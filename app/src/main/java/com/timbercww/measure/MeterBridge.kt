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

    // קודי סטטוס GATT ש"חולפים מעצמם" - לא בעיית שיוך/הרשאה אמיתית, אלא תקלת תזמון/
    // עומס פנימית בערימת הבלוטות' של הטלפון (כתיבה שקרתה "מהר מדי" אחרי החיבור).
    // הדוגמה הנפוצה ביותר: 128 (0x80, GATT_NO_RESOURCES) ו-133 (0x85, GATT_ERROR כללי)
    // ו-142 (0x8e, GATT_CONNECTION_CONGESTED). במקרים האלה הפתרון הנכון הוא לנסות שוב
    // אחרי המתנה קצרה, לא לבקש מהמשתמש לשייך את המכשיר.
    private val TRANSIENT_GATT_STATUSES = setOf(128, 133, 142)
    private val MAX_RETRIES = 3
    private val INITIAL_OP_DELAY_MS = 400L

    private val handler = Handler(Looper.getMainLooper())
    private val btManager by lazy { context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager }
    private val adapter: BluetoothAdapter? get() = btManager.adapter

    private var gatt: BluetoothGatt? = null
    private var scanning = false
    private var connected = false
    private var cccdRetries = 0

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
        cccdRetries = 0

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

    @SuppressLint("MissingPermission")
    private fun sendStartCommand(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
        // המטר לא בהכרח תומך בכתיבה "בלי תשובה" (Write Without Response) - חייבים
        // לבדוק את היכולות האמיתיות של ה-characteristic ולהתאים את סוג הכתיבה,
        // בדיוק כמו שהדפדפן עושה (writeValueWithoutResponse עם נפילה ל-writeValue).
        ch.writeType =
            if (ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            else
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        ch.value = START_CMD
        val queued = g.writeCharacteristic(ch)
        if (!queued) {
            reportError("שליחת פקודת ההפעלה למטר לא יצאה לדרך.")
            return
        }
        // ל-writeType NO_RESPONSE אין קולבק onCharacteristicWrite בטוח בכל המכשירים -
        // מדווחים 'on' כבר כאן, אבל אם זו כתיבה עם תשובה (DEFAULT) נחכה לאישור בפועל
        // ב-onCharacteristicWrite ונדווח שם אם היא נכשלה.
        if (ch.writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) {
            connected = true
            runJs("window.__mpMeter && window.__mpMeter('on')")
        }
    }

    @SuppressLint("MissingPermission")
    private fun enableNotifications(g: BluetoothGatt) {
        val service = g.getService(SERVICE_UUID)
        val ch = service?.getCharacteristic(CHAR_UUID)
        if (ch == null) {
            reportError("המטר נמצא, אבל לא נמצא בו השירות הצפוי. ייתכן שהדגם משתמש בפרוטוקול אחר.")
            g.disconnect()
            return
        }
        val okLocal = g.setCharacteristicNotification(ch, true)
        if (!okLocal) {
            reportError("לא ניתן להפעיל קבלת מידע מהמטר (setCharacteristicNotification נכשל).")
        }
        val cccd = ch.getDescriptor(CCCD_UUID)
        if (cccd != null) {
            cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            val queued = g.writeDescriptor(cccd)
            if (!queued) {
                reportError("כתיבת הגדרת ההתראות למטר לא יצאה לדרך.")
            }
        } else {
            // אין CCCD - מנסים לשלוח את פקודת ההתחלה ישירות
            sendStartCommand(g, ch)
        }
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
            if (status != BluetoothGatt.GATT_SUCCESS) {
                reportError("גילוי השירותים במטר נכשל (קוד $status).")
                g.disconnect()
                return
            }
            // המתנה קצרה לפני תחילת כתיבות ה-GATT: מיד אחרי שהחיבור/גילוי השירותים
            // מסתיים, ערימת הבלוטות' בחלק מהטלפונים עדיין "תפוסה" ותחזיר שגיאת משאבים
            // (סטטוס 128/133) על הכתיבה הראשונה, גם כשהכל תקין. השהיה קצרה פותרת את זה
            // כמעט תמיד בלי שום פעולה מהמשתמש.
            cccdRetries = 0
            handler.postDelayed({ enableNotifications(g) }, INITIAL_OP_DELAY_MS)
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (descriptor.uuid != CCCD_UUID) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                if (status in TRANSIENT_GATT_STATUSES && cccdRetries < MAX_RETRIES) {
                    // תקלת תזמון/עומס זמנית - מנסים שוב אחרי המתנה גוברת, בלי לערב את המשתמש.
                    cccdRetries++
                    val delayMs = 400L * cccdRetries
                    handler.postDelayed({ enableNotifications(g) }, delayMs)
                    return
                }
                // זה בדיוק המקרה ש"מתחבר אבל לא מגיע מידע": אם כתיבת ה-CCCD נכשלת בפועל,
                // המטר אף פעם לא נכנס למצב שידור, וההתראה 'on' לא הייתה נשלחת בעבר למרות
                // שדבר לא עבד בפועל.
                val msg = if (status in TRANSIENT_GATT_STATUSES) {
                    "הפעלת ההתראות מהמטר נכשלה שוב ושוב (קוד $status) - נראה שזו תקלת תקשורת זמנית. נסה לכבות ולהדליק את הבלוטות' בטלפון, לקרב את המטר, ולנסות שוב."
                } else {
                    "הפעלת ההתראות מהמטר נכשלה (קוד $status). ייתכן שצריך לשייך (pair) את המטר קודם בהגדרות הבלוטות' של הטלפון."
                }
                reportError(msg)
                try { g.disconnect() } catch (_: Exception) {}
                return
            }
            cccdRetries = 0
            val service = g.getService(SERVICE_UUID)
            val ch = service?.getCharacteristic(CHAR_UUID) ?: return
            sendStartCommand(g, ch)
        }

        @SuppressLint("MissingPermission")
        override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (characteristic.uuid != CHAR_UUID) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                reportError("פקודת ההפעלה למטר נדחתה (קוד $status). ייתכן שהמטר צריך שיוך (pair) בהגדרות הבלוטות' של הטלפון, או שהוא לא תומך בפקודה הזו.")
                return
            }
            connected = true
            runJs("window.__mpMeter && window.__mpMeter('on')")
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid != CHAR_UUID) return
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
