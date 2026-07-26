package com.example.rokidcxr;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.example.rokidcxr.hud.GlobeAnimator;
import com.example.rokidcxr.hud.HudCard;
import com.example.rokidcxr.hud.HudFeedManager;
import com.example.rokidcxr.sdk.ConnectionStateManager;
import com.example.rokidcxr.sdk.CxrSdkManager;
import com.example.rokidcxr.sdk.capability.AudioCapabilityManager;
import com.example.rokidcxr.sdk.capability.BaseCapabilityManager;
import com.example.rokidcxr.sdk.capability.DisplayCapabilityManager;
import com.example.rokidcxr.sdk.capability.ImageCapabilityManager;
import com.example.rokidcxr.sdk.capability.StatusCapabilityManager;

/**
 * 验证入口页：按官方流程逐步联调。
 *
 * 官方状态机顺序（CUSTOMVIEW 会话）：
 *   1. 检查 Rokid AI App（≥1.7.14）已安装
 *   2. 授权拿 token（拉起 Rokid AI 授权页，onActivityResult 解析）
 *   3. connect(token)，等 onCXRLConnected + onGlassBtConnected 双条件就绪
 *   4. customViewOpen，等 onCustomViewOpened（场景构建完成）
 *   5. 之后才能使用音频流 / 拍照；customViewUpdate 增量刷新
 *   6. 真正退出时 customViewClose + disconnect
 */
public class MainActivity extends Activity {

    private static final String TAG = "MainActivity";

    // ===== HUD 卡片流配置（backend/HUD.md）=====
    // USB 联调：adb reverse tcp:18473 tcp:18473 已建隧道，手机访本机端口即电脑后端。
    // 脱离 USB 时换回电脑局域网 IP（需同网段且放行防火墙，当前 WLAN AP 隔离 ping 不通）
    private static final String HUD_BASE_URL = "http://127.0.0.1:18473";
    // 开发直通 token（后端 .env 的 HUD_DEV_TOKEN，仅限 /hud/* 路由）；
    // 正式环境换成 Supabase 登录后的 access_token
    private static final String HUD_SUPABASE_TOKEN = "hud-dev-01b95861acb34f4e979e4ceaf778ee8a";

    // ===== 自动化流程开关（开发者配置）=====
    // true：打开 App 自动串完 1→2→3→4→9→10→11，眼镜 HUD 直接跑起来，按钮仍可手动干预。
    // 事件驱动状态机：授权拿到 token → 保活服务自动 connect → 链路就绪 openView
    // → onCustomViewOpened → 启动 HUD 卡片流 + 地球动画。
    // false：回到纯手动逐步联调模式。
    private static final boolean AUTO_PILOT = true;

    /** 自动流程一次性护栏：防止链路状态反复回调时重复触发 openView */
    private boolean autoViewRequested = false;

    private final Handler autoHandler = new Handler(Looper.getMainLooper());

    private TextView statusView;
    private TextView logView;

    /** POST_NOTIFICATIONS 运行时权限请求码（Android 13+ 前台服务通知需要） */
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1002;

