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
import android.view.KeyEvent
import android.view.MotionEvent
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
    // v1.3.15：容器改为 View（内含文字 + 三个救援按钮），文字提亮，杜绝"黑屏没字"不可自救
    private lateinit var overlay: View
    private lateinit var overlayText: TextView
    private var loadFailed = false
    private var retryRunnable: Runnable? = null
    // v1.3.15：连续加载失败计数。≥ FAIL_STREAK_LIMIT 时清空错误地址并回到零配置发现。
    // 现场事故：设备存了错/不可达的 server_url 后永不重新发现，黑屏死锁。
    private var failStreak = 0

    // 5.0+ Kiosk 进入标记（onResume 只尝试一次，避免反复调用 DevicePolicyManager）
    private var kioskAttempted = false

    // 网络连通性监听
    private val connectivityManager by lazy {
        getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    private var lastNetOnline: Boolean? = null
    // ⚠️ ConnectivityManager.NetworkCallback 是 API 21+ (Lollipop) 才引入的类。
    // Android 4.4 (API 19) 上该类不存在，如果作为 val 属性初始化器直接 new 出匿名内部类，
    // 会在 MainActivity 构造阶段触发 NoClassDefFoundError / VerifyError（类加载器无法解析父类）。
    // 因此必须声明为可空 var，延迟到 registerConnectivity() 内部、SDK 版本确认后再创建。
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private val netReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) { onConnectivityChanged(isNetworkOnline()) }
    }

    companion object {
        const val PREFS = "luma_config"
        const val KEY_SERVER = "server_url"
        const val KEY_CODE = "terminal_code"
        const val DEFAULT_PORT = 7788
        /** 连续加载失败达到该次数 → 判定"地址存错了"，清空并重新零配置发现（约 4×15s ≈ 60s） */
        const val FAIL_STREAK_LIMIT = 4
        @JvmField var crashCount: Int = 0
    }

    /**
     * 规范化服务器地址（v1.3.15）。
     *
     * 现场事故复盘：用户在配置框里填了管理端界面上显示的 `192.168.2.97:7788`（不带 http://），
     * 旧实现原样存盘并直接拼成 `192.168.2.97:7788/player/?mode=term` 交给 WebView。
     * WebView 把 `192.168.2.97` 当成协议名 → URL 在本地就被判非法 → 连一次 TCP 都没发出，
     * `onReceivedError` → 全屏黑底遮罩 + 每 15s 重试同一个坏 URL → 永久黑屏。
     *
     * 规则：去空白 → 无 `://` 补 `http://` → host 后无端口补 `:7788` → 去尾部 `/` → 校验可解析。
     * @return 规范化后的地址；无法解析时返回 null（调用方应提示而不落盘）。
     */
    private fun normalizeServerUrl(raw: String?): String? {
        var s = (raw ?: "").trim().replace(Regex("\\s+"), "")
        if (s.isEmpty()) return null
        if (!s.contains("://")) s = "http://$s"
        // 协议名只保留已知安全值，避免 javascript: 等被塞进来
        val scheme = s.substringBefore("://").lowercase(Locale.ROOT)
        if (scheme != "http" && scheme != "https") return null
        s = "$scheme://" + s.substringAfter("://").trimEnd('/')
        // 补默认端口：host 部分不含 ':' 时补默认端口（IPv6 字面量不处理，本项目用不到）
        val hostPart = s.substringAfter("://").substringBefore("/")
        if (!hostPart.contains(":")) s = "$s:$DEFAULT_PORT"
        return try {
            val u = java.net.URL(s)
            if (u.host.isNullOrBlank()) null else s
        } catch (_: Exception) {
            null
        }
    }

    // 启动自检覆盖层：每一步更新文字，若卡死可据此定位冻结点（嵌墙设备无法取 logcat）
    private var bootStatusView: android.widget.TextView? = null
    private fun showBootStatus(step: String) {
        runOnUiThread {
            if (bootStatusView == null) {
                bootStatusView = android.widget.TextView(this).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    setBackgroundColor(Color.parseColor("#0d1117"))
                    setTextColor(Color.WHITE)
                    textSize = 18f
                    gravity = Gravity.CENTER
                }
                try { (findViewById<ViewGroup>(R.id.root)).addView(bootStatusView) } catch (_: Exception) {}
            }
            bootStatusView?.text = "灵屏 LumaSign 启动中…\n\n$step"
        }
    }
    private fun hideBootStatus() {
        runOnUiThread { bootStatusView?.visibility = View.GONE }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showBootStatus("① 初始化界面布局")
        try {
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

            setupOverlay()

            showBootStatus("② 初始化 WebView 引擎")
            webView = findViewById(R.id.webview)
            setupWebView()

            showBootStatus("③ WebView 就绪，准备连接")
            handleIntent(intent)
            val server = prefs.getString(KEY_SERVER, "") ?: ""
            registerConnectivity()
            if (server.isBlank()) {
                showBootStatus("④ 未配置服务端：零配置发现 / 手动配置")
                showDiscoveringThenConfig()
            } else {
                showBootStatus("④ 加载播放端：$server")
                loadPlayer(server)
            }
            applyScreenIntent(intent)

            showBootStatus("⑤ 启动完成，进入播放端")
            hideBootStatus()

            // ── Kiosk 抢占：前台探测 + 应急悬浮窗（压制触拓等第三方抢前台）──
            startKioskGuard()
        } catch (e: Throwable) {
            // 启动期任意异常都写到崩溃日志并展示在屏幕上，避免静默黑屏
            try { writeCrashLog(e) } catch (_: Exception) {}
            showBootStatus("⚠ 启动失败：${e.javaClass.simpleName}: ${e.message}\n\n已写入崩溃日志，请拍照反馈此屏幕")
        }
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

    /** 启动 Kiosk 抢占守护服务：前台探测 + 应急悬浮窗（非致命） */
    private fun startKioskGuard() {
        // Android 4.4 上 getRunningTasks 探测不可靠，应急悬浮窗会误遮成黑屏且无法退出，
        // 调试期先在 4.4 跳过；5.0+ 或设为 Device Owner 后再启用系统级 Kiosk。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            android.util.Log.i("LumaSign", "KioskGuard 在 Android 4.4 跳过（探测不可靠，避免误遮挡锁死）")
            return
        }
        try {
            val intent = Intent(this, KioskGuardService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            android.util.Log.i("LumaSign", "KioskGuardService started")
        } catch (e: Exception) {
            android.util.Log.w("LumaSign", "KioskGuardService start failed (non-fatal): ${e.message}")
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
        failStreak++
        val hint = if (failStreak >= FAIL_STREAK_LIMIT) {
            "连接失败 $failStreak 次，即将重新自动发现…\n也可点下方按钮手动改地址"
        } else {
            "将自动重试…（第 $failStreak 次失败）"
        }
        showOverlay("无法连接服务端\n${desc ?: ""}\n$hint")
        scheduleRetry()
    }

    private fun scheduleRetry() {
        retryRunnable?.let { uiHandler.removeCallbacks(it) }
        retryRunnable = Runnable {
            val server = prefs.getString(KEY_SERVER, "") ?: ""
            // ── 自愈（v1.3.15）──────────────────────────────────────────
            // 旧逻辑只在"存了地址且加载失败"时死磕同一个地址，永不重新发现 →
            // 现场把错地址填进去的设备（v1.3.11 事故）会永久黑屏。这是本项目最危险的失效模式：
            // 地址落盘后没有任何 UI 入口能改回来。
            // 现在连续失败 FAIL_STREAK_LIMIT 次后，先问一次"服务端你到底在哪"（UDP 零配置发现）：
            //   发现到 → 用新地址自愈（地址写错也能自己爬回来，无需人到现场）
            //   没发现 → 保留原地址继续重试，只把救援按钮亮出来；
            //            刻意不弹手填框，避免无人值守设备停在弹窗上等人点。
            if (failStreak >= FAIL_STREAK_LIMIT) {
                failStreak = 0
                loadFailed = false
                android.util.Log.w("LumaSign", "server unreachable ${FAIL_STREAK_LIMIT}x, retry via zero-config discovery")
                showOverlay("无法连接服务端\n正在自动搜寻管理端…\n（也可点下方按钮手动改地址）")
                tryDiscoverServer { url ->
                    runOnUiThread {
                        if (url != null && url != server) {
                            prefs.edit().putString(KEY_SERVER, url).apply()
                            loadPlayer(url)
                        } else if (url != null) {
                            loadPlayer(url)
                        } else {
                            scheduleRetry()
                        }
                    }
                }
                return@Runnable
            }
            if (server.isNotBlank() && loadFailed) { loadFailed = false; loadPlayer(server) }
        }
        uiHandler.postDelayed(retryRunnable!!, 15000)
    }

    /**
     * 故障覆盖层（v1.3.15 重做）。
     *
     * 旧版是「整屏纯黑 + #6b7280 灰字」，现场表现就是"黑屏没字"，且没有任何自救入口——
     * 设备一旦存了错地址就永久锁死（v1.3.11 事故）。
     * 新版：文字提到 #e5e7eb/18sp（低亮度下也读得出）+ 三个鼠标/触屏可点的救援按钮。
     */
    private fun setupOverlay() {
        val box = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        overlayText = TextView(this).apply {
            setTextColor(Color.parseColor("#e5e7eb"))
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(32, 32, 32, 24)
            text = "灵屏 LumaSign\n正在连接服务端…"
        }
        val btnRow = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        btnRow.addView(android.widget.Button(this).apply {
            text = "重新配置服务器"
            setOnClickListener { showConfigDialog() }
        })
        btnRow.addView(android.widget.Button(this).apply {
            text = "重新自动发现"
            setOnClickListener {
                // 清掉可能存错的地址，交给 UDP 零配置发现重新定位服务端
                prefs.edit().remove(KEY_SERVER).apply()
                failStreak = 0
                loadFailed = false
                showDiscoveringThenConfig()
            }
        })
        btnRow.addView(android.widget.Button(this).apply {
            text = "退出到桌面"
            setOnClickListener { showExitConfirm() }
        })
        box.addView(overlayText)
        box.addView(btnRow)
        overlay = box
        (findViewById<ViewGroup>(R.id.root)).addView(overlay)
    }

    private fun showOverlay(msg: String) {
        overlayText.text = msg
        overlay.visibility = View.VISIBLE
    }

    private fun hideOverlay() {
        overlay.visibility = View.GONE
        failStreak = 0
    }

    private fun loadPlayer(server: String) {
        val base = normalizeServerUrl(server)
        if (base == null) {
            // 地址不合法：直接给可自救的提示，而不是让 WebView 抛错后显示无信息黑屏
            showOverlay("服务器地址不合法\n请点下方按钮重新配置\n（例：http://192.168.1.10:7788）")
            return
        }
        // 顺手把规范化结果回写，后续重试/上报都用干净地址
        prefs.edit().putString(KEY_SERVER, base).apply()
        val code = prefs.getString(KEY_CODE, "") ?: ""
        val url = buildString {
            append(base)
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
            // ConnectivityManager.NetworkCallback / Network / NetworkRequest 均为 API 21+ 类，
            // 在此 SDK 守卫内部创建匿名内部类，确保 API 19 设备不会尝试加载这些类。
            netCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) { onConnectivityChanged(true) }
                override fun onLost(network: android.net.Network) { onConnectivityChanged(false) }
            }
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
            try { connectivityManager.registerNetworkCallback(req, netCallback!!) } catch (_: Exception) {}
        } else {
            val filter = IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION)
            try { registerReceiver(netReceiver, filter) } catch (_: Exception) {}
        }
    }

    private fun unregisterConnectivity() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                netCallback?.let { connectivityManager.unregisterNetworkCallback(it) }
                netCallback = null
            } else {
                unregisterReceiver(netReceiver)
            }
        } catch (_: Exception) {}
    }

    /** 深链配置：lumasync://config?server=http://192.168.1.10:7788&code=LS-0001 */
    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "lumasync" && data.host == "config") {
            // v1.3.15：深链同样走规范化，`lumasync://config?server=192.168.2.97:7788` 也能生效
            val server = normalizeServerUrl(data.getQueryParameter("server"))
            val code = data.getQueryParameter("code")
            if (server != null) {
                prefs.edit().putString(KEY_SERVER, server).apply()
                if (!code.isNullOrBlank()) prefs.edit().putString(KEY_CODE, code).apply()
                failStreak = 0
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
        val input = EditText(ctx).apply {
            hint = getString(R.string.server_hint)
            text?.append(prefs.getString(KEY_SERVER, ""))
        }
        val codeInput = EditText(ctx).apply { hint = "终端预置编码（可选，如 LS-0001）" }
        layout.addView(input); layout.addView(codeInput)

        AlertDialog.Builder(ctx)
            .setTitle(R.string.config_title)
            .setView(layout)
            .setPositiveButton(R.string.save) { _, _ ->
                // v1.3.15：必须规范化后再落盘。
                // 旧实现原样存 `192.168.2.97:7788`（无 http://）→ WebView 把 IP 当协议名 → 永久黑屏。
                val normalized = normalizeServerUrl(input.text.toString())
                if (normalized == null) {
                    android.widget.Toast.makeText(
                        ctx, "地址无效，请按 http://IP:端口 格式填写", android.widget.Toast.LENGTH_LONG
                    ).show()
                    // 弹回配置框，保证用户有机会改正，而不是静默失败
                    uiHandler.post { showConfigDialog() }
                    return@setPositiveButton
                }
                prefs.edit().putString(KEY_SERVER, normalized).apply()
                val c = codeInput.text.toString().trim()
                if (c.isNotBlank()) prefs.edit().putString(KEY_CODE, c).apply()
                failStreak = 0
                loadPlayer(normalized)
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
    @Suppress("DEPRECATION")
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
        // 5.0+ Device Owner Kiosk：静默默认 Home + 锁定任务（4.4 自动跳过；仅尝试一次）
        if (!kioskAttempted) {
            kioskAttempted = true
            KioskManager.maybeEnterKiosk(this)
        }
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

    /**
     * 硬按键救援入口（v1.3.15）。
     *
     * 背景：v1.3.11 的 MainActivity 完全没有按键/触摸处理，配置框一旦被关掉（地址已落盘）
     * 就再也打不开 → 嵌墙设备彻底锁死。这里补一条"纯键盘也能进配置"的通路：
     * MENU / SETTINGS 键（多数 USB 键盘、红外遥控都有）直接弹配置框。
     * 鼠标/触屏路径见 setupOverlay() 的救援按钮与 dispatchTouchEvent() 的右键。
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            showConfigDialog()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    /** 返回键：调试期允许退出，避免嵌墙设备被锁死（正式部署可重新开启 kiosk 拦截） */
    override fun onBackPressed() {
        try { moveTaskToBack(true) } catch (_: Exception) { finish() }
    }

    // ─────────────────────────────────────────────────────────────
    // 紧急逃生口（v1.3.13，防"坏版本把嵌墙设备锁死"）
    // 触发方式：① 触屏长按 2 秒（静止不动）  ② 鼠标右键 / 映射的 menu 键
    // 行为：弹出二次确认框 → 确认后退回系统桌面（moveTaskToBack）
    // 设计要点：长按中一旦手指移动（滑动/滚动）即取消，避免误触；
    //          覆盖层之上仍可见；4.4 上 kiosk 守卫已跳过，退出必然生效。
    // ─────────────────────────────────────────────────────────────
    private val exitHandler = Handler(Looper.getMainLooper())
    private val exitLongPress = Runnable { showExitConfirm() }
    private var exitDialog: AlertDialog? = null

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        when (ev.action) {
            MotionEvent.ACTION_DOWN -> {
                // 鼠标右键（或遥控器 menu 键映射）→ 直接弹确认
                if ((ev.buttonState and MotionEvent.BUTTON_SECONDARY) != 0) {
                    showExitConfirm()
                } else {
                    exitHandler.removeCallbacks(exitLongPress)
                    exitHandler.postDelayed(exitLongPress, 2000)
                }
            }
            MotionEvent.ACTION_MOVE,
            MotionEvent.ACTION_UP,
            MotionEvent.ACTION_CANCEL -> {
                // 滑动/抬起即取消长按计时，防止正常交互误触发退出
                exitHandler.removeCallbacks(exitLongPress)
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun showExitConfirm() {
        exitHandler.removeCallbacks(exitLongPress)
        if (exitDialog?.isShowing == true) return
        exitDialog = AlertDialog.Builder(this).apply {
            setTitle("退出到桌面")
            setMessage("确认退出灵屏播放端并返回系统桌面？")
            setPositiveButton("确认退出") { _, _ ->
                try { moveTaskToBack(true) } catch (_: Exception) { finish() }
            }
            setNegativeButton("取消", null)
            setCancelable(true)
        }.create().also { it.show() }
    }
}
