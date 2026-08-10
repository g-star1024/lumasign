package com.lumasign.player

import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import org.json.JSONObject

/**
 * 应用级崩溃兜底：比 Activity.onCreate 更早注册 UncaughtExceptionHandler。
 * 目的：捕获主界面、WebView、LumaBridge 初始化阶段之前的致命异常，保证日志可落地、可上传。
 */
class LumaApplication : Application() {

    companion object {
        private const val PREFS = "luma_config"
        private const val KEY_SERVER = "server_url"
        private const val KEY_CODE = "terminal_code"
        private const val TAG = "LumaSign"
    }

    override fun onCreate() {
        super.onCreate()
        installCrashHandler()
    }

    private fun installCrashHandler() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val prevHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            val nextCrashCount = prefs.getInt("crash_count", 0) + 1
            prefs.edit().putInt("crash_count", nextCrashCount).apply()
            writeCrashLog(throwable)
            Log.i(TAG, "uncaught exception captured at Application level: ${throwable.message}")
            prevHandler?.uncaughtException(thread, throwable)
        }

        val crashCount = prefs.getInt("crash_count", 0)
        if (crashCount > 0) {
            uploadCrashLogToServer(this, crashCount)
        }
    }

    private fun writeCrashLog(t: Throwable?) {
        try {
            val ts = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())
            val sb = StringBuilder()
            sb.append("=== crash @ $ts ===\n")
            sb.append("model=${Build.MODEL} android=${Build.VERSION.RELEASE} sdk=${Build.VERSION.SDK_INT}\n")
            sb.append("thread=${Thread.currentThread().name}\n")
            sb.append("${t?.javaClass?.name ?: "Throwable"}: ${t?.message ?: ""}\n")
            t?.stackTrace?.forEach { sb.append("  at $it\n") }

            val header = sb.toString()
            val previousLogs = existingCrashLog()?.take(5000) ?: ""
            val content = header + "\n" + previousLogs

            // 两个位置都写，避免某一路径权限/存储异常时日志丢失
            val appDir = File(getExternalFilesDir(null), "logs")
            appDir.mkdirs()
            File(appDir, "crash.log").writeText(content)
            File(filesDir, "crash.log").writeText(content)
            Log.i(TAG, "crash log written to ${appDir.resolve("crash.log").absolutePath}")
        } catch (e: Exception) {
            Log.w(TAG, "failed to write crash log: ${e.message}")
        }
    }

    private fun existingCrashLog(): String? {
        val candidates = listOf(
            File(getExternalFilesDir(null), "logs/crash.log"),
            File(filesDir, "crash.log")
        )
        for (f in candidates) {
            if (f.exists()) return f.readText().take(8000)
        }
        return null
    }

    private fun uploadCrashLogToServer(ctx: Context, crashCount: Int) {
        val logText = existingCrashLog() ?: return
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(KEY_SERVER, "") ?: ""
        val code = prefs.getString(KEY_CODE, "") ?: ""
        if (serverUrl.isBlank()) return
        val url = serverUrl.trimEnd('/') + "/api/t/crash"
        Thread {
            try {
                val conn = java.net.URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("X-Luma-Product", "LumaSign")
                conn.setConnectTimeout(5000)
                conn.setReadTimeout(10000)
                val payload = JSONObject().apply {
                    put("token", code)
                    put("model", Build.MODEL)
                    put("androidVersion", Build.VERSION.RELEASE)
                    put("crashCount", crashCount)
                    put("log", logText.take(8000))
                }.toString()
                conn.doOutput = true
                conn.outputStream.write(payload.toByteArray(Charsets.UTF_8))
                val rc = conn.responseCode
                Log.i(TAG, "crash log uploaded: HTTP $rc")
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "crash log upload failed: ${e.message}")
            }
        }.start()
    }
}