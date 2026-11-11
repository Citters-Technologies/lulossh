package com.lulossh.ssh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Servicio en primer plano mientras haya sesiones SSH abiertas. Evita que
 * Android congele la app (y corte el socket) al apagar la pantalla o pasar a
 * segundo plano, mantiene el wifi despierto y muestra una notificación para
 * volver a la sesión.
 */
class SshService : Service() {

    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val titles = intent?.getStringArrayListExtra(EXTRA_TITLES) ?: arrayListOf()
        val lastId = intent?.getStringExtra(EXTRA_LAST_ID)
        if (titles.isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, build(titles, lastId), type)
        acquireWifi()
        return START_NOT_STICKY
    }

    private fun build(titles: List<String>, lastId: String?): Notification {
        ensureChannel(this)
        val open = Intent(this, Class.forName("com.lulossh.MainActivity")).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            if (lastId != null) putExtra(EXTRA_OPEN_SESSION, lastId)
        }
        val pi = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = if (titles.size == 1) "Sesión SSH activa" else "${titles.size} sesiones SSH activas"
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(com.lulossh.R.drawable.ic_stat_terminal)
            .setContentTitle(title)
            .setContentText(titles.joinToString(" · "))
            .setStyle(NotificationCompat.BigTextStyle().bigText(titles.joinToString("\n")))
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    @Suppress("DEPRECATION")
    private fun acquireWifi() {
        if (wifiLock?.isHeld == true) return
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
        wifiLock = wm.createWifiLock(mode, "LuloSSH:ssh").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    override fun onDestroy() {
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "ssh_sessions"
        private const val NOTIFICATION_ID = 1
        private const val EXTRA_TITLES = "titles"
        private const val EXTRA_LAST_ID = "lastId"
        const val EXTRA_OPEN_SESSION = "com.lulossh.OPEN_SESSION"

        /** Sesión pedida desde la notificación; JS la recoge al volver. */
        @Volatile var pendingOpen: String? = null

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL, "Sesiones SSH", NotificationManager.IMPORTANCE_LOW).apply {
                        description = "Mantiene las conexiones abiertas en segundo plano"
                        setShowBadge(false)
                    },
                )
            }
        }

        /** Arranca, actualiza o para el servicio según las sesiones abiertas. */
        fun sync(ctx: Context, titles: List<String>, lastId: String?) {
            val i = Intent(ctx, SshService::class.java)
            if (titles.isEmpty()) {
                ctx.stopService(i)
                return
            }
            i.putStringArrayListExtra(EXTRA_TITLES, ArrayList(titles))
            i.putExtra(EXTRA_LAST_ID, lastId)
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (_: Exception) {
                // Android 12+ no deja arrancarlo desde segundo plano; se reintenta al volver.
            }
        }

        fun handleIntent(intent: Intent?) {
            intent?.getStringExtra(EXTRA_OPEN_SESSION)?.let {
                pendingOpen = it
                intent.removeExtra(EXTRA_OPEN_SESSION)
            }
        }
    }
}
