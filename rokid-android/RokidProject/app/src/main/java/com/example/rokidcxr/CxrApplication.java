package com.example.rokidcxr;

import android.app.Application;

/**
 * 应用入口。
 *
 * 注意：CXR-L 的鉴权是 OAuth 式流程（需拉起 Rokid AI App 授权页），必须在 Activity 中发起，
 * 因此不在 Application 里做初始化；CXRLink 的创建与连接由 MainActivity 在拿到 token 后触发，
 * 全局链路实例由 CxrSdkManager 单例持有（官方要求进程内单实例复用）。
 */
public class CxrApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        // 预留：全局日志/崩溃采集等基础设施初始化
    }
}
