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
import android.os.SystemClock
import android.util.Log
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
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
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

    /* ── WebView 活性看门狗（v1.3.45）──
     * 背景：RK312x/4.4 上 Chromium 33 渲染进程被 LMKD 杀（OOM）后页面静默死亡——
     *   黑屏、心跳/SSE 全断，而应用进程仍在前台。KioskGuardService 只防「外部应用
     *   抢占前台」，救不了这种「自己死在里面」的状态；现场设备因此黑屏 39 分钟
     *   无人恢复（ping 通但播放端已死）。
     * 机制：播放引擎心跳（15s）调 LumaBridge.ping()；本看门狗 10s 检查一次，
     *   页面曾成功加载（onPageFinished）但超过阈值未 ping → reload()；
     *   连续多次救不回 → restartApp() 整进程重启。
     * 安全阀：页面从未加载成功时（服务端不可达等）不介入——那属既有重连逻辑的职责，
     *   避免 reload/重启风暴。 */
    @Volatile private var lastWebViewAliveAt = 0L
    private var webViewPageLoaded = false
    private var webViewRecoveryStreak = 0
    private var lastWebViewRecoveryAt = 0L
    // ★ v1.3.48：原生渲染器活性探针状态——独立于 JS ping，直接探测 WebView 渲染进程是否还能响应。
    //   探针在途标记 + 派发时刻；若超时未回 → 渲染进程已死/卡死 → 触发恢复（reload/重启）。
    private var webViewProbePending = false
    private var webViewProbeIssuedAt = 0L
    private val webViewLivenessCheck = object : Runnable {
        override fun run() {
            try { checkWebViewLiveness() } catch (_: Exception) { /* 看门狗自身异常绝不致命 */ }
            uiHandler.postDelayed(this, WEBVIEW_LIVENESS_INTERVAL_MS)
        }
    }

    // 加载 / 错误覆盖层（服务端不可达时显示「正在重连」而非黑屏死寂）
    // v1.3.15：容器改为 View（内含文字 + 三个救援按钮），文字提亮，杜绝"黑屏没字"不可自救
    private lateinit var overlay: View
    private lateinit var overlayText: TextView
    private var loadFailed = false
    private var retryRunnable: Runnable? = null
    // ★ v1.3.47：页面加载兜底超时（4.4 主文档失败不回调 onReceivedError，见 loadPlayer 注释）
    private var loadTimeoutRunnable: Runnable? = null
    // 常驻状态条：竞品「Version-5.99SM + 状态」式运维可见性设计
    private lateinit var statusView: TextView
    // v1.3.15：连续加载失败计数。≥ FAIL_STREAK_LIMIT 时清空错误地址并回到零配置发现。
    // 现场事故：设备存了错/不可达的 server_url 后永不重新发现，黑屏死锁。
    // v1.3.47：FAIL_STREAK_LIMIT 4→2、重试间隔 15s→8s——现场用户等不及 60s 自愈手动配置；
    //   配合开机并行发现，最坏 ~19s 自己爬回正确地址。
    private var failStreak = 0

    // 5.0+ Kiosk 进入标记（onResume 只尝试一次，避免反复调用 DevicePolicyManager）
    private var kioskAttempted = false
    // 默认桌面引导弹窗：同进程只提示一次，避免反复打扰
    private var homePromptShown = false
    // ★ v1.3.49：默认桌面引导弹窗句柄 + 自动隐藏时长（现场无鼠标/触摸，30s 后自动收起）
    private var homePromptDialog: AlertDialog? = null

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

    // ★ v1.3.31：存储热插拔监听（对齐竞品 DeviceChangeListener / DiskChangeReceiver）
    // 收到 ACTION_MEDIA_MOUNTED/EJECT/REMOVED 后重建挂载路径列表，通过 getNativeStatus 上报给心跳
    internal var mountedDevices: List<String> = emptyList()
    private val storageReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            refreshMountedDevices()
            // 广播给前台 WebView：让播放端有机会触发 storage-changed 事件（暂仅记录日志）
            Log.i(TAG, "storage changed: ${intent?.action} -> $mountedDevices")
        }
    }

    // ★ v1.3.31：关机/重启广播（对齐竞品 PowerOffRem）
    // 收到系统关机广播后主动通知 WebView 立即上报退出 + 保存断点
    private val shutdownReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            Log.w(TAG, "system power event: $action")
            try {
                webView.evaluateJavascript(
                    "window.__lumaPlayer && (window.__lumaPlayer.exit('${java.lang.String(action).replace("'", "\\'")}'), 1)",
                    null
                )
            } catch (_: Exception) {}
        }
    }

    companion object {
        const val TAG = "LumaSign"
        const val PREFS = "luma_config"
        const val KEY_SERVER = "server_url"
        const val KEY_CODE = "terminal_code"
        /** 56iq/触拓 兼容模式：开启后加载 player/siqian.html（JS 轮询 CMS OpenAPI）而非灵屏引擎 */
        const val KEY_SIQIAN_MODE = "siqian_mode"
        /** 56iq CMS 基址（如 http://192.168.1.41:8888）；留空则由灵屏服务端同机推导（7788→8888） */
        const val KEY_SIQIAN_CMS = "siqian_cms"
        /** 终端显示名（56iq 注册 name / authorized_device_id 兜底） */
        const val KEY_NAME = "terminal_name"
        const val DEFAULT_PORT = 7788
        /** 连续加载失败达到该次数 → 判定"地址存错了"，清空并重新零配置发现（v1.3.47：约 2×8s ≈ 16s） */
        const val FAIL_STREAK_LIMIT = 2
        /** 手动退出后的静默期：30s 内不拉起，到点由 Alarm 重新拉起电子屏 */
        const val EXIT_GRACE_MS = 30_000L
        /** ★ v1.3.49：默认桌面引导弹窗无交互自动隐藏时长（现场无鼠标/触摸） */
        const val HOME_PROMPT_AUTO_HIDE_MS = 30_000L
        /* ── WebView 活性看门狗（v1.3.45，详见类内字段注释）── */
        /** 页面加载成功后超过该时长未收到 JS ping → 判渲染进程已死 */
        const val WEBVIEW_ALIVE_TIMEOUT_MS = 90_000L
        /** 看门狗检查间隔 */
        const val WEBVIEW_LIVENESS_INTERVAL_MS = 10_000L
        /** 两次恢复动作（reload/restart）之间的最小间隔，防恢复风暴 */
        const val WEBVIEW_RECOVERY_COOLDOWN_MS = 120_000L
        /** 连续恢复失败达该次数 → 放弃 reload 升级为整进程重启 */
        const val WEBVIEW_MAX_RECOVERY_STREAK = 3
        /**
         * ★ v1.3.48：原生渲染器活性探针超时。
         * 每隔检查周期派发一次 evaluateJavascript，若超过该时长回调仍未到达，
         * 判定渲染进程已死/主线程卡死（4.4 上 LMKD 杀渲染进程后页面常仍“画着最后一帧”，
         * 但 JS 全死、evaluateJavascript 不再返回）——这正是“画面还画着但引擎已死”的冻结态。
         */
        const val WEBVIEW_PROBE_TIMEOUT_MS = 5_000L
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
                // 优先挂到布局根；若 setContentView 尚未执行则挂到窗口 decor，确保绝不静默黑屏
                val root = try { findViewById<ViewGroup>(R.id.root) } catch (_: Exception) { null }
                val parent = root ?: (window.decorView as? ViewGroup)
                try { parent?.addView(bootStatusView) } catch (_: Exception) {}
            }
            bootStatusView?.text = "灵屏 LumaSign 启动中…\n\n$step"
        }
    }
    private fun hideBootStatus() {
        runOnUiThread { bootStatusView?.visibility = View.GONE }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 必须先 setContentView，R.id.root 才存在，否则启动/崩溃覆盖层挂不上 → 静默黑屏
        setContentView(R.layout.activity_main)
        showBootStatus("① 初始化界面布局")
        try {
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
            setupStatusOverlay()

            showBootStatus("② 初始化 WebView 引擎")
            webView = findViewById(R.id.webview)
            setupWebView()

            showBootStatus("③ WebView 就绪，准备连接")
            handleIntent(intent)
            val server = prefs.getString(KEY_SERVER, "") ?: ""
            registerConnectivity()
            registerSystemReceivers()
            if (server.isBlank()) {
                showBootStatus("④ 未配置服务端：零配置发现 / 手动配置")
                showDiscoveringThenConfig()
            } else {
                showBootStatus("④ 加载播放端：$server")
                loadPlayer(server)
                // ★ v1.3.47：开机并行零配置发现。旧实现只有加载连败 FAIL_STREAK_LIMIT×15s 后
                //   才重新发现——服务端 IP 漂移（DHCP：.97→.213→.239→.216→.200…）后现场用户
                //   等不及，只能手动重新配置（2026-10-26 事故）。现在每次开机都并行问一次
                //   「服务端在哪」：发现到不同地址立即热切换，相同则无动作，失败不影响正常加载。
                discoverAndAdoptServer()
            }
            applyScreenIntent(intent)

            showBootStatus("⑤ 启动完成，进入播放端")
            hideBootStatus()

            // ── Kiosk 抢占：前台探测 + 应急悬浮窗（压制触拓等第三方抢前台）──
            startKioskGuard()
            // ── 系统级周期看门狗：进程若被 OOM 回收，由 AlarmManager 定期把应用拉回来 ──
            //   每次 onCreate 都注册一次是幂等的（同 requestCode + FLAG_UPDATE_CURRENT 覆盖旧 Alarm），
            //   同时覆盖「安装后从未重启过」的场景（那种情况下 BootReceiver 不会触发）。
            WatchdogReceiver.schedule(this)
            // ── WebView 活性看门狗（v1.3.45）：渲染进程静默死亡（黑屏+心跳断）时自动 reload，连续失败重启进程 ──
            lastWebViewAliveAt = SystemClock.elapsedRealtime()
            uiHandler.postDelayed(webViewLivenessCheck, WEBVIEW_LIVENESS_INTERVAL_MS)
            // 竞品「液晶互动」式默认桌面引导：没被设为默认桌面时主动提示用户设置，
            // 这是保证 LumaSign 持续驻守屏幕、不会被系统桌面覆盖的最有效手段。
            maybePromptSetDefaultHome()
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
        // 4.4（rk312x 主力）上 getRunningTasks 全局可见 → 满血探测，被抢占/最小化/退出后
        // 2 秒内自动拉回（否则屏幕黑着没人管）。历史顾虑「误遮挡锁死」已消除：
        // 检测可靠时前台是自己就隐藏悬浮层；且「退出到桌面」会先停本服务再杀进程，
        // doExit 不会被守护拉回。5.0+ 无使用情况授权时服务自身退化为不抢占，安全。
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
        // ── v1.3.26 修复「视频在 rk312x/Android4.4 不播放」：
        // H.264 硬解（Rockchip FFPlayer → SurfaceTexture）必须走 GPU 合成才能上屏；
        // 若强制 LAYER_TYPE_SOFTWARE，视频虽解码成功（readyState=4、尺寸真实）却无法合成，
        // 表现为 currentTime 恒为 0、画面黑/卡死。故 4.4 也启用硬件渲染层。
        // 旧注释的「硬件加速静默崩溃」针对早期 Chromium 30 + 未修的 GPU 兼容坑
        // （inset→position、交叉淡入黑屏等，v1.3.22 起均已修复），本机实为 Chromium 33，可安全启用。
        // 若个别 4.4 固件在复杂动效（如图片交叉淡入）上复现 GPU 崩溃，回退此行为 SOFTWARE 即可。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
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

        // 播放素材本地缓存（v1.3.34）：<img>/<video> 的 /api/t/media/* 命中本地即离线回源，
        // 实现「视频/图片下载到屏幕端再播放」；需在 loadUrl 前初始化。
        MediaCache.init(this)
        // ★ v1.3.50：本地素材回源服务（127.0.0.1 随机端口）——4.4 上 <video> 由平台媒体栈取数，
        //   绕过 WebView 拦截，file:// 又被 Chromium 拒绝；给媒体栈一个 http:// 回环地址，
        //   才能真正「下载到屏幕端再播放」（零远程重下、零首帧等待）。
        LocalMediaServer.start()
        bridge = LumaBridge(this, webView)
        webView.addJavascriptInterface(bridge, "LumaBridge")
        // 56iq 兼容：触拓原生网页模板走 window.Android.getDeviceInfo()，复用同一桥
        webView.addJavascriptInterface(bridge, "Android")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = false

            // v1.3.34：/api/t/media/<id> 命中本地缓存即从本机回源（下载到屏幕端再播放，断网也能放）；
            // 未缓存则返回 null 走网络正常加载，同时后台完整下载一份供次播/断网使用。
            // 用 String 重载（API 1+）而非 WebResourceRequest 重载（API 21+）以保证 Android 4.4 生效。
            @Suppress("DEPRECATION")
            override fun shouldInterceptRequest(view: WebView?, url: String?): WebResourceResponse? {
                if (url == null) return null
                return try {
                    val path = android.net.Uri.parse(url).path ?: return null
                    if (!path.startsWith("/api/t/media/")) return null
                    val seg = path.trimEnd('/').substringAfterLast('/')
                    if (seg.isBlank()) return null
                    val key = seg.replace(Regex("\\.[^.]+$"), "") // 去掉可能的后缀（hash.ext）
                    MediaCache.serve(key) ?: run { MediaCache.prefetch(url, key); null }
                } catch (_: Exception) {
                    null
                }
            }
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                if (loadFailed) showOverlay("灵屏 LumaSign\n正在重新连接服务端…")
                // 页面开始导航：重置活性计时（给页面加载+引擎启动留出 grace），
                // 加载成功前看门狗待命（webViewPageLoaded=false），防服务端不可达时的恢复风暴
                lastWebViewAliveAt = SystemClock.elapsedRealtime()
                webViewPageLoaded = false
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                loadFailed = false
                loadTimeoutRunnable?.let { uiHandler.removeCallbacks(it) }
                retryRunnable?.let { uiHandler.removeCallbacks(it) }
                hideOverlay()
                updateStatusOverlay("已连接")
                // 页面加载成功：此后开始接受活性监管（引擎心跳会持续 ping）
                webViewPageLoaded = true
                lastWebViewAliveAt = SystemClock.elapsedRealtime()
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

    /** LumaBridge.ping() 入口（JS 线程调用）：记录播放引擎最近活跃时刻 */
    fun markWebViewAlive() {
        lastWebViewAliveAt = SystemClock.elapsedRealtime()
    }

    /**
     * WebView 活性检查（v1.3.45，v1.3.48 加固）：
     *  - 原生渲染器探针：页面已加载时每周期派发 evaluateJavascript，超过 [WEBVIEW_PROBE_TIMEOUT_MS]
     *    回调未到 → 渲染进程已死/主线程卡死。4.4 上 LMKD 杀渲染进程后页面常仍“画着最后一帧”，
     *    但 JS 全死、evaluateJavascript 不再返回——这正是“画面还画着但引擎已死”的冻结态，
     *    旧版仅靠 JS ping + onPageFinished 门控会漏判（现场曾冻结 67 分钟未被 reload）。
     *  - JS 心跳失活：页面曾加载但引擎循环超过 [WEBVIEW_ALIVE_TIMEOUT_MS] 未 ping → 判引擎循环死。
     *    注意：探针只清自己的在途标记，绝不改写 lastWebViewAliveAt，否则会掩盖“引擎死但渲染进程还活着”的分支。
     * 两种信号任一命中即走 [handleWebViewDead]（reload → 连败升级 restartApp），带 cooldown 防风暴。
     */
    private fun checkWebViewLiveness() {
        if (!webViewPageLoaded) return          // 页面未加载成功：交给既有重连逻辑，不介入（含探针，避免重连期风暴）
        val now = SystemClock.elapsedRealtime()
        // ① 原生渲染器探针超时判定：在途探针超过阈值无回调 → 渲染进程无响应（画面画着但已死）
        if (webViewProbePending && webViewProbeIssuedAt > 0L
            && now - webViewProbeIssuedAt > WEBVIEW_PROBE_TIMEOUT_MS) {
            webViewProbePending = false
            handleWebViewDead(now, "renderer unresponsive >${WEBVIEW_PROBE_TIMEOUT_MS}ms")
            return
        }
        // ② 派发新探针（无在途探针时）。回调到达即证明渲染进程活着，仅清在途标记，不碰 JS 心跳时间戳。
        if (!webViewProbePending) {
            webViewProbePending = true
            webViewProbeIssuedAt = now
            try {
                webView.evaluateJavascript("1") { _ -> webViewProbePending = false }
            } catch (_: Exception) {
                webViewProbePending = false
                handleWebViewDead(SystemClock.elapsedRealtime(), "evaluateJavascript threw")
                return
            }
        }
        // ③ JS 心跳失活判定（引擎循环已死，ping 长期不来）
        val aliveAt = lastWebViewAliveAt
        if (aliveAt <= 0L) return
        if (now - aliveAt < WEBVIEW_ALIVE_TIMEOUT_MS) {
            webViewRecoveryStreak = 0           // 恢复健康：清零连败计数
            return
        }
        handleWebViewDead(now, "no js ping >${WEBVIEW_ALIVE_TIMEOUT_MS}ms")
    }

    /**
     * 统一恢复入口（v1.3.48 抽出）：渲染进程判死后执行 reload，连续
     * [WEBVIEW_MAX_RECOVERY_STREAK] 次救不回 → 升级 restartApp() 整进程重启。
     * 带 [WEBVIEW_RECOVERY_COOLDOWN_MS] 冷却防恢复风暴，每次恢复落崩溃日志供管理端出证。
     */
    private fun handleWebViewDead(now: Long, reason: String) {
        if (now - lastWebViewRecoveryAt < WEBVIEW_RECOVERY_COOLDOWN_MS) return
        lastWebViewRecoveryAt = now
        webViewRecoveryStreak++
        val deadMs = if (lastWebViewAliveAt > 0L) now - lastWebViewAliveAt else 0L
        try {
            writeCrashLog(RuntimeException("webview liveness: $reason, streak=$webViewRecoveryStreak"))
        } catch (_: Exception) { /* 日志失败不阻断恢复 */ }
        val recovered = if (webViewRecoveryStreak >= WEBVIEW_MAX_RECOVERY_STREAK) {
            Log.w(TAG, "WebView 活性看门狗：reload x$webViewRecoveryStreak 未恢复，重启应用 ($reason)")
            try { bridge.restartApp(); true } catch (_: Exception) { recreate(); true }
        } else {
            Log.w(TAG, "WebView 活性看门狗：失联，reload（第 $webViewRecoveryStreak 次）($reason)")
            stopMediaThenReload()
            true
        }
        if (recovered) {
            lastWebViewAliveAt = SystemClock.elapsedRealtime()   // 给恢复动作留 grace
            webViewProbePending = false
        }
    }

    /**
     * ★ v1.3.54：reload 前先让页面停掉所有 `<video>` 再 reload——
     *   Android 4.4 WebView 的视频硬件 overlay（SurfaceView）在「导航/重载时视频正在播放」会被遗留，
     *   导致 WebView 合成层挂掉：**屏幕全黑但 DOM 完全正常**（img complete、opacity=1、health=100），
     *   只有再 reload 一次才恢复。这正是「一加视频就长时间黑屏、纯图片不会」的真凶之一。
     *   播放端已有 pagehide/beforeunload 兜底，这里从原生侧再兜一层（含渲染进程半死、JS 跑不动的场景）。
     */
    private fun stopMediaThenReload() {
        try {
            webView.evaluateJavascript(
                "try{document.querySelectorAll('video').forEach(function(v){try{v.pause();}catch(e){}" +
                    "try{v.removeAttribute('src');v.src='';}catch(e){}try{v.load();}catch(e){}});}catch(e){}", null)
        } catch (_: Exception) { }
        uiHandler.postDelayed({
            try { webView.reload() } catch (_: Exception) { try { recreate() } catch (_: Exception) { } }
        }, 350)
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
        updateStatusOverlay("连接失败", desc)
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
        uiHandler.postDelayed(retryRunnable!!, 8000)
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

    // ─────────────────────────────────────────────────────────────
    // 竞品学习落地：常驻状态条 + 默认桌面引导（v1.3.29）
    // 液晶互动 MPlayer 在空闲屏始终显示 Version +「没有可播放的任务节目」；
    // LumaSign 也应在任何状态下让运维看到版本、终端、服务、网络状态。
    // ─────────────────────────────────────────────────────────────

    // 右上角维护信息：正常连接态展示 5 秒后自动隐藏，避免常驻遮挡播放画面；
    // 连接失败/未配置等异常态保持常驻，便于现场拍照诊断。状态变化时由 updateStatusOverlay 重新弹出计时。
    private val statusHideHandler = Handler(Looper.getMainLooper())
    private val statusHideRun = Runnable { if (::statusView.isInitialized) statusView.visibility = View.GONE }

    /** 初始化顶部状态条，点击打开运维菜单 */
    private fun setupStatusOverlay() {
        try {
            val root = findViewById<ViewGroup>(R.id.root)
            statusView = TextView(this).apply {
                textSize = 11f
                setTextColor(Color.parseColor("#d1d5db"))
                setBackgroundColor(Color.parseColor("#cc0d1117"))
                setPadding(14, 6, 14, 6)
                gravity = Gravity.CENTER_VERTICAL
                visibility = View.GONE
                isClickable = true
                setOnClickListener { showOpsMenu() }
            }
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                topMargin = 6
                rightMargin = 6
            }
            root.addView(statusView, lp)
            updateStatusOverlay()
        } catch (_: Exception) {}
    }

    /** 更新状态条；main/sub 为 null 时按当前状态自动推断 */
    private fun updateStatusOverlay(main: String? = null, sub: String? = null) {
        try {
            if (!::statusView.isInitialized) return
            val ver = try {
                packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
            } catch (_: Exception) { "?" }
            val code = prefs.getString(KEY_CODE, "") ?: ""
            val server = prefs.getString(KEY_SERVER, "") ?: ""
            val net = when (lastNetOnline) {
                true -> "在线"
                false -> "离线"
                else -> "?"
            }
            val statusMain = main ?: when {
                loadFailed -> "连接失败"
                server.isBlank() -> "未配置服务端"
                else -> "已连接"
            }
            val statusSub = sub ?: "终端：${code.ifBlank { "未绑定" }} | 服务：${server.ifBlank { "-" }}"
            statusView.text = "灵屏 LumaSign v$ver | $statusMain | 网络$net\n$statusSub\n点此 / 右键 打开运维菜单"
            statusView.visibility = View.VISIBLE
            // 正常连接态 5s 后自动隐藏；连接失败/未配置等异常态常驻，便于现场诊断拍照
            statusHideHandler.removeCallbacks(statusHideRun)
            if (!(loadFailed || server.isBlank())) statusHideHandler.postDelayed(statusHideRun, 5000)
        } catch (_: Exception) {}
    }

    /** LumaSign 是否已被设为默认 HOME（默认桌面） */
    private fun isDefaultHome(): Boolean {
        return try {
            val home = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            val info = packageManager.resolveActivity(home, 0)
            info?.activityInfo?.packageName == packageName
        } catch (_: Exception) { false }
    }

    /** 引导用户将 LumaSign 设为默认桌面；同进程只弹一次，且只在已配置服务端后提示 */
    private fun maybePromptSetDefaultHome() {
        if (homePromptShown || isDefaultHome()) return
        val server = prefs.getString(KEY_SERVER, "") ?: ""
        if (server.isBlank()) return
        homePromptShown = true
        try {
            val dlg = AlertDialog.Builder(this)
                .setTitle("设为默认桌面")
                .setMessage("为保证灵屏播放端持续驻守屏幕，请将「灵屏播放端」设为默认桌面。\n\n设置后按 Home 键将始终回到灵屏，不会被系统桌面覆盖。")
                .setCancelable(false)
                .setPositiveButton("去设置") { _, _ ->
                    try {
                        val intent = Intent(Intent.ACTION_MAIN).apply {
                            addCategory(Intent.CATEGORY_HOME)
                            addCategory(Intent.CATEGORY_DEFAULT)
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        startActivity(intent)
                    } catch (_: Exception) {}
                }
                .setNegativeButton("暂不") { _, _ -> }
                .show()
            homePromptDialog = dlg
            // ★ v1.3.49：电子屏现场没有鼠标/触摸，无法点「暂不」→ 弹窗会永久挡住整屏。
            //   30s 无人点击自动隐藏，播放优先（可后续在运维菜单里再手动设置）。
            uiHandler.postDelayed({
                try { if (homePromptDialog === dlg) { dlg.dismiss(); homePromptDialog = null } } catch (_: Exception) {}
            }, HOME_PROMPT_AUTO_HIDE_MS)
        } catch (_: Exception) {}
    }

    /** 由灵屏服务端基址推导同机 56iq CMS（端口 7788 → 8888） */
    private fun siqianCmsFromLumaBase(base: String): String {
        return try {
            val u = java.net.URI(base)
            val port = if (u.port > 0) u.port else DEFAULT_PORT
            java.net.URI(u.scheme, null, u.host, if (port == DEFAULT_PORT) 8888 else port, "", null, null).toString()
        } catch (_: Exception) { base }
    }

    /** 当前终端码（LumaBridge.getDeviceInfo / 56iq 注册共用） */
    fun currentTerminalCode(): String = prefs.getString(KEY_CODE, "") ?: ""
    /** 当前终端显示名 */
    fun currentTerminalName(): String = prefs.getString(KEY_NAME, "") ?: ""

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

        // 56iq/触拓 兼容模式：改载兼容 Shell 页（JS 侧经 JSONP 轮询 CMS OpenAPI，无需 XMPP）
        if (prefs.getBoolean(KEY_SIQIAN_MODE, false)) {
            val cmsRaw = prefs.getString(KEY_SIQIAN_CMS, "") ?: ""
            val cmsBase = normalizeServerUrl(if (cmsRaw.isBlank()) siqianCmsFromLumaBase(base) else cmsRaw) ?: base
            val name = prefs.getString(KEY_NAME, "") ?: ""
            val siqianUrl = buildString {
                append(base)
                append("/player/siqian.html?mode=siqian&cms=")
                append(java.net.URLEncoder.encode(cmsBase, "UTF-8"))
                append("&code=").append(code)
                if (name.isNotBlank()) append("&name=").append(java.net.URLEncoder.encode(name, "UTF-8"))
            }
            webView.loadUrl(siqianUrl)
            updateStatusOverlay("56iq 兼容模式：正在加载…")
            return
        }

        val url = buildString {
            append(base)
            append("/player/?mode=term")
            if (code.isNotBlank()) append("&code=").append(code)
        }
        webView.loadUrl(url)
        updateStatusOverlay("正在加载…")
        // ★ v1.3.47：4.4 WebView 主文档失败时不回调 onReceivedError（2026-10-26 实测：
        //   ERR_ADDRESS_UNREACHABLE 只出 Chromium 错误页，onMainFrameError 收不到通知）→
        //   「失败→重试→重发现」自愈链永不启动，设备死坐错误页等人手动配置。
        //   兜底：加载后 20s 仍未 onPageFinished 即按加载失败处理，亮 overlay 救援按钮
        //   并走重试/发现链（开机并行发现 + 网络恢复探测 + 此兜底，三道防线）。
        loadTimeoutRunnable?.let { uiHandler.removeCallbacks(it) }
        loadTimeoutRunnable = Runnable {
            if (!webViewPageLoaded && !loadFailed) {
                Log.w(TAG, "page not finished in 20s, treating as load failure")
                onMainFrameError("页面加载超时")
            }
        }
        uiHandler.postDelayed(loadTimeoutRunnable!!, 20000)
    }

    /** 网络连通性变化：恢复时通知引擎重连指令流+刷新清单，并兜底重载失败的页面 */
    private fun onConnectivityChanged(online: Boolean) {
        if (lastNetOnline == online) return
        lastNetOnline = online
        updateStatusOverlay()
        if (!online) return
        webView.post {
            webView.evaluateJavascript("try{window.__onNetworkChange&&window.__onNetworkChange(true)}catch(e){}", null)
            if (loadFailed) {
                val server = prefs.getString(KEY_SERVER, "") ?: ""
                if (server.isNotBlank()) { loadPlayer(server) }
                return@post
            }
            // ★ v1.3.47：网络恢复时探测存址服务端是否可达。IP 漂移的隐蔽失效模式：
            //   页面加载成功时服务端还在旧 IP，之后 IP 变了——页面「已加载」loadFailed=false，
            //   但所有请求都发向死 IP，旧逻辑什么都不做 → 黑屏到人工干预。
            //   现在网络一恢复就探测，不可达立即重新发现热切换。
            probeServerThenRediscover()
        }
    }

    /** v1.3.47：开机/网络恢复时的并行零配置发现——服务端挪窝则自动热切换，无需人工配置 */
    private fun discoverAndAdoptServer() {
        val current = prefs.getString(KEY_SERVER, "") ?: ""
        if (current.isBlank()) return
        tryDiscoverServer { url ->
            if (url == null) return@tryDiscoverServer
            val norm = normalizeServerUrl(url) ?: return@tryDiscoverServer
            val cur = normalizeServerUrl(current) ?: current
            if (norm == cur) return@tryDiscoverServer
            Log.w(TAG, "server moved: $cur -> $norm, adopting")
            runOnUiThread {
                prefs.edit().putString(KEY_SERVER, norm).apply()
                loadPlayer(norm)
                updateStatusOverlay("服务端已自动切换：$norm")
            }
        }
    }

    /** v1.3.47：后台 HTTP 探测存址服务端 /health；不可达 → 零配置发现热切换 */
    private fun probeServerThenRediscover() {
        val server = prefs.getString(KEY_SERVER, "") ?: ""
        if (server.isBlank()) return
        Thread {
            val ok = try {
                val conn = (java.net.URL(server.trimEnd('/') + "/health").openConnection() as java.net.HttpURLConnection).apply {
                    connectTimeout = 2500
                    readTimeout = 2500
                    requestMethod = "GET"
                }
                conn.responseCode in 200..299
            } catch (_: Exception) { false }
            if (!ok) {
                Log.w(TAG, "stored server $server unreachable, rediscovering")
                discoverAndAdoptServer()
            }
        }.start()
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

    // ★ v1.3.31：存储挂载路径刷新（SD/USB 卡热插拔）
    internal fun refreshMountedDevices() {
        val list = mutableListOf<String>()
        // 内置存储（作为基线，始终包含）
        try {
            val st = android.os.Environment.getExternalStorageDirectory()
            list.add(st.absolutePath)
        } catch (_: Exception) {}
        // 外部挂载点（SD/USB）：遍历 /mnt 与 /storage
        for (root in arrayOf("/mnt", "/storage", "/mnt/sdcard")) {
            try {
                val d = java.io.File(root)
                d.listFiles()?.forEach { if (it.isDirectory && it.canRead()) list.add(it.absolutePath) }
            } catch (_: Exception) {}
        }
        // 去重
        mountedDevices = list.distinct()
    }

    // ★ v1.3.31：存储/关机广播注册
    private fun registerSystemReceivers() {
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_MEDIA_MOUNTED)
                addAction(Intent.ACTION_MEDIA_EJECT)
                addAction(Intent.ACTION_MEDIA_REMOVED)
                addAction(Intent.ACTION_MEDIA_UNMOUNTED)
                addAction(Intent.ACTION_MEDIA_CHECKING)
            }
            registerReceiver(storageReceiver, filter)
        } catch (_: Exception) {}

        try {
            val shutdownFilter = IntentFilter().apply {
                addAction(Intent.ACTION_SHUTDOWN)
                addAction(Intent.ACTION_REBOOT)
            }
            registerReceiver(shutdownReceiver, shutdownFilter)
        } catch (_: Exception) {}

        refreshMountedDevices()
    }

    private fun unregisterSystemReceivers() {
        try { unregisterReceiver(storageReceiver) } catch (_: Exception) {}
        try { unregisterReceiver(shutdownReceiver) } catch (_: Exception) {}
    }

    /** 由 56iq CMS 基址反推同机灵屏服务端（端口 8888 → 7788），用于托管 Shell 页 */
    private fun siqianServerFromCms(cms: String): String {
        return try {
            val u = java.net.URI(cms)
            val port = if (u.port > 0) u.port else 8888
            java.net.URI(u.scheme, null, u.host, if (port == 8888) DEFAULT_PORT else port, "", null, null).toString()
        } catch (_: Exception) { cms }
    }

    /** 深链配置：lumasync://config?server=http://192.168.1.10:7788&code=LS-0001
     *  56iq 兼容：lumasync://config?mode=siqian&cms=http://192.168.1.41:8888&name=触拓A */
    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "lumasync" && data.host == "config") {
            // v1.3.15：深链同样走规范化，`lumasync://config?server=192.168.2.97:7788` 也能生效
            val mode = data.getQueryParameter("mode")
            val cmsParam = data.getQueryParameter("cms")
            var server = normalizeServerUrl(data.getQueryParameter("server"))
            // 56iq 兼容模式只给了 CMS（没给灵屏 server）时，反推同机灵屏服务端托管 Shell 页
            if (server == null && mode == "siqian" && !cmsParam.isNullOrBlank()) {
                server = normalizeServerUrl(siqianServerFromCms(cmsParam))
            }
            val code = data.getQueryParameter("code")
            val name = data.getQueryParameter("name")
            if (server != null) {
                prefs.edit().putString(KEY_SERVER, server).apply()
                if (!code.isNullOrBlank()) prefs.edit().putString(KEY_CODE, code).apply()
                if (!name.isNullOrBlank()) prefs.edit().putString(KEY_NAME, name).apply()
                when (mode) {
                    "siqian" -> {
                        prefs.edit().putBoolean(KEY_SIQIAN_MODE, true).apply()
                        if (!cmsParam.isNullOrBlank()) {
                            val cmsNorm = normalizeServerUrl(cmsParam)
                            if (cmsNorm != null) prefs.edit().putString(KEY_SIQIAN_CMS, cmsNorm).apply()
                        }
                    }
                    "lumasign" -> prefs.edit().putBoolean(KEY_SIQIAN_MODE, false).apply()
                }
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
        updateStatusOverlay("自动发现中…")
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

    private var configDialog: AlertDialog? = null
    private fun showConfigDialog() {
        // 防重复弹栈：rk312x 上右键=MENU，连续右键会叠出多个配置框，先查重
        if (configDialog?.isShowing == true) return
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

        configDialog = AlertDialog.Builder(ctx)
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
                // 首次配置好服务端后，引导用户把 LumaSign 设为默认桌面，保证长期驻守前台
                maybePromptSetDefaultHome()
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
        // 4.4 Chromium33：仅 onResume() 可能不恢复 JS 定时器，必须全局 resumeTimers()
        webView.resumeTimers()
        // 5.0+ Device Owner Kiosk：静默默认 Home + 锁定任务（4.4 自动跳过；仅尝试一次）
        if (!kioskAttempted) {
            kioskAttempted = true
            KioskManager.maybeEnterKiosk(this)
        }
    }

    override fun onPause() {
        webView.pauseTimers()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        unregisterConnectivity()
        unregisterSystemReceivers()
        retryRunnable?.let { uiHandler.removeCallbacks(it) }
        uiHandler.removeCallbacks(webViewLivenessCheck)
        webView.destroy()
        super.onDestroy()
    }

    /**
     * 键事件统一入口（v1.3.44）。
     *
     * rk312x/Android 4.4 实测（2026-10-19）：该 ROM 输入栈把鼠标 BTN_RIGHT **硬编码**改写为
     * KEYCODE_BACK（evdev→InputReader 层，keylayout 干预无效——Vendor 专属 .kl 实测不加载，
     * dumpsys input 实证 sendevent BTN_RIGHT 产生 deviceId=1/source=0x2002 的 keyCode=4），
     * 且不产生 buttonState=BUTTON_SECONDARY 的触摸事件，app 原有的三条右键路径全部收不到。
     * 因此「鼠标来源的 BACK」= 用户按了鼠标右键（或侧键 BTN_BACK）→ 弹运维菜单；
     * 键盘/遥控器的 BACK 的 source 是 SOURCE_KEYBOARD，不受影响，仍走 onBackPressed。
     *
     * 放在 dispatchKeyEvent 而非仅 onKeyDown：焦点在 WebView 内时按键先经 WebView，
     * 从这里拦截可保证任何焦点状态下都能触发（onKeyDown 保留作兜底）。
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_BACK -> {
                    if ((event.source and android.view.InputDevice.SOURCE_MOUSE) != 0) {
                        Log.i(TAG, "mouse BACK (rk312x maps right button to BACK) -> showOpsMenu")
                        showOpsMenu()
                        return true
                    }
                }
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> {
                    // USB 键盘 MENU / 红外遥控 MENU：直接弹运维菜单（先于 WebView，必达）
                    showOpsMenu()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    /**
     * 硬按键救援入口（v1.3.15）。
     *
     * 背景：v1.3.11 的 MainActivity 完全没有按键/触摸处理，配置框一旦被关掉（地址已落盘）
     * 就再也打不开 → 嵌墙设备彻底锁死。这里补一条"纯键盘也能进配置"的通路：
     * MENU / SETTINGS 键（多数 USB 键盘、红外遥控都有）直接弹配置框。
     * 鼠标/触屏路径见 setupOverlay() 的救援按钮与 dispatchTouchEvent() 的右键。
     *
     * 注：v1.3.44 起 MENU/SETTINGS 与"鼠标右键（ROM 映射为 BACK）"已在 dispatchKeyEvent
     * 统一拦截，本方法主要作兜底（dialog 等非常规焦点路径）。
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            // rk312x 固件把鼠标右键映射成 MENU 键（非 BUTTON_SECONDARY 触摸事件），IR 遥控器 MENU 也走这里。
            // 统一弹「运维菜单」，让右键/MENU 两条路径都有明确归宿：退出到桌面 / 配置服务器。
            showOpsMenu()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    /** 运维菜单：鼠标右键（固件映射为 MENU）与遥控器 MENU 的共用入口 */
    private fun showOpsMenu() {
        AlertDialog.Builder(this)
            .setTitle("运维菜单")
            .setItems(arrayOf("退出到桌面", "配置服务器", "取消")) { _, which ->
                when (which) {
                    0 -> showExitConfirm()
                    1 -> showConfigDialog()
                }
            }
            .setCancelable(true)
            .show()
    }

    /** 返回键：仅最小化（moveTaskToBack），Kiosk 守护会在 2 秒内自动拉回；
     *  真正退出走「长按 2 秒 / 右键 → 退出到桌面」（先停守护再杀进程，不会被拉回） */
    override fun onBackPressed() {
        try { moveTaskToBack(true) } catch (_: Exception) { finish() }
    }

    // ─────────────────────────────────────────────────────────────
    // 紧急逃生口（v1.3.13，防"坏版本把嵌墙设备锁死"）
    // 触发方式：① 触屏长按 2 秒（静止不动）  ② 鼠标右键 / 映射的 menu 键
    // 行为：弹出二次确认框 → 确认后退回系统桌面（moveTaskToBack）
    // 设计要点：长按中一旦手指移动（滑动/滚动）即取消，避免误触；
    //          覆盖层之上仍可见；退出走 doExit（先停 kiosk 守护再杀进程），退出必然生效，
    //          而返回键/最小化只是 moveTaskToBack，2 秒内会被守护拉回（v1.3.21 起 4.4 也启用守护）。
    // ─────────────────────────────────────────────────────────────
    private val exitHandler = Handler(Looper.getMainLooper())
    private val exitLongPress = Runnable { showExitConfirm() }
    private var exitDialog: AlertDialog? = null
    private var exitDownX = 0f
    private var exitDownY = 0f
    private val exitTouchSlop by lazy { android.view.ViewConfiguration.get(this).scaledTouchSlop }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        when (ev.action) {
            MotionEvent.ACTION_DOWN -> {
                // 诊断日志（v1.3.35/v1.3.38）：不同模拟器/固件对鼠标右键的映射千差万别——标准
                // BUTTON_SECONDARY 鼠标事件 / MENU 键（rk312x）/ 直接映射为 BACK 键（蓝叠等
                // 第三方模拟器）/ 降级为 buttonState=0 的普通触摸。打全字段，用户复现一次抓
                // logcat 即可定位是哪条路径，不再靠猜。
                //
                // ★ v1.3.38 关键修复：MotionEvent.getActionButton() 是 API 23+，Android 4.4（API19）
                // 上没有该方法；v1.3.35 里无条件调用 ev.actionButton 会导致每个触摸事件都抛
                // NoSuchMethodError 并崩溃（RK312x 真机事故）。pre-M 设备用 "N/A" 占位，
                // 仅在 M+ 读取 actionButton；判据同样只在 M+ 生效。
                val canReadActionButton = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                val actionButtonStr = if (canReadActionButton) ev.actionButton.toString() else "N/A"
                val actionButtonSecondary = canReadActionButton && (ev.actionButton and MotionEvent.BUTTON_SECONDARY) != 0
                Log.i("LumaSign", "touch DOWN: buttonState=" + ev.buttonState +
                    " actionButton=" + actionButtonStr +
                    " secondary=" + ((ev.buttonState and MotionEvent.BUTTON_SECONDARY) != 0) +
                    " actionSecondary=" + actionButtonSecondary +
                    " source=0x" + Integer.toHexString(ev.source) +
                    " mouse=" + ((ev.source and android.view.InputDevice.SOURCE_MOUSE) != 0))
                // 鼠标右键（标准 BUTTON_SECONDARY 路径，rk312x 固件右键走 MENU 键见 onKeyDown）→ 弹运维菜单
                // 判据放宽：buttonState 或 actionButton 命中 BUTTON_SECONDARY 均算右键
                // （部分模拟器/固件只在 actionButton 里给按钮，buttonState 为 0）
                if ((ev.buttonState and MotionEvent.BUTTON_SECONDARY) != 0 || actionButtonSecondary) {
                    showOpsMenu()
                } else {
                    exitDownX = ev.x; exitDownY = ev.y
                    exitHandler.removeCallbacks(exitLongPress)
                    exitHandler.postDelayed(exitLongPress, 2000)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                // 仅当位移超出触摸容差才取消长按——鼠标传感器抖动/触屏微颤不再误杀长按（v1.3.23）
                val dx = ev.x - exitDownX; val dy = ev.y - exitDownY
                if (dx * dx + dy * dy > exitTouchSlop * exitTouchSlop) exitHandler.removeCallbacks(exitLongPress)
            }
            MotionEvent.ACTION_UP,
            MotionEvent.ACTION_CANCEL -> {
                // 抬起/取消时停止计时（若 2s 已到、弹窗已弹，这里是无害的空操作）
                exitHandler.removeCallbacks(exitLongPress)
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    /**
     * 鼠标右键的第二条投递路径（v1.3.37 修复真机右键无反应）。
     *
     * 模拟器 / 部分固件把右键作为「触摸事件」走 dispatchTouchEvent（buttonState/actionButton
     * 命中 BUTTON_SECONDARY），上面已处理。但 Android 8+ 真机（尤其小米 / Android 12）常把
     * 鼠标按键作为「通用运动事件」投递：右键 -> ACTION_BUTTON_PRESS + actionButton=BUTTON_SECONDARY，
     * 它走 dispatchGenericMotionEvent 而非 dispatchTouchEvent，旧实现完全收不到 → 右键无反应。
     * 这里补上该路径，与上面的触摸路径互补，保证各类设备右键都能弹出运维菜单。
     */
    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        try {
            // ACTION_BUTTON_PRESS / getActionButton 均为 API 23+；低版本设备不投递该事件，
            // 但为避免在 pre-M 上误调用 getActionButton 触发 NoSuchMethodError，加 SDK 守卫。
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                ev.action == MotionEvent.ACTION_BUTTON_PRESS &&
                (ev.actionButton and MotionEvent.BUTTON_SECONDARY) != 0) {
                Log.i("LumaSign", "generic BTN_PRESS secondary -> showOpsMenu")
                showOpsMenu()
                return true
            }
        } catch (_: Exception) { }
        return super.dispatchGenericMotionEvent(ev)
    }

    private fun showExitConfirm() {
        exitHandler.removeCallbacks(exitLongPress)
        if (exitDialog?.isShowing == true) return
        exitDialog = AlertDialog.Builder(this).apply {
            setTitle("退出到桌面")
            setMessage("确认退出灵屏播放端并返回系统桌面？")
            setPositiveButton("确认退出") { _, _ -> doExit() }
            setNegativeButton("取消", null)
            setCancelable(true)
        }.create().also { it.show() }
    }

    /** 彻底退出：先停 Kiosk 守护（否则它会把你拉回），再释放 lockTask，最后结束并杀进程 */
    private fun doExit() {
        // 先标记退出静默期：即便守护服务被系统作为 START_STICKY 重启，也会跳过拉回，
        // 等 30s Alarm 到点才由系统重新拉起（修复「退出后 2s 即被拉回、30s 静默失效」）
        KioskManager.markExitGrace(this, EXIT_GRACE_MS)
        try { stopService(Intent(this, KioskGuardService::class.java)) } catch (_: Exception) { }
        // ★ v1.3.44 修复「退出到桌面被秒回」：本应用是默认 HOME（always=true）时，
        // finish/killProcess 后 system_server 立即以 MAIN cat=[HOME] intent 重启本 Activity
        // （logcat 实证 "START u0 {act=MAIN cat=[HOME]} from pid 0"），30s 静默期完全失效。
        // 先禁用自身 HOME 组件：系统解析 HOME intent 跳过禁用组件 → 落到 launcher3，
        // 退出真正生效；30s 后 ExitRelaunchReceiver 恢复组件并显式拉起。
        KioskManager.setHomeComponentEnabled(this, false)
        // 30s 静默期：给运维留出退出后的操作时间（装包/改设置），到点由 Alarm 触发
        // ExitRelaunchReceiver（恢复组件 + 显式拉起）。用广播而非 getActivity：
        // 组件禁用期间显式 intent 无法启动 Activity，必须先经 Receiver 恢复组件。
        try {
            val am = getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            val relaunch = Intent(this, ExitRelaunchReceiver::class.java)
                .setAction(ExitRelaunchReceiver.ACTION_RELAUNCH)
            val imm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) android.app.PendingIntent.FLAG_IMMUTABLE else 0
            val pi = android.app.PendingIntent.getBroadcast(this, 2001, relaunch,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or imm)
            am.set(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + EXIT_GRACE_MS, pi)
            android.util.Log.i("LumaSign", "exit: home component disabled, relaunch alarm in ${EXIT_GRACE_MS / 1000}s")
        } catch (e: Exception) {
            android.util.Log.w("LumaSign", "exit alarm failed (non-fatal): ${e.message}")
        }
        // finishAndRemoveTask / stopLockTask 是 API 21+，4.4 上必须用 SDK 守卫包住，否则 NoSuchMethodError 崩
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try { stopLockTask() } catch (_: Exception) { }
            try { finishAndRemoveTask() } catch (_: Exception) { finish() }
        } else {
            try { finish() } catch (_: Exception) { }
        }
        try { android.os.Process.killProcess(android.os.Process.myPid()) } catch (_: Exception) { }
    }
}
