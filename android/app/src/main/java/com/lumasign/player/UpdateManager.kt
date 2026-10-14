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
 * - root 设备优先 pm install -r 静默安装（kiosk 无人值守，免手动确认）
 *
 * 关键兼容点（瑞芯微 rk312x / Android 4.4 / API 19）：
 * 1) `pm install -g`（grant 全部权限）在 API 19 上是「Unknown option」，会导致安装命令直接失败。
 *    4.4 为安装期授权模型（无运行时权限弹窗），本就无需 -g，故仅 LOLLIPOP+ 才加 -g。
 * 2) 跨签名自愈：当新包与已装包签名不一致时，`pm install -r` 会被拒。此时先卸载旧包再装新包。
 *    卸载会清理应用私有目录，故 APK 需先复制到与包名无关的中立路径 /data/local/tmp，
 *    并用 setsid 完全脱离原进程树，确保卸载「正在运行的自家应用」后安装脚本仍能继续执行并拉起新版本。
 */
object UpdateManager {

    private const val TAG = "LumaUpdate"
    private const val PKG = "com.lumasign.player"
    private const val NEUTRAL_APK = "/data/local/tmp/lumasign_update.apk"
    private const val INSTALL_SCRIPT = "/data/local/tmp/lumasign_install.sh"

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

                if (ScreenPower.isRootAvailable()) {
                    // 复制到与包名无关的中立路径（root 执行，避免 uninstall 时随应用缓存被清理）
                    val copied = ScreenPower.execRoot("cp ${file.absolutePath} $NEUTRAL_APK && chmod 644 $NEUTRAL_APK")
                    val apkPath = if (copied && File(NEUTRAL_APK).exists() && File(NEUTRAL_APK).length() == file.length())
                        NEUTRAL_APK else file.absolutePath

                    // ① 同签名优先：增量静默安装（kiosk 无人值守）
                    if (installAsRoot(apkPath)) {
                        Log.i(TAG, "已静默增量安装更新，重启后生效")
                        ScreenPower.execRoot("rm -f $NEUTRAL_APK")
                        return@Thread
                    }

                    // ② 跨签名自愈：卸载旧包（旧签名）后再装新包（新签名）
                    Log.w(TAG, "增量安装失败（疑似签名不一致），尝试卸载旧包后重装以自愈跨签名升级")
                    if (selfHealInstallAsRoot(context, apkPath)) {
                        Log.i(TAG, "已提交跨签名自愈安装，新版本将自动拉起")
                        return@Thread
                    }
                }

                // ③ 回退：系统安装器（需用户点确认）
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

    /** root 静默安装；API 19 不加 -g（该选项在 4.4 上不存在） */
    private fun installAsRoot(apkPath: String): Boolean {
        val grant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) " -g" else ""
        return ScreenPower.execRoot("pm install -r$grant $apkPath")
    }

    /**
     * 跨签名自愈：卸载运行中旧应用 → 安装新应用 → 拉起 MainActivity。
     * 用 setsid 完全脱离原进程树，规避「卸载自家应用导致安装脚本随进程被杀」。
     */
    private fun selfHealInstallAsRoot(context: Context, apkPath: String): Boolean {
        return try {
            // 脚本先写到应用自有缓存目录（应用可写），再经 root 复制到中立路径
            val cacheScript = File(context.cacheDir, "lumasign_install.sh")
            cacheScript.writeText(
                buildString {
                    appendLine("#!/system/bin/sh")
                    appendLine("sleep 1")
                    appendLine("pm uninstall $PKG")
                    appendLine("sleep 3")
                    appendLine("pm install -r $apkPath")
                    appendLine("am start -n $PKG/.MainActivity")
                    appendLine("rm -f $INSTALL_SCRIPT $apkPath")
                }
            )
            val staged = ScreenPower.execRoot("cp ${cacheScript.absolutePath} $INSTALL_SCRIPT && chmod 755 $INSTALL_SCRIPT")
            if (!staged) { Log.e(TAG, "安装脚本写入中立路径失败"); return false }

            // 优先 setsid 完全脱离（卸载运行中应用自身后仍能继续）；否则 nohup 后台
            val detached = ScreenPower.execRoot("setsid sh $INSTALL_SCRIPT >/dev/null 2>&1 &")
                || ScreenPower.execRoot("nohup sh $INSTALL_SCRIPT >/dev/null 2>&1 &")
            detached || ScreenPower.execRoot(
                "pm uninstall $PKG && sleep 3 && pm install -r $apkPath && am start -n $PKG/.MainActivity"
            )
        } catch (e: Exception) {
            Log.e(TAG, "自愈安装异常：${e.message}")
            false
        }
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
