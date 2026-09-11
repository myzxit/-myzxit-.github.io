package io.github.myzxit.screensolver

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.webkit.WebViewAssetLoader

/**
 * 웹 UI 를 담는 호스트 액티비티.
 *
 * 웹 자산을 file:// 이 아니라 https://appassets.androidplatform.net 으로 제공합니다.
 * 그래야 오리진이 생겨 AI API 로의 CORS 요청과 localStorage 가 정상 동작합니다.
 */
class MainActivity : AppCompatActivity() {

    private companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val START_URL = "$ORIGIN/assets/www/index.html"
    }

    private lateinit var webView: WebView
    private lateinit var bridge: ScreenSolverBridge
    private lateinit var assetLoader: WebViewAssetLoader

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            if (result.resultCode == RESULT_OK && data != null) {
                ScreenCaptureService.start(this, result.resultCode, data)
            } else {
                // 사용자가 시스템 권한창에서 취소한 경우
                CaptureBus.publishState(CaptureState.IDLE, null)
                bridge.emitError("화면 공유가 취소되었습니다.")
            }
        }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* 거부해도 캡처는 진행 */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true          // localStorage (설정·API 키 저장)
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    // 앱 자산 밖의 링크(키 발급 페이지 등)는 외부 브라우저로 보냅니다.
                    val url = request.url
                    if (url.toString().startsWith(ORIGIN)) return false
                    openExternally(url)
                    return true
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    bridge.onPageReady()
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    // 카메라 탭에서 getUserMedia 를 쓸 때 들어옵니다.
                    val wantsCamera = request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                    if (!wantsCamera) { request.deny(); return }
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(request.resources)
                    } else {
                        cameraPermission.launch(Manifest.permission.CAMERA)
                        request.deny()   // 권한 획득 후 사용자가 다시 시도합니다
                    }
                }
            }
        }
        setContentView(webView)

        bridge = ScreenSolverBridge(this, webView)
        webView.addJavascriptInterface(bridge, "ScreenSolverAndroidNative")
        webView.loadUrl(START_URL)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        onBackPressedDispatcher.addCallback(this, backHandler)
    }

    private val cameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) Toast.makeText(this, R.string.camera_granted, Toast.LENGTH_SHORT).show()
        }

    /**
     * Android 뒤로가기.
     * 웹이 처리할 게 있으면(설정 열림·영역 지정 중) 웹에 먼저 물어보고,
     * 공유 중이라면 실수로 종료되지 않게 한 번 확인합니다.
     */
    private val backHandler = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            bridge.askWebToHandleBack { handled ->
                if (handled) return@askWebToHandleBack
                if (ScreenCaptureService.running) {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle(R.string.back_while_sharing_title)
                        .setMessage(R.string.back_while_sharing_message)
                        .setNegativeButton(R.string.keep_sharing, null)
                        .setPositiveButton(R.string.stop_and_exit) { _, _ ->
                            ScreenCaptureService.stop(this@MainActivity)
                            finish()
                        }
                        .show()
                } else {
                    finish()
                }
            }
        }
    }

    /** 화면 공유 시스템 권한창을 띄웁니다. 반드시 사용자가 직접 허용해야 합니다. */
    fun requestScreenCapture() {
        val manager = getSystemService<MediaProjectionManager>()
        if (manager == null) {
            bridge.emitError("이 기기는 화면 공유를 지원하지 않습니다.")
            return
        }
        CaptureBus.publishState(CaptureState.REQUESTING_PERMISSION)
        projectionLauncher.launch(manager.createScreenCaptureIntent())
    }

    private fun openExternally(url: Uri) {
        try {
            startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, url))
        } catch (_: Exception) {
            Toast.makeText(this, R.string.cannot_open_link, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroy() {
        bridge.detach()
        webView.destroy()
        super.onDestroy()
    }
}
