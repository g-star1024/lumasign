package com.lumasign.player

import android.util.Log
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * 屏幕端本地素材回源服务（v1.3.50）——让平台媒体栈直接读本机缓存文件。
 *
 * 背景（2026-10-26 真机实证）：
 *  - Android 4.4 上 `<video>` 的取数由**平台媒体栈**发起（access log 里
 *    UA=AppleCoreMedia/1.0.0.7B367 与 RockFFPlayer），**绕过** WebViewClient.shouldInterceptRequest
 *    → MediaCache 的「本地回源」对视频根本不生效（对 `<img>` 有效），于是每轮轮播都远程重下同一文件。
 *  - 改用 `file://` 也不行：Chromium 33 对 http 源页面直接拒绝
 *    「Not allowed to load local resource: file:///data/data/...」，媒体栈拿不到 MIME。
 *  - 唯一可行路径：给媒体栈一个 http 回环地址，指向本机回环端口，由本服务回源到本地缓存文件。
 *
 * 设计要点：
 *  - 只监听 127.0.0.1（回环），不对局域网暴露；仅回源**已完整落盘**的缓存文件（半途 .tmp 不给）。
 *  - 支持 Range（媒体栈常带 `Range: bytes=0-`），206 + Content-Range，Chromium 33 可正常播/拖。
 *  - mime 由文件魔术字节嗅探（缓存文件扩展名虽已带，嗅探更稳）。
 *  - 任何异常都吞掉（绝不影响播放）；单连接单线程处理，避免阻塞。
 */
object LocalMediaServer {
    private const val TAG = "LumaLocalMedia"

    /** 单连接最多处理的请求数（防线程/连接堆积） */
    private const val MAX_REQS_PER_CONN = 16

    /** 回环端口（0 = 由系统分配，start 后可读） */
    @Volatile
    var port: Int = 0
        private set

    private var ss: ServerSocket? = null

    /** ASCII 小写（避免 Kotlin 版本差异的 toLowerCase 弃用告警） */
    private fun lower(s: String): String {
        val b = StringBuilder(s.length)
        for (c in s) b.append(if (c in 'A'..'Z') (c + 32) else c)
        return b.toString()
    }

    fun start() {
        if (ss != null) return
        try {
            val s = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
            ss = s
            port = s.localPort
            Thread({ acceptLoop(s) }, "luma-local-media").apply { isDaemon = true }.start()
            Log.i(TAG, "local media server on 127.0.0.1:$port")
        } catch (e: Exception) {
            Log.w(TAG, "start failed: ${e.message}")
        }
    }

    private fun acceptLoop(s: ServerSocket) {
        while (!s.isClosed) {
            try {
                val sock = s.accept()
                Thread({ handle(sock) }, "luma-local-media-conn").apply { isDaemon = true }.start()
            } catch (e: Exception) {
                if (s.isClosed) break
            }
        }
    }

