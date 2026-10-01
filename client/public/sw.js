// Service worker for "Install app" (PWA). It deliberately caches nothing, so every deploy is picked up
// immediately; when the network is down, page navigations get a small offline message instead of the
// browser's error page. API calls, images and assets always go straight to the network.
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · Rivoora Textile</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#fff;color:#0f172a;text-align:center;padding:24px}
h1{font-size:20px;margin:0 0 8px}p{color:#64748b;margin:0 0 20px}button{background:#8B1E3F;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600}</style>
</head><body><div><h1>You're offline</h1><p>Check the internet connection and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ),
  );
});
