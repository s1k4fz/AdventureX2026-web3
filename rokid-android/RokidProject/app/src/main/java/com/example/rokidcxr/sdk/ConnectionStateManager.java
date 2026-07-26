package com.example.rokidcxr.sdk;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.rokid.cxr.link.callbacks.ICXRLinkCbk;
import com.rokid.cxr.link.utils.GlassInfo;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import com.example.rokidcxr.sdk.capability.StatusCapabilityManager;

/**
 * 链路状态管理（单例）：持有 ICXRLinkCbk 实现，维护官方"双条件就绪"判定并向订阅者广播。
 *
 * 官方就绪判定（CustomView / CustomApp 一致）：
 *   onCXRLConnected(true)   —— 与 Rokid AI App 的 CXR 服务已连接
 *   onGlassBtConnected(true) —— 眼镜蓝牙已连接
 * 两者同时为 true 才可调用 customViewSetIcons/customViewOpen/appStart 及各子能力。
 *
 * 注意：链路就绪 ≠ 眼镜端场景构建完成；显示/音频/拍照还需等 onCustomViewOpened（见 DisplayCapabilityManager）。
 */
public final class ConnectionStateManager {

    private static final String TAG = "ConnectionStateManager";

    /** 链路状态快照 */
    public static class LinkState {
        /** CXR 服务（Rokid AI App）连接状态 */
        public final boolean cxrConnected;
        /** 眼镜蓝牙连接状态 */
        public final boolean glassBtConnected;

        LinkState(boolean cxrConnected, boolean glassBtConnected) {
            this.cxrConnected = cxrConnected;
            this.glassBtConnected = glassBtConnected;
        }

        /** 双条件就绪 */
        public boolean isReady() {
            return cxrConnected && glassBtConnected;
        }

        @Override
        public String toString() {
            return "LinkState{cxr=" + cxrConnected + ", glassBt=" + glassBtConnected + "}";
        }
    }

    public interface LinkStateListener {
        void onLinkStateChanged(LinkState state);

        /** 眼镜佩戴状态变化（可选关注） */
        default void onWearingStatusChanged(boolean wearing) {
        }
    }

    private static volatile ConnectionStateManager sInstance;

    public static ConnectionStateManager getInstance() {
        if (sInstance == null) {
            synchronized (ConnectionStateManager.class) {
                if (sInstance == null) {
                    sInstance = new ConnectionStateManager();
                }
            }
        }
        return sInstance;
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<LinkStateListener> listeners = new CopyOnWriteArrayList<>();
    private volatile boolean cxrConnected = false;
    private volatile boolean glassBtConnected = false;
    private volatile int glassBatteryLevel = 0;

    private ConnectionStateManager() {
    }

    public int getGlassBatteryLevel() {
        return glassBatteryLevel;
    }

    /** 能力调用前置检查：双条件就绪 */
    public boolean isLinkReady() {
        return cxrConnected && glassBtConnected;
    }

    public LinkState getCurrentState() {
        return new LinkState(cxrConnected, glassBtConnected);
    }

    public void addListener(LinkStateListener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    public void removeListener(LinkStateListener listener) {
        listeners.remove(listener);
    }

    /** 断开后复位状态（由 CxrSdkManager.disconnect 调用） */
    void reset() {
        cxrConnected = false;
        glassBtConnected = false;
        broadcast();
    }

    /**
     * 供 CXRLink.setCXRLinkCbk 注册的回调实现（已对齐 client-l:1.0.3 真实签名）。
     */
    private final ICXRLinkCbk linkCallback = new ICXRLinkCbk() {
        @Override
        public void onCXRLConnected(boolean connected) {
            Log.i(TAG, "onCXRLConnected: " + connected);
            cxrConnected = connected;
            broadcast();
        }

        @Override
        public void onGlassBtConnected(boolean connected) {
            Log.i(TAG, "onGlassBtConnected: " + connected);
            glassBtConnected = connected;
            broadcast();
        }

        @Override
        public void onGlassAiAssistStart() {
            Log.i(TAG, "onGlassAiAssistStart（语音唤醒开始）");
        }

        @Override
        public void onGlassAiAssistStop() {
            Log.i(TAG, "onGlassAiAssistStop（语音唤醒结束）");
        }

        @Override
        public void onGlassAiInterrupt(boolean interrupt) {
            Log.i(TAG, "onGlassAiInterrupt: " + interrupt);
        }

        @Override
        public void onGlassDeviceInfo(GlassInfo glassInfo) {
            // 字段：deviceName/batteryLevel/sound/brightness/systemVersion/ischarging/sn/wearingStatus
            if (glassInfo != null) {
                // 尝试通过反射获取 batteryLevel 字段
                try {
                    java.lang.reflect.Field field = glassInfo.getClass().getDeclaredField("batteryLevel");
                    field.setAccessible(true);
                    glassBatteryLevel = field.getInt(glassInfo);
                    Log.i(TAG, "onGlassDeviceInfo: batteryLevel=" + glassBatteryLevel);
                    // 通知 StatusCapabilityManager 更新
                    StatusCapabilityManager.getInstance().setGlassBatteryLevel(glassBatteryLevel);
                } catch (Exception e) {
                    Log.w(TAG, "获取眼镜电池电量失败: " + e.getMessage());
                }
            }
        }

        @Override
        public void onGlassWearingStatus(boolean wearing) {
            Log.i(TAG, "onGlassWearingStatus: " + wearing);
            for (LinkStateListener listener : listeners) {
                mainHandler.post(() -> listener.onWearingStatusChanged(wearing));
            }
        }
    };

    public ICXRLinkCbk getLinkCallback() {
        return linkCallback;
    }

    private void broadcast() {
        final LinkState state = getCurrentState();
        Log.i(TAG, "broadcast: " + state);
        for (LinkStateListener listener : listeners) {
            mainHandler.post(() -> listener.onLinkStateChanged(state));
        }
    }
}
