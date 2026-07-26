package com.example.rokidcxr.sdk;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.Pair;

import com.rokid.cxr.link.CXRLink;
import com.rokid.cxr.link.utils.CxrDefs;
import com.rokid.sprite.aiapp.externalapp.auth.AuthResult;
import com.rokid.sprite.aiapp.externalapp.auth.AuthorizationHelper;
import com.rokid.sprite.aiapp.externalapp.auth.GlassPermission;

/**
 * CXR-L SDK 封装（单例）：鉴权 + CXRLink 生命周期管理。
 *
 * 官方流程（client-l:1.0.3）：
 * 1. 检查 Rokid AI App（≥1.7.14）已安装 —— AuthorizationHelper.isRequiredRokidAppInstalled
 * 2. OAuth 式授权拿 token —— AuthorizationHelper.requestAuthorization / parseAuthorizationResult
 * 3. 创建 CXRLink -> configCXRSession(CUSTOMVIEW) -> setCXRLinkCbk -> connect(token)
 * 4. 等 onCXRLConnected(true) + onGlassBtConnected(true) 双条件满足后才算链路就绪
 *
 * 注意：整个进程复用同一个 CXRLink 实例；切换会话类型（CUSTOMVIEW/CUSTOMAPP）需重建 CXRLink。
 */
public final class CxrSdkManager {

    private static final String TAG = "CxrSdkManager";

    /** 授权请求码，MainActivity onActivityResult 使用 */
    public static final int AUTH_REQUEST_CODE = 1001;

    /** token 持久化：进程被杀重启后 LinkGuardian 才能免授权自动重连 */
    private static final String PREFS_NAME = "cxr_sdk";
    private static final String PREF_KEY_TOKEN = "auth_token";

    private static volatile CxrSdkManager sInstance;

    public static CxrSdkManager getInstance() {
        if (sInstance == null) {
            synchronized (CxrSdkManager.class) {
                if (sInstance == null) {
                    sInstance = new CxrSdkManager();
                }
            }
        }
        return sInstance;
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    /** 进程内共享的全局链路实例（官方要求单实例复用） */
    private volatile CXRLink link;
    /** 授权后获得的通信 token */
    private volatile String token;
    /** 应用上下文（用于注册广播等） */
    private volatile Context context;

    private CxrSdkManager() {
    }

    /** 全局 CXRLink 实例；未连接时为 null。能力 Manager 通过此方法取链路。 */
    public CXRLink getLink() {
        return link;
    }

    /** 应用上下文；可用于注册广播等操作 */
    public Context getContext() {
        return context;
    }

    public boolean hasToken() {
        return token != null && !token.isEmpty();
    }

    /** 眼镜蓝牙是否连接（链路就绪的双条件之一） */
    public boolean isGlassBtConnected() {
        return ConnectionStateManager.getInstance().isLinkReady() && 
               ConnectionStateManager.getInstance().getCurrentState().glassBtConnected;
    }

    // ==================== 鉴权 ====================

    /**
     * 检查 Rokid AI App（国内版，≥1.7.14）是否已安装且满足最低版本。
     */
    public boolean isRokidAiAppInstalled(Activity activity) {
        return AuthorizationHelper.INSTANCE.isRequiredRokidAppInstalled(activity);
    }

    /**
     * 发起授权：拉起 Rokid AI App 的授权页，同时申请眼镜端运行时权限（麦克风/相机）。
     * 若此前已授权过，可能同步返回 (resultCode, data)，此时直接解析出 token；
     * 否则结果经 Activity#onActivityResult 回到 {@link #parseAuthResult}。
     *
     * @return 同步拿到的 token；需要走授权页时返回 null
     */
    public String requestAuth(Activity activity) {
        Pair<Integer, Intent> immediate = AuthorizationHelper.INSTANCE.requestAuthorization(
                activity,
                new GlassPermission[]{GlassPermission.MICROPHONE, GlassPermission.CAMERA},
                AUTH_REQUEST_CODE);
        if (immediate != null) {
            String t = parseAuthResult(immediate.first, immediate.second);
            if (t != null) {
                Log.i(TAG, "requestAuth: 已授权过，同步拿到 token");
                return t;
            }
        }
        return null;
    }

    /**
     * 在 onActivityResult 中解析授权结果。注意第一个参数是 resultCode 而不是 requestCode！
     * 成功时 token 同步落盘（见 {@link #restoreToken}）。
     *
     * @return 解析出的 token；失败/取消返回 null
     */
    public String parseAuthResult(int resultCode, Intent data) {
        AuthResult result = AuthorizationHelper.INSTANCE.parseAuthorizationResult(resultCode, data);
        if (result instanceof AuthResult.AuthSuccess) {
            String t = ((AuthResult.AuthSuccess) result).getToken();
            if (t != null && !t.isEmpty()) {
                this.token = t;
                persistToken(t);
                return t;
            }
        }
        this.token = null;
        persistToken(null);
        return null;
    }

    /**
     * 进程重启后从 SharedPreferences 恢复上次授权的 token（MainActivity/保活服务
     * 启动时调用）。token 是否仍有效由后续 connect 的回调裁决，失效则需重新授权。
     *
     * @return 恢复（或本就持有）后是否有 token
     */
    public boolean restoreToken(Context context) {
        this.context = context.getApplicationContext();
        if (hasToken()) {
            return true;
        }
        String saved = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PREF_KEY_TOKEN, null);
        if (saved != null && !saved.isEmpty()) {
            this.token = saved;
            Log.i(TAG, "restoreToken: 已从本地恢复授权 token");
        }
        return hasToken();
    }

