// PWA 설치 · 공유받은 스크린샷 수신 · 클립보드 붙여넣기
//
// 모바일 브라우저는 폰 화면을 직접 캡처할 수 없습니다(getDisplayMedia 미지원).
// 대신 홈 화면에 설치해 두면 스크린샷 → 공유 → ScreenSolver 로 보내는 것만으로
// 곧바로 풀이가 시작됩니다.

const CACHE = 'screensolver-v1';
const SHARED_KEY = './__shared-image';

export const PWA_SUPPORTED = 'serviceWorker' in navigator;

/** 서비스 워커 등록. 실패해도 앱 동작에는 영향이 없습니다. */
export function registerServiceWorker() {
  if (!PWA_SUPPORTED) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/**
 * 공유 대상으로 들어온 이미지를 꺼냅니다. (?shared=1 로 열렸을 때)
 * @returns {Promise<File|null>}
 */
export async function takeSharedImage() {
  if (!new URLSearchParams(location.search).has('shared')) return null;
  history.replaceState({}, '', location.pathname); // 새로고침 시 중복 처리 방지

  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(SHARED_KEY);
    if (!res) return null;
    await cache.delete(SHARED_KEY);
    const blob = await res.blob();
    if (!blob.size) return null;
    return new File([blob], 'shared.png', { type: blob.type || 'image/png' });
  } catch {
    return null;
  }
}

/** 붙여넣기(Ctrl/⌘+V)로 들어온 이미지를 콜백으로 넘깁니다. */
export function onPastedImage(handler) {
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      e.preventDefault();
      handler(file);
    }
  });
}

/**
 * 설치 버튼 배선. 설치 가능할 때만 버튼을 보여 줍니다.
 * @param {HTMLElement} button
 */
export function wireInstallButton(button) {
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    button.hidden = true;
  });

  button.addEventListener('click', async () => {
    if (!deferred) return;
    button.disabled = true;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      deferred = null;
      button.disabled = false;
      button.hidden = true;
    }
  });
}

/** 이미 홈 화면 앱으로 실행 중인지 */
export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
