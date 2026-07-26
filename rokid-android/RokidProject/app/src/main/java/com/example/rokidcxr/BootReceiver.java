package com.example.rokidcxr;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.example.rokidcxr.sdk.CxrSdkManager;

/**
 * 开机自启动：BOOT_COMPLETED 后拉起保活服务，重启后无需人工打开 App。
 *
 * 流程：restoreToken（SharedPreferences）→ 有 token 则启动 LinkKeepAliveService，
 * 服务 onCreate 里会自动 connectCustomView 重建链路。token 缺失（首次安装/被清数据）
 * 时不启动服务，等用户打开 App 走授权流程。
 *
 * 前置（代码外）：MIUI 类 ROM 需放行"自启动"，root 机可用
 * `appops set com.example.rokidcxr BOOT_COMPLETED allow` 直接配置。
 * FGS 类型为 connectedDevice，BOOT_COMPLETED 场景允许后台启动。
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }
        if (!CxrSdkManager.getInstance().restoreToken(context)) {
            Log.w(TAG, "开机自启动跳过：无本地 token，需手动打开 App 授权");
            return;
        }
        Log.i(TAG, "开机自启动：token 已恢复，拉起保活服务");
        LinkKeepAliveService.start(context);
    }
}
