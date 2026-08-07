package com.lumasign.player

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
        val prevHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            crashCount++
            prefs.edit().putInt("crash_count", crashCount).apply()
            writeCrashLog(throwable)
            // 链式调用原 handler，让进程按系统默认方式退出（避免被静默吞掉导致 ANR/诡异闪退）
            prevHandler?.uncaughtException(thread, throwable)
        }

        setupOverlay()
        webView = findViewById(R.id.webview)
        setupWebView()

        handleIntent(intent)
        val server = prefs.getString(KEY_SERVER, "") ?: ""
        if (server.isBlank()) showConfigDialog() else loadPlayer(server)
        applyScreenIntent(intent)

        registerConnectivity()
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
        ws.domStorageEnabled = true
        ws.databaseEnabled = true
        ws.mediaPlaybackRequiresUserGesture = false
        ws.allowFileAccess = true
        ws.allowContentAccess = true
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

    /** 把崩溃堆栈写入外部存储日志，便于用户反馈诊断（Android 4.4 仍可访问 getExternalFilesDir） */
    private fun writeCrashLog(t: Throwable?) {
        try {
            val dir = File(getExternalFilesDir(null), "logs")
            dir.mkdirs()
            val f = File(dir, "crash.log")
            val ts = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())
            val sb = StringBuilder()
            sb.append("=== crash @ $ts ===\n")
            sb.append("model=${Build.MODEL} android=${Build.VERSION.RELEASE} sdk=${Build.VERSION.SDK_INT}\n")
            sb.append("${t?.javaClass?.name ?: "Throwable"}: ${t?.message ?: ""}\n")
            t?.stackTrace?.forEach { sb.append("  at $it\n") }
            // 保留最近若干次，避免无限增长
            val old = if (f.exists()) f.readText() else ""
            f.writeText(sb.toString() + "\n" + old.take(6000))
        } catch (_: Exception) { /* 日志写入失败也不应再抛异常 */ }
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
