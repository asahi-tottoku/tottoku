// とっとく Web版 - データはこの端末(ブラウザ)の中だけに保存する。PCもサーバーも使わない。
//
// 画面(app.js)は PC版と同じ形で api("/api/...") を呼ぶ。ここでそれを受けて、端末の中のデータを読み書きする。
// 保存のときは、共有された文・URLだけから名前・地域・ジャンルを決める(他のサイトは読みに行かない)。
(function (root) {
  "use strict";
  const S = root.Sorter;
  const DB_NAME = "tottoku-web", STORE = "kv", KEY = "state";
  const CATEGORIES = ["飲食店", "お出かけ", "買い物", "記事", "動画", "レシピ", "その他"];
  const URL_RE = /https?:\/\/[^\s<>"']+/;

  // ---------------------------------------------------------------- 端末の中の保存場所(IndexedDB)
  let mem = null;   // 読み込んだデータ { items, folders, nextItem, nextFolder }

  function idb() {
    return new Promise((ok, ng) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ng(r.error);
    });
  }

  async function loadState() {
    if (mem) return mem;
    const db = await idb();
    mem = await new Promise((ok, ng) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => ng(r.error);
    });
    db.close();
    if (!mem) mem = { items: [], folders: [], nextItem: 1, nextFolder: 1 };
    for (const it of mem.items) {   // 辞書が増えたとき用: 名前から分かるジャンルをタグに足す
      const add = S.detectGenres(it.title || "").filter((g) => !(it.tags || []).includes(g));
      if (add.length) {
        it.tags = [...(it.tags || []), ...add].slice(0, 8);
        if (it.category === "その他") it.category = "飲食店";
      }
    }
    return mem;
  }

  async function saveState() {
    const db = await idb();
    await new Promise((ok, ng) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(mem, KEY);
      tx.oncomplete = ok;
      tx.onerror = () => ng(tx.error);
    });
    db.close();
  }

  // ブラウザが空き容量のために勝手に消さないよう、頼んでおく(断られても動く)
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* なくてもよい */ }

  // ---------------------------------------------------------------- 共有された文・URLから整理する
  const norm = (s) => String(s || "").normalize("NFKC").replace(/[\s・\-ー()（）【】\[\]「」]/g, "").toLowerCase();

  function host(url) {
    try { return new URL(url).hostname; } catch (e) { return ""; }
  }

  // Google マップの URL から、場所の名前と座標を取り出す
  function mapsInfo(url) {
    if (!/google\./.test(url) || !/\/maps/.test(url)) return {};
    const info = {};
    let m = url.match(/\/maps\/place\/([^/@?]+)/);
    if (m) { try { info.name = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { /* そのまま */ } }
    m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) { info.lat = parseFloat(m[1]); info.lng = parseFloat(m[2]); }
    return info;
  }

  // 「店名 (六本木/焼肉) - 食べログ」→「店名 (六本木/焼肉)」。サイト名の飾りを外す
  function cleanTitle(t) {
    let s = String(t || "").replace(URL_RE, "").trim().split("\n")[0].trim();
    const cut = s.replace(/\s+[-|｜]\s+[^-|｜]{1,30}$/, "").trim();
    if (cut.length >= 2) s = cut;
    return s.slice(0, 120);
  }

  function categoryOf(h, url, genres) {
    // 買い物・動画・レシピのサイトは、ジャンルの言葉があってもそちらを優先する
    if (/amazon|rakuten|yahoo|mercari/.test(h)) return "買い物";
    if (/youtube|youtu\.be|tiktok/.test(h)) return "動画";
    if (/cookpad|kurashiru|delishkitchen/.test(h)) return "レシピ";
    if (genres.length || /tabelog|hotpepper|retty|gnavi|ikyu|hitosara/.test(h)) return "飲食店";
    if (/google\./.test(h) && /\/maps|maps\.app/.test(url) || /maps\.app\.goo\.gl/.test(h)) return "お出かけ";
    return "その他";
  }

  // 保存された1件の、名前・地域・ジャンル(タグ)・分類を決める
  function organize(it) {
    const shared = it.shared_text || "";
    const h = host(it.url);
    const mi = mapsInfo(it.url);
    const lines = shared.replace(URL_RE, "").split("\n").map((s) => s.trim()).filter(Boolean);
    const title = cleanTitle(lines[0] || mi.name || "") || h || it.url || "(名前なし)";
    const desc = lines.join(" ").slice(0, 300);
    const all = [title, desc, mi.name || ""].join(" ");
    const hint = S.urlHints(it.url);   // 公式サイトのローマ字・食べログの地域番号
    const tags = [...new Set([...S.detectGenres(all), ...hint.genres])].slice(0, 6);
    Object.assign(it, {
      title, description: desc, site: h,
      area: S.detectPlace(all) || hint.place || S.placeFromCoords(mi.lat, mi.lng), tags,
      category: categoryOf(h, it.url, tags),
      lat: mi.lat ?? null, lng: mi.lng ?? null, status: "done",
    });
  }

  // 支店名を外した名前。「すしざんまい匠 六本木ラピロス店」→「すしざんまい匠」、「blueberry御殿場店」→「blueberry」
  function chainKey(title) {
    let s = String(title || "").normalize("NFKC").trim().replace(/\s*\([^)]*\)\s*$/, "");
    if (/店$/.test(s)) {
      const parts = s.split(/\s+/);
      if (parts.length > 1) s = parts.slice(0, -1).join(" ");
      else {
        const p = S.detectPlace(s), i = p ? s.lastIndexOf(p) : -1;
        if (i >= 2) s = s.slice(0, i);
      }
    }
    const k = norm(s);
    return k.length >= 2 ? k : "";
  }

  // ---------------------------------------------------------------- フォルダの振り分け(PC版の assign_folders と同じ順番)
  // 1. 同じ名前のお店を自分でフォルダに入れていれば、それに合わせる
  // 2. 辞書(地名・ジャンルの同義語)で決める
  // 3. 新しく保存したものが辞書で決まらず、同じ名前のお店がどこかのフォルダにあれば、それに合わせる
  // 4. (Web版だけ)それでも決まらず、同じチェーンの別の店がフォルダにあれば、それに合わせる(自分で選んだものを先に)
  // 決まらなかったものは、今のフォルダのまま動かさない(新しく保存したときは、画面がどこに入れるか聞く)
  // 自分で直した結果を覚える: 同じくらい合うフォルダが複数あって決まらないとき、
  // 前に同じ組み合わせで迷って自分で選んだお店があれば、多く選ばれた側に入れる(同数なら決めない)。
  function learnedFolder(rows, fl, all, sigs) {
    const sigOf = (list) => [...S.topFolders(list, fl)].sort((a, b) => a - b).join(",");
    const top = S.topFolders(rows, fl);
    if (top.length < 2) return null;
    const sig = sigOf(rows);
    const mine = new Set(rows.map((r) => r.id));
    const votes = new Map();
    for (const r of all) {
      if (!r.folder_manual || mine.has(r.id) || !top.includes(r.folder_id)) continue;
      if (!sigs.has(r.id)) sigs.set(r.id, sigOf([r]));
      if (sigs.get(r.id) === sig) votes.set(r.folder_id, (votes.get(r.folder_id) || 0) + 1);
    }
    const order = [...votes].sort((a, b) => b[1] - a[1]);
    if (!order.length || (order[1] && order[1][1] === order[0][1])) return null;
    return order[0][0];
  }

  let learnedId = null;   // いま保存したものが「前と同じ分け方」で入ったら、その id
  function assignFolders(ids = null, newItem = false) {
    const fl = sortedFolders();
    if (!fl.length) return 0;
    const fids = new Set(fl.map((f) => f.id));
    const all = mem.items.filter((i) => i.status === "done");
    const targets = all.filter((i) => !i.folder_manual && (ids == null || ids.includes(i.id)));
    const groups = new Map();
    for (const r of targets) {
      const k = norm(r.title) || "#" + r.id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    let moved = 0;
    const sigs = new Map();
    for (const [key, rows] of groups) {
      const same = all.filter((r) => norm(r.title) === key && fids.has(r.folder_id));
      const manual = same.filter((r) => r.folder_manual);
      let fid = null;
      if (manual.length) fid = manual[0].folder_id;
      else {
        const cur = (rows.find((r) => fids.has(r.folder_id)) || {}).folder_id ?? null;
        fid = S.pickFolder(rows, fl, cur);
        if (fid == null && newItem) {
          const ids2 = new Set(rows.map((r) => r.id));
          const others = same.filter((r) => !ids2.has(r.id));
          fid = others.length ? others[0].folder_id : null;
          const ck = fid == null ? chainKey(rows[0].title) : "";
          if (ck) {
            const chain = all.filter((r) => !ids2.has(r.id) && fids.has(r.folder_id) && chainKey(r.title) === ck)
              .sort((a, b) => (b.folder_manual || 0) - (a.folder_manual || 0));
            if (chain.length) fid = chain[0].folder_id;
          }
        }
        if (fid == null) {
          fid = learnedFolder(rows, fl, all, sigs);
          if (fid != null && newItem) learnedId = rows[0].id;
        }
      }
      if (fid == null) continue;
      for (const r of rows) if (r.folder_id !== fid) { r.folder_id = fid; moved++; }
    }
    return moved;
  }

  function sortedFolders() {
    return [...mem.folders].sort((a, b) =>
      (a.position == null) - (b.position == null) || (a.position ?? 0) - (b.position ?? 0) || a.created_at - b.created_at);
  }

  const findName = (name) => mem.folders.find((f) => S.fnorm(f.name) === S.fnorm(name));

  // ---------------------------------------------------------------- 保存
  function addItem({ url = "", text = "", title = "", folder_id = null }) {
    url = String(url || "").trim();
    text = [title, text].filter(Boolean).join("\n").trim();
    if (!url) { const m = text.match(URL_RE); url = m ? m[0] : ""; }
    if (/^https?:\/\//.test(text) && text === url) text = "";
    const it = {
      id: mem.nextItem++, url, shared_text: text, title: "", description: "", image: "", site: "",
      category: "その他", area: "", tags: [], summary: "", note: "", lat: null, lng: null,
      status: "processing", created_at: Date.now() / 1000,
      folder_id: folder_id ?? null, folder_manual: folder_id ? 1 : 0,
      recommender: "", review: "", rating: null, visited_at: null, snooze_until: null,
    };
    organize(it);
    mem.items.push(it);
    learnedId = null;
    if (!it.folder_manual) assignFolders([it.id], true);
    return it;
  }

  // ---------------------------------------------------------------- 書き出し・読み込み
  function exportData() {
    return { app: "tottoku", version: 1, exported_at: new Date().toISOString(),
      folders: sortedFolders(), items: [...mem.items].sort((a, b) => a.created_at - b.created_at) };
  }

  // PC版の「全部を書き出す」ファイルもそのまま読める。今のデータは全部置き換える
  function importData(data) {
    if (!data || data.app !== "tottoku" || !Array.isArray(data.items) || !Array.isArray(data.folders)) {
      throw new Error("とっとくのバックアップファイルではありません");
    }
    const folders = data.folders.map((f, n) => ({
      id: Number(f.id), name: String(f.name || "").slice(0, 30), created_at: Number(f.created_at) || n, position: n,
    })).filter((f) => f.id && f.name);
    const fids = new Set(folders.map((f) => f.id));
    const items = data.items.map((r) => {
      const it = { ...r };
      it.id = Number(r.id);
      it.tags = Array.isArray(r.tags) ? r.tags : (() => { try { return JSON.parse(r.tags || "[]"); } catch (e) { return []; } })();
      it.status = "done";
      it.created_at = Number(r.created_at) || Date.now() / 1000;
      if (!fids.has(it.folder_id)) { it.folder_id = null; it.folder_manual = 0; }
      return it;
    }).filter((it) => it.id);
    mem = {
      items, folders,
      nextItem: Math.max(0, ...items.map((i) => i.id)) + 1,
      nextFolder: Math.max(0, ...folders.map((f) => f.id)) + 1,
    };
    return { items: items.length, folders: folders.length };
  }

  // ---------------------------------------------------------------- PC版と同じ形の「API」
  async function request(method, path, body = {}) {
    await loadState();
    let m;
    const out = (() => {
      if (method === "GET" && path === "/api/items") {
        return { items: [...mem.items].sort((a, b) => b.created_at - a.created_at), folders: sortedFolders().map(({ id, name }) => ({ id, name })) };
      }
      if (method === "POST" && path === "/api/items/restore") {   // 消した直後の「元に戻す」
        const it = body.item;
        if (it && it.id != null && !mem.items.some((i) => i.id === it.id)) mem.items.push(it);
        return { ok: true };
      }
      if (method === "POST" && path === "/api/items") { const it = addItem(body); return { id: it.id, learned: learnedId === it.id }; }
      if (method === "POST" && path === "/api/folders") {
        const name = String(body.name || "").trim().slice(0, 30);
        if (!name) return { error: "名前が空です" };
        if (findName(name)) return { error: "同じ名前のフォルダがあります" };
        const f = { id: mem.nextFolder++, name, created_at: Date.now() / 1000, position: null };
        mem.folders.push(f);
        return { id: f.id };
      }
      if (method === "POST" && path === "/api/folders/order") {
        (body.ids || []).forEach((id, n) => { const f = mem.folders.find((x) => x.id === Number(id)); if (f) f.position = n; });
        return { ok: true };
      }
      if (method === "POST" && path === "/api/folders/autosort") return { moved: assignFolders() };
      if ((m = path.match(/^\/api\/folders\/(\d+)$/))) {
        const fid = Number(m[1]);
        if (method === "PATCH") {
          const name = String(body.name || "").trim().slice(0, 30);
          if (!name) return { error: "名前が空です" };
          const f = mem.folders.find((x) => x.id === fid);
          if (f) f.name = name;
          return { ok: true };
        }
        if (method === "DELETE") {   // 中身は消さず「フォルダなし」に戻す
          mem.items.forEach((i) => { if (i.folder_id === fid) { i.folder_id = null; i.folder_manual = 0; } });
          mem.folders = mem.folders.filter((f) => f.id !== fid);
          return { ok: true };
        }
      }
      if ((m = path.match(/^\/api\/items\/(\d+)$/))) {
        const id = Number(m[1]);
        const it = mem.items.find((i) => i.id === id);
        if (method === "DELETE") { mem.items = mem.items.filter((i) => i.id !== id); return { ok: true }; }
        if (method === "PATCH" && it) {
          for (const k of ["note", "title", "category", "area", "recommender", "review", "rating", "visited_at", "snooze_until", "tags"]) {
            if (k in body) it[k] = body[k];
          }
          if ("title" in body || "area" in body) {   // 名前や地域を直したら、ジャンルも付け直す
            const add = S.detectGenres([it.title, it.description].join(" "));
            it.tags = [...new Set([...(it.tags || []), ...add])].slice(0, 8);
            if (add.length && it.category === "その他") it.category = "飲食店";
          }
          if ("folder" in body) {   // 数字=そのフォルダ / null=フォルダなし / "auto"=自動
            if (body.folder === "auto") it.folder_manual = 0;
            else { it.folder_id = body.folder; it.folder_manual = 1; }
          }
          if (body.folder === "auto" || (!it.folder_manual && ("title" in body || "area" in body || "note" in body))) {
            assignFolders([id]);
          }
          return { ok: true };
        }
      }
      return { error: "not found" };
    })();
    if (method !== "GET") await saveState();
    return out;
  }

  root.LocalAPI = { request, exportData, importData, saveState, loadState, CATEGORIES,
    _organize: organize, _cleanTitle: cleanTitle, _chainKey: chainKey };
})(self);
