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
