// 서버 프록시 감지 (§2B, §67)
//
// 이 앱은 두 가지 방식으로 AI 를 부를 수 있습니다.
//   1) 직접 호출 — 사용자의 API 키를 브라우저에서 바로 씁니다. (GitHub Pages·앱)
//   2) 서버 프록시 — 키가 서버 환경변수에만 있고 브라우저는 키를 모릅니다. (Netlify)
//
// 함수가 없는 환경(GitHub Pages, Android 앱 내장 자산)에서는 조회가 실패하는데,
// 그건 오류가 아니라 "프록시 없음" 입니다. 조용히 1) 로 동작합니다.

/** @type {{proxy: boolean, configured: Record<string, boolean>}} */
let status = { proxy: false, configured: {} };
let probed = null;

const CACHE_KEY = 'screensolver.proxy.v1';

/**
 * 서버 프록시가 있는지 확인합니다.
 *
 * 함수가 없는 호스팅(GitHub Pages 등)에서는 이 조회가 404 가 되는데, 매번
 * 부를 필요는 없으므로 결과를 이 세션 동안 기억합니다. 탭을 닫으면 지워지므로
 * 나중에 서버에 키를 추가해도 다음 세션에서 곧바로 반영됩니다.
 */
export function probeProxy() {
  if (probed) return probed;

  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      status = JSON.parse(cached);
      probed = Promise.resolve(status);
      return probed;
    }
  } catch { /* 세션 저장소를 못 쓰면 그냥 조회합니다 */ }

  probed = (async () => {
    try {
      // 함수가 없으면 정적 호스팅이 404(또는 index.html)를 돌려줍니다.
      const res = await fetch('/api/ai-status', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      const type = res.headers.get('content-type') || '';
      // 정적 호스팅의 404 페이지(HTML)를 응답으로 오해하지 않도록 함께 확인합니다.
      if (res.ok && type.includes('application/json')) {
        const body = await res.json();
        if (body && body.proxy) status = { proxy: true, configured: body.configured || {} };
      }
    } catch {
      /* 프록시 없음 — 직접 호출로 갑니다 */
    }
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(status)); } catch { /* 무시 */ }
    return status;
  })();
  return probed;
}

/** 마지막으로 확인된 프록시 상태 (동기 조회용) */
export function proxyStatus() {
  return status;
}

/** 이 프로바이더를 서버 키로 부를 수 있는지 */
export function proxyHasKey(provider) {
  return Boolean(status.proxy && status.configured[provider]);
}
