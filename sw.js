// サービスワーカー: 一度開けば、電波が無くても「とっとく」を開けるように、画面のファイルを端末にしまっておく。
// データ(保存したもの)は IndexedDB にあり、ここでは扱わない。画面を変えたら CACHE の番号を上げる。
const CACHE = "tottoku-web-v1";
const SHELL = ["./", "index.html", "app.js", "localdb.js", "sorter.js", "install.js", "style.css",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 同じ場所のファイル: まずネットから新しいものを取り、だめならしまってある分を使う
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && req.mode !== "navigate") await c.put(req, res.clone());
      if (res.ok && req.mode === "navigate") await c.put("./", res.clone());
      return res;
    } catch (err) {
      const hit = req.mode === "navigate" ? await c.match("./") : await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
