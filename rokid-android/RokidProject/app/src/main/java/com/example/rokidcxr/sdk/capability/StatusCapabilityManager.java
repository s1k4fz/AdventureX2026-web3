package com.example.rokidcxr.sdk.capability;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.example.rokidcxr.sdk.CxrSdkManager;
import com.example.rokidcxr.sdk.ConnectionStateManager;

/**
 * 状态能力 Manager（单例）：监听蓝牙连接状态和眼镜电池电量，刷新 HUD 状态区。
 *
 * 状态显示规则：
 * - 未配对/未连接：显示 "BT"
 * - 已连接：显示 "● BT"（● 每3秒温柔闪烁）
 * - 眼镜电池电量显示百分比
 */
public final class StatusCapabilityManager {

    private static final String TAG = "StatusCapability";

    private static final long BLINK_INTERVAL_MS = 3000L; // 3秒闪烁周期
    private static final char BLINK_ON = '●';
    private static final char BLINK_OFF = '○';

    private static volatile StatusCapabilityManager sInstance;

    public static StatusCapabilityManager getInstance() {
        if (sInstance == null) {
            synchronized (StatusCapabilityManager.class) {
                if (sInstance == null) {
                    sInstance = new StatusCapabilityManager();
                }
            }
        }
        return sInstance;
    }

    private static final long TIME_UPDATE_INTERVAL_MS = 1000L; // 1秒更新时间
    private static final long GLASS_INFO_CHECK_INTERVAL_MS = 2000L; // 2秒检查眼镜信息

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean running = false;
    private volatile boolean registeredListener = false;
    private BroadcastReceiver batteryReceiver = null;
    private volatile boolean btConnected = false;
    private volatile boolean blinkState = true; // true=亮, false=灭
    private Runnable blinkRunnable = null;
    private Runnable timeRunnable = null;
    private Runnable glassInfoRunnable = null;
    private volatile int glassBatteryLevel = 0; // 眼镜电池电量

    private StatusCapabilityManager() {
    }

    public boolean isRunning() {
        return running;
    }

    /**
     * 启动状态监听。重复调用会先停旧监听（幂等）。
     */
    public void start() {
        if (running) {
            return;
        }
        running = true;
        btConnected = CxrSdkManager.getInstance().isGlassBtConnected();
        registerBatteryReceiver();
        // 注册眼镜信息监听
        registerGlassInfoListener();
        // 启动时立即刷新一次
        mainHandler.post(this::refreshStatus);
        // 启动蓝牙连接闪烁动画
        startBlinkAnimation();
        // 启动时间更新
        startTimeUpdate();
        // 启动眼镜信息检查
        startGlassInfoCheck();
        Log.i(TAG, "status listener started");
    }

    /**
     * 停止状态监听并释放资源（不动眼镜端已显示内容）。
     */
    public void stop() {
        if (!running) {
            return;
        }
        running = false;
        stopBlinkAnimation();
        stopTimeUpdate();
        stopGlassInfoCheck();
        unregisterGlassInfoListener();
        unregisterBatteryReceiver();
        // 单空格即视觉隐藏（空串固件不认）
        mainHandler.post(() -> DisplayCapabilityManager.getInstance().updateStatusText(" ", null));
        Log.i(TAG, "status listener stopped");
    }

