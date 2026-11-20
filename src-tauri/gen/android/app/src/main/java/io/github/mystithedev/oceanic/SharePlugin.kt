package io.github.mystithedev.oceanic

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ShareArgs {
  lateinit var name: String
  lateinit var data: String // base64
}

/**
 * Export: hands a .ocean file to Android's share sheet.
 * Import: a .ocean / .omap opened from Files, WhatsApp, … is read here and
 * passed to the page (`pending` at launch, `file` event while running).
 */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
  private var pending: JSObject? = null

  override fun load(webView: WebView) {
    pending = read(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    read(intent)?.let { pending = it } // the page asks for it on resume
  }

  @Command
  fun pending(invoke: Invoke) {
    val ret = JSObject()
    ret.put("file", pending)
    pending = null
    invoke.resolve(ret)
  }

  @Command
  fun share(invoke: Invoke) {
    val args = invoke.parseArgs(ShareArgs::class.java)
    val dir = File(activity.cacheDir, "share").apply { deleteRecursively(); mkdirs() } // drop earlier exports
    val safe = args.name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    val file = File(dir, safe)
    file.writeBytes(Base64.decode(args.data, Base64.DEFAULT))
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND).apply {
      type = "application/octet-stream"
      putExtra(Intent.EXTRA_STREAM, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(Intent.createChooser(send, safe))
    invoke.resolve()
  }

  /** Settings → Import: the Files picker; resolves `{ file }` (null when cancelled). */
  @Command
  fun pick(invoke: Invoke) {
    val open = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
    }
    startActivityForResult(invoke, open, "picked")
  }

  @ActivityCallback
  fun picked(invoke: Invoke, result: ActivityResult) {
    val ret = JSObject()
    ret.put("file", result.data?.data?.let { readUri(it) })
    invoke.resolve(ret)
  }

  private fun read(intent: Intent?): JSObject? {
    if (intent?.action != Intent.ACTION_VIEW) return null
    val uri: Uri = intent.data ?: return null
    intent.action = null // a config change must not import it again
    return readUri(uri)
  }

  private fun readUri(uri: Uri): JSObject? {
    return try {
      val bytes = activity.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
      JSObject().apply {
        put("name", nameOf(uri))
        put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun nameOf(uri: Uri): String {
    activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0)?.let { return it }
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "Imported.ocean"
  }
}
