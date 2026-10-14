/* =========================================================
   Service worker: Populasi Data Penjualan
   - Kerangka halaman (index.html + font): tampil dari cache, diperbarui di belakang layar.
   - Daftar produk/tahun/wilayah/provinsi dan hasil "Lihat": disimpan sementara,
     jadi pilihan yang pernah dibuka tampil instan.
   - Export (download) tidak pernah di-cache: selalu data terbaru.
   Naikkan VERSION kalau isi sw.js ini diubah.
   ========================================================= */
const VERSION = 'v1';
const SHELL_CACHE = 'populasi-shell-' + VERSION;
const DATA_CACHE  = 'populasi-data-' + VERSION;
const SHELL_FILES = ['./', './index.html'];

const API_HOST = 'script.google.com';
const MIN = 60 * 1000, HOUR = 60 * MIN;
// Berapa lama hasil dianggap "segar" untuk tiap action.
// Kalau data penjualan sering berubah, kecilkan angka viewData.
const TTL = {
  listProduk:   6 * HOUR,
  listTahun:    6 * HOUR,
  listWilayah:  6 * HOUR,
  listProvinsi: 6 * HOUR,
  viewData:    15 * MIN,
};
const REFRESH_AFTER = 5 * MIN;   // data segar yang lebih tua dari ini diperbarui diam-diam

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL_FILES))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === API_HOST) {
    const action = url.searchParams.get('action');
    if (action && TTL[action]) e.respondWith(apiCache(e, req, action));
    return;                                  // export dan lainnya: langsung ke jaringan
  }

  if (url.origin === self.location.origin ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(e, req));
  }
});

/* ---------- Kerangka halaman & font ---------- */
async function staleWhileRevalidate(e, req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const net = fetch(req)
    .then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (hit) { e.waitUntil(net); return hit; }
  const res = await net;
  if (res) return res;
  if (req.mode === 'navigate') {
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
  }
  return Response.error();
}

/* ---------- Data Apps Script ---------- */
async function apiCache(e, req, action) {
  const cache = await caches.open(DATA_CACHE);
  const hit = await cache.match(req.url);
  const age = hit ? Date.now() - Number(hit.headers.get('x-sw-time') || 0) : Infinity;

  // Masih segar: tampilkan dari cache, perbarui diam-diam kalau sudah agak lama.
  if (hit && age < TTL[action]) {
    if (age > REFRESH_AFTER) e.waitUntil(fetchAndStore(req, cache, action).catch(() => {}));
    return hit;
  }

  // Tidak ada / sudah kedaluwarsa: ambil dari jaringan, cadangan cache lama kalau offline.
  try {
    return await fetchAndStore(req, cache, action);
  } catch (err) {
    if (hit) return hit;
    throw err;
  }
}

async function fetchAndStore(req, cache, action) {
  const res = await fetch(req.url);
  if (!res.ok) return res;
  const text = await res.clone().text();
  if (isGood(action, text)) {
    await cache.put(req.url, new Response(text, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-sw-time': String(Date.now()) },
    }));
  }
  return res;
}

// Jangan simpan respons error (Apps Script tetap membalas 200 walau isinya {"error":...}).
function isGood(action, text) {
  const t = text.trim();
  if (action === 'viewData') return t.charAt(0) === '{' && !/^\{\s*"error"/.test(t);
  return t.charAt(0) === '[';
}
