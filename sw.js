// ScreenSolver 서비스 워커
//
// 두 가지 일만 합니다.
//   1. 공유 대상(share_target): 스크린샷을 POST 로 받아 캐시에 넣고 앱으로 넘깁니다.
//   2. 네트워크 우선 캐시: 오프라인일 때만 마지막으로 받은 앱 파일을 씁니다.
//      (항상 네트워크를 먼저 시도하므로 배포한 새 버전이 캐시에 막히지 않습니다.)

const CACHE = 'screensolver-v1';
const SHARED_KEY = './__shared-image';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './js/store.js',
  './js/capture.js',
  './js/markdown.js',
  './js/prompt.js',
  './js/share.js',
  './js/android.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})            // 일부 파일이 없어도 설치는 계속합니다
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) 공유받은 스크린샷 — 캐시에 저장한 뒤 앱을 엽니다.
  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const file = form.get('image');
        if (file && file.size) {
          const cache = await caches.open(CACHE);
          await cache.put(SHARED_KEY, new Response(file, {
            headers: { 'content-type': file.type || 'image/png' },
          }));
          return Response.redirect('./?shared=1', 303);
        }
      } catch { /* 아래 기본 이동으로 */ }
      return Response.redirect('./', 303);
    })());
    return;
  }

  // 2) 그 외 GET 은 네트워크 우선, 실패하면 캐시.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 큰 배포 산출물(APK 등)은 캐시에 담지 않습니다. 저장 공간을 통째로 잡아먹고
  // 브라우저가 캐시 전체를 비워버릴 수 있습니다.
  const cacheable = !url.pathname.includes('/dist/');

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (cacheable && fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(request) || await caches.match('./index.html');
      if (cached) return cached;
      return new Response('오프라인입니다.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});
