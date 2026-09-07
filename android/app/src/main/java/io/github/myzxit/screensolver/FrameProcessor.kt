package io.github.myzxit.screensolver

import android.graphics.Bitmap
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.abs

/**
 * 캡처된 프레임을 판정하는 곳. 모든 프레임을 AI 로 보내지 않기 위한 핵심입니다.
 *
 *   프레임 → 축소 시그니처 → 변화량 → 안정화 대기 → 중복(해시) 검사 → 통과한 것만 전송
 *
 * 네이티브에서 먼저 걸러내므로 WebView 로 넘어가는 프레임 수가 크게 줄고,
 * JS 메인 스레드와 API 호출량이 함께 절약됩니다.
 */
class FrameProcessor(@Volatile var config: CaptureConfig) {

    private companion object {
        const val SIG = 40           // 변화 감지용 축소 크기 (40x40 그레이스케일)
        const val HASH_EDGE = 9      // dHash 계산용 가로 (9x8 → 64bit)
        const val HASH_ROWS = 8
        const val DUPLICATE_DISTANCE = 5   // 이 이하의 해밍 거리면 같은 문제로 봅니다
    }

    private var lastSignature: ByteArray? = null       // 직전 샘플
    private var analyzedSignature: ByteArray? = null   // 마지막으로 분석에 쓴 프레임
    private var analyzedHash: Long? = null

    private var changeSeenAt = 0L      // 변화가 처음 감지된 시각
    private var stableSince = 0L       // 화면이 멎기 시작한 시각
    private var pendingChange = false
    private var lastAnalysisAt = 0L
    private var lastSampleAt = 0L

    /** 상태가 바뀔 때만 알려 주기 위해 직전 상태를 들고 있습니다. */
    private var reportedState: CaptureState? = null

    fun reset() {
        lastSignature = null
        analyzedSignature = null
        analyzedHash = null
        pendingChange = false
        changeSeenAt = 0
        stableSince = 0
        lastAnalysisAt = 0
        lastSampleAt = 0
        reportedState = null
    }

    /** 마지막 샘플로부터 확인 주기가 지났는지 (지나지 않은 프레임은 버립니다). */
    fun shouldSample(now: Long): Boolean = now - lastSampleAt >= config.sampleIntervalMs

    /**
     * 한 프레임을 판정합니다.
     * @return 전송해야 할 프레임, 없으면 null
     */
    fun process(bitmap: Bitmap, now: Long, manual: Boolean): CaptureFrame? {
        lastSampleAt = now
        val signature = signatureOf(bitmap)

        val sinceLast = diffPercent(signature, lastSignature)
        val sinceAnalyzed = diffPercent(signature, analyzedSignature)
        lastSignature = signature
        CaptureBus.publishChange(sinceAnalyzed)

        // 수동 요청(⚡ 지금 풀기)은 모든 판정을 건너뜁니다.
        if (manual) return emit(bitmap, signature, sinceAnalyzed, FrameReason.MANUAL, now)

        if (!config.autoAnalyze) {
            report(CaptureState.MONITORING)
            return null
        }

        if (sinceAnalyzed >= config.sensitivity) {
            if (!pendingChange) {
                pendingChange = true
                changeSeenAt = now
                stableSince = 0
                report(CaptureState.CHANGE_DETECTED)
            }
        }

        if (!pendingChange) {
            report(CaptureState.MONITORING)
            return null
        }

        // 화면이 아직 움직이는 중이면 안정화 타이머를 다시 시작합니다.
        val moving = sinceLast >= config.sensitivity / 3f
        if (moving) {
            stableSince = 0
            report(CaptureState.WAITING_STABLE)
            return null
        }
        if (stableSince == 0L) stableSince = now
        if (now - stableSince < config.stableMs) {
            report(CaptureState.WAITING_STABLE)
            return null
        }

        // 비용 보호: 자동 분석 사이 최소 간격
        if (now - lastAnalysisAt < config.minAnalysisIntervalMs) {
            report(CaptureState.WAITING_STABLE)
            return null
        }

        // 같은 문제를 다시 보내지 않습니다.
        val hash = dHash(bitmap)
        val previous = analyzedHash
        if (previous != null && hammingDistance(hash, previous) <= DUPLICATE_DISTANCE) {
            pendingChange = false
            stableSince = 0
            analyzedSignature = signature   // 기준을 갱신해 같은 화면으로 계속 트리거되지 않게
            report(CaptureState.MONITORING)
            return null
        }

        analyzedHash = hash
        pendingChange = false
        stableSince = 0
        return emit(bitmap, signature, sinceAnalyzed, FrameReason.AUTO, now)
    }

