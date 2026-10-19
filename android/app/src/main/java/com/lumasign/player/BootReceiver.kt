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
            // v1.3.44：开机/换包重启后 HOME 组件必须可用（doExit 静默期内可能禁用它，
            // 若期间断电重启，禁用的组件会让下面的 startActivity 失败 → 黑屏无人值守）
            KioskManager.ensureHomeEnabled(context)
            val i = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(i)
            // Kiosk 抢占守护全版本启动：4.4 上 getRunningTasks 全局可见 → 满血探测；
            // 5.0+ 无「使用情况访问」授权时服务自身退化为不抢占（detectForeground 返回 null）。
            // 与 MainActivity.startKioskGuard 行为一致（v1.3.21 起 4.4 也启用守护）。
            try {
                val g = Intent(context, KioskGuardService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(g)
                } else {
                    context.startService(g)
                }
            } catch (_: Exception) { }
            // 系统级周期看门狗：AlarmManager 驱动，应用进程被 OOM 回收后自动复活。
            // KioskGuardService 与主进程同生死，管不了「进程已死」，这一个是补那一档的。
            WatchdogReceiver.schedule(context)
        }
    }
}
