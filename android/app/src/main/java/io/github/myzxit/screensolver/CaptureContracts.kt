package io.github.myzxit.screensolver

/** 화면 공유 상태 머신 (웹 UI 의 상태 표시와 1:1 대응). */
enum class CaptureState {
    IDLE,
    REQUESTING_PERMISSION,
    CAPTURING,      // 캡처는 시작됐지만 아직 첫 프레임 전
    MONITORING,     // 변화를 지켜보는 중
    CHANGE_DETECTED,
    WAITING_STABLE,
    ANALYZING,      // 웹 계층이 AI 분석 중이라고 알려준 상태
    ERROR,
    STOPPED,
}

/** 프레임을 웹으로 올린 이유. */
enum class FrameReason { AUTO, MANUAL }

/**
 * 자동 분석 튜닝값. 웹 설정 화면에서 내려옵니다.
 *
 * @param sampleIntervalMs 화면을 확인하는 주기
 * @param sensitivity 새 문제로 볼 변화량(%) 임계값
 * @param stableMs 이 시간만큼 화면이 멎어야 "안정" 으로 봅니다
 * @param minAnalysisIntervalMs 자동 분석 사이의 최소 간격 (API 비용 보호)
 * @param maxWidth 웹으로 올릴 이미지의 최대 가로 픽셀
 * @param jpegQuality JPEG 품질
 * @param autoAnalyze 자동 분석 사용 여부
 */
data class CaptureConfig(
    val sampleIntervalMs: Long = 1500,
    val sensitivity: Float = 6f,
    val stableMs: Long = 1000,
    val minAnalysisIntervalMs: Long = 5000,
    val maxWidth: Int = 1400,
    val jpegQuality: Int = 80,
    val autoAnalyze: Boolean = true,
)

/** 웹으로 올리는 한 장의 프레임. */
data class CaptureFrame(
    val jpegBase64: String,
    val width: Int,
    val height: Int,
    val sourceWidth: Int,     // 원본 화면 픽셀 (좌표 변환용)
    val sourceHeight: Int,
    val rotationPortrait: Boolean,
    val reason: FrameReason,
    val changePercent: Float,
)

/**
 * 서비스 → 액티비티 전달 통로.
 * 같은 프로세스 안이므로 단순 콜백으로 충분하고, 브로드캐스트보다 지연이 적습니다.
 */
object CaptureBus {
    @Volatile var state: CaptureState = CaptureState.IDLE
        private set

    @Volatile var lastError: String? = null
        private set

    /** 마지막으로 관측된 화면 변화량(%). UI 미터용. */
    @Volatile var changePercent: Float = 0f

    var onState: ((CaptureState, String?) -> Unit)? = null
    var onFrame: ((CaptureFrame) -> Unit)? = null
    var onChange: ((Float) -> Unit)? = null

    fun publishState(next: CaptureState, error: String? = null) {
        state = next
        lastError = error
        onState?.invoke(next, error)
    }

    fun publishFrame(frame: CaptureFrame) {
        changePercent = frame.changePercent
        onFrame?.invoke(frame)
    }

    fun publishChange(percent: Float) {
        changePercent = percent
        onChange?.invoke(percent)
    }

    fun reset() {
        state = CaptureState.IDLE
        lastError = null
        changePercent = 0f
    }
}
