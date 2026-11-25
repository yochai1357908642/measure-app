package com.timbercww.measure

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import android.webkit.WebView
import java.util.UUID

/**
 * חיבור ישיר (לא דרך שירות רקע) למטר הלייזר של בוש (GLM), תואם ל-GLM_SVC/GLM_CH
 * ולפרוטוקול שכבר מוגדרים ב-index.html (navigator.bluetooth בגרסת הדפדפן).
 *
 * בכוונה: אין כאן Foreground Service ואין שום Notification קבועה. החיבור חי רק כל עוד
 * MainActivity פתוח, ומתנתק לבד ב-onDestroy. זה בדיוק מה שמסתיר את שם/מספר הסידורי
 * של המכשיר מהמשתמש - אין שום התראה של המערכת שמציגה את זה בכלל.
 */
class MeterBridge(private val context: Context, private val webView: WebView) {

    private val SERVICE_UUID: UUID = UUID.fromString("02a6c0d0-0451-4000-b000-fb3210111989")
    private val CHAR_UUID: UUID = UUID.fromString("02a6c0d1-0451-4000-b000-fb3210111989")
    private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    private val START_CMD = byteArrayOf(
        0xc0.toByte(), 0x55, 0x02, 0x01, 0x00, 0x1a
    )
    private val SCAN_TIMEOUT_MS = 12000L

    private val handler = Handler(Looper.getMainLooper())
    private val btManager by lazy { context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager }
    private val adapter: BluetoothAdapter? get() = btManager.adapter

    private var gatt: BluetoothGatt? = null
    private var scanning = false
    private var connected = false

    private fun runJs(js: String) {
        handler.post { webView.evaluateJavascript(js, null) }
    }

    private fun jsString(s: String): String = "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"

    fun reportError(msg: String) {
        runJs("window.__mpMeter && window.__mpMeter('error', " + jsString(msg) + ")")
    }

    @SuppressLint("MissingPermission")
    fun startScanAndConnect() {
        val ad = adapter
        if (ad == null || !ad.isEnabled) {
            reportError("הבלוטות' כבוי במכשיר. צריך להדליק אותו.")
            return
        }
        val scanner = ad.bluetoothLeScanner
        if (scanner == null) {
            reportError("לא ניתן לסרוק בלוטות' במכשיר הזה כרגע.")
            return
        }
        if (scanning) return
        scanning = true

        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        )
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            scanner.startScan(filters, settings, scanCallback)
        } catch (e: Exception) {
            scanning = false
            reportError("סריקת הבלוטות' נכשלה להתחיל.")
            return
        }

        handler.postDelayed({
            if (scanning) {
                try { scanner.stopScan(scanCallback) } catch (_: Exception) {}
                scanning = false
                if (!connected) {
                    reportError("המטר לא נמצא. ודא שהוא דלוק וקרוב לטלפון.")
                }
            }
        }, SCAN_TIMEOUT_MS)
    }

    private val scanCallback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val ad = adapter ?: return
            try { ad.bluetoothLeScanner?.stopScan(this) } catch (_: Exception) {}
            scanning = false
            connectTo(result.device)
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            reportError("סריקת הבלוטות' נכשלה (קוד $errorCode).")
        }
    }

    @SuppressLint("MissingPermission")
    private fun connectTo(device: BluetoothDevice) {
        gatt = device.connectGatt(context, false, gattCallback)
    }

    private val gattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val wasConnected = connected
                connected = false
                g.close()
                if (gatt === g) gatt = null
                if (wasConnected) {
                    runJs("window.__mpMeter && window.__mpMeter('off')")
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val service = g.getService(SERVICE_UUID)
            val ch = service?.getCharacteristic(CHAR_UUID)
            if (ch == null) {
                reportError("המטר נמצא, אבל לא נמצא בו השירות הצפוי. ייתכן שהדגם משתמש בפרוטוקול אחר.")
                g.disconnect()
                return
            }
            g.setCharacteristicNotification(ch, true)
            val cccd = ch.getDescriptor(CCCD_UUID)
            if (cccd != null) {
                cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                g.writeDescriptor(cccd)
            } else {
                // אין CCCD - מנסים לשלוח את פקודת ההתחלה ישירות
                sendStartCommand(g, ch)
            }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val service = g.getService(SERVICE_UUID)
            val ch = service?.getCharacteristic(CHAR_UUID) ?: return
            sendStartCommand(g, ch)
        }

        @SuppressLint("MissingPermission")
        private fun sendStartCommand(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
            // המטר לא בהכרח תומך בכתיבה "בלי תשובה" (Write Without Response) - חייבים
            // לבדוק את היכולות האמיתיות של ה-characteristic ולהתאים את סוג הכתיבה,
            // בדיוק כמו שהדפדפן עושה (writeValueWithoutResponse עם נפילה ל-writeValue).
            // כתיבה עם סוג לא נתמך נכשלת בשקט (בלי שגיאה), וזה גרם לתופעה: "מתחבר" אבל
            // לא זורם מידע בלחיצה על כפתור המדידה במטר עצמו.
            ch.writeType =
                if (ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                    BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                else
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            ch.value = START_CMD
            val ok = g.writeCharacteristic(ch)
            connected = true
            runJs("window.__mpMeter && window.__mpMeter('on')")
            if (!ok) {
                Log.w(MainActivity.TAG, "meter start command write failed")
            }
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val bytes = characteristic.value ?: return
            val hex = bytes.joinToString("") { "%02x".format(it) }
            runJs("window.__mpMeter && window.__mpMeter('data', " + jsString(hex) + ")")
        }
    }

    @SuppressLint("MissingPermission")
    fun disconnect() {
        try {
            if (scanning) {
                adapter?.bluetoothLeScanner?.stopScan(scanCallback)
                scanning = false
            }
            gatt?.disconnect()
            gatt?.close()
        } catch (_: Exception) {
        } finally {
            val wasConnected = connected
            connected = false
            gatt = null
            if (wasConnected) {
                runJs("window.__mpMeter && window.__mpMeter('off')")
            }
        }
    }
}