    private final ConnectionStateManager.LinkStateListener linkStateListener =
            new ConnectionStateManager.LinkStateListener() {
                @Override
                public void onLinkStateChanged(ConnectionStateManager.LinkState state) {
                    refreshStatus();
                    appendLog("链路状态: " + state + (state.isReady() ? " ✔ 已就绪" : ""));
                    if (state.isReady()) {
                        // 链路就绪后注册各能力回调（进程内一次即可）
                        DisplayCapabilityManager.getInstance().registerCallback();
                        ImageCapabilityManager.getInstance().registerCallback();
                        AudioCapabilityManager.getInstance().registerCallback();
                        // 自动流程：就绪 → 步骤 4 打开眼镜视图（延时给固件喘息，防抖一次性）
                        if (AUTO_PILOT && !autoViewRequested
                                && !DisplayCapabilityManager.getInstance().isSceneOpened()) {
                            autoViewRequested = true;
                            appendLog("[自动] 链路就绪，打开眼镜文本视图…");
                            autoHandler.postDelayed(MainActivity.this::openView, 500);
                        }
                    }
                }

                @Override
                public void onWearingStatusChanged(boolean wearing) {
                    appendLog("佩戴状态: " + (wearing ? "已佩戴" : "已摘下"));
                }
            };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildContentView());
        ConnectionStateManager.getInstance().addListener(linkStateListener);
        // 进程重启后恢复上次授权的 token（保活服务自动重连依赖它）；
        // 有 token 就直接拉起保活服务，服务内部会自动 connect 重建链路
        if (CxrSdkManager.getInstance().restoreToken(this)) {
            appendLog("已恢复本地授权 token（失效则重走步骤 2）");
            LinkKeepAliveService.start(this);
            appendLog("息屏保活已自动开启（链路自动重建中，通知栏可见）");
        }
        requestNotificationPermissionIfNeeded();
        DisplayCapabilityManager.getInstance().setSceneListener(new DisplayCapabilityManager.SceneListener() {
            @Override
            public void onSceneOpened() {
                appendLog("场景构建完成（onCustomViewOpened）✔ 可使用音频/拍照");
                // 自动流程：场景就绪 → 步骤 9 卡片流 + 步骤 10 地球动画（幂等，重复回调无副作用）
                if (AUTO_PILOT) {
                    if (!HudFeedManager.getInstance().isRunning()) {
                        appendLog("[自动] 启动 HUD 卡片流…");
                        toggleHudFeed();
                    }
                    if (!GlobeAnimator.getInstance().isRunning()) {
                        appendLog("[自动] 启动地球动画…");
                        toggleGlobe();
                    }
                }
            }

            @Override
            public void onSceneClosed() {
                appendLog("CustomView 已关闭");
            }

            @Override
            public void onSceneError(int code, String message) {
                appendLog("CustomView 错误: code=" + code + ", " + message);
                // 自动流程：打开失败放行重试（下次链路就绪回调再触发 openView）
                autoViewRequested = false;
            }
        });
        refreshStatus();
        if (AUTO_PILOT) {
            runAutoPilot();
        }
    }

    @Override
    protected void onDestroy() {
        ConnectionStateManager.getInstance().removeListener(linkStateListener);
        autoHandler.removeCallbacksAndMessages(null);
        if (isFinishing()) {
            // 官方约束：仅会话真正结束时才关视图、断链路（保活服务同步停）
            LinkKeepAliveService.stop(this);
            GlobeAnimator.getInstance().stop();
            HudFeedManager.getInstance().stop();
            AudioCapabilityManager.getInstance().stopPlayback();
            AudioCapabilityManager.getInstance().stopAudioStream();
            DisplayCapabilityManager.getInstance().closeView();
            CxrSdkManager.getInstance().disconnect();
        }
        super.onDestroy();
    }

    private View buildContentView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        statusView = new TextView(this);
        statusView.setTextSize(14);
        root.addView(statusView);

        addButton(root, "1. 检查 Rokid AI App", v -> checkRequiredApp());
        addButton(root, "2. 发起授权（拿 token）", v -> requestAuth());
        addButton(root, "3. 连接（CUSTOMVIEW 会话）", v -> connect());
        addButton(root, "4. 打开眼镜文本视图", v -> openView());
        addButton(root, "5. 更新文本", v -> updateText());
        addButton(root, "6. 拍照", v -> takePhoto());
        addButton(root, "7. 开始/停止音频流", v -> toggleAudio());
        addButton(root, "8. 回放录音（试听）+ 存 WAV", v -> playAudio());
        addButton(root, "9. 启动/停止 HUD 卡片流", v -> toggleHudFeed());
        addButton(root, "10. 地球动画 开/关", v -> toggleGlobe());
        addButton(root, "11. 申请忽略电池优化（息屏保活必做）", v -> requestIgnoreBatteryOptimizations());
        addButton(root, "清空日志", v -> logView.setText(""));

        logView = new TextView(this);
        logView.setTextSize(12);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(logView);
        root.addView(scroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    private void addButton(LinearLayout parent, String text, View.OnClickListener listener) {
        Button btn = new Button(this);
        btn.setText(text);
        btn.setAllCaps(false);
        btn.setOnClickListener(listener);
        parent.addView(btn);
    }

    // ===== 步骤 1：环境检查 =====

    private void checkRequiredApp() {
        boolean installed = CxrSdkManager.getInstance().isRokidAiAppInstalled(this);
        appendLog("Rokid AI App（≥1.7.14）已安装: " + installed);
        if (!installed) {
            appendLog("请先安装/升级 Rokid AI App 并完成眼镜配对");
        }
    }

    // ===== 步骤 2：授权 =====

    private void requestAuth() {
        appendLog("发起授权（拉起 Rokid AI App 授权页）...");
        String token = CxrSdkManager.getInstance().requestAuth(this);
        if (token != null) {
            appendLog("此前已授权，同步拿到 token ✔");
            refreshStatus();
        }
        // 未同步返回时，结果经 onActivityResult 回调
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CxrSdkManager.AUTH_REQUEST_CODE) {
            String token = CxrSdkManager.getInstance().parseAuthResult(resultCode, data);
            if (token != null) {
                appendLog("授权成功，token 已持有 ✔");
                // 自动流程：授权回来 → 拉起保活服务（内部自动 connect，后续链路回调接力）
                if (AUTO_PILOT) {
                    appendLog("[自动] 开启保活并连接…");
                    LinkKeepAliveService.start(this);
                }
            } else {
                appendLog("授权失败/取消，请重试");
            }
            refreshStatus();
        }
    }

    // ===== 步骤 3：连接 =====

    private void connect() {
        if (!CxrSdkManager.getInstance().hasToken()) {
            appendLog("token 为空，请先完成步骤 2 授权");
            return;
        }
        boolean requested = CxrSdkManager.getInstance().connectCustomView(this);
        appendLog("connect 发起: " + requested + "（最终状态等 ICXRLinkCbk 回调）");
        // 链路建立后即开启息屏保活：前台服务防冻结 + LinkGuardian 自动重连
        LinkKeepAliveService.start(this);
        appendLog("息屏保活已开启（前台服务 + 自动重连，通知栏可见）");
    }

    // ===== 步骤 4/5：显示 =====

    private void openView() {
        DisplayCapabilityManager.getInstance().openTextView("xEngine XR 仪表盘\n等待数据接入…",
                new BaseCapabilityManager.CapabilityCallback<Void>() {
                    @Override
                    public void onResult(Void result) {
                        appendLog("customViewOpen 已发出，等 onCustomViewOpened");
                    }

                    @Override
                    public void onError(int errorCode, String message) {
                        appendLog("打开视图失败: code=" + errorCode + ", " + message);
                    }
                });
    }

    private void updateText() {
        String text = "更新时间: " + System.currentTimeMillis();
        DisplayCapabilityManager.getInstance().updateText(text,
                new BaseCapabilityManager.CapabilityCallback<Void>() {
                    @Override
                    public void onResult(Void result) {
                        appendLog("customViewUpdate 已发出");
                    }

                    @Override
                    public void onError(int errorCode, String message) {
                        appendLog("更新文本失败: code=" + errorCode + ", " + message);
                    }
                });
    }

    // ===== 步骤 6：拍照 =====

    private void takePhoto() {
        appendLog("发起拍照 1024x768 q80...");
        ImageCapabilityManager.getInstance().takePhoto(
                new BaseCapabilityManager.CapabilityCallback<byte[]>() {
                    @Override
                    public void onResult(byte[] jpeg) {
                        appendLog("拍照成功: " + (jpeg == null ? 0 : jpeg.length) + " bytes（JPEG）");
                        // 解码展示请切工作线程后 BitmapFactory.decodeByteArray
                    }

                    @Override
                    public void onError(int errorCode, String message) {
                        appendLog("拍照失败: code=" + errorCode + ", " + message);
                    }
                });
    }

    // ===== 步骤 7：音频 =====

    private void toggleAudio() {
        AudioCapabilityManager audio = AudioCapabilityManager.getInstance();
        if (audio.isStreaming()) {
            audio.stopAudioStream();
            appendLog("音频流已停止");
            return;
        }
        appendLog("开启音频流（16k/mono/16bit PCM）...");
        audio.startAudioStream(new AudioCapabilityManager.AudioStreamListener() {
            private long totalBytes = 0;

            @Override
            public void onAudioFrame(byte[] data, int offset, int length) {
                // SDK 原始线程回调：只做累计，严禁耗时操作
                totalBytes += length;
            }

            @Override
            public void onStreamStateChanged(boolean started) {
                appendLog("音频流状态: " + (started ? "已开启" : "已停止")
                        + "，累计 " + totalBytes + " bytes（约 "
                        + (totalBytes / (AudioCapabilityManager.SAMPLE_RATE * 2)) + " 秒）");
            }

            @Override
            public void onAudioError(int code, String message) {
                appendLog("音频错误: code=" + code + ", " + message);
            }
        }, new BaseCapabilityManager.CapabilityCallback<Void>() {
            @Override
            public void onResult(Void result) {
                appendLog("startAudioStream 已发出");
            }

            @Override
            public void onError(int errorCode, String message) {
                appendLog("开启音频流失败: code=" + errorCode + ", " + message);
            }
        });
    }

    // ===== 步骤 8：回放试听 =====

    private void playAudio() {
        AudioCapabilityManager audio = AudioCapabilityManager.getInstance();
        int bytes = audio.getCapturedByteCount();
        if (bytes <= 0) {
            appendLog("暂无录音数据，请先点步骤 7 采集一段音频");
            return;
        }
        // 先存成 WAV（便于 adb pull 验证）
        try {
            java.io.File wav = audio.saveLastCaptureAsWav(getExternalFilesDir(null));
            if (wav != null) {
                appendLog("已存 WAV: " + wav.getAbsolutePath());
            }
        } catch (Exception e) {
            appendLog("存 WAV 失败: " + e.getMessage());
        }
        appendLog("开始回放（输出跟随系统：连蓝牙耳机则走蓝牙）...");
        audio.playLastCapture(new AudioCapabilityManager.PlaybackListener() {
            @Override
            public void onPlaybackStart(int pcmBytes, int seconds) {
                appendLog("回放中: " + pcmBytes + " bytes（约 " + seconds + " 秒）");
            }

            @Override
            public void onPlaybackFinish() {
                appendLog("回放完成 ✔");
            }

            @Override
            public void onPlaybackError(String message) {
                appendLog("回放失败: " + message);
            }
        });
    }

    // ===== 步骤 9：HUD 卡片流 =====

    private void toggleHudFeed() {
        HudFeedManager hud = HudFeedManager.getInstance();
        if (hud.isRunning()) {
            hud.stop();
            appendLog("HUD 卡片流已停止");
            return;
        }
        if (HUD_SUPABASE_TOKEN.isEmpty()) {
            appendLog("HUD_SUPABASE_TOKEN 为空：先填入 Supabase access_token（见 backend/HUD.md 第 1 节）");
            return;
        }
        if (!DisplayCapabilityManager.getInstance().isSceneOpened()) {
            appendLog("提示：场景未打开，卡片只入队不上屏；先点步骤 4 打开文本视图");
        }
        appendLog("启动 HUD 卡片流: " + HUD_BASE_URL + "/api/v1/hud/stream");
        hud.start(HUD_BASE_URL, HUD_SUPABASE_TOKEN, new HudFeedManager.FeedListener() {
            @Override
            public void onFeedConnected() {
                appendLog("HUD 流已连接 ✔（等 snapshot）");
            }

            @Override
            public void onFeedDisconnected(String reason) {
                appendLog("HUD 流断开: " + reason + "（自动重连中）");
            }

            @Override
            public void onAuthError() {
                appendLog("HUD 流 401：Supabase token 失效，请刷新后重新启动");
            }

            @Override
            public void onCardShown(HudCard card) {
                appendLog("上屏 [" + card.priority + "] " + card.title);
            }
        });
    }

    // ===== 步骤 10：地球自转动画 =====

    private void toggleGlobe() {
        GlobeAnimator globe = GlobeAnimator.getInstance();
        if (globe.isRunning()) {
            globe.stop();
            appendLog("地球动画已停止，卡片轮播恢复");
            return;
        }
        if (!DisplayCapabilityManager.getInstance().isSceneOpened()) {
            appendLog("场景未打开：先点步骤 4 打开文本视图，再启动地球动画");
            return;
        }
        globe.start();
        appendLog("左下角小地球转动中（卡片轮播不受影响，再点一次隐藏）");
    }

    // ===== 息屏保活配套 =====

    /**
     * 自动化流程入口（AUTO_PILOT=true 时 onCreate 触发）：
     * 步骤 1 检查 → 步骤 11 电池白名单（已在白名单则静默跳过）→ 步骤 2 授权
     * （已有 token 跳过）。后续 3/4/9/10 由链路/场景回调事件接力，无需轮询。
     */
    private void runAutoPilot() {
        appendLog("═══ 自动化流程已启用（AUTO_PILOT）═══");
        // 步骤 1：环境检查，不通过则中止（授权页都拉不起来）
        if (!CxrSdkManager.getInstance().isRokidAiAppInstalled(this)) {
            appendLog("[自动] 中止：Rokid AI App 未安装/版本过低，请先装好并配对眼镜");
            return;
        }
        appendLog("[自动] 步骤 1 通过：Rokid AI App 已安装");
        // 步骤 11：不在白名单才弹系统窗（root 机已预配置，通常静默跳过）
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (!pm.isIgnoringBatteryOptimizations(getPackageName())) {
            appendLog("[自动] 步骤 11：申请电池白名单…");
            requestIgnoreBatteryOptimizations();
        }
        // 步骤 2/3：有 token 时 onCreate 已拉起保活服务（内部自动 connect），
        // 这里只兜授权缺失的场景
        if (!CxrSdkManager.getInstance().hasToken()) {
            appendLog("[自动] 步骤 2：无本地 token，拉起授权页…");
            requestAuth();
            return;
        }
        // 兜底：Activity 重进时链路/场景可能早已就绪（保活服务一直持着），
        // 状态回调不会再来，直接接力后续步骤
        if (DisplayCapabilityManager.getInstance().isSceneOpened()) {
            if (!HudFeedManager.getInstance().isRunning()) {
                appendLog("[自动] 场景已就绪，启动 HUD 卡片流…");
                toggleHudFeed();
            }
            if (!GlobeAnimator.getInstance().isRunning()) {
                toggleGlobe();
            }
        } else if (ConnectionStateManager.getInstance().isLinkReady() && !autoViewRequested) {
            autoViewRequested = true;
            appendLog("[自动] 链路已就绪（复用现有链路），打开眼镜文本视图…");
            autoHandler.postDelayed(this::openView, 500);
        }
        // 其余情况：链路就绪回调 → openView；onCustomViewOpened → HUD 流 + 地球动画
    }

    /** Android 13+ 首次启动申请通知权限；拒授不影响保活，仅通知栏不显示 */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                        != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},
                    NOTIFICATION_PERMISSION_REQUEST_CODE);
        }
    }

    /**
     * 申请忽略电池优化（系统弹窗）。注意：Rokid AI App 也必须手动加白名单，
     * 它被杀会直接触发 onCXRLConnected(false)；国产 ROM 还需开自启动+后台无限制。
     */
    private void requestIgnoreBatteryOptimizations() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm.isIgnoringBatteryOptimizations(getPackageName())) {
            appendLog("本 App 已在电池白名单 ✔（别忘了给 Rokid AI App 也设置）");
            return;
        }
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())));
            appendLog("已拉起电池白名单弹窗，请点“允许”");
        } catch (Exception e) {
            appendLog("拉起失败，请去 设置>电池 手动把本 App 设为无限制: " + e.getMessage());
        }
    }

    // ===== 工具 =====

    private void refreshStatus() {
        ConnectionStateManager.LinkState state = ConnectionStateManager.getInstance().getCurrentState();
        statusView.setText("token: " + (CxrSdkManager.getInstance().hasToken() ? "已持有" : "无")
                + " | CXR服务: " + state.cxrConnected
                + " | 眼镜蓝牙: " + state.glassBtConnected
                + " | 场景: " + (DisplayCapabilityManager.getInstance().isSceneOpened() ? "已打开" : "未打开"));
    }

    private void appendLog(String line) {
        Log.i(TAG, line);
        logView.append(line + "\n");
    }
}
