package com.example.rokidcxr.sdk.capability;

import android.util.Log;

import com.example.rokidcxr.sdk.CxrSdkManager;
import com.rokid.cxr.Caps;
import com.rokid.cxr.link.CXRLink;
import com.rokid.cxr.link.callbacks.ICustomCmdCbk;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 指令通道 Manager（单例）：手机与眼镜端自定义 App 的双向二进制消息。
 *
 * 官方 API（client-l:1.0.3）：
 *   setCXRCustomCmdCbk(ICustomCmdCbk) / sendCustomCmd(key, Caps)
 *   回调 onCustomCmdResult(key, byte[])，用 Caps.fromBytes 按约定字段顺序解析。
 *
 * ⚠️ 重要约束：
 * 1. 仅 CUSTOMAPP 会话支持自定义指令，CUSTOMVIEW 会话不支持！
 *    需通过 CxrSdkManager.connectCustomApp(context, 眼镜端包名) 建立会话。
 * 2. 眼镜端配套 App 需集成 CXR-S（cxr-service-bridge）并 subscribe 相同通道。
 * 3. 官方示例通道约定：
 *      手机 -> 眼镜: sendCustomCmd("rk_custom_client", caps)，眼镜 subscribe("rk_custom_client")
 *      眼镜 -> 手机: 眼镜 sendMessage("rk_custom_key", caps)，手机 onCustomCmdResult 过滤 "rk_custom_key"
 * 4. 双端必须约定一致的通道 key、字段顺序、类型与最大包大小。
 */
public final class CommandChannelManager extends BaseCapabilityManager {

    private static final String TAG = "CommandChannel";

    /** 手机 -> 眼镜 的通道 key（与眼镜端 subscribe 一致，可按业务改名） */
    public static final String CHANNEL_TO_GLASS = "rk_custom_client";
    /** 眼镜 -> 手机 的通道 key（与眼镜端 sendMessage 一致） */
    public static final String CHANNEL_FROM_GLASS = "rk_custom_key";

    /** 收到眼镜端消息的监听（已切主线程） */
    public interface CommandListener {
        /**
         * @param key     通道 key
         * @param payload 原始字节，用 Caps.fromBytes 按约定字段顺序解析
         */
        void onCommandReceived(String key, byte[] payload);
    }

    private static volatile CommandChannelManager sInstance;

    public static CommandChannelManager getInstance() {
        if (sInstance == null) {
            synchronized (CommandChannelManager.class) {
                if (sInstance == null) {
                    sInstance = new CommandChannelManager();
                }
            }
        }
        return sInstance;
    }

    private final List<CommandListener> commandListeners = new CopyOnWriteArrayList<>();

    private CommandChannelManager() {
    }

    public void addCommandListener(CommandListener listener) {
        if (listener != null && !commandListeners.contains(listener)) {
            commandListeners.add(listener);
        }
    }

    public void removeCommandListener(CommandListener listener) {
        commandListeners.remove(listener);
    }

    /**
     * 注册指令回调（CUSTOMAPP 会话 connect 发起后调用一次）。
     */
    public void registerCallback() {
        CXRLink link = CxrSdkManager.getInstance().getLink();
        if (link == null) {
            Log.w(TAG, "registerCallback: link 为空");
            return;
        }
        link.setCXRCustomCmdCbk(new ICustomCmdCbk() {
            @Override
            public void onCustomCmdResult(String key, byte[] payload) {
                dispatch(key, payload);
            }
        });
        Log.i(TAG, "registerCallback 完成");
    }

    /**
     * 向眼镜端发送文本消息（官方 Demo 字段约定：先写 key 再写内容）。
     *
     * @param message 消息内容
     */
    public void sendTextCommand(String message, CapabilityCallback<Void> callback) {
        String err = preCheck();
        if (err != null) {
            postError(callback, preCheckErrorCode(), err);
            return;
        }
        CXRLink link = CxrSdkManager.getInstance().getLink();
        Log.i(TAG, "sendTextCommand: " + message);
        Caps caps = new Caps();
        caps.write(CHANNEL_FROM_GLASS);
        caps.write(message);
        Integer status = link.sendCustomCmd(CHANNEL_TO_GLASS, caps);
        Log.i(TAG, "sendCustomCmd 返回: " + status);
        if (status != null) {
            postResult(callback, null); // 发送为异步单向，回执经 onCustomCmdResult
        } else {
            postError(callback, ERR_UNSUPPORTED, "sendCustomCmd 发送失败（确认会话类型为 CUSTOMAPP）");
        }
    }

    /**
     * 分发眼镜端消息给业务监听器（由 SDK 回调调用）。
     */
    public void dispatch(String key, byte[] payload) {
        Log.i(TAG, "dispatch: key=" + key + ", size=" + (payload == null ? 0 : payload.length));
        for (CommandListener listener : commandListeners) {
            mainHandler.post(() -> listener.onCommandReceived(key, payload));
        }
    }

    /** 页面销毁时清除回调（官方约束：不要 disconnect） */
    public void clearCallback() {
        commandListeners.clear();
    }
}
