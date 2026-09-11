package io.github.myzxit.screensolver

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService

/**
 * 화면 캡처 포그라운드 서비스.
 *
 * Android 14(API 34)+ 는 순서가 중요합니다.
 *   1) 포그라운드 서비스를 mediaProjection 타입으로 먼저 올리고
 *   2) 그 다음에야 getMediaProjection() 으로 프로젝션을 만들 수 있습니다.
 * 이 순서를 지키지 않으면 SecurityException 이 납니다.
 *
 * 사용자가 홈으로 나가거나 다른 앱을 써도 이 서비스가 살아 있으므로 캡처가 이어집니다.
 */
class ScreenCaptureService : Service() {

    companion object {
        private const val TAG = "ScreenSolver/Service"
        const val ACTION_START = "io.github.myzxit.screensolver.START"
        const val ACTION_STOP = "io.github.myzxit.screensolver.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        private const val NOTIFICATION_ID = 4111

        /** 수동 캡처 요청 플래그 (⚡ 지금 풀기). */
        @Volatile private var manualRequested = false

        @Volatile var running = false
            private set

        /** 실행 중인 인스턴스. 설정을 실시간으로 반영하기 위해 참조를 들고 있습니다. */
        @Volatile private var instance: ScreenCaptureService? = null

        /** 다음 시작에도 쓰이는 현재 설정. */
        @Volatile var config: CaptureConfig = CaptureConfig()
            private set

        /**
         * ⚡ 지금 풀기.
         *
         * MediaProjection 은 화면이 바뀔 때만 새 프레임을 만듭니다. 정지된 화면에서
         * 다음 프레임을 기다리면 영영 오지 않을 수 있으므로, 들고 있던 마지막
         * 프레임으로 즉시 응답합니다. (아직 한 장도 없으면 다음 프레임을 씁니다.)
         */
        fun requestManualFrame() {
            val service = instance
            if (service == null) { manualRequested = true; return }
            val posted = service.handler?.post { service.emitFromCache() } ?: false
            if (!posted) manualRequested = true
        }

        /** 웹 설정 화면에서 내려온 값을 즉시 반영합니다. */
        fun applyConfig(next: CaptureConfig) {
            config = next
            instance?.processor?.config = next
        }

        fun start(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, ScreenCaptureService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, data)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ScreenCaptureService::class.java).apply { action = ACTION_STOP }
            context.startService(intent)
        }
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var thread: HandlerThread? = null
    internal var handler: Handler? = null
        private set

    internal val processor = FrameProcessor(config)

    /**
     * 마지막으로 받아 둔 화면 한 장.
     * 수동 캡처를 즉시 처리하기 위한 것으로, 항상 한 장만 유지합니다.
     */
    private var lastFrame: Bitmap? = null
    private var widthPx = 0
    private var heightPx = 0
    private var densityDpi = 0

    /** 회전·화면 크기 변화를 감지해 VirtualDisplay 를 다시 만듭니다. */
    private val configCallbacks = object : ComponentCallbacks2 {
        override fun onConfigurationChanged(newConfig: Configuration) {
            if (projection != null) recreateVirtualDisplay()
        }
        override fun onLowMemory() {}
        override fun onTrimMemory(level: Int) {}
    }

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            // 사용자가 시스템 UI 에서 공유를 중지한 경우에도 여기로 옵니다.
            log("MediaProjection.onStop")
            teardown(CaptureState.STOPPED, null)
            stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        processor.config = config
        registerComponentCallbacks(configCallbacks)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                teardown(CaptureState.STOPPED, null)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                @Suppress("DEPRECATION")
                val data: Intent? =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                    else intent.getParcelableExtra(EXTRA_RESULT_DATA)

                if (data == null) {
                    fail("화면 공유 권한 정보를 받지 못했습니다.")
                    stopSelf()
                    return START_NOT_STICKY
                }
                startCapture(resultCode, data)
            }
        }
        return START_NOT_STICKY
    }

    private fun startCapture(resultCode: Int, data: Intent) {
        // 1) 먼저 포그라운드로 (Android 14+ 필수 순서)
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } catch (e: Exception) {
            fail("포그라운드 서비스를 시작하지 못했습니다: ${e.message}")
            stopSelf()
            return
        }

        // 2) 그 다음 MediaProjection
        val manager = getSystemService<MediaProjectionManager>()
        if (manager == null) {
            fail("이 기기에서 화면 캡처를 사용할 수 없습니다.")
            stopSelf()
            return
        }
        try {
            projection = manager.getMediaProjection(resultCode, data)
        } catch (e: SecurityException) {
            fail("화면 공유 권한이 유효하지 않습니다. 다시 시도해 주세요.")
            stopSelf()
            return
        }
        val projection = projection
        if (projection == null) {
            fail("화면 공유를 시작하지 못했습니다.")
            stopSelf()
            return
        }

        thread = HandlerThread("screensolver-capture").also { it.start() }
        handler = Handler(thread!!.looper)
        projection.registerCallback(projectionCallback, handler)

        processor.reset()
        readMetrics()
        createVirtualDisplay()

        running = true
        CaptureBus.publishState(CaptureState.CAPTURING)
        log("capture started ${widthPx}x$heightPx")
    }

    private fun readMetrics() {
        val wm = getSystemService<WindowManager>() ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            widthPx = bounds.width()
            heightPx = bounds.height()
        } else {
            @Suppress("DEPRECATION")
            val metrics = android.util.DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }
            widthPx = metrics.widthPixels
            heightPx = metrics.heightPixels
        }
        densityDpi = resources.configuration.densityDpi
    }

    private fun createVirtualDisplay() {
        val projection = projection ?: return
        // ImageReader 는 2장만 유지해 메모리 사용을 억제합니다.
        val reader = ImageReader.newInstance(widthPx, heightPx, PixelFormat.RGBA_8888, 2)
        reader.setOnImageAvailableListener({ onImage(it) }, handler)
        imageReader = reader
        virtualDisplay = projection.createVirtualDisplay(
            "ScreenSolver",
            widthPx,
            heightPx,
            densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler,
        )
    }

    /** 회전 등으로 화면 크기가 바뀌면 새 크기로 다시 만듭니다. */
    private fun recreateVirtualDisplay() {
        handler?.post {
            val previousW = widthPx
            val previousH = heightPx
            readMetrics()
            if (previousW == widthPx && previousH == heightPx) return@post
            log("display changed → ${widthPx}x$heightPx")
            virtualDisplay?.release()
            virtualDisplay = null
            imageReader?.close()
            imageReader = null
            processor.reset()   // 좌표·시그니처 기준이 달라졌으므로 초기화
            lastFrame?.recycle()
            lastFrame = null
            createVirtualDisplay()
        }
    }

    private fun onImage(reader: ImageReader) {
        var image: Image? = null
        try {
            image = reader.acquireLatestImage() ?: return
            val now = System.currentTimeMillis()
            val manual = manualRequested
            // 확인 주기가 지나지 않았고 수동 요청도 아니면 그냥 버립니다(비용·발열 억제).
            if (!manual && !processor.shouldSample(now)) return
            if (manual) manualRequested = false

            val bitmap = image.toBitmap() ?: return
            processor.process(bitmap, now, manual)?.let { CaptureBus.publishFrame(it) }
            // 직전 프레임을 버리고 이번 것을 보관합니다(항상 한 장만).
            lastFrame?.recycle()
            lastFrame = bitmap
        } catch (e: Exception) {
            Log.w(TAG, "frame drop: ${e.message}")
        } finally {
            image?.close()   // 누수 방지: 반드시 닫습니다
        }
    }

    /** 보관 중인 마지막 화면으로 즉시 한 장 내보냅니다. */
    private fun emitFromCache() {
        val bitmap = lastFrame
        if (bitmap == null || bitmap.isRecycled) {
            manualRequested = true   // 아직 받은 화면이 없으면 다음 프레임을 씁니다
            return
        }
        try {
            processor.process(bitmap, System.currentTimeMillis(), true)
                ?.let { CaptureBus.publishFrame(it) }
        } catch (e: Exception) {
            Log.w(TAG, "manual emit failed: ${e.message}")
            manualRequested = true
        }
    }

    /** ImageReader 의 row padding 을 잘라내고 Bitmap 으로 만듭니다. */
    private fun Image.toBitmap(): Bitmap? {
        val plane = planes.firstOrNull() ?: return null
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width
        val paddedWidth = width + rowPadding / pixelStride
        val padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(plane.buffer)
        if (paddedWidth == width) return padded
        val exact = Bitmap.createBitmap(padded, 0, 0, width, height)
        padded.recycle()
        return exact
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, ScreenCaptureService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, ScreenSolverApp.CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_capturing))
            .setSmallIcon(R.drawable.ic_stat_screensolver)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(open)
            .addAction(0, getString(R.string.notification_stop), stop)
            .build()
    }

    private fun fail(message: String) {
        Log.w(TAG, message)
        CaptureBus.publishState(CaptureState.ERROR, message)
    }

    private fun teardown(state: CaptureState, error: String?) {
        if (!running && projection == null) return
        running = false
        manualRequested = false
        try { virtualDisplay?.release() } catch (_: Exception) {}
        virtualDisplay = null
        try { imageReader?.close() } catch (_: Exception) {}
        imageReader = null
        try {
            projection?.unregisterCallback(projectionCallback)
            projection?.stop()
        } catch (_: Exception) {}
        projection = null
        thread?.quitSafely()
        thread = null
        handler = null
        lastFrame?.recycle()
        lastFrame = null
        processor.reset()
        CaptureBus.publishState(state, error)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        log("teardown → $state")
    }

    override fun onDestroy() {
        // 앱이 강제 종료돼도 여기서 리소스를 정리합니다.
        teardown(CaptureState.STOPPED, null)
        unregisterComponentCallbacks(configCallbacks)
        instance = null
        super.onDestroy()
    }

    private fun log(message: String) {
        if (BuildConfig.VERBOSE_LOG) Log.d(TAG, message)
    }
}
