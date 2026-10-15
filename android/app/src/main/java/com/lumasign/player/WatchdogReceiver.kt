package com.lumasign.player

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * 系统级周期看门狗（v1.3.25+）—— 根治「应用被 OOM 回收后永久离线」。
 *
 * 背景：KioskGuardService 与 MainActivity 同进程，进程一旦被系统回收（rk312x 仅 1GB RAM，
 * 长播视频极易 OOM）守护随之消失，不再有人把应用拉回来；而 BootReceiver 只在开机时触发，
 * 且依赖 ROM 授予「自启动」权限（工控板常被拦截）。结果是设备画面全黑、服务端永久 offline，
 * 且服务端下发的重启指令要设备在线才送得到 → 形成恶性循环，只能现场人工拉起。
 *
 * 方案：把「保活检查」挂到 AlarmManager（系统级，不随应用进程消亡而消失）。
 * 每 3 分钟由系统唤醒本 Receiver（必要时会拉起应用进程来交付广播），
 * 检查 com.lumasign.player 进程是否还在：不在就 startActivity 拉起；在就什么都不做。
 * 与 KioskGuardService 分工明确——本 Receiver 只管「进程死了要复活」，
 * 前台抢占/最小化拉回仍由 KioskGuardService 负责（它需要进程活着才跑得起来）。
 *
 * 退出静默期：doExit 会 markExitGrace(30s)，本看门狗在静默期内不拉起，
 * 否则运维退出后 3 分钟内会被看门狗顶回来，30s 静默就失去意义。
 */
class WatchdogReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "LumaSign.Watchdog"
        private const val REQ_CODE = 2002
        /** 保活检查周期。3 分钟：掉线阈值 60s，留足余量又不至于把机器吵醒太频繁 */
        const val INTERVAL_MS = 3 * 60 * 1000L
        private const val ACTION_KEEPALIVE = "com.lumasign.player.action.WATCHDOG_KEEPALIVE"

        /** 调度周期检查。重复调用安全（同 requestCode + FLAG_UPDATE_CURRENT 会替换而非叠加） */
        fun schedule(ctx: Context) {
            try {
                val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val pi = pendingIntent(ctx)
                am.setInexactRepeating(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    android.os.SystemClock.elapsedRealtime() + INTERVAL_MS,
                    INTERVAL_MS,
                    pi
                )
                Log.i(TAG, "watchdog scheduled every ${INTERVAL_MS / 60000}min")
            } catch (e: Exception) {
                Log.w(TAG, "schedule failed (non-fatal): ${e.message}")
            }
        }

        fun cancel(ctx: Context) {
            try {
                val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                am.cancel(pendingIntent(ctx))
                Log.i(TAG, "watchdog cancelled")
            } catch (e: Exception) {
                Log.w(TAG, "cancel failed (non-fatal): ${e.message}")
            }
        }

        private fun pendingIntent(ctx: Context): PendingIntent {
            val i = Intent(ctx, WatchdogReceiver::class.java).apply {
                action = ACTION_KEEPALIVE
            }
            val imm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                PendingIntent.FLAG_IMMUTABLE else 0
            return PendingIntent.getBroadcast(ctx, REQ_CODE, i,
                PendingIntent.FLAG_UPDATE_CURRENT or imm)
        }
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != ACTION_KEEPALIVE) return

        // 退出静默期内不复活：尊重 doExit 的 30s 运维窗口（装包/改设置）
        if (KioskManager.inExitGrace(context)) {
            Log.i(TAG, "in exit grace window, skip relaunch")
            schedule(context)
            return
        }

        if (isAppRunning(context)) {
            Log.d(TAG, "app alive, nothing to do")
        } else {
            Log.w(TAG, "app process gone -> relaunching MainActivity")
            try {
                val i = Intent(context, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(i)
            } catch (e: Exception) {
                Log.w(TAG, "relaunch failed: ${e.message}")
            }
        }

        // 续期下一次检查（BOOT_COMPLETED 时这里是首次注册）
        schedule(context)
    }

    /** 应用进程是否存活。探测失败时保守返回 true（宁可不动，也别乱拉） */
    private fun isAppRunning(ctx: Context): Boolean {
        return try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val list = am.runningAppProcesses ?: return true
            list.any { it.processName == ctx.packageName }
        } catch (e: Exception) {
            Log.w(TAG, "probe failed, assume alive: ${e.message}")
            true
        }
    }
}
