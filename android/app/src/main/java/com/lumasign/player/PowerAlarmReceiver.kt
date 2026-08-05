package com.lumasign.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager

/**
 * 定时开关机触发：
 * - 开机（POWER_ON）：唤醒设备并拉起播放 Activity（普通应用靠 WAKE_LOCK 强制亮屏，系统/root 走真亮屏）。
 * - 关机（POWER_OFF）：优先真熄屏（系统签名/root），仅当无权限时降级为拉起 Activity 做亮度置 0。
 */
class PowerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val on = intent.action == "com.lumasign.player.POWER_ON"

        if (on) {
            // 真亮屏（系统签名/root）优先；普通应用再靠 WAKE_LOCK 强制亮屏
            ScreenPower.tryTrueOn(context)
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "luma:power"
            )
            try { wl.acquire(5000) } catch (_: Exception) {}

            val i = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra("screen", "on")
            }
            context.startActivity(i)
        } else {
            // 优先真熄屏；失败才降级为亮度置 0（仍需拉起 Activity 改 window 亮度）
            if (!ScreenPower.tryTrueOff(context)) {
                val i = Intent(context, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    putExtra("screen", "off")
                }
                context.startActivity(i)
            }
        }
    }
}
