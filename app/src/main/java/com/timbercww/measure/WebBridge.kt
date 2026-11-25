package com.timbercww.measure

import android.content.Context
import android.os.Environment
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream
import kotlin.concurrent.thread

/**
 * הגשר בין ה-JavaScript (index.html / shim.js) לבין קוד האנדרואיד.
 * נחשף ל-JS בשם "Android" (ראו MainActivity.setupWebView), ומיישם בדיוק את הפונקציות
 * ש-shim.js וה-index.html כבר קוראים להן: saveFile, getUpdateUrl/setUpdateUrl, checkUpdate,
 * reload, getVersion, meterConnect, meterDisconnect.
 */
class WebBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val meter: MeterBridge
) {
    private val prefs = activity.getSharedPreferences("measure_app", Context.MODE_PRIVATE)

    companion object {
        // כתובת ברירת מחדל קבועה לעדכון תוכן - כדי שהאפליקציה תתעדכן לבד ברגע שיש
        // אינטרנט, בלי שהמשתמש יצטרך להדביק שום כתובת בעצמו (בדיוק כמו ההתנהגות
        // הישנה). מצביעה תמיד על ה-release האחרון שפורסם ב-GitHub Actions (ראו
        // .github/workflows/build.yml, "web-update.zip"). אם המשתמש שומר כתובת שונה
        // במסך "עדכון האפליקציה", היא תגבר על זו (ראו getUpdateUrl למטה).
        private const val DEFAULT_UPDATE_URL =
            "https://github.com/yochai1357908642/measure-app/releases/latest/download/web-update.zip"
    }

    private fun runJs(js: String) {
        activity.runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    private fun jsString(s: String): String {
        // בריחה בטוחה למחרוזת JS בתוך evaluateJavascript
        val b = StringBuilder("'")
        for (c in s) {
            when (c) {
                '\\' -> b.append("\\\\")
                '\'' -> b.append("\\'")
                '\n' -> b.append("\\n")
                '\r' -> b.append("")
                else -> b.append(c)
            }
        }
        b.append("'")
        return b.toString()
    }

    // ---------- שמירת קובץ (הורדות) ----------
    @JavascriptInterface
    fun saveFile(filename: String, mimeType: String, base64Data: String) {
        thread {
            try {
                val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: activity.filesDir
                if (!dir.exists()) dir.mkdirs()
                val safeName = filename.replace(Regex("[\\\\/:*?\"<>|]"), "_")
                val out = File(dir, safeName)
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                FileOutputStream(out).use { it.write(bytes) }
                activity.toast("הקובץ נשמר: ${out.name}")
            } catch (e: Exception) {
                Log.e(MainActivity.TAG, "saveFile failed", e)
                activity.toast("שמירת הקובץ נכשלה")
            }
        }
    }

    // ---------- עדכון ----------
    private val updateBaseDir: File get() = File(activity.filesDir, "webupdate")
    private val updateLiveDir: File get() = File(updateBaseDir, "live")
    private val updateStagingDir: File get() = File(updateBaseDir, "staging")

    /** נקרא מ-MainActivity כדי לדעת אם להגיש קבצים מעודכנים במקום מה-assets המובנים */
    fun updateDir(): File? = if (updateLiveDir.exists()) updateLiveDir else null

    @JavascriptInterface
    fun getVersion(): String {
        val liveVersion = File(updateLiveDir, "version.txt")
        if (liveVersion.exists()) {
            return liveVersion.readText().trim()
        }
        return try {
            activity.assets.open("www/version.txt").bufferedReader().use { it.readText().trim() }
        } catch (e: Exception) {
            "?"
        }
    }

    @JavascriptInterface
    fun getUpdateUrl(): String = prefs.getString("update_url", DEFAULT_UPDATE_URL) ?: DEFAULT_UPDATE_URL

    @JavascriptInterface
    fun setUpdateUrl(url: String) {
        prefs.edit().putString("update_url", url.trim()).apply()
    }

    @JavascriptInterface
    fun checkUpdate() {
        val url = getUpdateUrl()
        if (url.isBlank()) {
            runJs("window.__mpAndroid && window.__mpAndroid('nourl')")
            return
        }
        thread {
            try {
                val zipBytes = httpGetBytes(url)
                if (updateStagingDir.exists()) updateStagingDir.deleteRecursively()
                updateStagingDir.mkdirs()
                unzipInto(zipBytes, updateStagingDir)

                val newVersionFile = File(updateStagingDir, "version.txt")
                val newVersion = if (newVersionFile.exists()) newVersionFile.readText().trim() else ""
                val curVersion = getVersion()

                if (newVersion.isBlank() || !File(updateStagingDir, "index.html").exists()) {
                    runJs("window.__mpAndroid && window.__mpAndroid('error:" +
                        "קובץ העדכון לא תקין')")
                    return@thread
                }
                if (newVersion == curVersion) {
                    updateStagingDir.deleteRecursively()
                    runJs("window.__mpAndroid && window.__mpAndroid('uptodate')")
                    return@thread
                }

                // מחליפים: staging -> live (הגרסה הישנה של live נמחקת)
                if (updateLiveDir.exists()) updateLiveDir.deleteRecursively()
                updateStagingDir.renameTo(updateLiveDir)

                runJs("window.__mpAndroid && window.__mpAndroid(" + jsString("updated:$newVersion") + ")")
            } catch (e: Exception) {
                Log.e(MainActivity.TAG, "checkUpdate failed", e)
                runJs("window.__mpAndroid && window.__mpAndroid(" + jsString("error:${e.message ?: "לא ידוע"}") + ")")
            }
        }
    }

    @JavascriptInterface
    fun reload() {
        activity.reloadApp()
    }

    private fun httpGetBytes(urlString: String): ByteArray {
        val conn = URL(urlString).openConnection() as HttpURLConnection
        conn.connectTimeout = 20000
        conn.readTimeout = 30000
        conn.instanceFollowRedirects = true
        conn.inputStream.use { stream ->
            return stream.readBytes()
        }
    }

    private fun unzipInto(zipBytes: ByteArray, destDir: File) {
        ZipInputStream(zipBytes.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val outFile = File(destDir, entry.name)
                if (entry.isDirectory) {
                    outFile.mkdirs()
                } else {
                    outFile.parentFile?.mkdirs()
                    FileOutputStream(outFile).use { fos ->
                        zis.copyTo(fos)
                    }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
    }

    // ---------- מטר הלייזר (בלוטות') ----------
    @JavascriptInterface
    fun meterConnect() {
        activity.runOnUiThread { activity.ensureBtPermissionsThenConnect() }
    }

    @JavascriptInterface
    fun meterDisconnect() {
        meter.disconnect()
    }
}
