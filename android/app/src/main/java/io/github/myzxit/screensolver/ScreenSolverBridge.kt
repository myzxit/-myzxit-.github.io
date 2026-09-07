package io.github.myzxit.screensolver

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * Web ↔ Native 브리지.
 *
 * JS 쪽 계약(js/android.js 와 일치):
 *   ScreenSolverAndroidNative.startScreenCapture() / stopScreenCapture() / getStatus()
 *   ScreenSolverAndroidNative.requestFrame() / takeFrame() / setConfig(json)
 *
 * 이벤트는 window 에 CustomEvent 로 올라갑니다.
 *   screensolver:screen-capture-started / -stopped / -frame / -error / -state
 *
 * 프레임 본문(base64)은 이벤트에 실어 보내지 않고 takeFrame() 으로 당겨 가게 합니다.
 * evaluateJavascript 로 수백 KB 문자열을 매번 넘기지 않기 위해서입니다.
 */
class ScreenSolverBridge(
    private val activity: MainActivity,
    private var webView: WebView?,
) {
    private val main = Handler(Looper.getMainLooper())

    /** 웹이 아직 가져가지 않은 프레임 한 장. 최신 것만 유지합니다. */
    @Volatile private var pendingFrame: CaptureFrame? = null

    @Volatile private var pageReady = false

    init {
        CaptureBus.onState = { state, error -> onStateChanged(state, error) }
        CaptureBus.onFrame = { frame -> onFrameReady(frame) }
        CaptureBus.onChange = { percent ->
            // 미터 갱신은 잦으므로 이벤트 대신 폴링(getStatus)으로 읽게 둡니다.
            CaptureBus.changePercent = percent
        }
    }

    fun detach() {
        CaptureBus.onState = null
        CaptureBus.onFrame = null
        CaptureBus.onChange = null
        webView = null
    }

    fun onPageReady() {
        pageReady = true
        // 앱으로 돌아왔을 때 웹이 현재 상태를 다시 그릴 수 있게 합니다.
        dispatch("screensolver:bridge-ready", JSONObject().put("version", BuildConfig.BRIDGE_VERSION))
        if (ScreenCaptureService.running) {
            dispatch("screensolver:screen-capture-started", statusJson())
        }
    }

    /* ── JS 에서 부르는 것들 ─────────────────────────── */

    @JavascriptInterface
    fun getBridgeVersion(): Int = BuildConfig.BRIDGE_VERSION

    @JavascriptInterface
    fun getStatus(): String = statusJson().toString()

    /**
     * 네트워크 상태. 와이파이가 아니어도 동작해야 하므로, 실제로 막는 것이
     * 무엇인지(연결 없음 / 데이터 절약)를 웹이 구분해 안내할 수 있게 합니다.
     */
    @JavascriptInterface
    fun getNetwork(): String {
        val json = JSONObject()
        try {
            val cm = activity.getSystemService(ConnectivityManager::class.java)
            val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
            val online = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
            json.put("online", online)
            json.put("metered", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) != true)
            json.put("wifi", caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
            json.put("cellular", caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true)
            // 데이터 절약이 켜져 있으면 종량제 회선에서 요청이 막힐 수 있습니다.
            json.put(
                "dataSaver",
                cm?.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED,
            )
        } catch (e: Exception) {
            json.put("error", e.message ?: "unknown")
        }
        return json.toString()
    }

    @JavascriptInterface
    fun startScreenCapture() {
        main.post {
            if (ScreenCaptureService.running) return@post
            activity.requestScreenCapture()
        }
    }

    @JavascriptInterface
    fun stopScreenCapture() {
        main.post { ScreenCaptureService.stop(activity) }
    }

    /** ⚡ 지금 풀기 — 다음 프레임을 판정 없이 올려 보냅니다. */
    @JavascriptInterface
    fun requestFrame() {
        ScreenCaptureService.requestManualFrame()
    }

    /** 대기 중인 프레임의 base64 를 가져갑니다. 한 번 가져가면 비웁니다. */
    @JavascriptInterface
    fun takeFrame(): String? {
        val frame = pendingFrame ?: return null
        pendingFrame = null
        return frame.jpegBase64
    }

    /** 웹 설정 화면의 값을 네이티브 판정기에 반영합니다. */
    @JavascriptInterface
    fun setConfig(json: String) {
        try {
            val o = JSONObject(json)
            val current = ScreenCaptureService.config
            ScreenCaptureService.applyConfig(
                CaptureConfig(
                    sampleIntervalMs = o.optLong("sampleIntervalMs", current.sampleIntervalMs),
                    sensitivity = o.optDouble("sensitivity", current.sensitivity.toDouble()).toFloat(),
                    stableMs = o.optLong("stableMs", current.stableMs),
                    minAnalysisIntervalMs = o.optLong("minAnalysisIntervalMs", current.minAnalysisIntervalMs),
                    maxWidth = o.optInt("maxWidth", current.maxWidth),
                    jpegQuality = o.optInt("jpegQuality", current.jpegQuality),
                    autoAnalyze = o.optBoolean("autoAnalyze", current.autoAnalyze),
                )
            )
        } catch (_: Exception) {
            // 잘못된 설정은 무시하고 기존 값을 유지합니다.
        }
    }

    /* ── 네이티브 → 웹 ──────────────────────────────── */

    private fun onStateChanged(state: CaptureState, error: String?) {
        val payload = statusJson()
        if (error != null) payload.put("error", error)
        when (state) {
            CaptureState.CAPTURING -> dispatch("screensolver:screen-capture-started", payload)
            CaptureState.STOPPED, CaptureState.IDLE -> dispatch("screensolver:screen-capture-stopped", payload)
            CaptureState.ERROR -> dispatch("screensolver:screen-capture-error", payload)
            else -> dispatch("screensolver:screen-capture-state", payload)
        }
    }

    private fun onFrameReady(frame: CaptureFrame) {
        pendingFrame = frame
        dispatch(
            "screensolver:screen-capture-frame",
            JSONObject()
                .put("reason", frame.reason.name.lowercase())
                .put("width", frame.width)
                .put("height", frame.height)
                .put("sourceWidth", frame.sourceWidth)
                .put("sourceHeight", frame.sourceHeight)
                .put("portrait", frame.rotationPortrait)
                .put("changePercent", frame.changePercent.toDouble()),
        )
    }

    fun emitError(message: String) {
        dispatch("screensolver:screen-capture-error", JSONObject().put("error", message))
    }

    /** 뒤로가기를 웹이 처리했는지 물어봅니다. */
    fun askWebToHandleBack(callback: (Boolean) -> Unit) {
        val view = webView
        if (view == null || !pageReady) { callback(false); return }
        view.evaluateJavascript(
            "(function(){try{return !!(window.ScreenSolverAndroid && window.ScreenSolverAndroid.handleBack());}catch(e){return false;}})()"
        ) { result -> callback(result == "true") }
    }

    private fun statusJson(): JSONObject = JSONObject()
        .put("bridgeVersion", BuildConfig.BRIDGE_VERSION)
        .put("state", CaptureBus.state.name.lowercase())
        .put("running", ScreenCaptureService.running)
        .put("changePercent", CaptureBus.changePercent.toDouble())
        .apply { CaptureBus.lastError?.let { put("error", it) } }

    private fun dispatch(event: String, detail: JSONObject) {
        main.post {
            val view = webView ?: return@post
            val js = "window.dispatchEvent(new CustomEvent(${quote(event)},{detail:${quote(detail.toString())}}));"
            view.evaluateJavascript(js, null)
        }
    }

    /** JS 문자열 리터럴로 안전하게 감싸기. */
    private fun quote(raw: String): String = JSONObject.quote(raw)
}
