package com.lumasign.player

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * 灵屏播放端 JS 桥：暴露原生能力给 Web 播放引擎（player/engine.js）。
 * 引擎通过 window.LumaBridge 调用；返回 JSON 字符串，引擎已做 JSON.parse 兼容。
 */
class LumaBridge(private val activity: MainActivity, private val webView: WebView) {

    private val audio: AudioManager by lazy {
        activity.getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager
    }
    private val power: PowerManager by lazy {
        activity.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
    }

    /** 硬件信息：mac/serial 作为服务端注册幂等键 */
    @JavascriptInterface
    fun getHardwareInfo(): String {
        return try {
            val dm = activity.resources.displayMetrics
            val rotation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                activity.display?.rotation ?: 0
            } else {
                @Suppress("DEPRECATION")
                activity.windowManager.defaultDisplay.rotation
            }
            val orientation = if (rotation == 0 || rotation == 2) "landscape" else "portrait"
            val (total, free) = storageBytes()

            JSONObject().apply {
                put("mac", activity.readMac())
                put("serial", serial())
                put("model", Build.MODEL)
                put("androidVersion", Build.VERSION.RELEASE)
                put("resolution", "${dm.widthPixels}x${dm.heightPixels}")
                put("orientation", orientation)
                put("firmware", Build.DISPLAY)
                put("storageTotal", total)
                put("storageFree", free)
                put("name", Build.MODEL)
            }.toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "unknown").toString()
        }
    }

    /** 实时状态：音量 / 存储 / 版本 / 温度 */
    @JavascriptInterface
    fun getNativeStatus(): String {
        return try {
            val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val cur = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
            val (total, free) = storageBytes()
            val (ver, _) = appVersion()
            JSONObject().apply {
                put("volume", if (max > 0) (cur * 100 / max) else 0)
                put("storageTotal", total)
                put("storageFree", free)
                put("appVersion", ver)
                put("cpuTemp", 0)
            }.toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "unknown").toString()
        }
    }

    /** 截屏：截取 WebView 当前画面（含 DOM），返回 dataURL，再回调 JS */
    @JavascriptInterface
    fun capture(jsCallback: String) {
        webView.post {
            val dataUrl = screenshotBase64()
            if (dataUrl != null) {
                val safe = dataUrl.replace("'", "\\'")
                webView.evaluateJavascript("($jsCallback)('$safe')", null)
            }
        }
    }

    /** 设置系统音量 0-100 */
    @JavascriptInterface
    fun setVolume(level: Int) {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val v = (level.coerceIn(0, 100) * max / 100)
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
    }

    @JavascriptInterface
    fun getVolume(): Int {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val cur = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        return if (max > 0) (cur * 100 / max) else 0
    }

    /** 重启设备（需系统权限）；失败则重启应用 */
    @JavascriptInterface
    fun reboot() {
        try {
            power.reboot(null)
        } catch (_: Exception) {
            restartApp()
        }
    }

    /** 重启应用（重新加载 WebView 播放引擎） */
    @JavascriptInterface
    fun restartApp() {
        activity.runOnUiThread {
            val intent = activity.packageManager.getLaunchIntentForPackage(activity.packageName)
            intent?.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP)
            activity.startActivity(intent)
            android.os.Process.killProcess(android.os.Process.myPid())
        }
    }

    @JavascriptInterface
    fun screenOn() {
        // 优先真亮屏（系统签名/root），失败降级为恢复亮度
        if (!ScreenPower.tryTrueOn(activity)) activity.setScreenOn(true)
    }

    @JavascriptInterface
    fun screenOff() {
        // 优先真熄屏（系统签名/root），失败降级为亮度置 0
        if (!ScreenPower.tryTrueOff(activity)) activity.setScreenOn(false)
    }

    /** 电源能力：是否支持真熄屏（root / 系统签名） */
    @JavascriptInterface
    fun powerCapabilities(): String {
        return try {
            JSONObject().apply {
                put("root", ScreenPower.isRootAvailable())
                put("systemPower", ScreenPower.hasSystemPowerPermission(activity))
                put("trueOffSupported", ScreenPower.hasSystemPowerPermission(activity) || ScreenPower.isRootAvailable())
            }.toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "unknown").toString()
        }
    }

    @JavascriptInterface
    fun setBrightness(level: Int) { activity.setBrightness(level) }

    /** 定时开关机：JSON 数组 [{on:"07:00", off:"22:00"}, ...] */
    @JavascriptInterface
    fun setPowerSchedule(json: String) {
        PowerScheduleManager.applySchedule(activity, json)
    }

    /** 自升级：下载并安装新 APK */
    @JavascriptInterface
    fun downloadAndInstallApk(url: String) {
        UpdateManager.install(activity, url)
    }

    /* ---------------- 内部工具 ---------------- */

    private fun screenshotBase64(): String? {
        val w = webView.width
        val h = webView.height
        if (w <= 0 || h <= 0) return null
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        webView.draw(canvas)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 80, out)
        bmp.recycle()
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    @SuppressLint("HardwareIds")
    private fun serial(): String {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Build.getSerial() else Build.SERIAL
        } catch (_: Exception) { Build.SERIAL }
    }

    private fun storageBytes(): Pair<Long, Long> {
        return try {
            val stat = StatFs(activity.filesDir.absolutePath)
            val block = stat.blockSizeLong
            Pair(stat.blockCountLong * block, stat.availableBlocksLong * block)
        } catch (_: Exception) { Pair(0L, 0L) }
    }

    private fun appVersion(): Pair<String, Int> {
        return try {
            val pi = activity.packageManager.getPackageInfo(activity.packageName, 0)
            Pair(pi.versionName ?: "1.0.0", pi.versionCode)
        } catch (_: Exception) { Pair("1.0.0", 1) }
    }
}
