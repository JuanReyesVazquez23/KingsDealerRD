/* ═══════════════════════════════════════════════
   KingsDealer — Service Worker  v1
   Estrategia:
   · Shell estático  → Cache First (CSS, JS, fuentes)
   · API /api/*      → Network Only (datos siempre frescos)
   · Imágenes        → Cache First con fallback
   · Navegación HTML → Network First con fallback a caché
   ═══════════════════════════════════════════════ */

const CACHE_SHELL   = "kd-shell-v1";
const CACHE_IMAGES  = "kd-images-v1";

// Assets del shell que se pre-cachean al instalar
const SHELL_ASSETS = [
  "/",
  "/static/css/style.css",
  "/static/js/app.js",
  "/static/manifest.json",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/offline.html",
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@400;600;700&display=swap"
];

// ── INSTALL ──────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then(cache => {
      // addAll falla si uno falla — usamos add individual para ser resilientes
      return Promise.allSettled(
        SHELL_ASSETS.map(url => cache.add(url).catch(() => null))
      );
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────
self.addEventListener("activate", event => {
  const VALID = [CACHE_SHELL, CACHE_IMAGES];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !VALID.includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH ─────────────────────────────────────────
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. API → siempre red, nunca caché
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: "Sin conexión. Reconéctate para ver el catálogo." }),
          { headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // 2. Uploads (imágenes de vehículos) → Cache First
  if (url.pathname.startsWith("/static/uploads/")) {
    event.respondWith(
      caches.open(CACHE_IMAGES).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(res => {
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          }).catch(() => new Response("", { status: 404 }));
        })
      )
    );
    return;
  }

  // 3. Assets estáticos (CSS, JS, fuentes, iconos) → Cache First
  if (
    url.pathname.startsWith("/static/") ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  // 4. Navegación HTML (/, /login, etc.) → Network First con fallback offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_SHELL).then(c => c.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match("/offline.html"))
        )
    );
    return;
  }

  // 5. Resto → red con fallback a caché
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
