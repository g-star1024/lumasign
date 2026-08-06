package com.lumasign.player

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 自升级：下载 APK 并安装。零第三方依赖，使用原生 HttpURLConnection。
 * - 最多重试 3 次（应对局域网抖动）
 * - expectedSha256 非空时校验完整性，防损坏/被投毒的安装包
 * - root 设备优先 pm install -r -g 静默安装（kiosk 无人值守，免手动确认）
 */
object UpdateManager {

    private const val TAG = "LumaUpdate"

    @Suppress("DEPRECATION")
    fun install(context: Context, apkUrl: String, expectedSha256: String? = null) {
        Thread {
            try {
                val dir = File(context.externalCacheDir ?: context.cacheDir, "updates")
                dir.mkdirs()
                val file = File(dir, "lumasign_update.apk")

                var downloaded = false
                for (attempt in 1..3) {
                    if (downloadFile(apkUrl, file)) { downloaded = true; break }
                    Log.w(TAG, "下载失败，第 $attempt 次重试")
                    Thread.sleep(2000)
                }
                if (!downloaded) { Log.e(TAG, "APK 下载失败（已重试 3 次）"); return@Thread }

                if (!expectedSha256.isNullOrBlank()) {
                    val actual = sha256(file)
                    if (!actual.equals(expectedSha256, true)) {
                        Log.e(TAG, "APK 校验失败：期望 $expectedSha256 实际 $actual")
                        file.delete()
                        return@Thread
                    }
                }

                // root 静默安装优先
                if (ScreenPower.isRootAvailable()) {
                    val ok = ScreenPower.execRoot("pm install -r -g ${file.absolutePath}")
                    if (ok) { Log.i(TAG, "已静默安装更新，重启后生效"); return@Thread }
                }

                // 回退：系统安装器（需用户点确认）
                val uri: Uri = FileProvider.getUriForFile(
                    context, context.packageName + ".fileprovider", file
                )
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "自升级异常：${e.message}")
            }
        }.start()
    }

    private fun downloadFile(url: String, file: File): Boolean {
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 30000
            conn.readTimeout = 120000
            conn.requestMethod = "GET"
            conn.connect()
            if (conn.responseCode != HttpURLConnection.HTTP_OK) { conn.disconnect(); return false }
            conn.inputStream.use { input ->
                FileOutputStream(file).use { out ->
                    val buf = ByteArray(8192)
                    var n: Int
                    while (input.read(buf).also { n = it } != -1) out.write(buf, 0, n)
                }
            }
            conn.disconnect()
            file.length() > 0
        } catch (e: Exception) {
            Log.e(TAG, "下载异常：${e.message}")
            false
        }
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { fis ->
            val buf = ByteArray(8192)
            var n: Int
            while (fis.read(buf).also { n = it } != -1) md.update(buf, 0, n)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