    private fun handle(sock: Socket) {
        try {
            sock.soTimeout = 8000
            val input = BufferedReader(InputStreamReader(sock.getInputStream(), "UTF-8"))
            val out = BufferedOutputStream(sock.getOutputStream())
            // ★ v1.3.51/52：同一连接上循环处理多个请求（keep-alive）——
            //   媒体栈（ffmpeg/RockFFPlayer）会在一个连接上连发多次 Range 请求，
            //   服务端若每次都关连接，它下一次请求就「open fail」。
            //   但连接数与时长必须封顶（MAX_REQS_PER_CONN / soTimeout），否则线程会堆积。
            var served = 0
            while (served < MAX_REQS_PER_CONN) {
                val requestLine = input.readLine() ?: break      // 客户端断开
                if (requestLine.isBlank()) continue
                served++
                val headers = HashMap<String, String>()
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                    val idx = line.indexOf(':')
                    if (idx > 0) headers[lower(line.substring(0, idx).trim())] = line.substring(idx + 1).trim()
                }
                val parts = requestLine.split(" ")
                val method = parts.getOrNull(0) ?: "GET"
                val path = parts.getOrNull(1) ?: "/"
                Log.i(TAG, "req $method $path range=" + (headers["range"] ?: "-"))
                val isHead = method.equals("HEAD", true)
                if (!isHead && !method.equals("GET", true)) {
                    respond(out, 405, "text/plain", "method not allowed".toByteArray(), null, false)
                    break
                }
                val id = path.substringAfter("/media/", "").substringBefore('?')
                if (id.isEmpty()) {
                    respond(out, 404, "text/plain", "not found".toByteArray(), null, false); break
                }
                val f = MediaCache.localFile(id)
                if (f == null) {
                    respond(out, 404, "text/plain", "not cached".toByteArray(), null, false); break
                }

                val total = f.length()
                val mime = MediaCache.sniffMime(f)
                // ★ v1.3.52：与桌面端 sendFile 完全同款的缓存语义（ETag / Cache-Control / 304），
                //   媒体栈对「像静态文件服务器」的响应最友好（桌面端 /api/t/media 就是这么发的）。
                val etag = "W/\"${total}-${f.lastModified()}\""
                if (headers["if-none-match"] == etag) {
                    out.write("HTTP/1.1 304 Not Modified\r\nETag: $etag\r\nCache-Control: public, max-age=300, must-revalidate\r\nConnection: keep-alive\r\n\r\n".toByteArray(Charsets.UTF_8))
                    out.flush()
                    continue
                }
                var start = 0L
                var end = total - 1
                var code = 200
                val range = headers["range"]
                if (range != null && range.isNotEmpty()) {
                    val m = Regex("bytes=(\\d*)-(\\d*)").find(range)
                    if (m != null) {
                        val g1 = m.groupValues[1]
                        val g2 = m.groupValues[2]
                        if (g1.isNotEmpty()) start = g1.toLong()
                        if (g2.isNotEmpty()) end = minOf(g2.toLong(), total - 1)
                        if (start >= total) {
                            respond(out, 416, "text/plain", "range not satisfiable".toByteArray(),
                                "Content-Range: bytes " + "*" + "/" + total.toString(), false)
                            break
                        }
                        code = 206
                    }
                }
                val len = (end - start + 1).coerceAtLeast(0L)
                val head = StringBuilder()
                head.append("HTTP/1.1 ").append(code).append(' ').append(if (code == 206) "Partial Content" else "OK").append("\r\n")
                head.append("Content-Type: ").append(mime).append("\r\n")
                head.append("Content-Length: ").append(len).append("\r\n")
                head.append("Accept-Ranges: bytes\r\n")
                head.append("ETag: ").append(etag).append("\r\n")
                if (code == 206) head.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(total).append("\r\n")
                head.append("Cache-Control: public, max-age=300, must-revalidate\r\n")
                head.append("Connection: keep-alive\r\n\r\n")
                out.write(head.toString().toByteArray(Charsets.UTF_8))
                out.flush()
                if (isHead) continue                      // HEAD：只回头，不发 body，连接保留
                if (len > 0) {
                    RandomAccessFile(f, "r").use { raf ->
                        raf.seek(start)
                        val buf = ByteArray(64 * 1024)
                        var remaining = len
                        while (remaining > 0) {
                            val want = minOf(buf.size.toLong(), remaining).toInt()
                            val n = raf.read(buf, 0, want)
                            if (n <= 0) break
                            out.write(buf, 0, n)
                            remaining -= n
                        }
                    }
                }
                out.flush()
            }
        } catch (_: Exception) {
            // 回源失败一律忽略：调用方会回退网络直连
        } finally {
            try { sock.close() } catch (_: Exception) {}
        }
    }

    private fun respond(out: BufferedOutputStream, code: Int, mime: String, body: ByteArray, extra: String?, keepAlive: Boolean) {
        try {
            val head = StringBuilder()
            head.append("HTTP/1.1 ").append(code).append(" X\r\n")
            head.append("Content-Type: ").append(mime).append("\r\n")
            head.append("Content-Length: ").append(body.size).append("\r\n")
            if (extra != null) head.append(extra).append("\r\n")
            head.append("Connection: ").append(if (keepAlive) "keep-alive" else "close").append("\r\n\r\n")
            out.write(head.toString().toByteArray(Charsets.UTF_8))
            out.write(body)
            out.flush()
        } catch (_: Exception) {}
    }
}
