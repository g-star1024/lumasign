package com.lumasign.player

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 设备管理员 / Device Owner 接收器。
 * 仅用于 Android 5.0+ Kiosk 模式：
 *   adb shell dpm set-device-owner com.lumasign.player/.KioskAdminReceiver
 * Android 4.4 无 Device Owner 概念，本类不会被系统实例化。
 */
class KioskAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Log.i("LumaSign.Kiosk", "Device admin enabled")
    }
}
