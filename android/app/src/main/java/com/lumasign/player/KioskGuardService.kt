package com.lumasign.player

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat

/**
 * Kiosk 抢占守护服务（前台服务，START_STICKY 防杀）。
 *
 * L2 前台 Watchdog：周期性探测前台应用，被抢占（触拓 / 桌面 / 任何应用）时立即拉回自己。
 * L1 应急悬浮窗：拉回间隙用全屏 SYSTEM_ALERT 层遮住对方画面，保证「屏幕上永远是灵屏」。
 *
 * 探测能力分档（决定能压多狠）：
 * - Android 4.4（rk312x 主力）：getRunningTasks 可见全部应用任务 → 满血检测 + 拉回
 * - Android 5.0+ 且授予「使用情况访问」：UsageStatsManager.queryEvents 判前台 → 满血
 * - Android 5.0+ 无授权：无法探测 → 退化为「仅开机抢占」，配合 Device Owner Kiosk 模式
 *
 * 悬浮窗：
 * - API 22 及以下：SYSTEM_ALERT_WINDOW 安装即授权，直接可用
 * - API 23+：需用户在系统设置开启「显示在其他应用上层」，未开启则跳过
 */
class KioskGuardService : Service() {

    companion object {
        private const val TAG = "LumaSign.Guard"
        private const val CHANNEL_ID = "lumasign_guard"
        private const val NOTIF_ID = 1002
        private const val POLL_MS = 2000L
        private const val APP_OPS_GET_USAGE_STATS = "android:get_usage_stats"
    }

    private val handler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var overlayShown = false

    private val pollRunnable = object : Runnable {
        override fun run() {
            try {
                guardOnce()
            } catch (e: Exception) {
                Log.w(TAG, "guard tick error: ${e.message}")
            }
            handler.postDelayed(this, POLL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
        handler.removeCallbacks(pollRunnable)
        handler.post(pollRunnable)
        return START_STICKY
    }

    /** 单次守护探测 */
    private fun guardOnce() {
        val foreground = detectForeground() ?: return  // 无法探测 → 靠开机抢占 / DO Kiosk
        if (foreground == packageName) {
            hideOverlay()
            return
        }
        // 被抢占 → 挡住对方画面 + 立即拉回自己
        showOverlay()
        bringSelfToFront()
    }

    /** 拉回 MainActivity 到前台（singleTask + CLEAR_TOP 复用现有实例，不重建） */
    private fun bringSelfToFront() {
        try {
            val i = Intent(this, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
            }
            startActivity(i)
        } catch (e: Exception) {
            Log.w(TAG, "bringSelfToFront failed: ${e.message}")
        }
    }

    /**
     * 探测前台应用包名：
     * 4.4：getRunningTasks 全局可见（5.0 起受限，仅能看到自己的任务）
     * 5.0+：有使用情况访问 → UsageStatsManager.queryEvents
     * 5.0+ 无权限：返回 null（不可探测，不盲目抢占）
     */
    @SuppressLint("NewApi")
    private fun detectForeground(): String? {
        val sdk = Build.VERSION.SDK_INT
        return when {
            sdk < Build.VERSION_CODES.LOLLIPOP -> detectForegroundLegacy()
            hasUsageAccess() -> detectForegroundUsage()
            else -> null
        }
    }

    @Suppress("DEPRECATION")
    private fun detectForegroundLegacy(): String? {
        return try {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            am.getRunningTasks(1).firstOrNull()?.topActivity?.packageName
        } catch (_: Exception) {
            null
        }
    }

    @SuppressLint("NewApi")
    private fun detectForegroundUsage(): String? {
        return try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val end = System.currentTimeMillis()
            val events = usm.queryEvents(end - 60_000, end)
            var lastForeground: String? = null
            val e = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(e)
                if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                    lastForeground = e.packageName
                }
            }
            lastForeground
        } catch (_: Exception) {
            null
        }
    }

    /** 是否已授予「使用情况访问」（特殊权限，AppOps 反射探测，避免 hidden API 编译问题） */
    private fun hasUsageAccess(): Boolean {
        return try {
            val am = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val method = try {
                AppOpsManager::class.java.getMethod(
                    "unsafeCheckOpNoThrow",
                    String::class.java, Int::class.java, String::class.java
                )
            } catch (_: NoSuchMethodException) {
                AppOpsManager::class.java.getMethod(
                    "checkOpNoThrow",
                    String::class.java, Int::class.java, String::class.java
                )
            }
            val mode = method.invoke(am, APP_OPS_GET_USAGE_STATS, applicationInfo.uid, packageName) as Int
            mode == AppOpsManager.MODE_ALLOWED
        } catch (_: Exception) {
            false
        }
    }

    /** 显示全屏应急层：挡住对方画面（黑色 + 提示），直到自己回到前台后隐藏 */
    private fun showOverlay() {
        if (overlayShown) return
        if (!KioskManager.canDrawOverlays(this)) return
        try {
            val wm = windowManager ?: return
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                    WindowManager.LayoutParams.FLAG_FULLSCREEN,
                PixelFormat.OPAQUE
            )
            lp.gravity = Gravity.TOP or Gravity.START
            val tv = TextView(this).apply {
                setBackgroundColor(Color.BLACK)
                setTextColor(Color.parseColor("#9ca3af"))
                textSize = 16f
                gravity = Gravity.CENTER
                text = "灵屏 LumaSign\n正在恢复播放…"
            }
            wm.addView(tv, lp)
            overlayView = tv
            overlayShown = true
            Log.i(TAG, "overlay shown (blocking foreground)")
        } catch (e: Exception) {
            Log.w(TAG, "overlay show failed: ${e.message}")
        }
    }

    private fun hideOverlay() {
        if (!overlayShown) return
        try {
            overlayView?.let { windowManager?.removeView(it) }
        } catch (_: Exception) { }
        overlayView = null
        overlayShown = false
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val flag = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_IMMUTABLE else 0
        val pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, flag)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("灵屏播放端")
            .setContentText("前台守护运行中")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "灵屏前台守护", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "保持灵屏位于前台，压制其它应用抢占" }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(pollRunnable)
        hideOverlay()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // 划走任务不停止守卫（前台服务保证存活）
        super.onTaskRemoved(rootIntent)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
