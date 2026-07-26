package com.example.rokidcxr;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import com.example.rokidcxr.hud.HudFeedManager;
import com.example.rokidcxr.sdk.ConnectionStateManager;
import com.example.rokidcxr.sdk.CxrSdkManager;
import com.example.rokidcxr.sdk.LinkGuardian;
import com.example.rokidcxr.sdk.capability.AudioCapabilityManager;
import com.example.rokidcxr.sdk.capability.DisplayCapabilityManager;
import com.example.rokidcxr.sdk.capability.ImageCapabilityManager;

/**
 * 链路保活前台服务：息屏/退后台时防止进程被冻结（Android 12+ cached app
 * freezer / OEM 杀后台），保证 CXR 链路 + HUD SSE 持续工作。
 *
 * 职责：
 * 1. startForeground(connectedDevice) —— 进程保持前台等级，不被冻结；
 * 2. PARTIAL_WAKE_LOCK —— 息屏后 CPU 不休眠（USB 供电场景无耗电顾虑）；
 * 3. 启停 LinkGuardian —— CXR 链路掉线自动重建；
 * 4. 链路重新就绪后补做"就绪后动作"：重注册能力回调（重建的 CXRLink 是新实例，
 *    旧回调全部失效）+ 若 HUD 流仍在跑则重建眼镜端场景。
 *
 * 启停时机：MainActivity 发起 connect 后 start；会话真正结束（isFinishing）时 stop。
 * 配合手段（代码外）：本 App 与 Rokid AI App 都要加电池白名单/后台无限制，
 * 否则前台服务在部分国产 ROM 上仍会被杀。
 */
public class LinkKeepAliveService extends Service {

    private static final String TAG = "LinkKeepAliveService";

    private static final String CHANNEL_ID = "link_keepalive";
    private static final int NOTIFICATION_ID = 42;
    /** 链路恢复到场景重建的延时：等 Rokid AI App 侧状态稳定 */
    private static final long SCENE_REBUILD_DELAY_MS = 1_500L;

    public static void start(Context context) {
        context.startForegroundService(new Intent(context, LinkKeepAliveService.class));
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, LinkKeepAliveService.class));
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;

    private final ConnectionStateManager.LinkStateListener linkListener =
            new ConnectionStateManager.LinkStateListener() {
                @Override
                public void onLinkStateChanged(ConnectionStateManager.LinkState state) {
                    updateNotification(state);
                    if (state.isReady()) {
                        onLinkRestored();
                    }
                }
            };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        Notification notification = buildNotification(
                ConnectionStateManager.getInstance().getCurrentState());
        // targetSdk 34 必须声明 FGS 类型；connectedDevice 语义对应"维持外设链路"
        startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rokidcxr:link");
        wakeLock.setReferenceCounted(false);
        // 不设超时：展会场景 USB 常供电；stop 时统一释放
        wakeLock.acquire();
        ConnectionStateManager.getInstance().addListener(linkListener);
        LinkGuardian.getInstance().start(this);
        // 开机自启/START_STICKY 重拉场景：恢复 token 后立即重建链路，
        // 不等 guardian 的 20s 宽限期（无 token/已有链路时为空操作）
        if (CxrSdkManager.getInstance().restoreToken(this)
                && CxrSdkManager.getInstance().getLink() == null) {
            boolean requested = CxrSdkManager.getInstance().connectCustomView(this);
            Log.i(TAG, "服务启动自动重连: connect 发起=" + requested);
        }
        Log.i(TAG, "前台保活已启动（wakelock + guardian）");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 被系统回收后自动拉起（token 若已丢失，guardian 会记日志等待重新授权）
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        LinkGuardian.getInstance().stop();
        ConnectionStateManager.getInstance().removeListener(linkListener);
        mainHandler.removeCallbacksAndMessages(null);
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        Log.i(TAG, "前台保活已停止");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ===== 链路恢复后的自愈动作 =====

    /**
     * 链路（重新）就绪：guardian 重建的 CXRLink 是新实例，能力回调必须重注册；
     * HUD 流还在跑但眼镜端场景已丢时，重建场景让卡片流恢复上屏。
     */
    private void onLinkRestored() {
        DisplayCapabilityManager.getInstance().registerCallback();
        ImageCapabilityManager.getInstance().registerCallback();
        AudioCapabilityManager.getInstance().registerCallback();
        if (!HudFeedManager.getInstance().isRunning()) {
            return;
        }
        mainHandler.postDelayed(() -> {
            DisplayCapabilityManager display = DisplayCapabilityManager.getInstance();
            if (!ConnectionStateManager.getInstance().isLinkReady()
                    || display.isSceneOpened()) {
                return;
            }
            Log.i(TAG, "链路恢复但场景未开，重建眼镜端视图");
            // openTextView 自带旧视图关闭重建逻辑；文本随后被轮播 tick 覆盖
            display.openTextView("xEngine XR 仪表盘\n链路已恢复，等待数据…", null);
        }, SCENE_REBUILD_DELAY_MS);
    }

    // ===== 通知 =====

    private void createChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                "眼镜链路保活", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("维持 Rokid 眼镜链路与 HUD 数据流");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildNotification(ConnectionStateManager.LinkState state) {
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class)
                        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text;
        if (state.isReady()) {
            text = "链路正常（CXR ✓ 蓝牙 ✓）";
        } else if (!CxrSdkManager.getInstance().hasToken()) {
            text = "等待授权：请打开 App 完成 Rokid 授权";
        } else {
            text = "链路恢复中（CXR " + (state.cxrConnected ? "✓" : "✗")
                    + " 蓝牙 " + (state.glassBtConnected ? "✓" : "✗") + "）";
        }
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle("Rokid HUD 保活中")
                .setContentText(text)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(ConnectionStateManager.LinkState state) {
        getSystemService(NotificationManager.class)
                .notify(NOTIFICATION_ID, buildNotification(state));
    }
}