    private void persistToken(String t) {
        Context ctx = this.context;
        if (ctx == null) {
            Log.w(TAG, "persistToken: context 为空，token 未落盘");
            return;
        }
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString(PREF_KEY_TOKEN, t)
                .apply();
    }

    // ==================== 连接 ====================

    /**
     * 创建 CUSTOMVIEW 会话并连接。
     * 前置：已通过授权拿到非空 token。
     *
     * @return connect 请求是否发起成功（最终状态以 ICXRLinkCbk 回调为准）
     */
    public synchronized boolean connectCustomView(Context context) {
        if (!hasToken()) {
            Log.e(TAG, "connectCustomView: token 为空，请先完成授权");
            return false;
        }
        if (link != null) {
            // 幂等处理：已有链路实例时不重建，已就绪则直接视为成功
            boolean ready = ConnectionStateManager.getInstance().isLinkReady();
            Log.i(TAG, "connectCustomView: 链路已存在，就绪=" + ready + "，跳过重建");
            return ready;
        }
        // 保存应用上下文供其他组件使用
        this.context = context.getApplicationContext();
        CXRLink newLink = new CXRLink(this.context);
        // CUSTOMVIEW 会话：支持自定义视图显示 + 音频 + 拍照；不支持自定义指令
        newLink.configCXRSession(new CxrDefs.CXRSession(CxrDefs.CXRSessionType.CUSTOMVIEW));
        // 链路回调统一交给 ConnectionStateManager 分发
        newLink.setCXRLinkCbk(ConnectionStateManager.getInstance().getLinkCallback());
        this.link = newLink;
        boolean requested = newLink.connect(token);
        Log.i(TAG, "connectCustomView: connect 发起=" + requested);
        return requested;
    }

    /**
     * 创建 CUSTOMAPP 会话并连接（需要眼镜端已安装配套自定义 App）。
     * 自定义指令通道仅在此会话类型下可用。
     *
     * @param glassTargetPackage 眼镜端目标 App 包名
     */
    public synchronized boolean connectCustomApp(Context context, String glassTargetPackage) {
        if (!hasToken()) {
            Log.e(TAG, "connectCustomApp: token 为空，请先完成授权");
            return false;
        }
        if (link != null) {
            // 幂等处理：同 connectCustomView；切换会话类型需先显式 disconnect
            boolean ready = ConnectionStateManager.getInstance().isLinkReady();
            Log.i(TAG, "connectCustomApp: 链路已存在，就绪=" + ready + "，跳过重建");
            return ready;
        }
        // 保存应用上下文供其他组件使用
        this.context = context.getApplicationContext();
        CXRLink newLink = new CXRLink(this.context);
        newLink.configCXRSession(new CxrDefs.CXRSession(
                CxrDefs.CXRSessionType.CUSTOMAPP, glassTargetPackage));
        newLink.setCXRLinkCbk(ConnectionStateManager.getInstance().getLinkCallback());
        this.link = newLink;
        boolean requested = newLink.connect(token);
        Log.i(TAG, "connectCustomApp: connect 发起=" + requested);
        return requested;
    }

    /**
     * 断开并释放链路。仅在会话真正结束时调用（官方约束：子页面不得调用 disconnect）。
     */
    public synchronized void disconnect() {
        CXRLink current = link;
        if (current != null) {
            try {
                current.disconnect();
            } catch (Exception e) {
                Log.w(TAG, "disconnect 异常", e);
            }
            link = null;
        }
        ConnectionStateManager.getInstance().reset();
    }
}
