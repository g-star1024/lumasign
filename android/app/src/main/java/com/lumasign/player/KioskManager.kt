package com.lumasign.player

import android.annotation.SuppressLint
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.provider.Settings
import android.util.Log

/**
 * Kiosk 抢占管理（5.0+ 系统级锁定；4.4 无 Device Owner 概念，所有方法自动跳过）。
 *
 * 目标：当灵屏被注册为 Device Owner 后（adb 一次性操作，需拆机前完成）：
 *  1. setPersistentPreferredActivity —— 静默把 MainActivity 设为默认 Launcher（用户无需弹框选择）
 *  2. setLockTaskPackages + startLockTask —— 进入锁定任务，触拓等任何 Activity 都无法盖上来
 *  3. 此时优先级是「系统级」，比 KioskGuardService 的软抢占高一个量级
 *
 * 注册命令（ADB，Android 5.0+）：
 *  adb shell dpm set-device-owner com.lumasign.player/.KioskAdminReceiver
 * 注意：设置 Device Owner 会清除设备用户数据，请在初始化设备时执行。
 */
object KioskManager {
    private const val TAG = "LumaSign.Kiosk"

    /**
     * 是否已是 Device Owner。
     * API 23+：官方 isDeviceOwnerApp 查询；
     * API 21-22：无公开查询接口，用 setLockTaskPackages 试探（抛异常 = 非 owner）。
     */
    @SuppressLint("NewApi")
    fun isDeviceOwner(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false
        return try {
            val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                dpm.isDeviceOwnerApp(ctx.packageName)
            } else {
                try {
                    dpm.setLockTaskPackages(
                        ComponentName(ctx, KioskAdminReceiver::class.java),
                        arrayOf(ctx.packageName)
                    )
                    true
                } catch (_: Exception) {
                    false
                }
            }
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Device Owner 时进入 Kiosk：静默默认 Home + 锁定任务。
     * 非 owner / Android 4.4 自动跳过，绝不影响正常使用。
     * 应在 Activity.onResume 阶段调用（startLockTask 要求 resumed 状态）。
     */
    @SuppressLint("NewApi")
    fun maybeEnterKiosk(activity: Activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
        if (!isDeviceOwner(activity)) return
        try {
            val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(activity, KioskAdminReceiver::class.java)

            // 1) 静默把 MainActivity 设为默认 Home（替代用户手动选择启动器）
            // 注意：setPersistentPreferredActivity 在部分 compileSdk 的公开 stub 中不可见（@hide），
            // 用反射调用以兼容不同 SDK 版本；失败不致命，仍继续进入 lockTask 锁定。
            val homeFilter = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            try {
                val m = DevicePolicyManager::class.java.getMethod(
                    "setPersistentPreferredActivity",
                    ComponentName::class.java,
                    IntentFilter::class.java,
                    ComponentName::class.java
                )
                m.invoke(dpm, admin, homeFilter, ComponentName(activity, MainActivity::class.java))
                Log.i(TAG, "persistent preferred home set")
            } catch (re: Exception) {
                Log.w(TAG, "setPersistentPreferredActivity 反射失败（非致命）: ${re.message}")
            }

            // 2) 锁定任务白名单（仅自己），随后进入 lockTask（HOME/返回键全部失效）
            dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
            activity.startLockTask()
            Log.i(TAG, "Kiosk mode entered (device owner)")
        } catch (e: Exception) {
            Log.w(TAG, "Kiosk enter failed (non-fatal): ${e.message}")
        }
    }

    /** 悬浮窗授权：API 23+ 需用户在系统设置开启「显示在其他应用上层」；22 及以下安装即授权 */
    fun canDrawOverlays(ctx: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try { Settings.canDrawOverlays(ctx) } catch (_: Exception) { false }
        } else {
            true
        }
    }
}
