package com.lumasign.player

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * 崩溃恢复启动页——纯 Activity（不依赖 AppCompat），消除 4.4 上 AppCompat 的崩溃面。
 *
 * 设计铁律（三重防御，确保任何崩溃都能被捕获）：
 *   1. 在 onCreate() 最前面（super.onCreate 之前）注册局部 crash handler ——
 *      即使 LumaApplication 的 handler 注册失败，这里也是第二道防线。
 *   2. 写 crash_marker 到三个位置（filesDir / 外部私有 / /sdcard/LumaSign），
 *      确保至少一个成功。
 *   3. 使用纯 LinearLayout + TextView，不加载任何 XML 布局，不依赖主题。
 */
class CrashRecoveryActivity : Activity() {

    companion object {
        private const val TAG = "LumaSign.Recovery"
        private const val PREFS = "luma_config"
        private const val KEY_CRASH_COUNT = "crash_count"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // ═══════════════════════════════════════════════════════════════
        // 第一道防线：在任何 super.onCreate() 之前注册局部 crash handler
        // 确保即使 LumaApplication 的 handler 没生效，Activity 自己崩溃也能被捕获
        // ═══════════════════════════════════════════════════════════════
        val appCtx = try { applicationContext } catch (_: Exception) { null }
        val prevHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { _, throwable ->
            try {
                writeCrashMarkerSafe(appCtx)
                writeCrashLogSafe(appCtx, throwable)
            } catch (_: Exception) { }
            prevHandler?.uncaughtException(Thread.currentThread(), throwable)
        }

        try {
            super.onCreate(savedInstanceState)
        } catch (e: Exception) {
            Log.e(TAG, "super.onCreate failed: ${e.message}", e)
            // super.onCreate 都崩了，直接显示最简恢复页
            showEmergencyView(e)
            return
        }

        try {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } catch (_: Exception) { }

        val crashCount = try {
            getSharedPreferences(PREFS, MODE_PRIVATE).getInt(KEY_CRASH_COUNT, 0)
        } catch (_: Exception) { 0 }

        val logText = try { findExistingCrashLog(appCtx) } catch (_: Exception) { null }
        val hasMarker = try { findCrashMarker(appCtx) != null } catch (_: Exception) { false }

        if (hasMarker || !logText.isNullOrEmpty()) {
            showCrashView(logText ?: "", crashCount)
        } else if (crashCount > 0) {
            showNonRecoverableView(crashCount)
        } else {
            showBootingView()
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 崩溃标记文件（最小 ~100 字节，三位置兜底）
    // ═══════════════════════════════════════════════════════════════

    private fun writeCrashMarkerSafe(ctx: Context?) {
        val paths = buildMarkerPaths(ctx)
        val content = "{\"ts\":${System.currentTimeMillis()},\"model\":\"${Build.MODEL}\"}\n"
        for (path in paths) {
            try {
                path.parentFile?.mkdirs()
                FileOutputStream(path).use { it.write(content.toByteArray(Charsets.UTF_8)) }
                Log.i(TAG, "crash marker written: ${path.absolutePath}")
                return
            } catch (_: Exception) { }
        }
        Log.e(TAG, "ALL crash marker writes failed (paths: ${paths.joinToString()})")
    }

    private fun writeCrashLogSafe(ctx: Context?, t: Throwable?) {
        val paths = buildLogPaths(ctx)
        val header = buildHeader(t)
        for (path in paths) {
            try {
                path.parentFile?.mkdirs()
                FileOutputStream(path, true).use { it.write(header.toByteArray(Charsets.UTF_8)) }
                Log.i(TAG, "crash log written: ${path.absolutePath}")
                return
            } catch (_: Exception) { }
        }
        Log.e(TAG, "ALL crash log writes failed")
    }

    private fun buildHeader(t: Throwable?): String {
        val sb = StringBuilder()
        sb.append("=== crash @ ${System.currentTimeMillis()} ===\n")
        sb.append("model=${Build.MODEL} android=${Build.VERSION.RELEASE} sdk=${Build.VERSION.SDK_INT}\n")
        sb.append("${t?.javaClass?.name ?: "Throwable"}: ${t?.message ?: ""}\n")
        t?.stackTrace?.take(30)?.forEach { sb.append("  at $it\n") }
        return sb.toString()
    }

    private fun buildMarkerPaths(ctx: Context?): List<File> {
        val paths = mutableListOf<File>()
        ctx?.let {
            try { paths.add(File(it.filesDir, ".crash_marker")) } catch (_: Exception) { }
            try { val d = it.getExternalFilesDir(null); if (d != null) paths.add(File(d, ".crash_marker")) } catch (_: Exception) { }
        }
        try { paths.add(File(java.io.File("/sdcard"), "LumaSign/.crash_marker")) } catch (_: Exception) { }
        return paths.distinct()
    }

    private fun buildLogPaths(ctx: Context?): List<File> {
        val paths = mutableListOf<File>()
        ctx?.let {
            try { val d = it.getExternalFilesDir(null); if (d != null) paths.add(File(d, "logs/crash.log")) } catch (_: Exception) { }
            try { paths.add(File(it.filesDir, "crash.log")) } catch (_: Exception) { }
        }
        try { paths.add(File(File("/sdcard"), "LumaSign/crash.log")) } catch (_: Exception) { }
        return paths.distinct()
    }

    // ═══════════════════════════════════════════════════════════════
    // 崩溃检测
    // ═══════════════════════════════════════════════════════════════

    private fun findCrashMarker(ctx: Context?): File? {
        val paths = buildMarkerPaths(ctx)
        for (path in paths) {
            if (path.exists()) return path
        }
        return null
    }

    private fun findExistingCrashLog(ctx: Context?): String? {
        val paths = buildLogPaths(ctx)
        for (path in paths) {
            if (path.exists()) {
                try { return path.readText().take(6000) } catch (_: Exception) { }
            }
        }
        return null
    }

    // ═══════════════════════════════════════════════════════════════
    // UI 视图（纯代码，不依赖 XML/主题）
    // ═══════════════════════════════════════════════════════════════

    private fun makeRoot(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0d1117"))
            setPadding(48, 48, 48, 48)
        }
    }

    private fun makeTitle(root: LinearLayout, text: String, color: Int) {
        root.addView(TextView(this).apply {
            setTextColor(color)
            textSize = 18f
            this.text = text
        })
    }

    private fun makeLog(root: LinearLayout, text: String) {
        root.addView(TextView(this).apply {
            setTextColor(Color.parseColor("#f0f6fc"))
            textSize = 12f
            typeface = Typeface.MONOSPACE
            this.text = text.take(4000).ifEmpty { "(日志文件不存在，可能是 OOM 或磁盘写满)" }
            setPadding(0, 16, 0, 0)
        })
    }

    private fun makeHint(root: LinearLayout, text: String, color: Int) {
        root.addView(TextView(this).apply {
            setTextColor(color)
            textSize = 13f
            setPadding(0, 16, 0, 0)
            this.text = text
        })
    }

    private fun showEmergencyView(e: Throwable) {
        try {
            val root = makeRoot()
            root.setBackgroundColor(Color.parseColor("#7f1d1d"))
            root.addView(TextView(this).apply {
                setTextColor(Color.WHITE)
                textSize = 18f
                text = "灵屏 LumaSign\n严重错误：应用启动框架崩溃"
            })
            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#fca5a5"))
                textSize = 12f
                typeface = Typeface.MONOSPACE
                text = "${e.javaClass.simpleName}: ${e.message}\n\n${
                    e.stackTrace?.take(10)?.joinToString("\n") { "  at $it" } ?: "无堆栈"
                }\n\n设备：${Build.MODEL} Android ${Build.VERSION.RELEASE} API ${Build.VERSION.SDK_INT}"
            })
            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#fecaca"))
                textSize = 13f
                setPadding(0, 16, 0, 0)
                text = "截图后反馈此页面，8 秒后尝试进入播放端"
            })
            setContentView(root)
            Handler(Looper.getMainLooper()).postDelayed(::launchMain, 8000)
        } catch (_: Exception) {
            // 连恢复页都显示不了，只能等系统 ANR 或让用户截屏
        }
    }

    private fun showCrashView(logText: String, crashCount: Int) {
        try {
            val root = makeRoot()
            makeTitle(root, "灵屏 LumaSign\n上次启动崩溃 ${crashCount} 次，堆栈如下", Color.parseColor("#f0f6fc"))
            makeLog(root, logText)
            makeHint(root, "8 秒后自动进入播放端。若仍闪退请反馈此截图", Color.parseColor("#58a6ff"))
            setContentView(root)
            Handler(Looper.getMainLooper()).postDelayed(::launchMain, 8000)
        } catch (e: Exception) {
            Log.w(TAG, "showCrashView failed: ${e.message}")
            showNonRecoverableView(crashCount)
        }
    }

    private fun showNonRecoverableView(crashCount: Int) {
        try {
            val root = makeRoot()
            makeTitle(root, "灵屏 LumaSign\n上次启动异常退出（${crashCount} 次）", Color.parseColor("#f0f6fc"))
            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#ffa657"))
                textSize = 13f
                setPadding(0, 16, 0, 0)
                this.text = "未能获取崩溃堆栈，可能原因：\n" +
                    "• 设备内存不足被系统强制终止 (OOM)\n" +
                    "• 崩溃发生在日志写入之前\n\n" +
                    "设备信息：\n" +
                    "  型号：${Build.MODEL}\n" +
                    "  系统：Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\n" +
                    "  内存：${getAvailableMemoryMB()}MB\n\n" +
                    "建议：重启设备后重试；若持续闪退，请将此屏幕截图发回"
            })
            makeHint(root, "5 秒后自动进入播放端", Color.parseColor("#58a6ff"))
            setContentView(root)
            Handler(Looper.getMainLooper()).postDelayed(::launchMain, 5000)
        } catch (e: Exception) {
            Log.w(TAG, "showNonRecoverableView failed: ${e.message}")
            showBootingView()
        }
    }

    private fun showBootingView() {
        try {
            val root = makeRoot()
            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#8b949e"))
                textSize = 18f
                this.text = "灵屏 LumaSign\n正在启动…"
            })
            setContentView(root)
        } catch (_: Exception) { }
        Handler(Looper.getMainLooper()).postDelayed(::launchMain, 700)
    }

    private fun getAvailableMemoryMB(): String {
        return try {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            val mi = android.app.ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            "${mi.availMem / 1024 / 1024}"
        } catch (_: Exception) { "未知" }
    }

    private fun launchMain() {
        try {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt(KEY_CRASH_COUNT, 0).commit()
            for (path in buildMarkerPaths(this)) {
                try { if (path.exists()) path.delete() } catch (_: Exception) { }
            }
        } catch (_: Exception) { }
        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }
}