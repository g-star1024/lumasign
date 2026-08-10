package com.lumasign.player

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File

/**
 * 崩溃恢复页：在主界面之前显示上一次崩溃日志。
 * - 若没有日志，1 秒后直接进入 MainActivity
 * - 若有日志，展示 8 秒，然后进入 MainActivity
 */
class CrashRecoveryActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        )

        val logText = readCrashLogText()
        if (logText.isNullOrBlank()) {
            setContentView(createEmptyView("灵屏 LumaSign\n正在启动…"))
            Handler(Looper.getMainLooper()).postDelayed(::launchMain, 700)
            return
        }

        setContentView(createCrashView(logText))
        Handler(Looper.getMainLooper()).postDelayed(::launchMain, 8000)
    }

    private fun createEmptyView(text: String): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.BLACK)
            setPadding(48, 48, 48, 48)
        }
        root.addView(TextView(this).apply {
            setTextColor(android.graphics.Color.parseColor("#6b7280"))
            textSize = 18f
            text = text
        })
        return root
    }

    private fun createCrashView(logText: String): View {
        val root = FrameLayout(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.BLACK)
            setPadding(48, 40, 48, 40)
        }

        content.addView(TextView(this).apply {
            setTextColor(android.graphics.Color.WHITE)
            textSize = 18f
            text = "灵屏 LumaSign\n上次启动崩溃，请查看日志后重试"
        })

        content.addView(TextView(this).apply {
            setTextColor(android.graphics.Color.parseColor("#fbbf24"))
            textSize = 12f
            typeface = android.graphics.Typeface.MONOSPACE
            text = logText.take(4000)
            setPadding(0, 16, 0, 0)
        })

        content.addView(TextView(this).apply {
            setTextColor(android.graphics.Color.parseColor("#f87171"))
            textSize = 13f
            setPadding(0, 16, 0, 0)
            text = "8 秒后自动重启播放端"
        })

        root.addView(content)
        return root
    }

    private fun readCrashLogText(): String? {
        val candidates = listOf(
            File(getExternalFilesDir(null), "logs/crash.log"),
            File(filesDir, "crash.log")
        )
        for (f in candidates) {
            if (f.exists()) return f.readText().take(8000)
        }
        return null
    }

    private fun launchMain() {
        val prefs = getSharedPreferences("luma_config", MODE_PRIVATE)
        val crashCount = prefs.getInt("crash_count", 0)
        // 显示过一次后清零，避免每次重启都显示同一份历史崩溃日志
        if (crashCount > 0) {
            prefs.edit().putInt("crash_count", 0).apply()
        }
        val intent = android.content.Intent(this, MainActivity::class.java)
        intent.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }
}