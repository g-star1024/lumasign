package com.lumasign.player

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File

/**
 * 崩溃恢复启动页。
 *
 * 判断逻辑（三重检测，确保任何崩溃都能被捕获）：
 *   1. crash_marker 存在 → 上次发生了崩溃，显示日志
 *   2. crash_count > 0 且日志存在 → 同上
 *   3. crash_count > 0 但日志缺失 → 显示"非正常退出"提示（OOM 场景）
 *   4. 都不满足 → 正常启动，显示"正在启动"
 *
 * 即使主题/style 有问题，本页面也使用最小化布局（直接 LinearLayout + TextView），
 * 不依赖任何 XML 布局文件。
 */
class CrashRecoveryActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "LumaSign"
        private const val PREFS = "luma_config"
        private const val KEY_CRASH_COUNT = "crash_count"
    }

    private lateinit var app: LumaApplication

    override fun onCreate(savedInstanceState: Bundle?) {
        try {
            super.onCreate(savedInstanceState)
            // 用最基本的窗口标志，不用全屏主题
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } catch (e: Exception) {
            Log.w(TAG, "window flags failed: ${e.message}")
        }

        app = applicationContext as LumaApplication

        val crashCount = try {
            getSharedPreferences(PREFS, MODE_PRIVATE).getInt(KEY_CRASH_COUNT, 0)
        } catch (_: Exception) { 0 }

        // 三重检测：crash_marker > crash_count+log > crash_count alone > 正常
        if (app.hasCrashMarker(this) || (!app.readExistingCrashLog(this).isNullOrBlank())) {
            showCrashView(app.readExistingCrashLog(this) ?: "", crashCount)
        } else if (crashCount > 0) {
            showNonRecoverableView(crashCount)
        } else {
            showBootingView()
        }
    }

    private fun showCrashView(logText: String, crashCount: Int) {
        try {
            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#0d1117"))
                setPadding(48, 48, 48, 48)
            }

            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#f0f6fc"))
                textSize = 18f
                text = "灵屏 LumaSign\n上次启动崩溃 ${crashCount} 次，堆栈如下"
            })

            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#7ee787"))
                textSize = 12f
                typeface = Typeface.MONOSPACE
                text = logText.take(3500).ifEmpty { "(日志文件不存在，可能是 OOM 或磁盘写满)" }
                setPadding(0, 16, 0, 0)
            })

            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#58a6ff"))
                textSize = 13f
                setPadding(0, 16, 0, 0)
                text = "8 秒后自动进入播放端。若仍闪退请反馈此截图"
            })

            setContentView(root)
            Handler(Looper.getMainLooper()).postDelayed(::launchMain, 8000)
        } catch (e: Exception) {
            Log.w(TAG, "showCrashView failed: ${e.message}")
            showNonRecoverableView(crashCount)
        }
    }

    private fun showNonRecoverableView(crashCount: Int) {
        try {
            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#0d1117"))
                setPadding(48, 48, 48, 48)
            }

            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#f0f6fc"))
                textSize = 18f
                text = "灵屏 LumaSign\n上次启动异常退出（${crashCount} 次）"
            })

            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#ffa657"))
                textSize = 13f
                setPadding(0, 16, 0, 0)
                text = "未能获取崩溃堆栈，可能原因：\n" +
                    "• 设备内存不足被系统强制终止 (OOM)\n" +
                    "• 崩溃发生在日志写入之前\n\n" +
                    "设备信息：\n" +
                    "  型号：${android.os.Build.MODEL}\n" +
                    "  系统：Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})\n\n" +
                    "建议：重启设备后重试；若持续闪退，请将此屏幕截图发回"
            })

            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#58a6ff"))
                textSize = 13f
                setPadding(0, 16, 0, 0)
                text = "5 秒后自动进入播放端"
            })

            setContentView(root)
            Handler(Looper.getMainLooper()).postDelayed(::launchMain, 5000)
        } catch (e: Exception) {
            Log.w(TAG, "showNonRecoverableView failed: ${e.message}")
            showBootingView()
        }
    }

    private fun showBootingView() {
        try {
            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#0d1117"))
                setPadding(48, 48, 48, 48)
            }
            root.addView(TextView(this).apply {
                setTextColor(Color.parseColor("#8b949e"))
                textSize = 18f
                text = "灵屏 LumaSign\n正在启动…"
            })
            setContentView(root)
        } catch (e: Exception) {
            Log.w(TAG, "showBootingView failed: ${e.message}")
        }
        Handler(Looper.getMainLooper()).postDelayed(::launchMain, 700)
    }

    private fun launchMain() {
        try {
            // 清除崩溃计数和标记文件
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt(KEY_CRASH_COUNT, 0).commit()
            for (path in app.crashMarkerPaths(this)) {
                try { if (path.exists()) path.delete() } catch (_: Exception) { }
            }
        } catch (_: Exception) { }

        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }
}