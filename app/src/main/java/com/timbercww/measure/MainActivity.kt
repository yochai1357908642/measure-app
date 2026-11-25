package com.timbercww.measure

import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.io.FileInputStream

/**
 * מעטפת WebView פשוטה לאפליקציית המדידות.
 * אין כאן Foreground Service ואין שום התראה קבועה - חיבור הבלוטות' חי רק כל עוד
 * המסך הזה פתוח, בדיוק כמו שחיבור בלוטות' רגיל של אפליקציה שלא מריצה שירות רקע.
 * זה הפתרון לבעיה: "לא רוצה לראות את שם/מספר הסידורי של המטר בהתראה".
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var meter: MeterBridge
    private lateinit var bridge: WebBridge

    // בקשת הרשאות בלוטות' (ומיקום במכשירים ישנים, נדרש טכנית לסריקת BLE)
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        val ok = granted.values.all { it }
        if (ok) {
            meter.startScanAndConnect()
        } else {
            meter.reportError("לא ניתנה הרשאת בלוטות'. אי אפשר להתחבר למטר בלי זה.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        meter = MeterBridge(this, webView)
        bridge = WebBridge(this, webView, meter)

        setupWebView()
        loadApp()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT

        webView.addJavascriptInterface(bridge, "Android")

        webView.webViewClient = object : WebViewClient() {
            // כשיש גרסה מעודכנת שהורדה (updateDir), היא זאת שמשרתת את הקבצים, אחרת ה-assets המובנים
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val updateDir = bridge.updateDir()
                if (updateDir != null && updateDir.exists()) {
                    val path = request.url.path ?: return null
                    // path מגיע כמו /android_asset/www/xxx - לוקחים רק את מה שאחרי www/
                    val marker = "www/"
                    val idx = path.indexOf(marker)
                    if (idx >= 0) {
                        val rel = path.substring(idx + marker.length)
                        val f = File(updateDir, rel)
                        if (f.exists() && f.isFile) {
                            return try {
                                WebResourceResponse(
                                    mimeFor(f.name),
                                    "UTF-8",
                                    FileInputStream(f)
                                )
                            } catch (e: Exception) {
                                null
                            }
                        }
                    }
                }
                return null
            }
        }
    }

    private fun mimeFor(name: String): String = when {
        name.endsWith(".html") -> "text/html"
        name.endsWith(".js") -> "text/javascript"
        name.endsWith(".css") -> "text/css"
        name.endsWith(".json") || name.endsWith(".webmanifest") -> "application/json"
        name.endsWith(".png") -> "image/png"
        name.endsWith(".woff2") -> "font/woff2"
        else -> "application/octet-stream"
    }

    private fun loadApp() {
        // תמיד טוענים מ-assets; אם קיימת גרסה מעודכנת, shouldInterceptRequest יגיש אותה במקום
        webView.loadUrl("file:///android_asset/www/index.html")
    }

    fun reloadApp() {
        runOnUiThread { loadApp() }
    }

    fun toast(msg: String) {
        runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    }

    /** נקרא מ-WebBridge.meterConnect(): מוודא הרשאות ואז מתחיל סריקה */
    fun ensureBtPermissionsThenConnect() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.BLUETOOTH_SCAN)
            }
            if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.BLUETOOTH_CONNECT)
            }
        } else {
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }
        if (needed.isEmpty()) {
            meter.startScanAndConnect()
        } else {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    override fun onDestroy() {
        meter.disconnect()
        super.onDestroy()
    }

    companion object {
        const val TAG = "MeasureApp"
    }
}
