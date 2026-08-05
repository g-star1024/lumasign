package com.lumasign.player

import android.content.Context
import android.content.pm.PackageManager
import android.os.PowerManager
import java.io.DataOutputStream

/**
 * 真熄屏 / 真亮屏 统一入口：
 * 1) 系统签名 / priv-app 路径：反射隐藏 API PowerManager.goToSleep() / wakeUp()（需 DEVICE_POWER）。
 * 2) root 路径：su + input keyevent 26 真正开关屏。
 * 3) 两者皆无：返回 false，由上层降级为亮度置 0（假熄屏）。
 *
 * 系统签名方案：APK 用设备 platform 密钥签名，或作为 priv-app 安装并授予 DEVICE_POWER。
 * root 方案：设备已 root，普通安装即可经 su 调用。
 */
object ScreenPower {

    /** 是否持有系统电源权限（系统签名 / priv-app 授予 DEVICE_POWER） */
    fun hasSystemPowerPermission(context: Context): Boolean {
        return try {
            context.checkSelfPermission("android.permission.DEVICE_POWER") == PackageManager.PERMISSION_GRANTED
        } catch (_: Exception) { false }
    }

    /** 设备是否已 root（su 可用） */
    fun isRootAvailable(): Boolean {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("su", "-c", "echo root_ok"))
            val ok = p.inputStream.bufferedReader().readLine() == "root_ok"
            p.waitFor()
            ok
        } catch (_: Exception) { false }
    }

    /** 真熄屏：成功返回 true */
    fun tryTrueOff(context: Context): Boolean {
        if (goToSleep(context)) return true
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isInteractive && execRoot("input keyevent 26")) return true
        return false
    }

    /** 真亮屏：成功返回 true */
    fun tryTrueOn(context: Context): Boolean {
        if (wakeUp(context)) return true
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isInteractive && execRoot("input keyevent 26")) return true
        return false
    }

    private fun goToSleep(context: Context): Boolean {
        return try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val m = pm.javaClass.getMethod("goToSleep", Long::class.javaPrimitiveType)
            m.isAccessible = true
            m.invoke(pm, System.currentTimeMillis())
            true
        } catch (_: Exception) { false }
    }

    private fun wakeUp(context: Context): Boolean {
        return try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val m = pm.javaClass.getMethod("wakeUp", Long::class.javaPrimitiveType)
            m.isAccessible = true
            m.invoke(pm, System.currentTimeMillis())
            true
        } catch (_: Exception) { false }
    }

    /** 经 su 执行单条命令，成功返回 true */
    fun execRoot(cmd: String): Boolean {
        return try {
            val p = Runtime.getRuntime().exec("su")
            val os = DataOutputStream(p.outputStream)
            os.writeBytes("$cmd\n")
            os.writeBytes("exit\n")
            os.flush()
            p.waitFor() == 0
        } catch (_: Exception) { false }
    }
}
