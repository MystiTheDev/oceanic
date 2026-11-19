package io.github.mystithedev.oceanic

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

@InvokeArg
class InstallArgs {
  lateinit var url: String
  lateinit var onProgress: Channel
}

/** Downloads a release APK to the cache and hands it to the system installer. */
@TauriPlugin
class UpdaterPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun install(invoke: Invoke) {
    val args = invoke.parseArgs(InstallArgs::class.java)
    // "Install unknown apps" is off for Oceanic: open that setting instead.
    if (!activity.packageManager.canRequestPackageInstalls()) {
      activity.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
      )
      invoke.reject("needs-permission")
      return
    }
    thread {
      try {
        val file = File(activity.cacheDir, "update.apk")
        val conn = URL(args.url).openConnection() as HttpURLConnection // follows GitHub's redirect
        val total = conn.contentLengthLong
        var done = 0L
        var last = -1
        conn.inputStream.use { input ->
          file.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              done += n
              val pct = if (total > 0) (done * 100 / total).toInt() else -1
              if (pct != last) {
                last = pct
                args.onProgress.send(JSObject().put("percent", pct))
              }
            }
          }
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        activity.startActivity(
          Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: "Download failed")
      }
    }
  }
}
