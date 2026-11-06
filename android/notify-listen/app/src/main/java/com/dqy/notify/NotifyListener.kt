package com.dqy.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.ServiceInfo
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

private const val TAG = "DQYNotify"
private const val STATUS_CHANNEL = "dqy_status"
private const val STATUS_ID = 1001

/**
 * Forwards every posted notification to the host over plain HTTP.
 *
 * The endpoint is fixed to the device loopback so the host can reach it
 * through `adb reverse tcp:14123 tcp:14123`; this avoids LAN IP / firewall
 * dependencies. Override it by editing DEFAULT_ENDPOINT below.
 *
 * The service runs as a foreground service (specialUse) so EMUI's startup
 * manager keeps its process alive; the status notification is the visible
 * side effect of the always-on listener.
 */
class NotifyListener : NotificationListenerService() {

    private val endpoint: String = DEFAULT_ENDPOINT

    @Volatile
    private var pollRunning = false
    private var pollThread: Thread? = null

    // Host reachability: consecutive POST failures flip the service into
    // offline mode, where a local keyword list stands in for the plugin rules.
    @Volatile
    private var offlineFails = 0

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(
            STATUS_ID,
            buildStatusNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
        )
        Log.d(TAG, "foreground started")
        pollRunning = true
        pollThread = thread {
            while (pollRunning) {
                fetchCancels()
                try {
                    Thread.sleep(POLL_INTERVAL_MS)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }
    }

    override fun onDestroy() {
        pollRunning = false
        pollThread?.interrupt()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        Log.d(TAG, "onPosted pkg=${sbn.packageName} key=${sbn.key}")
        if (sbn.packageName == packageName) {
            return
        }
        val extras = sbn.notification?.extras ?: return
        val title = extras
            .getCharSequence(Notification.EXTRA_TITLE)
            ?.toString()
            .orEmpty()
        val text = extras
            .getCharSequence(Notification.EXTRA_TEXT)
            ?.toString()
            .orEmpty()
        thread {
            val ok = post(
                mapOf(
                    "app" to sbn.packageName,
                    "title" to title,
                    "text" to text,
                    "when" to sbn.notification.`when`,
                    "id" to sbn.key,
                ),
            )
            if (ok) {
                offlineFails = 0
            } else {
                offlineFails += 1
                if (offlineFails >= OFFLINE_THRESHOLD) {
                    offlineJudge(title, text, sbn.key)
                }
            }
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // This source only cares about posted events.
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(STATUS_CHANNEL, "DQY 监听状态", NotificationManager.IMPORTANCE_MIN),
        )
    }

    private fun buildStatusNotification(): Notification {
        return Notification.Builder(this, STATUS_CHANNEL)
            .setContentTitle("青鱼通知监听运行中")
            .setContentText("正在实时转发手机通知到电脑")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
    }

    private fun post(payload: Map<String, Any?>): Boolean {
        return try {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 3000
                readTimeout = 3000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            conn.outputStream.use { out ->
                out.write(JSONObject(payload).toString().toByteArray(Charsets.UTF_8))
            }
            val resp = conn.inputStream.use { it.readBytes() }
            Log.d(TAG, "POST_OK resp=${String(resp)}")
            conn.disconnect()
            true
        } catch (e: Exception) {
            Log.e(TAG, "POST_FAIL ${e.javaClass.simpleName}: ${e.message}")
            false
        }
    }

    /**
     * Offline safety net: while the host is unreachable, cancel notifications
     * whose title/text hit the local junk keyword list (a subset of the plugin
     * default rules). Switches back automatically once a POST succeeds.
     */
    private fun offlineJudge(title: String, text: String, key: String) {
        val haystack = "$title\n$text"
        for (word in OFFLINE_JUNK_KEYWORDS) {
            if (haystack.contains(word)) {
                Log.w(TAG, "OFFLINE_CANCEL key=$key matched=$word")
                cancelWithRetry(key)
                return
            }
        }
    }

    /** Cancels a key, retrying once after [OFFLINE_RETRY_DELAY_MS] on failure. */
    private fun cancelWithRetry(key: String) {
        try {
            cancelNotification(key)
            return
        } catch (e: Exception) {
            Log.w(TAG, "CANCEL_RETRY key=$key ${e.javaClass.simpleName}: ${e.message}")
        }
        try {
            Thread.sleep(OFFLINE_RETRY_DELAY_MS)
        } catch (_: InterruptedException) {
            return
        }
        try {
            cancelNotification(key)
        } catch (e: Exception) {
            Log.w(TAG, "CANCEL_DROP key=$key ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun fetchCancels() {
        try {
            val url = URL(endpoint.substringBeforeLast('/') + "/api/pending-cancels")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 3000
                readTimeout = 3000
            }
            val body = conn.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8)
            conn.disconnect()
            val cancels = JSONObject(body).getJSONArray("cancels")
            for (i in 0 until cancels.length()) {
                cancelWithRetry(cancels.getString(i))
            }
        } catch (e: Exception) {
            Log.w(TAG, "CANCEL_POLL_FAIL ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private companion object {
        const val DEFAULT_ENDPOINT = "http://127.0.0.1:14123/notify"
        const val POLL_INTERVAL_MS = 1500L
        const val OFFLINE_THRESHOLD = 3
        const val OFFLINE_RETRY_DELAY_MS = 300L

        // Subset of the plugin default junk rules, kept in sync manually.
        // Used only when the host is unreachable; the plugin rules remain the
        // authoritative filter while connected.
        val OFFLINE_JUNK_KEYWORDS = arrayOf(
            "广告", "推广",
            "限时特惠", "限时优惠", "特惠", "大促", "秒杀", "清仓",
            "优惠券", "领券", "返现",
            "贷款", "借款", "放款", "网贷",
            "中奖", "抽奖", "领红包",
            "兼职", "刷单", "日结",
        )
    }
}
