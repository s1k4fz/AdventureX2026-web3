package com.example.rokidcxr.sdk;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * CXR 链路守护（单例）：链路掉线后自动重建，解决息屏/后台导致的 HUD 断链。
 *
 * 策略（对齐官方约束：进程内单 CXRLink 实例，重连只能 disconnect 后重建）：
 * 1. 双条件（onCXRLConnected + onGlassBtConnected）任一变 false 开始计时；
 * 2. 宽限期内不动作 —— 蓝牙瞬断时 Rokid AI App/SDK 会自愈，贸然重建反而拖慢恢复；
 * 3. 超过宽限期仍未就绪 → disconnect + 重新 connectCustomView(token)，指数退避重试；
 * 4. 恢复就绪后清零退避计数。
 *
 * 前置：token 已持有（内存或 SharedPreferences 恢复）。token 缺失时只能等
 * 用户回 MainActivity 重新授权（OAuth 必须走 Activity），守护只记日志不重试。
 *
 * 由 LinkKeepAliveService 启停；能力回调重注册、场景重建等"就绪后动作"
 * 不在本类做（见 LinkKeepAliveService 的链路监听）。
 */
public final class LinkGuardian {

    private static final String TAG = "LinkGuardian";

    /** 掉线自愈宽限期：期内交给 SDK 自己恢复，不强行重建 */
    private static final long NOT_READY_GRACE_MS = 20_000L;
    /** 巡检周期 */
    private static final long CHECK_INTERVAL_MS = 10_000L;
    /** 重建退避：5s 起步，60s 封顶 */
    private static final long RECONNECT_BASE_MS = 5_000L;
    private static final long RECONNECT_MAX_MS = 60_000L;
    /** disconnect 与重新 connect 之间的间隔，给 SDK 释放旧链路的时间 */
    private static final long REBUILD_DELAY_MS = 800L;

    private static volatile LinkGuardian sInstance;

    public static LinkGuardian getInstance() {
        if (sInstance == null) {
            synchronized (LinkGuardian.class) {
                if (sInstance == null) {
                    sInstance = new LinkGuardian();
                }
            }
        }
        return sInstance;
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private volatile boolean running = false;
    private Context appContext;
    /** 首次观测到未就绪的时刻；0 表示当前就绪 */
    private long notReadySinceMs = 0L;
    /** 下次允许重建的时刻（退避控制） */
    private long nextRetryAtMs = 0L;
    private int reconnectAttempts = 0;

    private LinkGuardian() {
    }

    private final ConnectionStateManager.LinkStateListener stateListener =
            state -> {
                if (state.isReady()) {
                    if (notReadySinceMs != 0) {
                        Log.i(TAG, "链路已恢复就绪，退避计数清零");
                    }
                    notReadySinceMs = 0L;
                    nextRetryAtMs = 0L;
                    reconnectAttempts = 0;
                } else if (notReadySinceMs == 0) {
                    notReadySinceMs = System.currentTimeMillis();
                    Log.w(TAG, "链路失去就绪: " + state + "，进入 "
                            + (NOT_READY_GRACE_MS / 1000) + "s 自愈宽限期");
                }
            };

    public boolean isRunning() {
        return running;
    }

    /** 启动守护（幂等）。appContext 用于重建链路。 */
    public synchronized void start(Context context) {
        if (running) {
            return;
        }
        this.appContext = context.getApplicationContext();
        running = true;
        // 启动瞬间未就绪也从现在计时（覆盖服务先于链路启动的场景）
        notReadySinceMs = ConnectionStateManager.getInstance().isLinkReady()
                ? 0L : System.currentTimeMillis();
        nextRetryAtMs = 0L;
        reconnectAttempts = 0;
        ConnectionStateManager.getInstance().addListener(stateListener);
        mainHandler.postDelayed(checkRunnable, CHECK_INTERVAL_MS);
        Log.i(TAG, "守护已启动");
    }

    public synchronized void stop() {
        running = false;
        ConnectionStateManager.getInstance().removeListener(stateListener);
        mainHandler.removeCallbacks(checkRunnable);
        Log.i(TAG, "守护已停止");
    }

    private final Runnable checkRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) {
                return;
            }
            mainHandler.postDelayed(this, CHECK_INTERVAL_MS);
            check();
        }
    };

    private void check() {
        if (ConnectionStateManager.getInstance().isLinkReady()) {
            return;
        }
        if (!CxrSdkManager.getInstance().hasToken()) {
            Log.w(TAG, "token 缺失，无法自动重连（需回 App 重新授权）");
            return;
        }
        long now = System.currentTimeMillis();
        if (notReadySinceMs == 0) {
            // 监听回调可能晚于巡检（如 link 从未建立过），此处兜底计时
            notReadySinceMs = now;
            return;
        }
        if (now - notReadySinceMs < NOT_READY_GRACE_MS) {
            return; // 宽限期内等 SDK 自愈
        }
        if (now < nextRetryAtMs) {
            return; // 退避中
        }
        long delay = Math.min(RECONNECT_MAX_MS,
                RECONNECT_BASE_MS << Math.min(reconnectAttempts, 4));
        reconnectAttempts++;
        nextRetryAtMs = now + REBUILD_DELAY_MS + delay;
        Log.w(TAG, "链路失联 " + ((now - notReadySinceMs) / 1000) + "s，第 "
                + reconnectAttempts + " 次重建（下次重试最快 " + delay + "ms 后）");
        rebuildLink();
    }

    /** 官方无 reconnect API：只能 disconnect 释放旧实例后重建会话 */
    private void rebuildLink() {
        CxrSdkManager sdk = CxrSdkManager.getInstance();
        sdk.disconnect();
        mainHandler.postDelayed(() -> {
            if (!running) {
                return;
            }
            boolean requested = sdk.connectCustomView(appContext);
            Log.i(TAG, "重建 connect 发起=" + requested + "（结果等 ICXRLinkCbk 回调）");
        }, REBUILD_DELAY_MS);
    }
}
