package com.lumasign.player

import android.content.Context
import android.util.Log
import android.webkit.WebResourceResponse
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * 播放素材本地缓存（v1.3.34）——把 `/api/t/media/<id>` 下载到本机 cacheDir/luma-media，
 * 由 MainActivity 的 WebViewClient.shouldInterceptRequest 命中后直接从本地回源，
 * 实现「视频 / 图片下载到屏幕端再播放」：断网、服务端抖动或重启后，已缓存素材依旧能放。
 *
 * 背景：此前 <img>/<video> 直接指向服务端 URL，靠 WebView HTTP 缓存（immutable/1年）兜底，
 *   一旦早期一次瞬时错误被缓存即永久「图片缺失」。改为本地文件回源后彻底摆脱该问题，
 *   且首播仍走网络（保证即时出画），后台同步落本地，次播起一律本地。
 *
 * 设计要点：
 * - 键 = URL 路径末段的 mediaId（m_xxx）；同一 mediaId 内容不可变（重新上传会换新 id），可安全缓存。
 * - 下载走完整 GET（不带 Range）落 `.tmp`，成功后原子 rename 为正式文件——半途文件永不对外服务。
 * - 回源用 3 参 WebResourceResponse(mime, null, 文件流)（API 19 可用；带 statusCode 的 6 参构造是 API 21+）。
 *   <video> 的 Range 请求会被忽略而拿到完整文件体（200）——本地文件瞬时可达，Chromium 33 可正常播/拖。
 * - mime 由文件魔术字节嗅探（URL 不带 mime）。
 * - 体积上限 MAX_BYTES，超出按 lastModified 淘汰（近似 LRU）；clearCache 指令/存储不足时整体清空。
 * - 任何异常都向上抛由调用方兜底返回 null（回退网络），本模块绝不阻塞播放。
 */
object MediaCache {
    private const val TAG = "LumaMediaCache"
    private const val DIR_NAME = "luma-media"
    private const val MAX_BYTES = 512L * 1024 * 1024 // 512MB 上限
    private const val CONNECT_TIMEOUT = 15000
    private const val READ_TIMEOUT = 30000

    // 注意：不能用 ConcurrentHashMap.newKeySet()（API 24+，4.4 运行期崩）；newSetFromMap 全 API 可用
    private val inflight: MutableSet<String> =
        java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private val pool = Executors.newSingleThreadExecutor()
    @Volatile private var dir: File? = null

    /** 在 WebView 加载页面前调用一次 */
    fun init(context: Context) {
        val d = File(context.cacheDir, DIR_NAME)
        if (!d.exists()) d.mkdirs()
        dir = d
    }

    private fun safeKey(id: String): String = id.replace(Regex("[^A-Za-z0-9._-]"), "_")

    /** 已完整落地的本地文件（不存在或半途 .tmp 都返回 null） */
    fun localFile(id: String): File? {
        val d = dir ?: return null
        val f = File(d, safeKey(id))
        return if (f.isFile && f.length() > 0) f else null
    }

    /**
     * 命中本地则返回可直接回源的 WebResourceResponse（完整文件体，200）；
     * 未命中返回 null（调用方应走网络并触发 prefetch）。用 3 参构造以兼容 API 19（4.4）——
     * <video> 的 Range 请求会被忽略而拿到完整文件，本地瞬时可达，Chromium 33 可正常播/拖。
     */
    fun serve(id: String): WebResourceResponse? {
        val f = localFile(id) ?: return null
        return try {
            WebResourceResponse(sniffMime(f), null, FileInputStream(f))
        } catch (e: Exception) {
            Log.w(TAG, "serve $id failed: ${e.message}")
            null
        }
    }

    /** 后台完整下载一份到本地；已缓存或正在下载则直接返回（幂等） */
    fun prefetch(url: String, id: String) {
        val d = dir ?: return
        if (localFile(id) != null) return
        if (!inflight.add(id)) return
        pool.execute {
            try {
                downloadToFile(url, id, d)
            } catch (e: Exception) {
                Log.w(TAG, "prefetch $id failed: ${e.message}")
            } finally {
                inflight.remove(id)
            }
        }
    }

    private fun downloadToFile(url: String, id: String, d: File) {
        val key = safeKey(id)
        val tmp = File(d, "$key.tmp")
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT
            readTimeout = READ_TIMEOUT
            instanceFollowRedirects = true
            requestMethod = "GET"
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                Log.w(TAG, "download $id -> HTTP $code")
                return
            }
            FileOutputStream(tmp).use { out ->
                conn.inputStream.use { input ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                    }
                }
            }
            if (tmp.length() <= 0L) { tmp.delete(); return }
            val fin = File(d, key)
            if (fin.exists()) fin.delete()
            if (!tmp.renameTo(fin)) { tmp.delete(); return }
            Log.i(TAG, "cached $key (${fin.length()}B)")
            evictIfNeeded(d)
        } finally {
            try { conn.disconnect() } catch (_: Exception) {}
        }
    }

    /** 超出上限时从最旧开始淘汰，直到降到 90% */
    private fun evictIfNeeded(d: File) {
        val files = d.listFiles { f -> f.isFile && !f.name.endsWith(".tmp") } ?: return
        var total = files.fold(0L) { acc, f -> acc + f.length() }
        if (total <= MAX_BYTES) return
        for (f in files.sortedBy { it.lastModified() }) {
            if (total <= MAX_BYTES * 9 / 10) break
            val len = f.length()
            if (f.delete()) total -= len
        }
    }

    /** 清空本地素材缓存（clear_cache 指令 / 存储不足） */
    fun clear() {
        val d = dir ?: return
        try {
            d.listFiles()?.forEach { deleteRecursive(it) }
        } catch (e: Exception) {
            Log.w(TAG, "clear failed: ${e.message}")
        }
    }

    private fun deleteRecursive(f: File) {
        if (f.isDirectory) f.listFiles()?.forEach { deleteRecursive(it) }
        f.delete()
    }

    /** 依据文件头魔术字节推断 mime（URL 不带 mime，需自判） */
    fun sniffMime(f: File): String {
        val head = ByteArray(16)
        try {
            FileInputStream(f).use { it.read(head) }
        } catch (_: Exception) {}
        fun ascii(off: Int, len: Int) = String(head, off, len, Charsets.US_ASCII)
        return when {
            head.size >= 8 && head[0] == 0x89.toByte() && head[1] == 0x50.toByte() &&
                head[2] == 0x4E.toByte() && head[3] == 0x47.toByte() -> "image/png"
            head.size >= 3 && head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() &&
                head[2] == 0xFF.toByte() -> "image/jpeg"
            head.size >= 6 && head[0] == 0x47.toByte() && head[1] == 0x49.toByte() &&
                head[2] == 0x46.toByte() -> "image/gif"
            head.size >= 12 && ascii(0, 4) == "RIFF" && ascii(8, 4) == "WEBP" -> "image/webp"
            head.size >= 12 && ascii(4, 4) == "ftyp" -> "video/mp4"
            head.size >= 4 && head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() &&
                head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte() -> "video/webm"
            else -> "application/octet-stream"
        }
    }
}
