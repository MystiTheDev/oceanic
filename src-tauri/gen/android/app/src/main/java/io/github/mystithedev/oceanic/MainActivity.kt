package io.github.mystithedev.oceanic

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge stops the keyboard from resizing the page, so the editor
    // toolbar ended up under it. Shrink the content by the keyboard's height.
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(0, 0, 0, ime.bottom)
      insets
    }
  }

  // The WebView paints white until the page loads; match the splash's night colour.
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    webView.setBackgroundColor(0xFF020A18.toInt())
  }
}
