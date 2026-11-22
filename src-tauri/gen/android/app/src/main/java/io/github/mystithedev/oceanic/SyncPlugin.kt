package io.github.mystithedev.oceanic

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class MulticastArgs {
  var on: Boolean = false
}

/**
 * LAN sync helpers: multicast lock for mDNS, device name, current Wi-Fi,
 * the "Syncing notes…" notification, and the battery/location prompts.
 */
@TauriPlugin
class SyncPlugin(private val activity: Activity) : Plugin(activity) {
  private var lock: WifiManager.MulticastLock? = null
  private val ctx: Context get() = activity.applicationContext

  @Command
  fun multicast(invoke: Invoke) {
    val on = invoke.parseArgs(MulticastArgs::class.java).on
    if (on && lock == null) {
      val wifi = ctx.getSystemService(Context.WIFI_SERVICE) as WifiManager
      lock = wifi.createMulticastLock("oceanic-sync").apply { setReferenceCounted(false); acquire() }
    } else if (!on) {
      lock?.release()
      lock = null
    }
    invoke.resolve()
  }

  /** The phone's name from Settings → About, else its model. */
  @Command
  fun deviceName(invoke: Invoke) {
    val name = Settings.Global.getString(activity.contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL
    invoke.resolve(JSObject().put("name", name))
  }

  /** Current Wi-Fi: ssid (needs location), bssid, gateway. Empty strings when unknown. */
  @Suppress("DEPRECATION")
  @Command
  fun network(invoke: Invoke) {
    val wifi = ctx.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val info = wifi.connectionInfo
    val ssid = info?.ssid?.trim('"')?.takeUnless { it == "<unknown ssid>" } ?: ""
    val bssid = info?.bssid?.takeUnless { it == "02:00:00:00:00:00" } ?: ""
    val g = wifi.dhcpInfo?.gateway ?: 0
    val gw = if (g == 0) "" else "${g and 255}.${g shr 8 and 255}.${g shr 16 and 255}.${g shr 24 and 255}"
    invoke.resolve(JSObject().put("ssid", ssid).put("bssid", bssid).put("gateway", gw))
  }

  @SuppressLint("MissingPermission")
  @Command
  fun syncing(invoke: Invoke) {
    val on = invoke.parseArgs(MulticastArgs::class.java).on
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (on) {
      if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("sync", "Sync", NotificationManager.IMPORTANCE_LOW))
      val n = NotificationCompat.Builder(ctx, "sync")
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setContentTitle("Syncing notes…")
        .setOngoing(true)
        .build()
      nm.notify(47823, n)
    } else nm.cancel(47823)
    invoke.resolve()
  }

  /** Whether the location permission (for Wi-Fi names) is granted. */
  @Command
  fun hasLocation(invoke: Invoke) {
    val ok = ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    invoke.resolve(JSObject().put("ok", ok))
  }

  @Command
  fun askLocation(invoke: Invoke) {
    ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 47823)
    invoke.resolve()
  }

  /** True when Android won't restrict Oceanic in the background. */
  @Command
  fun batteryOk(invoke: Invoke) {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    invoke.resolve(JSObject().put("ok", pm.isIgnoringBatteryOptimizations(ctx.packageName)))
  }

  @SuppressLint("BatteryLife")
  @Command
  fun askBattery(invoke: Invoke) {
    activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")))
    invoke.resolve()
  }
}
