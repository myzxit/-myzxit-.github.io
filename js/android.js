// Android 네이티브 브리지 (ScreenSolver Android 앱에서만 활성)
//
// 웹 브라우저에는 폰 화면을 캡처할 방법이 없습니다(getDisplayMedia 미지원).
// Android 앱에서는 MediaProjection 으로 전체 화면을 캡처하고, 네이티브가
// 변화 감지·안정화·중복 판정까지 끝낸 "분석할 가치가 있는 프레임"만 올려 줍니다.
//
// 네이티브 계약: android/app/.../ScreenSolverBridge.kt

/** 웹과 네이티브가 맞춰야 하는 브리지 계약 버전 */
export const BRIDGE_VERSION = 1;

const native = typeof window !== 'undefined' ? window.ScreenSolverAndroidNative : undefined;

/** ScreenSolver Android 앱 안에서 실행 중인지 */
export const IS_ANDROID_APP = !!native;

/**
 * 네이티브 버전이 웹과 다르면 그 버전을 반환합니다(같으면 null).
 * 앱만 업데이트되거나 웹만 업데이트된 상태를 사용자에게 알리기 위한 것입니다.
 */
export function bridgeMismatch() {
  if (!native) return null;
  try {
    const v = native.getBridgeVersion();
    return v === BRIDGE_VERSION ? null : v;
  } catch {
    return null;
  }
}

function parse(json) {
  try { return JSON.parse(json); } catch { return {}; }
}

export const androidBridge = {
  /** 시스템 화면 공유 권한창을 띄우고 캡처를 시작합니다. */
  start() { native?.startScreenCapture(); },

  /** 캡처를 중지하고 네이티브 리소스를 모두 해제합니다. */
  stop() { native?.stopScreenCapture(); },

  /** ⚡ 지금 풀기 — 판정을 건너뛰고 다음 프레임을 즉시 올리게 합니다. */
  requestFrame() { native?.requestFrame(); },

  /** 대기 중인 프레임을 data URL 로 가져옵니다. 없으면 null. */
  takeFrame() {
    const base64 = native?.takeFrame?.();
    return base64 ? `data:image/jpeg;base64,${base64}` : null;
  },

  /** { state, running, changePercent, error } */
  status() {
    if (!native) return { running: false, state: 'idle', changePercent: 0 };
    return parse(native.getStatus());
  },

  /** 웹 설정값을 네이티브 판정기에 반영합니다. */
  setConfig(config) {
    try { native?.setConfig(JSON.stringify(config)); } catch { /* 무시 */ }
  },

  /** 네이티브 이벤트 구독. 반환값을 호출하면 해제됩니다. */
  on(event, handler) {
    const name = `screensolver:${event}`;
    const listener = (e) => handler(parse(e.detail));
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  },
};

/**
 * 네이티브가 뒤로가기 처리를 물어볼 때 쓰는 창구.
 * true 를 돌려주면 네이티브는 아무 것도 하지 않습니다.
 * (§71 의 공개 API 이름도 함께 노출합니다.)
 */
export function exposePublicApi({ onBack }) {
  if (!IS_ANDROID_APP) return;
  window.ScreenSolverAndroid = {
    version: BRIDGE_VERSION,
    startScreenCapture: () => androidBridge.start(),
    stopScreenCapture: () => androidBridge.stop(),
    getStatus: () => androidBridge.status(),
    handleBack: () => {
      try { return !!onBack(); } catch { return false; }
    },
  };
}

/** 네이티브 상태 → 사용자에게 보여줄 문구 */
export const STATE_LABEL = {
  idle: '대기 중',
  requesting_permission: '권한 요청 중…',
  capturing: '화면 공유 중',
  monitoring: '화면 공유 중',
  change_detected: '변화 감지',
  waiting_stable: '안정화 중…',
  analyzing: '분석 중…',
  error: '오류',
  stopped: '대기 중',
};
