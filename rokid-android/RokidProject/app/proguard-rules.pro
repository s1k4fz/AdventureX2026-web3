# ===== CXR-L SDK 混淆规则 =====
# 保留 SDK 全部类（接口、回调与数据模型）
-keep class com.rokid.cxr.** { *; }
-dontwarn com.rokid.cxr.**

# 保留自定义回调接口，防止被混淆后 SDK 无法回调
-keep public class com.example.rokidcxr.sdk.** { *; }
