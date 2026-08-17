package com.lumasign.player

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.net.HttpURLConnection
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: LumaBridge
    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private val uiHandler = Handler(Looper.getMainLooper())

    // 加载 / 错误覆盖层（服务端不可达时显示「正在重连」而非黑屏死寂）
    private lateinit var overlay: TextView
    private var loadFailed = false
    private var retryRunnable: Runnable? = null

    // 网络连通性监听
    private val connectivityManager by lazy {
        getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    private var lastNetOnline: Boolean? = null
    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { onConnectivityChanged(true) }
        override fun onLost(network: Network) { onConnectivityChanged(false) }
    }
    private val netReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) { onConnectivityChanged(isNetworkOnline()) }
    }

    companion object {
        const val PREFS = "luma_config"
        const val KEY_SERVER = "server_url"
        const val KEY_CODE = "terminal_code"
        @JvmField var crashCount: Int = 0
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // 开机/重启后自动点亮屏幕并越过锁屏（kiosk 无人值守关键）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            window.addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        )
        hideSystemUI()

        // 累计崩溃计数（持久化），供健康度上报
        crashCount = prefs.getInt("crash_count", 0)
        // 注意：UncaughtExceptionHandler 已由 LumaApplication 在 attachBaseContext() 注册，
        // 此处不再重复注册，避免覆盖应用级 handler（更早捕获 theme/layout 异常）

        setupOverlay()

        // ── 崩溃复盘：上次崩溃过 → 自动把日志发到管理端 + 屏幕显示 10 秒 ──
        // 即使 APP 没崩溃但计数 > 0，也能主动把日志送到服务端，后台「终端管理」可查看
        // 崩溃复盘已由 CrashRecoveryActivity（启动入口）展示，此处不再重复弹窗
        // 崩溃日志上传也已由 LumaApplication 在 attachBaseContext 阶段完成

        webView = findViewById(R.id.webview)
        setupWebView()

        handleIntent(intent)
        val server = prefs.getString(KEY_SERVER, "") ?: ""
        if (server.isBlank()) showDiscoveringThenConfig() else loadPlayer(server)
        applyScreenIntent(intent)

        registerConnectivity()
    }

    /** 启动前台服务：防 OOM Kill + 保持 CPU 不休眠（非致命，服务失败不连累主界面） */
    private fun startWatchdogService() {
        try {
            val intent = Intent(this, CrashWatchdogService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            android.util.Log.i("LumaSign", "WatchdogService started")
        } catch (e: Exception) {
            android.util.Log.w("LumaSign", "WatchdogService start failed (non-fatal): ${e.message}")
        }
    }

    /**
     * 崩溃复盘屏：上次崩溃过 → 全屏显示崩溃日志（10 秒后自动关闭）
     * 内嵌墙设备无需 USB/ADB/文件管理器，谁路过都能看到崩溃原因
     */
    private fun showCrashDebugScreen() {
        val logText = readCrashLogText() ?: return
        runOnUiThread {
            val dialogView = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setBackgroundColor(Color.BLACK)
                setPadding(40, 40, 40, 40)
            }
            val titleTv = TextView(this).apply {
                setTextColor(Color.WHITE)
                textSize = 18f
                text = "⚠ 灵屏播放端 崩溃诊断\n(上次崩溃 $crashCount 次)"
            }
            val logTv = TextView(this).apply {
                setTextColor(Color.parseColor("#fbbf24"))
                textSize = 12f
                typeface = Typeface.MONOSPACE
                text = logText.take(4000)
                setPadding(0, 16, 0, 0)
            }
            dialogView.addView(titleTv)
            dialogView.addView(logTv)

            val dialog = AlertDialog.Builder(this)
                .setView(dialogView)
                .setTitle("崩溃诊断（10 秒后自动关闭）")
                .setCancelable(false)
                .show()

            uiHandler.postDelayed({
                dialog.dismiss()
                // 复盘后清零计数（下次再崩才显示，避免刷屏）
                crashCount = 0
                prefs.edit().putInt("crash_count", 0).apply()
            }, 10000)
        }
    }

    /**
     * 崩溃日志主动上传到管理端：POST /api/terminals/:code/logs
     * 即使 APP 闪退，崩溃日志也会通过下一启动时的 HTTP 请求发送到管理端
     */
    private fun uploadCrashLogToServer() {
        val logText = readCrashLogText() ?: return
        val serverUrl = prefs.getString(KEY_SERVER, "") ?: ""
        val code = prefs.getString(KEY_CODE, "") ?: ""
        if (serverUrl.isBlank()) return
        val url = serverUrl.trimEnd('/') + "/api/t/crash"
        Thread {
            try {
                val conn = java.net.URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("X-Luma-Product", "LumaSign")
                conn.setConnectTimeout(5000)
                conn.setReadTimeout(10000)
                val payload = JSONObject().apply {
                    put("token", prefs.getString(KEY_CODE, "") ?: "")
                    put("model", Build.MODEL)
                    put("androidVersion", Build.VERSION.RELEASE)
                    put("crashCount", crashCount)
                    put("log", logText.take(8000))
                }.toString()
                conn.doOutput = true
                conn.outputStream.write(payload.toByteArray(Charsets.UTF_8))
                val rc = conn.responseCode
                android.util.Log.i("LumaSign", "crash log uploaded: HTTP $rc")
                conn.disconnect()
            } catch (e: Exception) {
                android.util.Log.w("LumaSign", "crash log upload failed: ${e.message}")
            }
        }.start()
    }

    /** 读取 SD 卡崩溃日志文本（供上传/显示使用） */
    private fun readCrashLogText(): String? {
        try {
            val pubFile = File(Environment.getExternalStorageDirectory(), "LumaSign/crash.log")
            if (pubFile.exists()) return pubFile.readText().take(8000)
        } catch (_: Exception) { }
        try {
            val appFile = File(getExternalFilesDir(null), "logs/crash.log")
            if (appFile.exists()) return appFile.readText().take(8000)
        } catch (_: Exception) { }
        return null
    }

    /** 响应定时/远程开关节指令 */
    private fun applyScreenIntent(intent: Intent?) {
        when (intent?.getStringExtra("screen")) {
            "on" -> setScreenOn(true)
            "off" -> setScreenOn(false)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val ws = webView.settings
        ws.javaScriptEnabled = true
        ws.mediaPlaybackRequiresUserGesture = false
        ws.allowFileAccess = true
        ws.allowContentAccess = true
        // ── 低内存设备保护：domStorage/databaseEnabled 在 64-128MB 内存的
        // RK312x/Allwinner 板上极易 OOM，仅中端以上设备开启 ──
        if (activityMemoryMB() >= 256) {
            ws.domStorageEnabled = true
            ws.databaseEnabled = true
        }
        // ── Android 4.4 (Chromium 30) 硬件加速已知会导致 WebView 静默崩溃，
        // 强制使用软件渲染。CHUTO e-player 的标配做法（LAYER_TYPE_SOFTWARE） ──
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            ws.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        ws.useWideViewPort = true
        ws.loadWithOverviewMode = true
        // 离线韧性：优先用缓存，服务端重启/短暂断网时播放壳不白屏
        // 注意：AppCache（setAppCacheEnabled/setAppCachePath）已在 WebView API 33+ 删除，
        // 改用 LOAD_CACHE_ELSE_NETWORK 走 HTTP 缓存即可（服务端带 Cache-Control/ETag）
        ws.cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
        // WebView 远程调试仅 debug 构建开启（release 常开是安全风险）
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

        bridge = LumaBridge(this, webView)
        webView.addJavascriptInterface(bridge, "LumaBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = false
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                if (loadFailed) showOverlay("灵屏 LumaSign\n正在重新连接服务端…")
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                loadFailed = false
                retryRunnable?.let { uiHandler.removeCallbacks(it) }
                hideOverlay()
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) onMainFrameError(error?.description?.toString())
            }
            @Suppress("DEPRECATION")
            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                if (view?.url == null || failingUrl == view.url) onMainFrameError(description)
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) { /* 进度可在 UI 体现，此处保持轻量 */ }
        }
    }

    private fun onMainFrameError(desc: String?) {
        loadFailed = true
        showOverlay("无法连接服务端\n${desc ?: ""}\n将自动重试…")
        scheduleRetry()
    }

    private fun scheduleRetry() {
        retryRunnable?.let { uiHandler.removeCallbacks(it) }
        retryRunnable = Runnable {
            val server = prefs.getString(KEY_SERVER, "") ?: ""
            if (server.isNotBlank() && loadFailed) { loadFailed = false; loadPlayer(server) }
        }
        uiHandler.postDelayed(retryRunnable!!, 15000)
    }

    private fun setupOverlay() {
        overlay = TextView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.BLACK)
            setTextColor(Color.parseColor("#6b7280"))
            textSize = 16f
            gravity = Gravity.CENTER
            text = "灵屏 LumaSign\n正在连接服务端…"
            visibility = View.VISIBLE
        }
        (findViewById<ViewGroup>(R.id.root)).addView(overlay)
    }

    private fun showOverlay(msg: String) { overlay.text = msg; overlay.visibility = View.VISIBLE }
    private fun hideOverlay() { overlay.visibility = View.GONE }

    private fun loadPlayer(server: String) {
        val code = prefs.getString(KEY_CODE, "") ?: ""
        val url = buildString {
            append(server.trimEnd('/'))
            append("/player/?mode=term")
            if (code.isNotBlank()) append("&code=").append(code)
        }
        webView.loadUrl(url)
    }

    /** 网络连通性变化：恢复时通知引擎重连指令流+刷新清单，并兜底重载失败的页面 */
    private fun onConnectivityChanged(online: Boolean) {
        if (lastNetOnline == online) return
        lastNetOnline = online
        if (!online) return
        webView.post {
            webView.evaluateJavascript("try{window.__onNetworkChange&&window.__onNetworkChange(true)}catch(e){}", null)
            if (loadFailed) {
                val server = prefs.getString(KEY_SERVER, "") ?: ""
                if (server.isNotBlank()) { loadPlayer(server) }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun isNetworkOnline(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val nw = connectivityManager.activeNetwork ?: return false
                val caps = connectivityManager.getNetworkCapabilities(nw) ?: return false
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            } else {
                val info = connectivityManager.activeNetworkInfo
                info != null && info.isConnected
            }
        } catch (_: Exception) { false }
    }

    private fun registerConnectivity() {
        lastNetOnline = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
            try { connectivityManager.registerNetworkCallback(req, netCallback) } catch (_: Exception) {}
        } else {
            val filter = IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION)
            try { registerReceiver(netReceiver, filter) } catch (_: Exception) {}
        }
    }

    private fun unregisterConnectivity() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) connectivityManager.unregisterNetworkCallback(netCallback)
            else unregisterReceiver(netReceiver)
        } catch (_: Exception) {}
    }

    /** 深链配置：lumasync://config?server=http://192.168.1.10:7788&code=LS-0001 */
    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "lumasync" && data.host == "config") {
            val server = data.getQueryParameter("server")
            val code = data.getQueryParameter("code")
            if (!server.isNullOrBlank()) {
                prefs.edit().putString(KEY_SERVER, server).apply()
                if (!code.isNullOrBlank()) prefs.edit().putString(KEY_CODE, code).apply()
                loadPlayer(server)
            }
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
        applyScreenIntent(intent)
    }

    /**
     * 零配置发现：UDP 广播 LUMASIGN_DISCOVER 到 :7789，服务端应答自身 http 地址。
     * 成功回调完整 URL（如 http://192.168.1.10:7788），失败回调 null。全程后台线程。
     */
    private fun tryDiscoverServer(timeoutMs: Int = 2500, onResult: (String?) -> Unit) {
        Thread {
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket()
                socket.soTimeout = timeoutMs
                socket.broadcast = true
                val data = "LUMASIGN_DISCOVER".toByteArray(Charsets.UTF_8)
                val targets = linkedSetOf("255.255.255.255")
                // 同时按当前 WiFi 子网发定向广播，规避部分 ROM 禁 255.255.255.255 的情况
                try {
                    val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                    val ipInt = wm.connectionInfo.ipAddress
                    if (ipInt != 0) {
                        val ip = String.format("%d.%d.%d.%d",
                            ipInt and 0xff, ipInt shr 8 and 0xff, ipInt shr 16 and 0xff, ipInt shr 24 and 0xff)
                        val seg = ip.split(".")
                        targets.add("${seg[0]}.${seg[1]}.${seg[2]}.255")
                    }
                } catch (_: Exception) {}
                var found: String? = null
                for (target in targets) {
                    try {
                        val addr = InetAddress.getByName(target)
                        socket.send(DatagramPacket(data, data.size, addr, 7789))
                    } catch (_: Exception) { continue }
                    try {
                        val buf = ByteArray(1024)
                        val recv = DatagramPacket(buf, buf.size)
                        socket.receive(recv)
                        val json = JSONObject(String(recv.data, 0, recv.length, Charsets.UTF_8))
                        if (json.optString("product") == "LumaSign") {
                            val host = json.optString("host")
                            val port = json.optInt("port", 7788)
                            if (host.isNotBlank()) { found = "http://$host:$port"; break }
                        }
                    } catch (_: Exception) { /* 超时/解析失败，尝试下一个 target */ }
                }
                onResult(found)
            } catch (_: Exception) {
                onResult(null)
            } finally {
                try { socket?.close() } catch (_: Exception) {}
            }
        }.start()
    }

    /** 首次无配置：先尝试零配置发现，发现不到再弹手填框 */
    private fun showDiscoveringThenConfig() {
        val spinner = android.widget.ProgressBar(this).apply {
            isIndeterminate = true
            val p = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT)
            p.gravity = android.view.Gravity.CENTER
            layoutParams = p
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.config_title)
            .setMessage("正在自动搜寻同局域网内的灵屏管理端…")
            .setView(spinner)
            .setCancelable(false)
            .setNegativeButton("手动配置") { _, _ -> showConfigDialog() }
            .show()
        tryDiscoverServer { url ->
            runOnUiThread {
                dialog.dismiss()
                if (url != null) {
                    prefs.edit().putString(KEY_SERVER, url).apply()
                    loadPlayer(url)
                } else {
                    showConfigDialog()
                }
            }
        }
    }

    private fun showConfigDialog() {
        val ctx = this
        val layout = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(60, 40, 60, 10)
        }
        val input = EditText(ctx).apply { hint = getString(R.string.server_hint); text?.append(prefs.getString(KEY_SERVER, "")) }
        val codeInput = EditText(ctx).apply { hint = "终端预置编码（可选，如 LS-0001）" }
        layout.addView(input); layout.addView(codeInput)

        AlertDialog.Builder(ctx)
            .setTitle(R.string.config_title)
            .setView(layout)
            .setPositiveButton(R.string.save) { _, _ ->
                val s = input.text.toString().trim()
                if (s.isNotBlank()) {
                    prefs.edit().putString(KEY_SERVER, s).apply()
                    val c = codeInput.text.toString().trim()
                    if (c.isNotBlank()) prefs.edit().putString(KEY_CODE, c).apply()
                    loadPlayer(s)
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .setCancelable(false)
            .show()
    }

    /** 供桥调用：开关屏 / 亮度 */
    fun setScreenOn(on: Boolean) {
        runOnUiThread {
            val lp = window.attributes
            lp.screenBrightness = if (on) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else 0f
            window.attributes = lp
        }
    }

    fun setBrightness(level: Int) {
        val v = (level.coerceIn(0, 100) / 100f)
        runOnUiThread {
            val lp = window.attributes
            lp.screenBrightness = if (level <= 0) 0f else v
            window.attributes = lp
        }
    }

    /** 读取真实 MAC（兼容 Android 6+ 限制） */
    fun readMac(): String {
        return try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            val mac = wm.connectionInfo.macAddress
            if (mac != null && mac != "02:00:00:00:00:00") mac else macFromInterfaces()
        } catch (_: Exception) { macFromInterfaces() }
    }

    @SuppressLint("HardwareIds")
    private fun macFromInterfaces(): String {
        return try {
            val nis = java.net.NetworkInterface.getNetworkInterfaces()
            for (ni in nis) {
                if (ni.name.equals("wlan0", true) || ni.name.equals("eth0", true)) {
                    val a = ni.hardwareAddress ?: continue
                    val sb = StringBuilder()
                    for (b in a) sb.append(String.format("%02X:", b))
                    if (sb.isNotEmpty()) sb.deleteCharAt(sb.length - 1)
                    return sb.toString()
                }
            }
            Settings.Secure.getString(contentResolver, "bluetooth_address") ?: "00:00:00:00:00:00"
        } catch (_: Exception) { "00:00:00:00:00:00" }
    }

    private fun hideSystemUI() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
        // statusBarColor / navigationBarColor 仅在 API 21+ 可用，低版本调用会 NoSuchMethodError 崩溃
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.statusBarColor = Color.BLACK
            window.navigationBarColor = Color.BLACK
        }
    }

    /** 把崩溃堆栈写入日志：双位置写入（应用私有目录 + SD 卡公开目录），方便用户自行查看 */
    @SuppressLint("Deprecated")
    private fun writeCrashLog(t: Throwable?) {
        try {
            val ts = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())
            val sb = StringBuilder()
            sb.append("=== crash @ $ts ===\n")
            sb.append("model=${Build.MODEL} android=${Build.VERSION.RELEASE} sdk=${Build.VERSION.SDK_INT}\n")
            sb.append("ram=${activityMemoryMB()}MB\n")
            sb.append("${t?.javaClass?.name ?: "Throwable"}: ${t?.message ?: ""}\n")
            t?.stackTrace?.forEach { sb.append("  at $it\n") }
            val entry = sb.toString()
            // 1) 应用私有目录：/Android/data/com.lumasign.player/files/logs/crash.log
            val appDir = File(getExternalFilesDir(null), "logs")
            appDir.mkdirs()
            val appFile = File(appDir, "crash.log")
            val oldApp = if (appFile.exists()) appFile.readText() else ""
            appFile.writeText(entry + "\n" + oldApp.take(6000))
            // 2) SD 卡公开目录：/sdcard/LumaSign/crash.log（用户可直接用文件管理器找到）
            val pubDir = File(Environment.getExternalStorageDirectory(), "LumaSign")
            pubDir.mkdirs()
            val pubFile = File(pubDir, "crash.log")
            val oldPub = if (pubFile.exists()) pubFile.readText() else ""
            pubFile.writeText(entry + "\n" + oldPub.take(6000))
            // 同时打印到 Logcat 方便调试
            android.util.Log.e("LumaSign", entry)
        } catch (_: Exception) { /* 日志写入失败也不能再抛异常 */ }
    }

    /** 获取设备可用内存 MB（低内存判断依据） */
    private fun activityMemoryMB(): Int {
        return try {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            (mi.availMem / 1024 / 1024).toInt()
        } catch (_: Exception) { 256 }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUI()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        unregisterConnectivity()
        retryRunnable?.let { uiHandler.removeCallbacks(it) }
        webView.destroy()
        super.onDestroy()
    }

    /** 拦截返回键，保持 kiosk 不可退出 */
    override fun onBackPressed() {
        // 长按多任务键等系统行为无法拦截，但普通返回键不退出播放
    }
}