    private fun emit(
        bitmap: Bitmap,
        signature: ByteArray,
        change: Float,
        reason: FrameReason,
        now: Long,
    ): CaptureFrame {
        analyzedSignature = signature
        lastAnalysisAt = now
        if (reason == FrameReason.MANUAL) analyzedHash = dHash(bitmap)

        val scaled = scaleToWidth(bitmap, config.maxWidth)
        val jpeg = ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, config.jpegQuality, out)
            out.toByteArray()
        }
        val frame = CaptureFrame(
            jpegBase64 = Base64.encodeToString(jpeg, Base64.NO_WRAP),
            width = scaled.width,
            height = scaled.height,
            sourceWidth = bitmap.width,
            sourceHeight = bitmap.height,
            rotationPortrait = bitmap.height >= bitmap.width,
            reason = reason,
            changePercent = change,
        )
        if (scaled !== bitmap) scaled.recycle()
        report(CaptureState.ANALYZING)
        return frame
    }

    private fun report(state: CaptureState) {
        if (reportedState != state) {
            reportedState = state
            CaptureBus.publishState(state)
        }
    }

    /* ── 이미지 유틸 ────────────────────────────────── */

    private fun scaleToWidth(src: Bitmap, maxWidth: Int): Bitmap {
        if (src.width <= maxWidth) return src
        val ratio = maxWidth.toFloat() / src.width
        return Bitmap.createScaledBitmap(src, maxWidth, (src.height * ratio).toInt().coerceAtLeast(1), true)
    }

    /** 40×40 그레이스케일 시그니처. */
    private fun signatureOf(src: Bitmap): ByteArray {
        val small = Bitmap.createScaledBitmap(src, SIG, SIG, true)
        val pixels = IntArray(SIG * SIG)
        small.getPixels(pixels, 0, SIG, 0, 0, SIG, SIG)
        small.recycle()
        val out = ByteArray(SIG * SIG)
        for (i in pixels.indices) {
            val p = pixels[i]
            val gray = (((p shr 16 and 0xFF) * 299 + (p shr 8 and 0xFF) * 587 + (p and 0xFF) * 114) / 1000)
            out[i] = gray.toByte()
        }
        return out
    }

    /** 두 시그니처의 평균 차이를 0~100 으로. */
    private fun diffPercent(a: ByteArray, b: ByteArray?): Float {
        if (b == null || a.size != b.size) return 100f
        var sum = 0L
        for (i in a.indices) sum += abs((a[i].toInt() and 0xFF) - (b[i].toInt() and 0xFF))
        return sum.toFloat() / a.size / 255f * 100f
    }

    /** 중복 문제 판정용 64bit difference hash. */
    private fun dHash(src: Bitmap): Long {
        val small = Bitmap.createScaledBitmap(src, HASH_EDGE, HASH_ROWS, true)
        val pixels = IntArray(HASH_EDGE * HASH_ROWS)
        small.getPixels(pixels, 0, HASH_EDGE, 0, 0, HASH_EDGE, HASH_ROWS)
        small.recycle()
        var hash = 0L
        var bit = 0
        for (y in 0 until HASH_ROWS) {
            for (x in 0 until HASH_EDGE - 1) {
                val left = gray(pixels[y * HASH_EDGE + x])
                val right = gray(pixels[y * HASH_EDGE + x + 1])
                if (left > right) hash = hash or (1L shl bit)
                bit++
            }
        }
        return hash
    }

    private fun gray(p: Int) =
        ((p shr 16 and 0xFF) * 299 + (p shr 8 and 0xFF) * 587 + (p and 0xFF) * 114) / 1000

    private fun hammingDistance(a: Long, b: Long) = java.lang.Long.bitCount(a xor b)
}
