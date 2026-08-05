package com.lumasign.player

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 自升级：下载 APK 并请求安装。零第三方依赖，使用原生 HttpURLConnection。
 */
object UpdateManager {

    @Suppress("DEPRECATION")
    fun install(context: Context, apkUrl: String) {
        Thread {
            try {
                val dir = File(context.externalCacheDir ?: context.cacheDir, "updates")
                dir.mkdirs()
                val file = File(dir, "lumasign_update.apk")

                val conn = URL(apkUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 30000
                conn.readTimeout = 60000
                conn.requestMethod = "GET"
                conn.connect()
                val code = conn.responseCode
                if (code != HttpURLConnection.HTTP_OK) { conn.disconnect(); return@Thread }
                conn.inputStream.use { input ->
                    FileOutputStream(file).use { out ->
                        val buf = ByteArray(8192)
                        var n: Int
                        while (input.read(buf).also { n = it } != -1) out.write(buf, 0, n)
                    }
                }
                conn.disconnect()

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
                e.printStackTrace()
            }
        }.start()
    }
}
