const CACHE_NAME = 'driver-app-v1';

// 설치 시 기본 파일 캐싱
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './index.html',
        '../css/style.css'
      ]).catch(err => console.log('캐시 저장 에러(무시가능):', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// 네트워크 우선 (Network First) 전략 - 기사앱은 항상 최신 데이터가 필요하므로
self.addEventListener('fetch', (e) => {
  // API 요청 등은 캐싱하지 않고 무조건 통과
  if (e.request.url.includes('script.google.com') || e.request.method !== 'GET') {
    return;
  }
  
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
