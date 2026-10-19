package com.lumasign.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 退出静默期到点的重新拉起（v1.3.44）。
 *
 * 背景：doExit 为防「系统以 HOME intent 秒回」会先禁用 MainActivity 的 HOME 组件
 * （见 KioskManager.setHomeComponentEnabled）。30s 静默期到点后由本 Receiver：
 *   1. 先恢复组件（禁用期间显式 intent 无法启动该组件）
 *   2. 再显式拉起 MainActivity
 * 用广播而非 PendingIntent.getActivity：恢复组件必须发生在 startActivity 之前，
 * 而 getActivity 的 intent 到点直接启动 Activity，没有插入恢复逻辑的机会。
 */
class ExitRelaunchReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "LumaSign.ExitRelaunch"
        const val ACTION_RELAUNCH = "com.lumasign.player.action.EXIT_RELAUNCH"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        Log.i(TAG, "exit grace over -> restoring home component and relaunching")
        // 恢复组件（幂等；LumaApplication.attachBaseContext 通常已恢复，双保险）
        KioskManager.ensureHomeEnabled(context)
        try {
            val i = Intent(context, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
            }
            context.startActivity(i)
        } catch (e: Exception) {
            Log.w(TAG, "relaunch failed: ${e.message}")
        }
    }
}