    private void registerBatteryReceiver() {
        if (batteryReceiver != null) {
            return;
        }
        batteryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) {
                    return;
                }
                if (Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())) {
                    mainHandler.post(StatusCapabilityManager.this::refreshStatus);
                }
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Context context = CxrSdkManager.getInstance().getContext();
        context.registerReceiver(batteryReceiver, filter);
        Log.i(TAG, "battery receiver registered");
    }

    private void unregisterBatteryReceiver() {
        if (batteryReceiver == null) {
            return;
        }
        try {
            Context context = CxrSdkManager.getInstance().getContext();
            context.unregisterReceiver(batteryReceiver);
            Log.i(TAG, "battery receiver unregistered");
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "battery receiver not registered: " + e.getMessage());
        }
        batteryReceiver = null;
    }

    private void refreshStatus() {
        if (!running) {
            return;
        }
        boolean newBtConnected = CxrSdkManager.getInstance().isGlassBtConnected();
        if (newBtConnected != btConnected) {
            btConnected = newBtConnected;
            if (btConnected) {
                startBlinkAnimation();
            } else {
                stopBlinkAnimation();
            }
        }
        String statusText = buildStatusText();
        DisplayCapabilityManager.getInstance().updateStatusText(statusText, null);
        updateTimeText();
    }

    private void updateTimeText() {
        if (!running) {
            return;
        }
        String timeText = buildTimeText();
        DisplayCapabilityManager.getInstance().updateTimeText(timeText, null);
    }

    private String buildTimeText() {
        java.util.Date now = new java.util.Date();
        java.text.SimpleDateFormat timeFormat = new java.text.SimpleDateFormat("HH:mm:ss");
        java.text.SimpleDateFormat dateFormat = new java.text.SimpleDateFormat("yyyy/MM/dd");
        return timeFormat.format(now) + "\n" + dateFormat.format(now);
    }

    private String buildStatusText() {
        StringBuilder sb = new StringBuilder();
        if (btConnected) {
            // 蓝牙连接中，显示闪烁的 ● 或 ○
            sb.append(blinkState ? BLINK_ON : BLINK_OFF);
            sb.append(" BT");
        } else {
            sb.append("BT");  // 未连接状态
        }

        if (glassBatteryLevel > 0) {
            sb.append(" ").append(glassBatteryLevel).append("%");
        }

        return sb.toString();
    }

    /**
     * 设置眼镜电池电量（由眼镜信息回调调用）
     */
    public void setGlassBatteryLevel(int level) {
        this.glassBatteryLevel = level;
        mainHandler.post(this::updateTimeText);
    }

    private void startBlinkAnimation() {
        if (blinkRunnable != null) {
            return; // 已经在运行
        }
        blinkState = true;
        blinkRunnable = new Runnable() {
            @Override
            public void run() {
                if (!running) {
                    return;
                }
                blinkState = !blinkState;
                refreshStatus();
                mainHandler.postDelayed(this, BLINK_INTERVAL_MS);
            }
        };
        mainHandler.post(blinkRunnable);
        Log.i(TAG, "蓝牙连接闪烁动画启动");
    }

    private void stopBlinkAnimation() {
        if (blinkRunnable == null) {
            return;
        }
        mainHandler.removeCallbacks(blinkRunnable);
        blinkRunnable = null;
        blinkState = true;
        Log.i(TAG, "蓝牙连接闪烁动画停止");
    }

    private void startTimeUpdate() {
        if (timeRunnable != null) {
            return; // 已经在运行
        }
        timeRunnable = new Runnable() {
            @Override
            public void run() {
                if (!running) {
                    return;
                }
                updateTimeText();
                mainHandler.postDelayed(this, TIME_UPDATE_INTERVAL_MS);
            }
        };
        mainHandler.post(timeRunnable);
        Log.i(TAG, "时间更新启动");
    }

    private void stopTimeUpdate() {
        if (timeRunnable == null) {
            return;
        }
        mainHandler.removeCallbacks(timeRunnable);
        timeRunnable = null;
        Log.i(TAG, "时间更新停止");
    }

    private void registerGlassInfoListener() {
        if (registeredListener) {
            return;
        }
        ConnectionStateManager.getInstance().addListener(new ConnectionStateManager.LinkStateListener() {
            @Override
            public void onLinkStateChanged(ConnectionStateManager.LinkState state) {
                // 监听眼镜信息
            }

            @Override
            public void onWearingStatusChanged(boolean wearing) {
                // 监听佩戴状态
            }
        });
        registeredListener = true;
        Log.i(TAG, "眼镜信息监听器注册");
    }

    private void unregisterGlassInfoListener() {
        if (!registeredListener) {
            return;
        }
        // 目前没有直接的 unregister 方法，需要在玻璃信息回调中处理
        registeredListener = false;
        Log.i(TAG, "眼镜信息监听器注销");
    }

    private void startGlassInfoCheck() {
        if (glassInfoRunnable != null) {
            return;
        }
        glassInfoRunnable = new Runnable() {
            @Override
            public void run() {
                if (!running) {
                    return;
                }
                // 触发一次状态刷新以更新电池信息
                if (glassBatteryLevel > 0) {
                    updateTimeText();
                }
                mainHandler.postDelayed(this, GLASS_INFO_CHECK_INTERVAL_MS);
            }
        };
        mainHandler.post(glassInfoRunnable);
        Log.i(TAG, "眼镜信息检查启动");
    }

    private void stopGlassInfoCheck() {
        if (glassInfoRunnable == null) {
            return;
        }
        mainHandler.removeCallbacks(glassInfoRunnable);
        glassInfoRunnable = null;
        Log.i(TAG, "眼镜信息检查停止");
    }
}
