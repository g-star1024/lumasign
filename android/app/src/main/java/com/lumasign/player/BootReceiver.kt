package com.lumasign.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 开机自启 / 自升级后自拉起。
 * 需在系统设置中授予「自启动」权限（各厂商路径不同），否则部分 ROM 会拦截。
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
        }
    }
}
