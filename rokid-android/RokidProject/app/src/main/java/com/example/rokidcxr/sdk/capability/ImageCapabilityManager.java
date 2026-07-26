package com.example.rokidcxr.sdk.capability;

import android.util.Log;

import com.example.rokidcxr.sdk.CxrSdkManager;
import com.rokid.cxr.link.CXRLink;
import com.rokid.cxr.link.callbacks.IImageStreamCbk;

/**
 * 图像能力 Manager（单例）：眼镜拍照。
 *
 * 官方 API（client-l:1.0.3）：
 *   setCXRImageCbk(IImageStreamCbk) / takePhoto(width, height, quality)
 *   回调 onImageReceived(byte[]) 返回 JPEG 字节，onImageError(code, msg) 失败。
 *
 * 约束：
 * 1. 前置：链路双条件就绪 + 场景构建完成（onCustomViewOpened / appStart 成功）
 * 2. 收到上一次回调前不要发起下一次拍照（避免并发问题）
 * 3. 建议已授予 GlassPermission.CAMERA（授权阶段申请）
 * 4. JPEG 解码请切到工作线程，勿阻塞回调
 */
public final class ImageCapabilityManager extends BaseCapabilityManager {

    private static final String TAG = "ImageCapability";

    /** 默认拍照参数 */
    public static final int DEFAULT_WIDTH = 1024;
    public static final int DEFAULT_HEIGHT = 768;
    public static final int DEFAULT_QUALITY = 80; // JPEG 0~100

    private static volatile ImageCapabilityManager sInstance;

    public static ImageCapabilityManager getInstance() {
        if (sInstance == null) {
            synchronized (ImageCapabilityManager.class) {
                if (sInstance == null) {
                    sInstance = new ImageCapabilityManager();
                }
            }
        }
        return sInstance;
    }

    /** 拍照进行中标记：等回调返回前拒绝并发拍照 */
    private volatile boolean capturing = false;
    private volatile CapabilityCallback<byte[]> pendingCallback;

    private ImageCapabilityManager() {
    }

    /**
     * 注册图像回调（connect 发起后调用一次）。
     */
    public void registerCallback() {
        CXRLink link = CxrSdkManager.getInstance().getLink();
        if (link == null) {
            Log.w(TAG, "registerCallback: link 为空");
            return;
        }
        link.setCXRImageCbk(new IImageStreamCbk() {
            @Override
            public void onImageReceived(byte[] data) {
                Log.i(TAG, "onImageReceived: " + (data == null ? 0 : data.length) + " bytes");
                capturing = false;
                CapabilityCallback<byte[]> cb = pendingCallback;
                pendingCallback = null;
                if (cb != null) {
                    postResult(cb, data); // JPEG 字节，BitmapFactory 解码请切工作线程
                }
            }

            @Override
            public void onImageError(int code, String msg) {
                Log.e(TAG, "onImageError: code=" + code + ", " + msg);
                capturing = false;
                CapabilityCallback<byte[]> cb = pendingCallback;
                pendingCallback = null;
                if (cb != null) {
                    postError(cb, code, msg);
                }
            }
        });
        Log.i(TAG, "registerCallback 完成");
    }

    /** 以默认参数拍照 */
    public void takePhoto(CapabilityCallback<byte[]> callback) {
        takePhoto(DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_QUALITY, callback);
    }

    /**
     * 触发眼镜拍照，JPEG 字节经回调返回。
     */
    public void takePhoto(int width, int height, int quality, CapabilityCallback<byte[]> callback) {
        String err = preCheck();
        if (err != null) {
            postError(callback, preCheckErrorCode(), err);
            return;
        }
        if (!DisplayCapabilityManager.getInstance().isSceneOpened()) {
            postError(callback, ERR_SCENE_NOT_READY, "场景未构建完成（需先 openTextView 等待 onCustomViewOpened）");
            return;
        }
        if (capturing) {
            postError(callback, ERR_UNSUPPORTED, "上一次拍照未返回，请等待回调");
            return;
        }
        CXRLink link = CxrSdkManager.getInstance().getLink();
        capturing = true;
        pendingCallback = callback;
        Log.i(TAG, "takePhoto(" + width + ", " + height + ", " + quality + ")");
        boolean sent = link.takePhoto(width, height, quality);
        if (!sent) {
            capturing = false;
            pendingCallback = null;
            postError(callback, ERR_UNSUPPORTED, "takePhoto 发送失败");
        }
        // 成功时结果经 onImageReceived / onImageError 回调
    }

    /** 子页面销毁时清除回调（官方约束：不要 disconnect） */
    public void clearCallback() {
        pendingCallback = null;
        capturing = false;
    }
}
