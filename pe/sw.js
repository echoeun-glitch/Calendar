/* 오프라인에서도 열리도록 앱 파일만 캐시합니다. 데이터는 localStorage에 있어 캐시와 무관합니다.
   캐시 이름을 바꾸면 예전 캐시는 전부 지워지고 새 파일을 받습니다. */
const CACHE = 'pe-timetable-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  /* 설치할 때도 브라우저 캐시를 건너뛰고 서버에서 직접 받는다 */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u =>
        fetch(u, { cache: 'no-store' })
          .then(r => (r && r.ok) ? c.put(u, r) : null)
          .catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  /* 앱 파일(HTML·매니페스트)은 브라우저 캐시를 건너뛰고 항상 서버에서 먼저 받는다.
     GitHub Pages가 10분짜리 캐시 헤더를 주기 때문에, 이걸 안 하면
     새로고침을 해도 예전 파일이 그대로 돌아온다. */
  const isShell = req.mode === 'navigate' ||
                  /\.(html|webmanifest)$/.test(url.pathname) ||
                  url.pathname.endsWith('/');

  e.respondWith(
    fetch(isShell ? new Request(req, { cache: 'no-store' }) : req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
