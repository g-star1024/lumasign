# 灵屏播放端：保留 JS 桥与 WebView 相关符号
-keepattributes *Annotation*
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.lumasign.player.** { *; }
-keepclassmembers class com.lumasign.player.LumaBridge { *; }

# WebView / JS 互操作
-keepclassmembers class * extends android.webkit.WebViewClient { *; }
-keepclassmembers class * extends android.webkit.WebChromeClient { *; }

# 保留序列化（如有）
-keepnames class * implements java.io.Serializable

# ── 修复 v1.3.7 启动闪退：R8/minify 误删 Kotlin object expression 编译出的内部类 ──
# NoClassDefFoundError: com.lumasign.player.MainActivity$netCallback$1 at MainActivity.<init>
# 根因（v1.3.7，release 包）：ProGuard 的 ** 通配符只匹配包路径中的目录段，不匹配类名内部的 $ 分隔符。
#      上面那条 `-keep class com.lumasign.player.** { *; }` 不会保留 `MainActivity$netCallback$1`
#      这类匿名内部类。R8 23.x + AGP 8 已知有这个 bug，必须显式声明。
#
# 根因（v1.3.9+，所有构建类型 + API 19 设备）：
#      ConnectivityManager.NetworkCallback 是 API 21+ (Lollipop) 类，Android 4.4 (API 19) 上不存在。
#      若 netCallback 作为 val 属性初始化器直接 new 匿名内部类，会在 MainActivity 构造阶段
#      触发 VerifyError/NoClassDefFoundError（类加载器无法解析父类 NetworkCallback）。
#      正确做法：netCallback 声明为可空 var，延迟到 registerConnectivity() 内部 SDK 守卫之后创建。
#      本条 keep 规则作为双重保险继续保留。
# 覆盖：MainActivity$netCallback$1、MainActivity$netReceiver$1、MainActivity$1(WebViewClient)、
#       MainActivity$2(WebChromeClient)、MainActivity$3(retryRunnable) 等所有 object expression。
-keep class com.lumasign.player.**$** { *; }

# ── Kiosk 抢占组件（manifest 组件虽由 AGP 自动 keep，显式声明更保险）──
-keep class com.lumasign.player.KioskGuardService { *; }
-keep class com.lumasign.player.KioskAdminReceiver { *; }
-keep class com.lumasign.player.KioskManager { *; }
