package com.lumasign.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * 崩溃守望服务：前台服务防止系统 OOM Kill，同时持有 WakeLock 保持心跳。
 * 崩溃时由 MainActivity 的 UncaughtExceptionHandler 触发重启；
 * 进程被系统杀后由 BOOT_COMPLETED 恢复启动。
 *
 * CHUTO e-player 等数字标牌软件的标配做法：前台服务 + WakeLock 双保险。
 */
class CrashWatchdogService : Service() {

    companion object {
        private const val TAG = "LumaSign.Watchdog"
        private const val CHANNEL_ID = "lumasign_watchdog"
        private const val NOTIF_ID = 1001
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        // 应用级 WakeLock（PARTIAL）防止 CPU 休眠，确保 WebView 持续刷新
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "LumaSign:PlayerWatchdog"
        )
        wakeLock?.acquire(Long.MAX_VALUE)
        Log.i(TAG, "Watchdog service started, wakeLock acquired")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        val notification = buildNotification()
        startForeground(NOTIF_ID, notification)
        return START_STICKY  // 被系统杀后自动重启
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val flag = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            flag
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("灵屏播放端")
            .setContentText("正在播放内容")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "灵屏播放守护", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "保持播放端持续运行" }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        wakeLock?.apply { if (isHeld) release() }
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // 用户划走任务后仍保持服务运行（前台服务已保证不被杀）
        super.onTaskRemoved(rootIntent)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}