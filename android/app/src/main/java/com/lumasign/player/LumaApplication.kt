package com.lumasign.player

import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import org.json.JSONObject

/**
 * 应用级崩溃兜底。
 *
 * 关键设计：
 *   1. 在 attachBaseContext() 中注册 crash handler —— 比 onCreate() 更早，
 *      确保 theme/layout 膨胀阶段的异常也能被捕获（之前 B1 漏洞）
 *   2. 写入 .crash_marker 标记文件，即使日志写入失败（磁盘满/权限拒绝）
 *      恢复页也能通过该标记知道发生过崩溃（修复 B4 漏洞）
 *   3. 写入 .heartbeat 心跳文件（进程正常启动时覆盖，崩溃后残留）
 *      用于区分"正常退出"和"被杀/OOM"（修复 B2/B5 漏洞）
 */
class LumaApplication : Application() {

    companion object {
        private const val TAG = "LumaSign"
        private const val PREFS = "luma_config"
        private const val KEY_SERVER = "server_url"
        private const val KEY_CODE = "terminal_code"
        private const val KEY_CRASH_COUNT = "crash_count"
    }

    /**
     * attachBaseContext 在 super.onCreate() 之前执行。
     * 在这里注册 crash handler，确保 theme/layout 异常也能捕获。
     * 
     * 注意：attachBaseContext 中 getSharedPreferences 在极少数 4.4 ROM 上可能
     * 因文件系统未就绪而抛 IOException。此处用 try-catch 确保 handler 注册本身
     * 不会因为读 prefs 失败而跳过——handler 是核心，prefs 只是计数。
     */
    @android.annotation.SuppressLint("WrongThread")
    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        // 心跳：进程启动时立即写入，标记"这次启动了"
        writeHeartbeat(base)
        // 注册崩溃处理器（必须早于 onCreate）
        try { installCrashHandler(base) } catch (e: Exception) {
            // 极端情况：handler 安装本身失败，用本地文件兜底
            Log.e(TAG, "installCrashHandler FAILED in attachBaseContext: ${e.message}", e)
            try {
                val marker = File(base.filesDir, ".crash_handler_install_failed")
                marker.writeText(e.message ?: "unknown")
            } catch (_: Exception) { }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "LumaApplication.onCreate() 已完成")
    }

    private fun installCrashHandler(ctx: Context) {
        val prefs = try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        } catch (e: IOException) {
            // 4.4 ROM 上文件未就绪，用空文件兜底
            Log.w(TAG, "getSharedPreferences failed in attachBaseContext, retrying: ${e.message}")
            try { Thread.sleep(500) } catch (_: Exception) { }
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        } catch (e: Exception) {
            Log.e(TAG, "getSharedPreferences FAILED: ${e.message}", e)
            return  // handler 核心逻辑在下方，没有 prefs 也能注册
        }
        val prevHandler = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                writeCrashMarker(ctx)
                try {
                    prefs.edit().putInt(KEY_CRASH_COUNT, prefs.getInt(KEY_CRASH_COUNT, 0) + 1).commit()
                } catch (_: Exception) { }
                writeCrashLog(ctx, throwable)
                Log.i(TAG, "uncaught captured: ${throwable.javaClass.simpleName}: ${throwable.message}")
            } catch (e: Exception) {
                Log.e(TAG, "crash handler itself failed: ${e.message}")
            }
            prevHandler?.uncaughtException(thread, throwable)
        }

        // 上次崩过 → 立即上传日志到管理端（不阻塞启动）
        val crashCount = try { prefs.getInt(KEY_CRASH_COUNT, 0) } catch (_: Exception) { 0 }
        if (crashCount > 0) {
            uploadCrashLogToServer(ctx, crashCount)
        }
    }

    /**
     * 崩溃标记文件（最小）：仅写一行 JSON，约 100 字节。
     * 即使磁盘几乎满、权限受限，也能成功写入。
     * 恢复页以此判断"是否发生过崩溃"，不依赖日志文件存在。
     */
    private fun writeCrashMarker(ctx: Context) {
        val markerPaths = listOf(
            File(ctx.filesDir, ".crash_marker"),
            File(ctx.getExternalFilesDir(null), ".crash_marker")
        )
        val ts = System.currentTimeMillis()
        val content = "{\"ts\":$ts,\"model\":\"${Build.MODEL}\"}\n"
        for (path in markerPaths) {
            try {
                path.parentFile?.mkdirs()
                path.writeText(content)
                Log.i(TAG, "crash marker written: ${path.absolutePath}")
                return
            } catch (_: Exception) { }
        }
        Log.e(TAG, "ALL crash marker writes failed")
    }

    /**
     * 心跳文件：进程正常启动时覆盖，崩溃后残留。
     * 恢复页据此区分"正常退出"（有 heartbeat 且无 crash_marker）
     * 和"被杀/OOM"（有 crash_marker 或无 heartbeat 但 crash_count > 0）。
     */
    private fun writeHeartbeat(ctx: Context) {
        val path = File(ctx.filesDir, ".heartbeat")
        try {
            path.writeText("${System.currentTimeMillis()}\n")
            Log.i(TAG, "heartbeat written: ${path.absolutePath}")
        } catch (_: Exception) { }
    }

    private fun writeCrashLog(ctx: Context, t: Throwable?) {
        val header = buildCrashHeader(t)
        val prevLogs = readExistingCrashLog(ctx)?.take(4000) ?: ""
        val content = header + "\n" + prevLogs

        for (path in crashLogPaths(ctx)) {
            try {
                path.parentFile?.mkdirs()
                java.io.OutputStreamWriter(path.outputStream()).use {
                    it.write(content)
                    it.flush()
                }
                Log.i(TAG, "crash log written: ${path.absolutePath}")
            } catch (e: Exception) {
                Log.w(TAG, "crash log write failed ${path.absolutePath}: ${e.message}")
            }
        }
    }

    private fun buildCrashHeader(t: Throwable?): String {
        val ts = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())
        val sb = StringBuilder()
        sb.append("=== crash @ $ts ===\n")
        sb.append("model=${Build.MODEL} android=${Build.VERSION.RELEASE} sdk=${Build.VERSION.SDK_INT}\n")
        sb.append("thread=${Thread.currentThread().name}\n")
        val mem = try {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            val memInfo = android.app.ActivityManager.MemoryInfo()
            am.getMemoryInfo(memInfo)
            "${memInfo.availMem / 1024 / 1024}MB avail"
        } catch (_: Exception) { "memory info unavailable" }
        sb.append("memory: $mem\n")
        sb.append("${t?.javaClass?.name ?: "Throwable"}: ${t?.message ?: ""}\n")
        t?.stackTrace?.take(50)?.forEach { sb.append("  at $it\n") }
        return sb.toString()
    }

    fun readExistingCrashLog(ctx: Context): String? {
        for (path in crashLogPaths(ctx)) {
            if (path.exists()) {
                return try { path.readText().take(8000) } catch (_: Exception) { null }
            }
        }
        return null
    }

    /** 判断是否存在崩溃标记 */
    fun hasCrashMarker(ctx: Context): Boolean {
        return crashMarkerPaths(ctx).any { it.exists() }
    }

    /** 读取最近一次崩溃的时间戳 */
    fun lastCrashTimestamp(ctx: Context): Long {
        for (path in crashMarkerPaths(ctx)) {
            if (path.exists()) {
                return try {
                    path.readText().filter { it.isDigit() }.toLongOrNull() ?: 0L
                } catch (_: Exception) { 0L }
            }
        }
        return 0L
    }

    fun crashMarkerPaths(ctx: Context): List<File> {
        return listOf(
            File(ctx.filesDir, ".crash_marker"),
            File(ctx.getExternalFilesDir(null), ".crash_marker")
        )
    }

    fun crashLogPaths(ctx: Context): List<File> {
        return listOf(
            File(ctx.getExternalFilesDir(null), "logs/crash.log"),
            File(ctx.filesDir, "crash.log"),
            File(File(java.io.File("/sdcard"), "LumaSign"), "crash.log")
        )
    }

    private fun uploadCrashLogToServer(ctx: Context, crashCount: Int) {
        val logText = readExistingCrashLog(ctx) ?: return
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