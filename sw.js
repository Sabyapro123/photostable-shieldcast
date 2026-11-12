// ShieldCast service worker. It keeps the app shell on the phone, so the plan opens even on a weak signal.
// The forecast always tries the network first, because yesterday's UV is not today's UV.
const CACHE = "shieldcast-v3";
const SHELL = ["./", "index.html", "css/style.css", "js/app.js", "js/plan.js", "js/data.js", "js/forecast.js", "js/agents.js", "vendor/qrcode.min.js", "vendor/jsQR.js", "icons/icon-192.png", "manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // forecasts and the optional AI engine go straight to the network
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match("index.html"))));
});
