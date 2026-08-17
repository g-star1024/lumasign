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
# 根因：ProGuard 的 ** 通配符只匹配包路径中的目录段，不匹配类名内部的 $ 分隔符。
#      上面那条 `-keep class com.lumasign.player.** { *; }` 不会保留 `MainActivity$netCallback$1`
#      这类匿名内部类。R8 23.x + AGP 8 已知有这个 bug，必须显式声明。
# 覆盖：MainActivity$netCallback$1、MainActivity$netReceiver$1、MainActivity$1(WebViewClient)、
#       MainActivity$2(WebChromeClient)、MainActivity$3(retryRunnable) 等所有 object expression。
-keep class com.lumasign.player.**$** { *; }
