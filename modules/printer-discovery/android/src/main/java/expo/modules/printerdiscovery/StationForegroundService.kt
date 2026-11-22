package expo.modules.printerdiscovery

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Android Foreground Service to keep the FunPrinting print station running
 * continuously in the background when the app is minimized or the screen is off.
 *
 * Keeps CPU active using a partial WakeLock while jobs are processing/printing.
 */
class StationForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "funprinting_station_channel"
    const val NOTIFICATION_ID = 4001
    const val ACTION_START = "expo.modules.printerdiscovery.ACTION_START"
    const val ACTION_STOP = "expo.modules.printerdiscovery.ACTION_STOP"
    const val EXTRA_TITLE = "extra_title"
    const val EXTRA_MESSAGE = "extra_message"

    @Volatile
    private var isRunning = false

    fun isServiceRunning(): Boolean = isRunning

    fun start(context: Context, title: String, message: String) {
      val intent = Intent(context, StationForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_MESSAGE, message)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: Exception) {
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, StationForegroundService::class.java).apply {
        action = ACTION_STOP
      }
      try {
        context.startService(intent)
      } catch (_: Exception) {
      }
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    try {
      val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
      wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FunPrinting:StationWakeLock")?.apply {
        setReferenceCounted(false)
      }
    } catch (_: Exception) {
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopStationService()
      return START_NOT_STICKY
    }

    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "FunPrinting Partner · Station Active"
    val message = intent?.getStringExtra(EXTRA_MESSAGE) ?: "Checking orders and printing in background"

    val notification = buildNotification(title, message)

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      wakeLock?.acquire(30 * 60 * 1000L) // 30 min max, refreshed while active
      isRunning = true
    } catch (_: Exception) {
      stopSelf()
    }

    return START_STICKY
  }

  private fun stopStationService() {
    isRunning = false
    try {
      wakeLock?.let {
        if (it.isHeld) it.release()
      }
    } catch (_: Exception) {
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  override fun onDestroy() {
    stopStationService()
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Print Station Background Service",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Keeps FunPrinting Partner connected to the queue and printers while minimized"
        setShowBadge(false)
      }
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      manager?.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(title: String, message: String): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent = if (launchIntent != null) {
      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }
      PendingIntent.getActivity(this, 0, launchIntent, flags)
    } else null

    val iconRes = applicationInfo.icon.let { if (it != 0) it else android.R.drawable.ic_menu_agenda }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    builder.setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(iconRes)
      .setOngoing(true)

    if (pendingIntent != null) {
      builder.setContentIntent(pendingIntent)
    }

    return builder.build()
  }
}
