/* ==========================================================================
   FRETE NA MÃO — Service Worker
   Faz cache dos arquivos da aplicação para que ela funcione offline depois
   de aberta pela primeira vez. Os dados continuam salvos via localStorage,
   que não passa pelo service worker.
   ========================================================================== */

const CACHE_NAME = "frete-na-mao-v2";

const ARQUIVOS_PARA_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PARA_CACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: cache-first para os arquivos do app, com atualização em segundo
// plano (stale-while-revalidate) para pegar novas versões quando online.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Deixa o navegador tratar diretamente qualquer requisição para fora do
  // próprio site (Firebase Auth, Firestore, Google Fonts etc.) — o cache
  // deste service worker cuida só dos arquivos do app em si.
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      const buscaRede = fetch(event.request)
        .then((respostaRede) => {
          if (respostaRede && respostaRede.status === 200) {
            const clone = respostaRede.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return respostaRede;
        })
        .catch(() => respostaCache);

      return respostaCache || buscaRede;
    })
  );
});
