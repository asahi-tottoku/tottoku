// とっとく Web版 - データはこの端末(ブラウザ)の中だけに保存する。PCもサーバーも使わない。
//
// 画面(app.js)は PC版と同じ形で api("/api/...") を呼ぶ。ここでそれを受けて、端末の中のデータを読み書きする。
// 保存のときは、共有された文・URLだけから名前・地域・ジャンルを決める(他のサイトは読みに行かない)。
(function (root) {
  "use strict";
  const S = root.Sorter;
  const DB_NAME = "tottoku-web", STORE = "kv", KEY = "state";
  const CATEGORIES = ["飲食店", "お出かけ", "買い物", "記事", "動画", "レシピ", "メモ", "その他"];
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
    // 箱(v25): フォルダより大きいまとまり。箱 > フォルダの2段。前のデータには無いので足す
    if (!Array.isArray(mem.boxes)) mem.boxes = [];
    if (!mem.nextBox) mem.nextBox = Math.max(0, ...mem.boxes.map((b) => b.id)) + 1;
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
    // 買い物は、売り場のページだけ(Yahoo!ニュース・楽天トラベル・Amazon の動画などは買い物にしない)
    if (/mercari|paypayfleamarket/.test(h) || /^(www|item|books|product|search)\.rakuten\.co\.jp$/.test(h)
      || /(^|\.)(shopping|auctions)\.yahoo\.co\.jp$/.test(h)
      || (/(^|\.)amazon\.|(^|\.)amzn\./.test(h) && !/^watch\./.test(h) && !/\/(gp\/video|prime-?video)/i.test(url))) return "買い物";
    if (/youtube|youtu\.be|tiktok/.test(h)) return "動画";
    if (/cookpad|kurashiru|delishkitchen|^recipe\.rakuten\./.test(h)) return "レシピ";
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
  // 5. (Web版だけ)お店以外(サイト・動画・買い物)は、フォルダ名の言葉・種類・同じサイトでも決める(下の「お店以外の振り分け」)
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

  // ---------------------------------------------------------------- お店以外(サイト・動画・買い物など)の振り分け
  // 場所(お店・お出かけ先)かどうか。サイト・動画・買い物などは false。
  // false のものには、地域を聞かない・カードに「📍」を出さない・ジャンルの段では「その他」に数える。
  // 分類が「その他」のものは、URLが無い(名前だけ)か Google のリンク(共有リンクは名前しか届かない)なら、お店かもしれないので場所として扱う。
  function isPlace(i) {
    if (i.category === "メモ") return false;   // メモは、文に地名が入っていても場所ではない
    if (i.lat != null || i.area || i.address) return true;
    if (i.category === "飲食店" || i.category === "お出かけ") return true;
    return i.category === "その他" && (!i.url || /(^|\.)google(\.|$)|goo\.gl$/.test(i.site || ""));
  }
  // サイトの呼び名(フォルダ名「YouTube」「楽天」などと合わせる用)
  const SITE_NAMES = [[/youtube|youtu\.be/, "youtube ユーチューブ"], [/amazon|amzn\./, "amazon アマゾン"], [/rakuten/, "rakuten 楽天"],
    [/cookpad/, "cookpad クックパッド"], [/instagram/, "instagram インスタ"], [/(^|\.)x\.com$|twitter/, "twitter ツイッター"],
    [/tiktok/, "tiktok ティックトック"], [/mercari/, "mercari メルカリ"], [/yahoo/, "yahoo ヤフー"], [/(^|\.)note\.com$/, "note ノート"],
    [/facebook|fb\.com|fb\.me/, "facebook フェイスブック"], [/threads\./, "threads スレッズ"], [/pinterest|pin\.it/, "pinterest ピンタレスト"],
    [/ameblo|ameba/, "ameblo アメブロ"], [/nicovideo|nico\.ms/, "niconico ニコニコ"], [/(^|\.)line\.me$|lin\.ee/, "line ライン"]];
  // 種類(分類)と、それを入れそうなフォルダ名の言葉
  const KIND_WORDS = {
    "動画": /動画|ビデオ|映像|youtube|ユーチューブ|見る|観る/,
    "買い物": /買い物|買物|かいもの|ほしい|欲しい|ショッピング|買う|購入/,
    "レシピ": /レシピ|料理|作る|自炊/,
    "記事": /読む|よむ|記事|ブログ|ニュース|読み物|読みもの|サイト|リンク|ブックマーク/,
    "メモ": /メモ|めも|ノート|覚え書き|おぼえがき|やること|todo/,
  };
  // フォルダ名の言葉。地名・料理のジャンル(辞書が分かる言葉)は外す(それは辞書の仕事。「御殿場 寿司」に御殿場のパン屋を入れない)
  const PREF_RE = /^(北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)[都府県]?$/;
  // フォルダ名ごとの答えは覚えておく(1件ごと・フォルダごとに全国の地名の辞書を引き直すと、振り分け直しが何秒もかかる)
  const memoName = (fn) => { const m = new Map(); return (name) => { const k = String(name || ""); if (!m.has(k)) m.set(k, fn(k)); return m.get(k); }; };
  const plainWords = memoName((name) => name.split(/[\s・、,\/]+/)
    .filter((t) => t && !PREF_RE.test(t) && !S.detectPlace(t) && !S.detectGenres(t).length));
  // 地名・都道府県・料理のジャンルの言葉が入ったフォルダ(「沼津 ランチ」「東京 動画」)。お店のフォルダなので、
  // 下の3つ(フォルダ名の言葉・種類・同じサイト)では相手にしない(地名を見ずに、サイトや動画を黙って入れないため)
  const placeFolder = memoName((name) => name.split(/[\s・、,\/]+/)
    .some((t) => t && (PREF_RE.test(t) || S.detectPlace(t) || S.detectGenres(t).length)));
  const isAscii = (t) => /^[\x00-\x7f]+$/.test(t);
  const isKana = (t) => /^[ァ-ヶー]+$/.test(t);
  // 言葉をさがす用(norm と違い「ー」を残す。「ビール」を「森ビル」に合わせない)
  const normW = (s) => String(s || "").normalize("NFKC").replace(/[\s・\-()\[\]【】「」]/g, "").toLowerCase();
  const folderTokens = memoName((name) => plainWords(name).map((t) => (isAscii(t) ? t.toLowerCase() : normW(t)))
    .filter((t) => t.length >= (isAscii(t) ? 3 : 2)));
  const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 英字の言葉は、単語として入っているときだけ(「note」を「Keynote」に合わせない)。
  // カタカナの言葉は、すぐ後ろにカタカナが続かないときだけ(「メモ」を「メモリ」に合わせない)
  const hasToken = (t, hay, raw) => (isAscii(t) ? new RegExp("(^|[^a-z0-9])" + reEsc(t) + "([^a-z0-9]|$)").test(raw)
    : isKana(t) ? new RegExp(reEsc(t) + "(?![ァ-ヶー])").test(raw) : hay.includes(t));
  // フォルダ名の言葉が、名前・説明(場所でないものはサイト名も)に入っているフォルダ。いちばん多く合う1つだけ。同数なら決めない
  function tokenHits(r) {
    const h = (r.site || "").replace(/^www\./, "");
    const names = isPlace(r) ? "" : [h, ...SITE_NAMES.filter(([re]) => re.test(h)).map(([, n]) => n)].join(" ");
    const raw = [r.title, r.description, names].join(" ").normalize("NFKC").toLowerCase();
    const hay = normW(raw);
    return (f) => folderTokens(f.name).filter((t) => hasToken(t, hay, raw)).length;
  }
  function nameFolder(r, fl) {
    const hits = tokenHits(r);
    const score = fl.filter((f) => !placeFolder(f.name)).map((f) => [f.id, hits(f)]).filter(([, n]) => n)
      .sort((a, b) => b[1] - a[1]);
    if (!score.length || (score[1] && score[1][1] === score[0][1])) return null;
    return score[0][0];
  }
  // 種類に合う名前のフォルダ(動画 →「あとで見る動画」、ふつうのサイト →「あとで読む」)。1つだけ合うときに決める
  const kindHit = (r, f) => { const re = KIND_WORDS[r.category]; return !!re && re.test(String(f.name).normalize("NFKC").toLowerCase()); };
  function kindFolder(r, fl) {
    // 分類が「その他」のサイトは、お店の公式サイトかもしれないので決めない(2026-11-24 きよさん「聞く」)
    const re = KIND_WORDS[r.category];
    if (!re) return null;
    // 地名・料理のジャンルの入ったフォルダは見ない(「沼津 中華料理」にレシピを、「東京 動画」に動画を入れない)
    const hit = fl.filter((f) => !placeFolder(f.name) && kindHit(r, f));
    return hit.length === 1 ? hit[0].id : null;
  }
  // 自分で同じサイトのものを入れたフォルダ(多いほう。同数なら決めない)。自動で入ったものは数えない。
  // お店として入っているもの・地名やジャンルの入ったフォルダも数えない。
  // 何でも載るサイト(インスタ・YouTube・Amazon など)は、同じサイトというだけでは決めない
  function siteFolder(r, all, fl) {
    const h = (r.site || "").replace(/^www\./, "");
    if (!h || SITE_NAMES.some(([re]) => re.test(h))) return null;
    const fids = new Set(fl.filter((f) => !placeFolder(f.name)).map((f) => f.id));
    const votes = new Map();
    for (const o of all) {
      if (o.id === r.id || !fids.has(o.folder_id) || !o.folder_manual || isPlace(o)) continue;
      if ((o.site || "").replace(/^www\./, "") === h) votes.set(o.folder_id, (votes.get(o.folder_id) || 0) + 1);
    }
    const order = [...votes].sort((a, b) => b[1] - a[1]);
    if (!order.length || (order[1] && order[1][1] === order[0][1])) return null;
    return order[0][0];
  }

  let learnedId = null;   // いま保存したものが「前と同じ分け方」で入ったら、その id
  let namedId = null;     // いま保存した「名前だけ」のものが、フォルダ名の言葉で入ったら、その id(メモとみなし、画面は地域を聞かない)
  function assignFolders(ids = null, newItem = false) {
    const fl = sortedFolders();
    if (!fl.length) return 0;
    const fids = new Set(fl.map((f) => f.id));
    // メモは振り分けない(メモの画面にだけ出るので、フォルダは意味が無い)。同じ名前のお店がメモにならうこともない
    const allFl = fl, allFids = fids;
    const all = mem.items.filter((i) => i.status === "done" && i.category !== "メモ");
    const targets = all.filter((i) => !i.folder_manual && (ids == null || ids.includes(i.id)));
    const groups = new Map();
    // 名前を付けずに保存したURL(題名がサイト名のまま)は、「同じ名前」「同じチェーン」とみなさない
    // (インスタや食べログを1つフォルダに入れたら、次の名前なしのものも黙って入る、を防ぐ。
    //  2026-11-24 きよさんの了解で、お店・場所のURLも同じにした。ここだけ、お店の答えが v20 と変わる)
    const bare = (r) => !!r.url && (r.title === r.site || r.title === r.url);
    const keyOf = (r) => (bare(r) ? "" : norm(r.title)) || "#" + r.id;
    // 箱の中で保存したもの(box_id があるもの)は、その箱のフォルダだけから選ぶ。箱が無ければ今までと同じ
    const boxKey = (r) => (r.box_id != null && mem.boxes.some((b) => b.id === r.box_id) ? r.box_id : null);
    for (const r of targets) {
      const k = boxKey(r) + "\u0000" + keyOf(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    let moved = 0;
    const sigsByBox = new Map();   // 迷ったときの覚え(箱ごと。比べるフォルダが箱で違うので)
    for (const rows of groups.values()) {
      const key = keyOf(rows[0]);
      const bk = boxKey(rows[0]);
      const fl = bk == null ? allFl : allFl.filter((f) => f.box_id === bk);
      if (!fl.length) continue;
      if (!sigsByBox.has(bk)) sigsByBox.set(bk, new Map());
      const sigs = sigsByBox.get(bk);
      const fids = bk == null ? allFids : new Set(fl.map((f) => f.id));
      const same = all.filter((r) => keyOf(r) === key && fids.has(r.folder_id));
      const manual = same.filter((r) => r.folder_manual);
      let fid = null;
      if (manual.length) fid = manual[0].folder_id;
      else {
        const cur = (rows.find((r) => fids.has(r.folder_id)) || {}).folder_id ?? null;
        // お店以外(サイト・動画・買い物): フォルダ名の言葉が題名やサイト名にある → 自分で同じサイトを入れたフォルダ、を先に見る
        const site = rows.every((r) => !isPlace(r));
        if (site) fid = nameFolder(rows[0], fl) ?? siteFolder(rows[0], all, fl);
        if (fid == null) {
          fid = S.pickFolder(rows, fl, cur);
          // お店以外: 辞書は文字の一部でも合わせる(「note」に「Keynote」、「メモ」に「メモリ」)。
          // 地名・ジャンルの無いフォルダへは、言葉として合っているか、種類に合う名前(動画 →「見る」)のときだけ入れる(合わなければ決めずに聞く)
          const f = site && fid != null && fid !== cur && fl.find((x) => x.id === fid);
          if (f && !placeFolder(f.name) && !tokenHits(rows[0])(f) && !kindHit(rows[0], f)) fid = null;
        }
        if (fid == null && newItem) {
          const ids2 = new Set(rows.map((r) => r.id));
          const others = same.filter((r) => !ids2.has(r.id));
          fid = others.length ? others[0].folder_id : null;
          const ck = fid == null && !bare(rows[0]) ? chainKey(rows[0].title) : "";
          if (ck) {
            const chain = all.filter((r) => !ids2.has(r.id) && !bare(r) && fids.has(r.folder_id) && chainKey(r.title) === ck)
              .sort((a, b) => (b.folder_manual || 0) - (a.folder_manual || 0));
            if (chain.length) fid = chain[0].folder_id;
          }
        }
        if (fid == null && S.topFolders(rows, fl).length < 2) {   // 辞書で迷っているとき(2つ以上)は決めずに聞く
          // お店以外: 種類に合うフォルダ(動画 →「見る」など)
          // (お店には足さない。前は聞いていたお店を、地名・ジャンルの合わないフォルダへ黙って入れないため)
          if (site) fid = kindFolder(rows[0], fl);
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
  const folderBox = (fid) => (mem.folders.find((f) => f.id === fid) || {}).box_id ?? null;
  const sortedBoxes = () => [...mem.boxes].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.created_at - b.created_at);
  // フォルダに入ったものは、そのフォルダの箱に合わせる(自動で入ったときも)
  const syncBoxes = () => mem.items.forEach((i) => {
    if (i.folder_id != null && mem.folders.some((f) => f.id === i.folder_id)) i.box_id = folderBox(i.folder_id);
  });

  // ---------------------------------------------------------------- 保存
  // name: 保存の画面で自分で付けた名前(そのまま名前にする)。title: 共有メニューから届いたページの題名(サイト名の飾りを外す)
  // box_id: 箱の中で保存したときの箱(フォルダはその箱の中から選ぶ)。共有メニューなど外からは null
  function addItem({ url = "", text = "", title = "", name = "", note = "", kind = "", folder_id = null, box_id = null }) {
    url = String(url || "").trim();
    name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 120);
    text = [name || title, text].filter(Boolean).join("\n").trim();
    if (!url) { const m = text.match(URL_RE); url = m ? m[0] : ""; }
    if (/^https?:\/\//.test(text) && text === url) text = "";
    const it = {
      id: mem.nextItem++, url, shared_text: text, title: "", description: "", image: "", site: "",
      category: "その他", area: "", tags: [], summary: "", note: "", lat: null, lng: null,
      status: "processing", created_at: Date.now() / 1000,
      folder_id: folder_id ?? null, folder_manual: folder_id ? 1 : 0,
      box_id: folder_id ? folderBox(folder_id) : mem.boxes.some((b) => b.id === box_id) ? box_id : null,
      recommender: "", review: "", rating: null, visited_at: null, snooze_until: null,
    };
    organize(it);
    if (name) it.title = name;   // 「歌手 - 曲」の「 - 曲」を飾りとして切らない
    if (kind === "memo") { it.category = "メモ"; it.area = ""; }   // 保存の画面で「メモとして保存」を選んだ(お店・場所ではない)
    it.note = String(note || "").trim().slice(0, 1000);   // 保存の画面で書いたメモ
    mem.items.push(it);
    learnedId = null;
    namedId = null;
    if (!it.folder_manual) assignFolders([it.id], true);
    // 名前だけのものが、フォルダ名の(地名・ジャンルでない)言葉で入った → メモとみなす
    const f = !it.url && it.category === "その他" && !it.folder_manual && mem.folders.find((x) => x.id === it.folder_id);
    if (f && nameFolder(it, [f]) != null) namedId = it.id;
    return it;
  }

  // ---------------------------------------------------------------- 書き出し・読み込み
  function exportData() {
    return { app: "tottoku", version: 1, exported_at: new Date().toISOString(),
      boxes: sortedBoxes(), folders: sortedFolders(), items: [...mem.items].sort((a, b) => a.created_at - b.created_at) };
  }

  // PC版の「全部を書き出す」ファイルもそのまま読める。今のデータは全部置き換える
  function importData(data) {
    if (!data || data.app !== "tottoku" || !Array.isArray(data.items) || !Array.isArray(data.folders)) {
      throw new Error("とっとくのバックアップファイルではありません");
    }
    // 箱は v25 から。前のファイル(PC版も)には無いので、無ければ箱なし
    const boxes = (Array.isArray(data.boxes) ? data.boxes : []).map((b, n) => ({
      id: Number(b.id), name: String(b.name || "").slice(0, 20), created_at: Number(b.created_at) || n, position: n,
    })).filter((b) => b.id && b.name);
    const bids = new Set(boxes.map((b) => b.id));
    const okBox = (v) => (v != null && bids.has(Number(v)) ? Number(v) : null);
    const folders = data.folders.map((f, n) => ({
      id: Number(f.id), name: String(f.name || "").slice(0, 30), created_at: Number(f.created_at) || n, position: n,
      box_id: okBox(f.box_id),
    })).filter((f) => f.id && f.name);
    const fids = new Set(folders.map((f) => f.id));
    const items = data.items.map((r) => {
      const it = { ...r };
      it.id = Number(r.id);
      it.tags = Array.isArray(r.tags) ? r.tags : (() => { try { return JSON.parse(r.tags || "[]"); } catch (e) { return []; } })();
      it.status = "done";
      it.created_at = Number(r.created_at) || Date.now() / 1000;
      if (!fids.has(it.folder_id)) { it.folder_id = null; it.folder_manual = 0; }
      it.box_id = okBox(r.box_id);
      return it;
    }).filter((it) => it.id);
    mem = {
      items, folders, boxes,
      nextItem: Math.max(0, ...items.map((i) => i.id)) + 1,
      nextFolder: Math.max(0, ...folders.map((f) => f.id)) + 1,
      nextBox: Math.max(0, ...boxes.map((b) => b.id)) + 1,
    };
    syncBoxes();
    return { items: items.length, folders: folders.length, boxes: boxes.length };
  }

  // ---------------------------------------------------------------- PC版と同じ形の「API」
  async function request(method, path, body = {}) {
    await loadState();
    let m;
    const out = (() => {
      if (method === "GET" && path === "/api/items") {
        return { items: [...mem.items].sort((a, b) => b.created_at - a.created_at),
          folders: sortedFolders().map(({ id, name, box_id }) => ({ id, name, box_id: box_id ?? null })),
          boxes: sortedBoxes().map(({ id, name }) => ({ id, name })) };
      }
      // ---- 箱(名前を付けられる大きなまとまり。中にフォルダが入る)
      if (method === "POST" && path === "/api/boxes") {
        const name = String(body.name || "").trim().slice(0, 20);
        if (!name) return { error: "名前が空です" };
        if (mem.boxes.some((b) => S.fnorm(b.name) === S.fnorm(name))) return { error: "同じ名前の箱があります" };
        const b = { id: mem.nextBox++, name, created_at: Date.now() / 1000, position: null };
        mem.boxes.push(b);
        return { id: b.id };
      }
      if (method === "POST" && path === "/api/boxes/order") {
        (body.ids || []).forEach((id, n) => { const b = mem.boxes.find((x) => x.id === Number(id)); if (b) b.position = n; });
        return { ok: true };
      }
      if ((m = path.match(/^\/api\/boxes\/(\d+)$/))) {
        const bid = Number(m[1]);
        const b = mem.boxes.find((x) => x.id === bid);
        if (!b) return { error: "箱が見つかりません" };
        if (method === "PATCH") {
          const name = String(body.name || "").trim().slice(0, 20);
          if (!name) return { error: "名前が空です" };
          if (mem.boxes.some((x) => x.id !== bid && S.fnorm(x.name) === S.fnorm(name))) return { error: "同じ名前の箱があります" };
          b.name = name;
          return { ok: true };
        }
        if (method === "DELETE") {   // 中のフォルダ・お店は消さず、箱の外に出す
          mem.folders.forEach((f) => { if (f.box_id === bid) f.box_id = null; });
          mem.items.forEach((i) => { if (i.box_id === bid) i.box_id = null; });
          mem.boxes = mem.boxes.filter((x) => x.id !== bid);
          return { ok: true };
        }
      }
      if (method === "POST" && path === "/api/items/restore") {   // 消した直後の「元に戻す」
        const it = body.item;
        if (it && it.id != null && !mem.items.some((i) => i.id === it.id)) {
          // その間にフォルダが消されていたら「フォルダなし」に戻す(無いフォルダの番号を残さない)
          if (it.folder_id != null && !mem.folders.some((f) => f.id === it.folder_id)) { it.folder_id = null; it.folder_manual = 0; }
          if (it.box_id != null && !mem.boxes.some((b) => b.id === it.box_id)) it.box_id = null;
          mem.items.push(it);
        }
        return { ok: true };
      }
      if (method === "POST" && path === "/api/items") { const it = addItem(body); return { id: it.id, learned: learnedId === it.id, named: namedId === it.id }; }
      if (method === "POST" && path === "/api/folders") {
        const name = String(body.name || "").trim().slice(0, 30);
        if (!name) return { error: "名前が空です" };
        if (findName(name)) return { error: "同じ名前のフォルダがあります" };
        const box = mem.boxes.some((b) => b.id === body.box_id) ? body.box_id : null;   // 箱の中で作ったら、その箱に入れる
        const f = { id: mem.nextFolder++, name, created_at: Date.now() / 1000, position: null, box_id: box };
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
          const f = mem.folders.find((x) => x.id === fid);
          if ("box_id" in body) {   // 入れる箱を変える(null = 箱に入れない)。中のお店も一緒に移る
            if (f) f.box_id = mem.boxes.some((b) => b.id === body.box_id) ? body.box_id : null;
            return { ok: true };
          }
          const name = String(body.name || "").trim().slice(0, 30);
          if (!name) return { error: "名前が空です" };
          if (f) f.name = name;
          return { ok: true };
        }
        if (method === "DELETE") {   // 中身は消さず「フォルダなし」に戻す(箱の中のフォルダなら、その箱の「フォルダなし」)
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
          // フォルダなしにしたとき、どの箱の「フォルダなし」に置くか(箱の中で選んだら、その箱)
          if ("box" in body) it.box_id = mem.boxes.some((b) => b.id === body.box) ? body.box : null;
          if (body.folder === "auto" || (!it.folder_manual && ("title" in body || "area" in body || "note" in body))) {
            assignFolders([id]);
          }
          return { ok: true };
        }
      }
      return { error: "not found" };
    })();
    if (method !== "GET") { syncBoxes(); await saveState(); }
    return out;
  }

  root.LocalAPI = { request, exportData, importData, saveState, loadState, CATEGORIES, isPlace,
    _organize: organize, _cleanTitle: cleanTitle, _chainKey: chainKey };
})(self);
