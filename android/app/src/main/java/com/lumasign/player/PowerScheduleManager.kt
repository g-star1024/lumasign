package com.lumasign.player

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import java.util.Calendar

/**
 * 定时开关机：解析 [{on:"07:00", off:"22:00"}]，每日到点由 PowerAlarmReceiver 切换屏幕。
 * 说明：普通应用无法真正切断屏幕供电，本实现通过「亮度置 0 + 保持唤醒」实现熄屏省电；
 * 若设备已 root 或系统签名，PowerAlarmReceiver 可进一步调用 PowerManager.goToSleep 实现真熄屏。
 */
object PowerScheduleManager {

    private const val ACTION_ON = "com.lumasign.player.POWER_ON"
    private const val ACTION_OFF = "com.lumasign.player.POWER_OFF"

    fun applySchedule(context: Context, json: String) {
        cancelAll(context)
        if (json.isBlank()) return
        try {
            val arr = JSONArray(json)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                o.optString("on").takeIf { it.isNotBlank() }?.let { schedule(context, it, ACTION_ON, i * 2) }
                o.optString("off").takeIf { it.isNotBlank() }?.let { schedule(context, it, ACTION_OFF, i * 2 + 1) }
            }
        } catch (_: Exception) { /* 非法 JSON 忽略 */ }
    }

    private fun schedule(context: Context, hhmm: String, action: String, reqCode: Int) {
        val parts = hhmm.split(":")
        if (parts.size != 2) return
        val h = parts[0].toIntOrNull() ?: return
        val m = parts[1].toIntOrNull() ?: return

        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, PowerAlarmReceiver::class.java).apply { this.action = action }
        val pi = PendingIntent.getBroadcast(
            context, reqCode, intent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            else PendingIntent.FLAG_UPDATE_CURRENT
        )
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m); set(Calendar.SECOND, 0)
            if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_MONTH, 1)
        }
        am.setRepeating(AlarmManager.RTC_WAKEUP, cal.timeInMillis, AlarmManager.INTERVAL_DAY, pi)
    }

    fun cancelAll(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        for (i in 0..31) {
            listOf(ACTION_ON, ACTION_OFF).forEach { action ->
                val intent = Intent(context, PowerAlarmReceiver::class.java).apply { this.action = action }
                val pi = PendingIntent.getBroadcast(
                    context, i, intent,
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
                    else PendingIntent.FLAG_NO_CREATE
                )
                pi?.let { am.cancel(it); it.cancel() }
            }
        }
    }
}
