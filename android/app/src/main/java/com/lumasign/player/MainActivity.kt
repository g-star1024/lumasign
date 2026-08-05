package com.lumasign.player

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: LumaBridge
    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private val uiHandler = Handler(Looper.getMainLooper())

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
        hideSystemUI()

        // 累计崩溃计数（持久化），供健康度上报
        crashCount = prefs.getInt("crash_count", 0)
        Thread.setDefaultUncaughtExceptionHandler { _, _ ->
            crashCount++
            prefs.edit().putInt("crash_count", crashCount).apply()
        }

        webView = findViewById(R.id.webview)
        setupWebView()

        handleIntent(intent)
        val server = prefs.getString(KEY_SERVER, "") ?: ""
        if (server.isBlank()) showConfigDialog() else loadPlayer(server)
        applyScreenIntent(intent)
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
        ws.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        ws.useWideViewPort = true
        ws.loadWithOverviewMode = true
        ws.cacheMode = WebSettings.LOAD_DEFAULT
        WebView.setWebContentsDebuggingEnabled(true)

        bridge = LumaBridge(this, webView)
        webView.addJavascriptInterface(bridge, "LumaBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = false
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                // 进度可在 UI 上体现，此处保持轻量
            }
        }
    }

    private fun loadPlayer(server: String) {
        val code = prefs.getString(KEY_CODE, "") ?: ""
        val url = buildString {
            append(server.trimEnd('/'))
            append("/player/?mode=term")
            if (code.isNotBlank()) append("&code=").append(code)
        }
        webView.loadUrl(url)
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
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
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
        webView.destroy()
        super.onDestroy()
    }

    /** 拦截返回键，保持 kiosk 不可退出 */
    override fun onBackPressed() {
        // 长按多任务键等系统行为无法拦截，但普通返回键不退出播放
    }
}
