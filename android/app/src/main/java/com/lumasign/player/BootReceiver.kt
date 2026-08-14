package com.lumasign.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * 开机自启 / 自升级后自拉起。
 * 需在系统设置中授予「自启动」权限（各厂商路径不同），否则部分 ROM 会拦截。
 *
 * Kiosk 抢占：manifest 中 intent-filter priority=999，先于触拓收到 BOOT_COMPLETED
 * （有序广播，跨应用按 priority 投递），并同时拉起 KioskGuardService 持续守护前台。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED
            || action == "android.intent.action.QUICKBOOT_POWERON"
            || action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            val i = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(i)
            // Kiosk 抢占守护：前台探测 + 应急悬浮窗（非致命，失败不影响主界面）
            try {
                val g = Intent(context, KioskGuardService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(g)
                } else {
                    context.startService(g)
                }
            } catch (_: Exception) { }
        }
    }
}
