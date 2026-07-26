package com.example.rokidcxr.sdk.capability;

import android.os.Handler;
import android.os.Looper;

import com.example.rokidcxr.sdk.ConnectionStateManager;
import com.example.rokidcxr.sdk.CxrSdkManager;

/**
 * 能力 Manager 基类：统一"前置状态检查 -> 调用 -> 主线程回调"的骨架流程。
 *
 * 前置检查链：
 * 1. {@link CxrSdkManager#getLink()} 非空 —— CXRLink 已创建并发起连接
 * 2. {@link ConnectionStateManager#isLinkReady()} —— CXR 服务 + 眼镜蓝牙双条件就绪
 */
public abstract class BaseCapabilityManager {

    /** 能力调用统一错误码（本地自定义，与 SDK 回调错误码区分使用） */
    public static final int ERR_SDK_NOT_READY = -1001;
    public static final int ERR_GLASS_NOT_CONNECTED = -1002;
    public static final int ERR_UNSUPPORTED = -1003;
    public static final int ERR_SCENE_NOT_READY = -1004;

    protected final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** 能力调用统一回调（主线程触发） */
    public interface CapabilityCallback<T> {
        void onResult(T result);

        void onError(int errorCode, String message);
    }

    /**
     * 统一前置检查。
     *
     * @return null 表示检查通过；否则返回错误描述
     */
    protected String preCheck() {
        if (CxrSdkManager.getInstance().getLink() == null) {
            return "CXRLink 未创建（未连接）";
        }
        if (!ConnectionStateManager.getInstance().isLinkReady()) {
            return "链路未就绪（CXR 服务或眼镜蓝牙未连接）";
        }
        return null;
    }

    protected int preCheckErrorCode() {
        if (CxrSdkManager.getInstance().getLink() == null) {
            return ERR_SDK_NOT_READY;
        }
        return ERR_GLASS_NOT_CONNECTED;
    }

    protected <T> void postResult(CapabilityCallback<T> callback, T result) {
        if (callback != null) {
            mainHandler.post(() -> callback.onResult(result));
        }
    }

    protected <T> void postError(CapabilityCallback<T> callback, int code, String message) {
        if (callback != null) {
            mainHandler.post(() -> callback.onError(code, message));
        }
    }
}
