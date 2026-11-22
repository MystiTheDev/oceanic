package io.github.mystithedev.oceanic

import android.app.Activity
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
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

/** LAN sync helpers: Android drops mDNS packets unless a multicast lock is held. */
@TauriPlugin
class SyncPlugin(private val activity: Activity) : Plugin(activity) {
  private var lock: WifiManager.MulticastLock? = null

  @Command
  fun multicast(invoke: Invoke) {
    val on = invoke.parseArgs(MulticastArgs::class.java).on
    if (on && lock == null) {
      val wifi = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
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
}
