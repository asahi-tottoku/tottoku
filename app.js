const $ = (s) => document.querySelector(s);
// 種類ごとの淡い色(カードの絵の代わり)。0:桃 1:緑 2:青 3:黄 4:灰
const KIND_TINT = { "飲食店": 0, "お出かけ": 1, "買い物": 3, "記事": 2, "動画": 2, "レシピ": 1, "メモ": 4, "その他": 4 };
const ICONS = { "飲食店": "🍽", "お出かけ": "📍", "買い物": "🛍", "記事": "📰", "動画": "▶", "レシピ": "🍳", "メモ": "📝", "その他": "🔖" };
const WD = "日月火水木金土";
let items = [];
let memos = [];   // 種類が「メモ」のもの。一覧には出さず、メモの画面(右上のえんぴつ)だけに出す
let folders = [];
let boxes = [];             // 箱(フォルダより大きいまとまり)。1つも無ければ、最初の画面は今までどおりの一覧
let activeBox = null;       // null = 最初の画面(箱の並び) | "all" = すべて | 箱のid
let activeFolder = "all";   // "all" | "none" | フォルダid
let activeGenre = null;      // 選んだジャンル(null = 全ジャンル)
let activeArea = "all";      // 選んだ地域("all" | "none" = 地域なし | 地域の名前)
let activePref = "all";      // 選んだ都道府県("all" | "none" = 県が分からない | 「静岡県」)。県が2つ以上あるときだけ使う
let view = "list";          // "list" | "map"
let myPos = null;           // 現在地 {lat, lng}

// Web版: データはこの端末の中(localdb.js)。PC版と同じ呼び方で読み書きする
async function api(path, opts = {}) {
  return LocalAPI.request(opts.method || "GET", path, opts.body || {});
}

// 消したばかりで、まだ「元に戻す」で戻せるお店(続けて消したら全部ここにたまり、まとめて戻せる)
let undoItems = [];
const undoAct = () => ({ label: "元に戻す", ms: 8000, fn: async () => {
  const back = undoItems; undoItems = [];
  for (const it of back) await api("/api/items/restore", { method: "POST", body: { item: it } });
  await load();
  toast(back.length > 1 ? `${back.length}件を元に戻しました` : "元に戻しました");
} });

// act = { label, fn, ms }: お知らせの中にボタンを1つ出す(「元に戻す」)
function toast(msg, act) {
  // 戻せるお店が残っている間は、ほかのお知らせにも「元に戻す」を付ける(ボタンが消えて戻せなくなるのを防ぐ)
  if (!act && undoItems.length) act = undoAct();
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  if (act) {
    const b = document.createElement("button");
    b.textContent = act.label;
    b.onclick = () => { t.hidden = true; act.fn(); };
    t.appendChild(b);
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; undoItems = []; }, act ? act.ms : 2800);
}

function getPref(k, d) { try { return localStorage.getItem("tottoku-" + k) || d; } catch (e) { return d; } }
function setPref(k, v) { try { localStorage.setItem("tottoku-" + k, v); } catch (e) { /* 保存できなくてもよい */ } }

async function load() {
  let data = { items: [...items, ...memos], folders };
  try { data = await api("/api/items"); } catch (e) { toast("データを読み込めませんでした"); }
  items = (data.items || []).filter((i) => i.category !== "メモ");
  memos = (data.items || []).filter((i) => i.category === "メモ").sort((a, b) => b.created_at - a.created_at || b.id - a.id);
  folders = data.folders || [];
  boxes = data.boxes || [];
  // 名前・地域・フォルダを直したあとに古い答えが残らないよう、覚えたジャンル・県を捨てる(お店は同じものが返ってくるので)
  genreMemo = new WeakMap(); prefMemo = new WeakMap();
  if (typeof activeBox === "number" && !boxes.some((b) => b.id === activeBox)) activeBox = null;
  if (activeFolder !== "all" && activeFolder !== "none" && !boxFolders().some((f) => f.id === activeFolder)) activeFolder = "all";
  render();
  renderMemos();
}

const folderName = (id) => (folders.find((f) => f.id === id) || {}).name;

// ---------------------------------------------------------------- 箱(箱 > フォルダの2段)
// お店の箱: フォルダに入っていればそのフォルダの箱、入っていなければ保存したときの箱
function boxOf(i) {
  const f = folders.find((x) => x.id === i.folder_id);
  return f ? f.box_id ?? null : i.box_id ?? null;
}
const inBoxView = () => typeof activeBox === "number";          // ある箱の中にいる
const gridMode = () => boxes.length > 0 && activeBox == null;    // 最初の画面が箱の並び
const inBox = (i) => !inBoxView() || boxOf(i) === activeBox;
const scoped = () => items.filter(inBox);                        // 今いる箱の中身(箱の外・「すべて」なら全部)
const boxFolders = () => (inBoxView() ? folders.filter((f) => f.box_id === activeBox) : folders);
const boxName = (id) => (boxes.find((b) => b.id === id) || {}).name;
const BOX_TINTS = 5;   // 箱ごとの色(id で決める。並べ替えても色は変わらない)
const tintOf = (id) => (id === "all" ? "all" : (id - 1) % BOX_TINTS);

function fmtDate(sec) {
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------- フォルダ
// 箱の中で作ったフォルダは、その箱に入る
async function createFolder() {
  const where = inBoxView() ? `(箱「${boxName(activeBox)}」に入ります)` : "";
  const name = (prompt(`新しいフォルダの名前${where}\n例:行きたい店、あとで読む、御殿場 焼肉`) || "").trim();
  if (!name) return null;
  const res = await api("/api/folders", { method: "POST", body: { name, box_id: inBoxView() ? activeBox : null } });
  if (res.error) { toast(res.error); return null; }
  toast(`「${name}」を作りました`);
  return res.id;
}


function renderFolders() {
  const box = $("#folders");
  box.innerHTML = "";
  const fl = boxFolders();
  // フォルダが1つも無いときは、段ごと出さない(作るのは 設定 →「フォルダを作る」)。
  // 箱の中では「+ フォルダを作る」だけ出す(その箱のフォルダを作れるように)。箱の並びで探しているときも出さない
  box.parentElement.hidden = (!fl.length && !inBoxView()) || gridMode();
  if (!fl.length) {
    if (activeFolder !== "all") activeFolder = "all";
    if (inBoxView()) {
      const b = document.createElement("button");
      b.className = "fbtn add-folder";
      b.textContent = "+ この箱にフォルダを作る";
      b.onclick = async () => { const id = await createFolder(); if (id) { activeFolder = id; await load(); } };
      box.appendChild(b);
    }
  } else {
    const q = filterQ();
    const mine = scoped();
    const count = (fn) => mine.filter((i) => matches(i, q) && fn(i)).length;
    const entries = [["all", "すべて", count(() => true)]];
    fl.forEach((f) => entries.push([f.id, f.name, count((i) => i.folder_id === f.id)]));
    entries.push(["none", "フォルダなし", count((i) => !folderName(i.folder_id))]);
    entries.forEach(([key, label, n]) => {
      const b = document.createElement("button");
      b.className = "fbtn" + (key === activeFolder ? " on" : "") + (typeof key === "number" ? " sortable" : "");
      b.dataset.key = key;
      b.innerHTML = `<span class="fbtn-name">${escapeHtml(label)}</span><small>${n}</small>`;   // 長い名前は「…」で省く
      b.onclick = () => { activeFolder = key; render(); };
      if (typeof key === "number") attachFolderPress(b, key);
      box.appendChild(b);
    });
  }
  // フォルダの操作は「⋯」ボタン(と、フォルダの長押し)のメニューにまとめる
  const more = $("#folderMore");   // 右端に固定(横にスクロールしても隠れない)
  more.textContent = "⋯";
  more.onclick = () => openFolderMenu(null);
}

// フォルダの長押し(0.5秒)で、そのまま左右に動かして並べ替え。右クリック(PC)はそのフォルダのメニュー。
// 長押し前に指が動いたら(横スクロール)何もしない
function attachFolderPress(b, fid) {
  attachSort(b, { sel: ".fbtn.sortable", scroller: $("#folders"), axis: "x",
    onContext: () => openFolderMenu(fid),
    onDone: (ids) => saveFolderOrder(ids) });
}
// 箱の中で並べ替えたフォルダ(一部)を、全体の並びに戻して保存する
async function saveFolderOrder(subIds) {
  const sub = new Set(subIds);
  const rest = [...subIds];
  const ids = folders.map((f) => (sub.has(f.id) ? rest.shift() : f.id));
  folders.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  render();
  try {
    const res = await api("/api/folders/order", { method: "POST", body: { ids } });
    if (!res || !res.ok) throw new Error("ng");
  } catch (e) { toast("並べ替えを保存できませんでした"); load(); }
}

// ---------------------------------------------------------------- 長押しで並べ替え(箱のカード・フォルダの段で共通)
// 長押し(0.5秒)で持ち上がり、指を離さずに動かすと、重なった所と入れ替わる。離すと置かれ、すぐ保存する。
// o = { sel: 並べ替える仲間, axis: "x" | "xy", scroller: 横に動く段, instant(): 押してすぐ持ち上げる(並べ替え中),
//       onLift(), onDone(ids), onDrop(): 離したとき(動かさなくても), onContext() }
let sortDrag = null;
function attachSort(el, o) {
  let timer = null, st = null, fired = false, moved = false, suppress = false;
  const begin = (x, y) => {
    st = { x, y }; fired = false; moved = false; clearTimeout(timer);
    if (o.instant && o.instant()) { fired = true; liftSort(el, o, x, y); }
    else timer = setTimeout(() => { fired = true; liftSort(el, o, x, y); }, 500);
  };
  const move = (x, y, e) => {
    if (!st) return;
    if (!fired) {
      if (Math.hypot(x - st.x, y - st.y) > 10) { clearTimeout(timer); st = null; }
      return;
    }
    if (e && e.cancelable) e.preventDefault();   // 持ち上げている間は、画面をスクロールさせない
    if (Math.hypot(x - st.x, y - st.y) > 6) moved = true;
    sortTo(x, y);
  };
  const end = () => {
    clearTimeout(timer);
    if (st && fired) { suppress = true; dropSort(moved); }
    st = null; fired = false;
  };
  el.addEventListener("touchstart", (e) => { if (e.touches.length === 1) { const t = e.touches[0]; begin(t.clientX, t.clientY); } }, { passive: true });
  el.addEventListener("touchmove", (e) => { const t = e.touches[0]; move(t.clientX, t.clientY, e); }, { passive: false });
  el.addEventListener("touchend", end);
  el.addEventListener("touchcancel", end);
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
    begin(e.clientX, e.clientY);
    const mm = (ev) => move(ev.clientX, ev.clientY, ev);
    const mu = () => { document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); end(); };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });
  // スマホの長押しメニューは出さない。PC の右クリックはメニュー(あれば)
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!st && !fired && o.onContext) o.onContext(); });
  el.addEventListener("click", (e) => {
    if (suppress) { suppress = false; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
}
function liftSort(el, o, x, y) {
  sortDrag = { el, o, x, y };
  el.classList.add("lifted");
  document.body.classList.add("noselect");
  try { navigator.vibrate && navigator.vibrate(15); } catch (e) { /* 震えなくてもよい */ }
  if (o.onLift) o.onLift();
  // 端まで持っていくと、画面(横の段なら段)が自動で動く
  sortDrag.timer = setInterval(() => {
    const d = sortDrag;
    if (!d) return;
    if (d.o.axis === "x" && d.o.scroller) {
      const r = d.o.scroller.getBoundingClientRect();
      if (d.x < r.left + 30) d.o.scroller.scrollLeft -= 6;
      else if (d.x > r.right - 30) d.o.scroller.scrollLeft += 6;
      else return;
    } else {
      if (d.y < 70) window.scrollBy(0, -8);
      else if (d.y > innerHeight - 70) window.scrollBy(0, 8);
      else return;
    }
    sortTo(d.x, d.y);
  }, 16);
}
function sortTo(x, y) {
  const d = sortDrag;
  if (!d) return;
  d.x = x; d.y = y;
  const hit = document.elementFromPoint(x, y);
  const t = hit && hit.closest(d.o.sel);
  if (!t || t === d.el || t.parentElement !== d.el.parentElement) return;
  const kids = [...d.el.parentElement.children];
  d.el.parentElement.insertBefore(d.el, kids.indexOf(t) > kids.indexOf(d.el) ? t.nextSibling : t);
}
function dropSort(moved) {
  const d = sortDrag;
  if (!d) return;
  sortDrag = null;
  clearInterval(d.timer);
  d.el.classList.remove("lifted");
  document.body.classList.remove("noselect");
  const ids = [...d.el.parentElement.querySelectorAll(d.o.sel)].map((n) => /^\d+$/.test(n.dataset.key) ? Number(n.dataset.key) : n.dataset.key);
  if (moved && d.o.onDone) d.o.onDone(ids);
  if (d.o.onDrop) d.o.onDrop();
}

// フォルダの管理での並べ替え: フォルダを長押しして、上下にドラッグ。離したところに置いて保存する
//   短く押す → そのフォルダのメニュー(名前を変える・削除)
//   長押し前に指が動いた → 一覧のスクロールなので何もしない
let rowDrag = null;   // { row, y, timer }

function renderManageList(focusId) {
  const box = $("#folderOrder");
  box.innerHTML = "";
  folders.forEach((f) => {
    const row = document.createElement("div");
    row.className = "frow";
    row.dataset.fid = f.id;
    const name = document.createElement("button");
    name.className = "frow-name";
    name.textContent = "📁 " + f.name;
    name.onclick = () => { $("#folderDlg").close(); openFolderMenu(f.id); };
    row.appendChild(name);
    attachRowDrag(row);
    if (f.id === focusId) row.classList.add("moved");
    box.appendChild(row);
  });
}

function attachRowDrag(row) {
  let timer = null, st = null, fired = false, moved = false, suppress = false;
  const begin = (x, y) => {
    st = { x, y }; fired = false; moved = false; clearTimeout(timer);
    timer = setTimeout(() => { fired = true; startRowDrag(row, y); }, 400);
  };
  const move = (x, y, e) => {
    if (!st) return;
    if (!fired) {
      if (Math.hypot(x - st.x, y - st.y) > 10) { clearTimeout(timer); st = null; }
      return;
    }
    if (e && e.cancelable) e.preventDefault();
    if (Math.abs(y - st.y) > 4) moved = true;
    dragRowTo(y);
  };
  const end = () => {
    clearTimeout(timer);
    if (st && fired) { suppress = true; finishRowDrag(moved); }
    st = null; fired = false;
  };
  row.addEventListener("touchstart", (e) => { const t = e.touches[0]; begin(t.clientX, t.clientY); }, { passive: true });
  row.addEventListener("touchmove", (e) => { const t = e.touches[0]; move(t.clientX, t.clientY, e); }, { passive: false });
  row.addEventListener("touchend", end);
  row.addEventListener("touchcancel", end);
  row.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
    begin(e.clientX, e.clientY);
    const mm = (ev) => move(ev.clientX, ev.clientY, ev);
    const mu = () => { document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); end(); };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });
  row.addEventListener("contextmenu", (e) => e.preventDefault());   // スマホの長押しメニューを出さない
  row.addEventListener("click", (e) => {
    if (suppress) { suppress = false; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
}

function startRowDrag(row, y) {
  rowDrag = { row, y };
  row.parentElement.querySelectorAll(".moved").forEach((r) => r.classList.remove("moved"));
  row.classList.add("dragging");
  document.body.classList.add("noselect");
  try { navigator.vibrate && navigator.vibrate(15); } catch (e) { /* 震えなくてもよい */ }
  // 一覧の上下の端まで動かしたら、一覧をスクロールする
  rowDrag.timer = setInterval(() => {
    const box = $("#folderOrder"), r = box.getBoundingClientRect();
    if (rowDrag.y < r.top + 30) box.scrollTop -= 6;
    else if (rowDrag.y > r.bottom - 30) box.scrollTop += 6;
    else return;
    dragRowTo(rowDrag.y);
  }, 16);
}

function dragRowTo(y) {
  if (!rowDrag) return;
  rowDrag.y = y;
  const box = $("#folderOrder"), row = rowDrag.row;
  const r0 = box.getBoundingClientRect();
  const hit = document.elementFromPoint(r0.left + r0.width / 2, y);
  const el = hit && hit.closest("#folderOrder .frow");
  if (!el || el === row) return;
  const r = el.getBoundingClientRect();
  box.insertBefore(row, y < r.top + r.height / 2 ? el : el.nextSibling);
}

async function finishRowDrag(moved) {
  if (!rowDrag) return;
  const row = rowDrag.row;
  clearInterval(rowDrag.timer);
  row.classList.remove("dragging");
  document.body.classList.remove("noselect");
  rowDrag = null;
  const ids = [...$("#folderOrder").querySelectorAll(".frow")].map((n) => Number(n.dataset.fid));
  if (!moved || ids.join() === folders.map((f) => f.id).join()) return;
  row.classList.add("moved");
  folders.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  render();
  try {
    const res = await api("/api/folders/order", { method: "POST", body: { ids } });
    if (!res || !res.ok) throw new Error("ng");
  } catch (e) {
    toast("並べ替えを保存できませんでした");
    load();
  }
}

// fid = フォルダのid → そのフォルダのメニュー / null → フォルダの管理(作る・自動で振り分け・一覧)
function openFolderMenu(fid) {
  const dlg = $("#folderDlg");
  const list = $("#folderDlgList");
  list.innerHTML = "";
  const btn = (label, fn, cls = "") => {
    const b = document.createElement("button");
    b.innerHTML = label;
    if (cls) b.className = cls;
    b.onclick = () => { dlg.close(); fn(); };
    list.appendChild(b);
  };
  if (fid == null) {
    $("#folderDlgTitle").textContent = "フォルダの管理";
    $("#folderDlgSub").hidden = !folders.length;
    btn("＋ 新しいフォルダを作る", async () => {
      const id = await createFolder();
      if (id) { activeFolder = id; await load(); offerAutosort(); }
    }, "accent");
    if (folders.length) {
      btn("🗂 自動で振り分け<span class=\"hint\">地名とジャンルで振り分け直す</span>", runAutosort, "accent");
    }
  } else {
    const name = folderName(fid);
    $("#folderDlgTitle").textContent = "📁 " + name;
    $("#folderDlgSub").hidden = true;
    btn("✏️ 名前を変える", async () => {
      const v = (prompt("新しい名前", name) || "").trim();
      if (!v || v === name) return;
      const res = await api(`/api/folders/${fid}`, { method: "PATCH", body: { name: v } });
      if (res && res.error) toast(res.error);
      load();
    });
    btn("🗑 フォルダを削除<span class=\"hint\">中身は消えません</span>", async () => {
      if (!await askYesNo(`フォルダ「${name}」を削除してよろしいですか?`, "中に入っているものは消えずに「フォルダなし」に戻ります。")) return;
      await api(`/api/folders/${fid}`, { method: "DELETE" });
      if (activeFolder === fid) activeFolder = "all";
      load();
    }, "danger");
  }
  $("#folderOrder").hidden = fid != null || !folders.length;
  if (fid == null) renderManageList(null);
  dlg.showModal();
}

async function runAutosort() {
  toast("振り分けています…");
  const res = await api("/api/folders/autosort", { method: "POST", body: {} });
  toast(res.error ? "振り分けに失敗しました" : res.moved ? `${res.moved}件を振り分けました(自分で選んだものはそのまま)` : "振り分け済みです(変更なし)");
  load();
}

// はい・いいえ の確かめ。「はい」で true。外を押す・Esc・「いいえ」は false
function askYesNo(title, sub = "", danger = true) {
  const dlg = $("#askDlg");
  $("#askTitle").textContent = title;
  $("#askSub").textContent = sub;
  $("#askYes").classList.toggle("danger", danger);
  return new Promise((resolve) => {
    let answer = false;
    $("#askYes").onclick = () => { answer = true; dlg.close(); };
    $("#askNo").onclick = () => dlg.close();
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
    dlg.onclose = () => resolve(answer);
    dlg.showModal();
    $("#askNo").focus();   // うっかり Enter で消さないよう、いいえ を選んだ状態にする
  });
}

async function offerAutosort() {
  if (items.some((i) => !i.folder_manual) &&
      await askYesNo("保存済みのものを、自動でフォルダに振り分け直しますか?", "自分で選んだものは動かしません。", false)) runAutosort();
}

// フォルダ選択ダイアログ。ask: 保存した直後に「自動では決められなかった」ときに出す
function openMove(item, ask = false) {
  const dlg = $("#moveDlg");
  const head = dlg.querySelector(".sheet-title");
  head.textContent = ask ? "自動では決められませんでした。\nどこに入れますか?" : "フォルダを選ぶ";
  head.style.whiteSpace = "pre-line";
  $("#moveCancel").textContent = ask ? "あとで" : "閉じる";
  $("#moveName").textContent = item.title || item.url;
  const list = $("#moveList");
  list.innerHTML = "";
  const opt = (label, value, cur, hint = "") => {
    const b = document.createElement("button");
    b.innerHTML = escapeHtml(label) + (hint ? `<span class="hint">${hint}</span>` : "");
    if (cur) b.className = "cur";
    b.onclick = async () => {
      dlg.close();
      // 「フォルダなし」を選んだら、今いる箱の「フォルダなし」に置く(箱の外・すべてにいるときは、今の箱のまま)
      const body = { folder: value };
      if (value === null) body.box = inBoxView() ? activeBox : boxOf(item);
      await api(`/api/items/${item.id}`, { method: "PATCH", body });
      toast(value === "auto" ? "自動で選びました" : "移動しました");
      load();
    };
    list.appendChild(b);
  };
  if (!ask) opt("🗂 自動で選ぶ", "auto", !item.folder_manual, "地名とジャンルで選びます");
  // 今いる箱のフォルダを先に。ほかの箱のフォルダには箱の名前を添える(選ぶと、お店もその箱へ移る)
  const here = boxFolders(), others = folders.filter((f) => !here.includes(f));
  here.forEach((f) => opt("📁 " + f.name, f.id, item.folder_manual && item.folder_id === f.id));
  others.forEach((f) => opt("📁 " + f.name, f.id, item.folder_manual && item.folder_id === f.id,
    escapeHtml(f.box_id != null ? `箱「${boxName(f.box_id)}」` : "箱の外")));
  opt("フォルダなし", null, item.folder_manual && !folderName(item.folder_id));
  $("#moveNew").onclick = async () => {
    dlg.close();
    const id = await createFolder();
    if (!id) return;
    await api(`/api/items/${item.id}`, { method: "PATCH", body: { folder: id } });
    load();
  };
  dlg.showModal();
}

// ---------------------------------------------------------------- メモ・教えてくれた人
function openNote(item) {
  const dlg = $("#noteDlg");
  $("#noteName").textContent = item.title;
  $("#titleInput").value = item.title || "";
  $("#areaInput").value = item.area || "";
  $("#whoInput").value = item.recommender || "";
  $("#noteInput").value = item.note || "";
  const names = [...new Set(items.map((i) => i.recommender).filter(Boolean))].slice(0, 12);
  const box = $("#whoChips");
  box.innerHTML = "";
  names.forEach((n) => {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = n;
    b.onclick = () => { $("#whoInput").value = n; };
    box.appendChild(b);
  });
  // 送る: 編集の画面の中から(カードの「送る」はここにまとめた)
  $("#noteShare").onclick = () => { dlg.close(); shareItem(item); };
  $("#noteSave").onclick = async () => {
    await api(`/api/items/${item.id}`, { method: "PATCH",
      body: { title: $("#titleInput").value.trim() || item.title, area: $("#areaInput").value.trim(),
        recommender: $("#whoInput").value.trim(), note: $("#noteInput").value.trim() } });
    dlg.close(); load();
  };
  dlg.showModal();
}

// ---------------------------------------------------------------- 地域だけ直す(カードの「📍」を押したとき)
// ask=true: 保存した直後に「地域が分かりませんでした」と聞く。閉じたら終わる Promise を返す
function openArea(item, ask = false) {
  const dlg = $("#areaDlg");
  const input = $("#areaOnlyInput");
  const head = dlg.querySelector(".sheet-title");
  head.textContent = ask ? "地域が分かりませんでした。\nどこにありますか?" : "📍 地域";
  head.style.whiteSpace = "pre-line";
  $("#areaCancel").textContent = ask ? "あとで" : "閉じる";
  let finish = () => {};
  let saving = false;
  const closed = new Promise((ok) => { finish = ok; });
  $("#areaName").textContent = item.title;
  input.value = item.area || "";
  // 候補: 座標・住所から分かる地域、ほかのお店で使っている地域(多い順)
  const cands = [];
  const add = (a) => { a = (a || "").trim(); if (a && !cands.includes(a)) cands.push(a); };
  if (item.lat != null && item.lng != null) add(Sorter.placeFromCoords(item.lat, item.lng));
  add(Sorter.areaGroup(item.address));
  const used = new Map();
  items.forEach((i) => { if (i.area) used.set(i.area, (used.get(i.area) || 0) + 1); });
  [...used].sort((a, b) => b[1] - a[1]).forEach(([a]) => add(a));
  const box = $("#areaChips");
  box.innerHTML = "";
  cands.slice(0, 10).forEach((a) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = a;
    b.onclick = () => { input.value = a; if (ask) save(); };   // 聞いているときは、押すだけで決まる
    box.appendChild(b);
  });
  const save = async () => {
    const v = input.value.trim();
    saving = true;
    dlg.close();
    if (v !== (item.area || "")) {
      await api(`/api/items/${item.id}`, { method: "PATCH", body: { area: v } });
      toast(v ? `地域を「${v}」にしました` : "地域を消しました");
      await load();
    }
    finish();
  };
  $("#areaSave").onclick = save;
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); save(); } };
  $("#areaCancel").onclick = () => dlg.close();
  dlg.onclose = () => { if (!saving) finish(); };
  dlg.showModal();
  if (ask) input.blur();   // 候補のボタンがキーボードに隠れないように
  return closed;
}

// ---------------------------------------------------------------- 送る(LINEなど)
async function shareItem(i) {
  const url = i.shop_url || i.url || "";
  const text = `${i.title}${i.area ? `(${i.area})` : ""}`;
  if (navigator.share) {
    try { await navigator.share({ title: i.title, text, url }); } catch (e) { /* やめた */ }
    return;
  }
  window.open("https://line.me/R/share?text=" + encodeURIComponent(`${text}\n${url}`), "_blank");
}

// ---------------------------------------------------------------- 現在地・距離
function getPos() {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { myPos = { lat: p.coords.latitude, lng: p.coords.longitude }; ok(myPos); },
      () => ok(null), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
}

function distKm(i) {
  if (!myPos || i.lat == null) return null;
  const p = Math.PI / 180;
  const h = Math.sin((i.lat - myPos.lat) * p / 2) ** 2 +
    Math.cos(myPos.lat * p) * Math.cos(i.lat * p) * Math.sin((i.lng - myPos.lng) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const fmtKm = (d) => (d < 1 ? `${Math.round(d * 1000)}m` : d < 10 ? `${d.toFixed(1)}km` : `${Math.round(d)}km`);

// ---------------------------------------------------------------- 営業時間
function todayHours(i) {
  if (!i.hours) return i.holiday && i.holiday !== "なし" ? `定休日: ${i.holiday}` : "";
  const wd = WD[new Date().getDay()];
  const m = i.hours.match(new RegExp(`\\[${wd}\\]([^\\[■]*)`));
  if (m) {
    const t = m[1].split("\n").map((s) => s.trim()).filter((s) => /\d{1,2}:\d\d|定休日|休み/.test(s)).join(" / ");
    if (t.includes("定休日")) return "今日は定休日";
    return `今日 ${t}`;
  }
  if (i.holiday && i.holiday.includes(wd)) return "今日は定休日かも";
  return "営業時間";
}

// 「[月] 18:00-05:00 [火] 18:00-05:00 …」を「月〜土 18:00-05:00」のように縮める
function compactHours(text) {
  const body = text.split("■")[0];
  const days = [...body.matchAll(/\[([^\]]+)\]\s*\n([^\[]*)/g)]
    .map((m) => [m[1], m[2].split("\n").map((s) => s.trim()).filter(Boolean)]);
  if (!days.length) return body.trim();
  const groups = [];
  const isTime = (s) => /\d{1,2}:\d\d|定休日|休み/.test(s);
  days.forEach(([d, lines]) => {
    const v = lines.filter(isTime).join(" / ");
    const g = groups[groups.length - 1];
    if (g && g.v === v && d.length === 1 && g.last.length === 1) { g.last = d; g.n++; }
    else groups.push({ first: d, last: d, v, n: 1 });
  });
  const out = groups.map((g) => `${g.first}${g.n > 1 ? (g.n > 2 ? "〜" : "・") + g.last : ""}  ${g.v}`);
  const rest = days[days.length - 1][1].filter((s) => !isTime(s)).join("\n");
  return out.join("\n") + (rest ? "\n" + rest : "");
}

// ---------------------------------------------------------------- 地域とジャンルで絞り込む(2段のボタン。自動で作る)
// 1段目が地域(御殿場 4・沼津 2…)、2段目がジャンル(焼肉 3・寿司 1…)。「すべて」でもフォルダの中でも出る。
// 件数は、もう一方の段・フォルダ・検索で絞ったあとの数。選んでいるボタンをもう一度押すと外れる。
// フォルダは増やさない。選べるものが2つ以上あるときだけ出す。
const GENRE_NAMES = new Set(Object.keys(Sorter.GENRES));
const GENRE_LABEL = { "蕎麦": "蕎麦・うどん", "お好み焼き": "お好み焼き・たこ焼き", "バー": "バー・お酒" };   // ボタンに出す名前(うどんの店も「蕎麦」に入るので)
let genreMemo = new WeakMap();   // load() のたびに作り直す
function genreOf(i) {
  if (!genreMemo.has(i)) genreMemo.set(i, genreOf0(i));
  return genreMemo.get(i);
}
// 場所(お店・お出かけ先)かどうか。サイト・動画・買い物などは false(決め方は localdb.js)
const isPlace = LocalAPI.isPlace;
function genreOf0(i) {
  if (!isPlace(i)) return "その他";
  const t = (i.tags || []).find((g) => GENRE_NAMES.has(g));
  if (t) return t;
  const d = Sorter.detectGenres([i.title, ...(i.tags || []), i.summary, i.description].join(" "))[0];
  if (d) return d;
  const fg = Sorter.detectGenres(folderName(i.folder_id) || "");   // 「イタリアン」フォルダに入れたなら、イタリアン
  return fg.length === 1 ? fg[0] : "その他";
}
// お店の「地域」(無ければ住所)を市区町村ごとにまとめる。地域が分からないものは ""(地域なし)。
const areaOf = (i) => Sorter.areaGroup(i.area) || Sorter.areaGroup(i.address) || "";
// お店の都道府県。住所に書いてあればそれ、無ければ地域の名前から。地域なし = ""、地域はあるが県が決まらない = "none"
let prefMemo = new WeakMap();    // load() のたびに作り直す
function prefKey(i) {
  if (!prefMemo.has(i)) {
    const a = areaOf(i);
    prefMemo.set(i, a ? Sorter.prefIn(i.address) || Sorter.prefOf(a) || "none" : "");
  }
  return prefMemo.get(i);
}
const prefLabel = (p) => (p === "none" ? "県が分からない" : p === "北海道" ? p : p.slice(0, -1));   // 「静岡県」→「静岡」
// 県が2つ以上あるときだけ、地域の段を「県 → 市」の2段にする
const manyPrefs = (list) => new Set(list.map(prefKey).filter((p) => p && p !== "none")).size >= 2;
function inArea(i) {
  if (activePref !== "all" && prefKey(i) !== activePref) return false;
  if (activeArea === "all") return true;
  return activeArea === "none" ? isPlace(i) && !areaOf(i) : areaOf(i) === activeArea;   // 「地域なし」は場所だけ(サイトや動画は数えない)
}
const inGenre = (i) => !activeGenre || genreOf(i) === activeGenre;
const areaLabel = () => (activeArea === "none" ? "地域なし" : activeArea !== "all" ? activeArea : prefLabel(activePref));
const areaPicked = () => activeArea !== "all" || activePref !== "all";

// 選んでいる地域・ジャンルに当たるものが無くなったら(フォルダを変えた・検索した・消した)、外す
function fixFilters() {
  const q = filterQ();
  const base = scoped().filter((i) => inFolder(i) && matches(i, q));
  if (!manyPrefs(base)) activePref = "all";
  else if (activePref === "all" && activeArea !== "all" && activeArea !== "none") {
    // 市を選んだまま、県が2つ以上ある所へ移った: その市の県を選んだことにする(段の表示と合わせる)
    const hit = base.find((i) => areaOf(i) === activeArea);
    if (hit) activePref = prefKey(hit);
  }
  if (activePref !== "all" && !base.some((i) => prefKey(i) === activePref)) activePref = "all";
  if (activeArea !== "all" && !base.some(inArea)) activeArea = "all";
  if (activeGenre && !base.some((i) => inArea(i) && inGenre(i))) activeGenre = null;
}
// mark: 段の左端の印(📍・🍴。押せない)。rows: [値, 名前, 件数] の並び。cur: 今の値。pick(値): 押したとき
// 「全地域」「全ジャンル」のボタンは置かない(選んだボタンをもう一度押すか「✕ 解除」で外れる)
const PIN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const FORK_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8a2 2 0 0 0 4 0V3"/><path d="M9 11v10"/><path d="M17 3c-2 2-2 6 0 8v10"/></svg>';
function chipRow(box, mark, rows, cur, pick) {
  box.innerHTML = `<span class="chip-mark" aria-hidden="true">${mark}</span>`;
  rows.forEach(([v, label, n]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (v === cur ? " on" : "");
    b.innerHTML = `${escapeHtml(label)}<small>${n}</small>`;
    b.onclick = () => { pick(v); render(); };
    box.appendChild(b);
  });
  box.hidden = false;
}
function renderAreas() {
  const box = $("#areaBar");
  const q = filterQ();
  const base = scoped().filter((i) => isPlace(i) && inFolder(i) && matches(i, q));   // 場所だけで数える
  if (new Set(base.map(areaOf)).size < 2) { box.hidden = true; box.innerHTML = ""; return; }
  const tally = (list, keyOf) => {
    const count = new Map();
    list.forEach((i) => { const k = keyOf(i); count.set(k, (count.get(k) || 0) + 1); });
    return count;
  };
  const byN = (x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "ja");
  const shown = base.filter(inGenre);
  if (manyPrefs(base) && activePref === "all") {
    // 1段目: 県(東京 12・静岡 8)。押すと、その県の市区町村だけになる
    const count = tally(shown, prefKey);
    const rows = [...count].filter(([p]) => p && p !== "none").sort(byN).map(([p, n]) => ["p:" + p, prefLabel(p), n]);
    if (count.has("none")) rows.push(["p:none", "県が分からない", count.get("none")]);
    if (count.has("")) rows.push(["none", "地域なし", count.get("")]);
    chipRow(box, PIN_SVG, rows, activeArea, (v) => {
      if (v.startsWith("p:")) { activePref = v.slice(2); activeArea = "all"; }
      else activeArea = v === activeArea ? "all" : v;
    });
    return;
  }
  const count = tally(shown.filter((i) => activePref === "all" || prefKey(i) === activePref), areaOf);
  const rows = [...count].filter(([a]) => a).sort(byN).map(([a, n]) => [a, a, n]);
  if (count.has("")) rows.push(["none", "地域なし", count.get("")]);
  // 県を選んでいるときは、先頭に「‹ 静岡」(押すと県の一覧に戻る)
  if (activePref !== "all") rows.unshift(["back", "‹ " + prefLabel(activePref), base.filter((i) => inGenre(i) && prefKey(i) === activePref).length]);
  chipRow(box, PIN_SVG, rows, activePref !== "all" && activeArea === "all" ? "back" : activeArea, (v) => {
    if (v === "back") { activePref = "all"; activeArea = "all"; }
    else activeArea = v === activeArea ? "all" : v;
  });
}
function renderGenres() {
  const box = $("#genreBar");
  const q = filterQ();
  const base = scoped().filter((i) => inFolder(i) && matches(i, q));
  if (new Set(base.map(genreOf)).size < 2) { box.hidden = true; box.innerHTML = ""; return; }
  const shown = base.filter(inArea);
  const count = new Map();
  shown.forEach((i) => { const g = genreOf(i); count.set(g, (count.get(g) || 0) + 1); });
  const order = [...count].sort((a, b) => (a[0] === "その他") - (b[0] === "その他") || b[1] - a[1]);
  const rows = order.map(([g, n]) => [g, GENRE_LABEL[g] || g, n]);
  chipRow(box, FORK_SVG, rows, activeGenre, (v) => { activeGenre = v === activeGenre ? null : v; });
}
// 今の絞り込みを1行で見せる(「📍御殿場 × 🍴焼肉 3件 ✕ 解除」)。地域もジャンルも選んでいなければ出さない
function renderFilterLine(n) {
  const box = $("#filterLine");
  const parts = [];
  if (areaPicked()) parts.push("📍" + areaLabel());
  if (activeGenre) parts.push("🍴" + (GENRE_LABEL[activeGenre] || activeGenre));
  box.hidden = !parts.length;
  if (!parts.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<span class="fl-what">${escapeHtml(parts.join(" × "))}</span><span class="fl-n">${n}件</span><button type="button">✕ 解除</button>`;
  box.querySelector("button").onclick = () => { activeArea = "all"; activePref = "all"; activeGenre = null; render(); };
}

// ---------------------------------------------------------------- 一覧
function inFolder(i) {
  if (activeFolder === "all") return true;
  if (activeFolder === "none") return !folderName(i.folder_id);
  return i.folder_id === activeFolder;
}


// 比べるための正規化: 全角/半角・大文字小文字・カタカナ/ひらがなの違いをなくす
function kn(s) {
  return String(s || "").normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
function matches(i, q) {
  if (!q) return true;
  const hay = kn([i.title, i.area, i.address, i.summary, i.description, i.note, i.review, i.recommender, i.site,
    i.category, i.shared_text, folderName(i.folder_id), ...(i.tags || [])].join(" "));
  return kn(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
// 検索欄は「保存」(保存したものを絞り込む)と「Web」(同じ言葉でGoogleなどを開く)を切り替える
let searchMode = getPref("smode", "saved") === "web" ? "web" : "saved";
const searchText = () => $("#filterInput").value.trim();
const filterQ = () => (searchMode === "web" ? "" : searchText());

function currentList() {
  const q = filterQ();
  const base = scoped().filter((i) => inFolder(i) && matches(i, q) && inGenre(i) && inArea(i));
  let list = base;
  if ($("#sortSel").value === "near") list.sort((a, b) => (distKm(a) ?? 1e9) - (distKm(b) ?? 1e9));
  return list;
}

// バックアップのお知らせ: 5件以上あって、前回の書き出し(無ければ最初の保存)から30日たったら出す。
// 「あとで」で7日休む。通信はしない(この端末の中の日付を見るだけ)。
function renderBackup() {
  const box = $("#remind");
  const DAY = 86400000, now = Date.now();
  const last = Number(getPref("exportedAt", 0)) || 0;
  const every = [...items, ...memos];   // メモも数える(メモばかりの人にも出す)
  const first = every.reduce((m, i) => Math.min(m, (i.created_at || 0) * 1000 || now), now);
  const due = every.length >= 5 && now - (last || first) > 30 * DAY && now > (Number(getPref("backupSnooze", 0)) || 0);
  box.hidden = !due;
  if (!due) return;
  box.innerHTML = `<p class="remind-title">💾 バックアップを取りませんか</p>
    <p class="remind-text">${last ? "前回の書き出しから1か月以上たちました。" : "まだ一度も書き出していません。"}データはこのスマホの中だけにあり、機種変更やブラウザのデータ削除で消えます。</p>
    <div class="remind-btns"><button id="backupNow" class="go">書き出す</button><button id="backupLater">あとで</button></div>`;
  $("#backupNow").onclick = () => $("#exportBtn").click();
  $("#backupLater").onclick = () => { setPref("backupSnooze", now + 7 * DAY); renderBackup(); };
}

function render() {
  renderBackup();
  renderHeader();
  // 箱が1つでもあれば、最初の画面は箱の並び。そこで「保存済み」を探しているときは、全部から探した一覧を出す
  const grid = gridMode(), searching = grid && !!filterQ();
  $("#boxHome").hidden = !grid || searching;
  $("#listArea").hidden = grid && !searching;
  if (grid && !searching) { renderBoxes(); renderSearchNote([]); return; }
  renderFolders();
  fixFilters();
  renderAreas();
  renderGenres();
  const list = currentList();
  renderFilterLine(list.length);
  document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $("#empty").hidden = items.length > 0;
  $("#boxEmpty").hidden = !(inBoxView() && items.length && !scoped().length);
  const ul = $("#list");
  ul.innerHTML = "";
  $("#mapBox").hidden = view !== "map";
  ul.hidden = view === "map";
  if (view === "map") renderMap(list);
  else list.forEach((i) => ul.appendChild(card(i)));
  renderSearchNote(list);
}

function renderSearchNote(list) {
  const fn = $("#filterNote");
  if (searchMode === "web") {
    const w = searchText();
    fn.hidden = !w;
    if (w) fn.innerHTML = webLinks(w, true);
    return;
  }
  const q = filterQ();
  fn.hidden = !q;
  if (q) {
    fn.innerHTML = (list.length
      ? `<span>保存したもの <b>${list.length}件</b></span> <button type="button" class="link" id="filterShow">見る ↓</button>`
      : `<span>保存したものには見つかりません</span>`) +
      ` <button type="button" class="link" id="filterClear">解除</button>` + webLinks(q);
    $("#filterClear").onclick = () => { $("#filterInput").value = ""; render(); };
    if (list.length) $("#filterShow").onclick = showResults;
  }
}

// キーボードを閉じて、一覧の先頭を見せる
function showResults() {
  $("#filterInput").blur();
  setTimeout(() => (view === "map" ? $("#mapBox") : $("#list")).scrollIntoView({ behavior: "smooth", block: "start" }), 150);
}

function card(i) {
  const el = $("#cardTpl").content.firstElementChild.cloneNode(true);
  const link = i.url || "#";
  if (i.status === "processing") el.classList.add("processing");
  const th = el.querySelector(".thumb");
  th.href = link;
  // 絵が無いときは、箱の名前(2026-11-25 きよさん。ジャンルはフォルダの札で分かるので)を、種類ごとの淡い色の上に出す。
  // 箱に入っていなければ、今までどおりジャンル(焼肉・スイーツ…)か種類(動画・買い物…)
  const g = genreOf(i);
  const bname = boxOf(i) != null ? boxName(boxOf(i)) : "";
  // 色: 箱に入っていれば箱のカードと同じ色(種類ごとだと同じ箱の中で色がばらばらになるため)。箱の外は種類ごとの色
  if (bname) th.classList.add("bt", "tint-" + tintOf(boxOf(i)));
  else th.classList.add("k-" + (KIND_TINT[i.category] ?? 4));
  const noimg = () => {
    th.classList.add("noimg");
    th.textContent = bname || (g !== "その他" ? (GENRE_LABEL[g] || g).split("・")[0] : i.category);
    if (th.textContent.length > 6) th.classList.add("long");
  };
  if (i.image) {
    th.querySelector("img").src = i.image;
    th.querySelector("img").onerror = noimg;
  } else noimg();
  el.querySelector(".cat").textContent = i.status === "processing" ? "整理中…" : "";   // 種類(その他・飲食店…)は左の四角と重なるので出さない
  const d = distKm(i);
  el.querySelector(".dist").textContent = d != null ? "📍" + fmtKm(d) : "";
  // 保存した日時は出さない(2026-11-25 きよさん「いらない」。並びの「新しい順」は今までどおり)。サイト名だけ残す
  el.querySelector(".date").textContent = i.site ? i.site.replace(/^www\./, "") : "";
  const meta = el.querySelector(".meta");
  if (![...meta.children].some((s) => s.textContent)) meta.remove();
  const t = el.querySelector(".title");
  t.textContent = i.title || i.url; t.href = link;
  el.querySelector(".summary").textContent = i.summary || "";

  const ft = el.querySelector(".folder-tag");
  const fname = folderName(i.folder_id);
  if (folders.length || fname) {
    // フォルダを変えるのは、この表示を押す(カードの「フォルダ」ボタンは 2026-11-11 に外した)
    ft.textContent = (fname ? `${fname}${i.folder_manual ? "" : " ✨"}` : "フォルダなし") + " ▾";
    ft.title = fname && !i.folder_manual ? "自動で選んだフォルダ" : "";
    if (fname) ft.classList.add("set");
    ft.onclick = () => openMove(i);
  } else ft.remove();

  // 地域(分かっていれば濃く表示。分からなければ薄く「地域を入れる」)。押すと地域を直せる
  const at = el.querySelector(".area-tag");
  const place = i.area || areaOf(i);
  if (isPlace(i)) {
    at.textContent = place ? place : "+ 地域を入れる";
    if (place) at.classList.add("set");
    at.title = "地域を直す";
    at.onclick = () => openArea(i);
  } else at.remove();   // サイト・動画・買い物には出さない(地域を付けたいときは「編集」から)

  el.querySelector(".who").textContent = i.recommender ? `👤 ${i.recommender}のおすすめ` : "";

  const si = el.querySelector(".shopinfo");
  const today = todayHours(i);
  if (today || i.address || i.tel) {
    si.hidden = false;
    const sum = si.querySelector("summary");
    sum.textContent = "🕒 " + (today || "くわしい情報");
    if (/定休日/.test(today)) sum.classList.add("closed");
    const rows = [];
    if (i.address) rows.push(`<div><b>住所</b>${escapeHtml(i.address)}</div>`);
    if (i.tel) rows.push(`<div><b>電話</b><a href="tel:${escapeHtml(i.tel.replace(/[^\d+]/g, ""))}">${escapeHtml(i.tel)}</a></div>`);
    if (i.holiday) rows.push(`<div><b>定休日</b>${escapeHtml(i.holiday)}</div>`);
    if (i.hours) rows.push(`<div><b>営業時間</b><pre>${escapeHtml(compactHours(i.hours))}</pre></div>`);
    if (i.shop_url && i.shop_url !== i.url) rows.push(`<div><a href="${escapeHtml(i.shop_url)}" target="_blank" rel="noopener">食べログで見る ↗</a></div>`);
    si.querySelector(".shopinfo-body").innerHTML = rows.join("");
  }

  el.querySelector(".note").textContent = i.note || "";

  const rsv = el.querySelector(".act-reserve");
  if (i.reserve_url) {  // ネット予約できるお店だけ表示
    rsv.hidden = false;
    rsv.href = i.reserve_url;
    const site = new URL(i.reserve_url).hostname;
    rsv.title = "予約ページを開く(" + site + ")";
  }
  const mapBtn = el.querySelector(".act-map");
  if (i.category === "飲食店" || i.category === "お出かけ" || i.lat) {
    mapBtn.hidden = false;
    mapBtn.onclick = () => {
      const q = i.lat ? `${i.lat},${i.lng}` : `${i.title} ${i.area || ""}`;
      window.open("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q), "_blank");
    };
  }
  el.querySelector(".act-note").onclick = () => openNote(i);
  el.querySelector(".act-share").onclick = () => shareItem(i);   // 編集の横の共有アイコン
  el.querySelector(".act-del").onclick = async () => {
    // はい・いいえ で確かめてから消す。消したあと8秒だけ「元に戻す」も出す。続けて消したら、まとめて戻せる
    const short = (i.title || "").length > 20 ? i.title.slice(0, 19) + "…" : (i.title || "これ");
    if (!await askYesNo("削除してよろしいですか?", `「${short}」`)) return;
    await api(`/api/items/${i.id}`, { method: "DELETE" });
    undoItems.push(i);
    await load();
    const name = (i.title || "").length > 14 ? i.title.slice(0, 13) + "…" : i.title;
    toast(undoItems.length > 1 ? `${undoItems.length}件を削除しました` : `「${name}」を削除しました`, undoAct());
  };
  return el;
}

// ---------------------------------------------------------------- 地図
let map = null, mapLayer = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (loadLeaflet.p) return loadLeaflet.p;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
  document.head.appendChild(css);
  loadLeaflet.p = new Promise((ok, ng) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    s.onload = ok; s.onerror = ng;
    document.head.appendChild(s);
  });
  return loadLeaflet.p;
}

async function renderMap(list) {
  const note = $("#mapNote");
  try { await loadLeaflet(); } catch (e) { note.textContent = "地図を読み込めませんでした(インターネットにつながっているか確認してください)"; return; }
  if (!map) {
    map = L.map("map", { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
  }
  mapLayer.clearLayers();
  const pts = [];
  const placed = list.filter((i) => i.lat != null);
  placed.forEach((i) => {
    const icon = L.divIcon({ className: "pin",
      html: `<span>${ICONS[i.category] || "•"}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    const d = distKm(i);
    const html = `<b>${escapeHtml(i.title)}</b><br><small>${escapeHtml(i.area || "")}${d != null ? " · " + fmtKm(d) : ""}</small>` +
      (todayHours(i) ? `<br><small>${escapeHtml(todayHours(i))}</small>` : "") +
      `<br><a href="${escapeHtml(i.url || "#")}" target="_blank" rel="noopener">開く</a>` +
      (i.reserve_url ? ` · <a href="${escapeHtml(i.reserve_url)}" target="_blank" rel="noopener">予約</a>` : "");
    mapLayer.addLayer(L.marker([i.lat, i.lng], { icon }).bindPopup(html));
    pts.push([i.lat, i.lng]);
  });
  if (myPos) {
    L.circleMarker([myPos.lat, myPos.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#1c7ed6", fillOpacity: 1 })
      .bindPopup("現在地").addTo(mapLayer);
  }
  setTimeout(() => {
    map.invalidateSize();
    if (pts.length) map.fitBounds(myPos && $("#sortSel").value === "near" ? [...pts, [myPos.lat, myPos.lng]] : pts,
      { padding: [30, 30], maxZoom: 15 });
    else map.setView(myPos ? [myPos.lat, myPos.lng] : [35.68, 139.76], 11);
  }, 30);
  const missing = list.length - placed.length;
  note.textContent = `${placed.length}件を表示中` + (missing ? `(場所が分からない${missing}件は出ていません)` : "");
}

// ---------------------------------------------------------------- 箱の画面(最初の画面の箱の並び・箱の中の見出し)
const pad2 = (n) => String(n).padStart(2, "0");
const shortName = (t) => { t = String(t || "").replace(/\s*\([^)]*\)\s*$/, ""); return t.length > 10 ? t.slice(0, 9) + "…" : t; };
let moveMode = false;   // 箱の並べ替え中

function renderHeader() {
  const inside = boxes.length > 0 && activeBox != null;
  $("#brand").hidden = inside;
  $("#boxBack").hidden = !inside;
  $("#boxMenuBtn").hidden = !inBoxView();
  if (!inside) return;
  $("#boxTitle").textContent = activeBox === "all" ? "すべて" : boxName(activeBox);
  const c = $("#boxCount");
  c.textContent = scoped().length;
  c.className = "box-count tint-" + tintOf(activeBox);
  $("#boxBack").setAttribute("aria-label", `箱の並びに戻る(今は「${$("#boxTitle").textContent}」)`);
}

// 「すべて」「メモ」の箱の位置(0から)。前の版の並び(すべて・メモが先頭)が既定
function fixedPos() {
  try {
    const p = JSON.parse(getPref("fixedPos", "{}"));
    if (p.all >= 0 && p.memo >= 0 && p.all !== p.memo) return p;
  } catch (e) { /* 読めなければ既定 */ }
  return { all: 0, memo: 1 };
}

function renderBoxes() {
  const grid = $("#boxGrid");
  grid.innerHTML = "";
  grid.classList.toggle("moving", moveMode);
  $("#boxStat").textContent = `${boxes.length} はこ / ${items.length} 件`;
  // 「すべて」と「メモ」(押すとメモの画面)は決まった箱。消せないが、並べ替えはできる。
  // 箱の順はデータに、この2つの位置はこの端末(tottoku-fixedPos)に覚える
  const cards = boxes.map((b) => ({ key: b.id, name: b.name, list: items.filter((i) => boxOf(i) === b.id) }));
  const fixedCards = [{ key: "all", name: "すべて", list: items }, { key: "memo", name: "メモ", list: memos }];
  const pos = fixedPos();
  fixedCards.sort((a, b) => pos[a.key] - pos[b.key])
    .forEach((c) => cards.splice(Math.min(pos[c.key], cards.length), 0, c));
  cards.forEach((c, n) => {
    const a = document.createElement("button");
    a.type = "button";
    a.className = `box-card tint-${c.key === "memo" ? 1 : tintOf(c.key)} sortable`;
    a.dataset.key = c.key;
    a.innerHTML = `<span class="box-no"></span><span class="box-name"></span><span class="box-sub"></span><span class="box-n"></span>`;
    a.querySelector(".box-no").textContent = `${pad2(n + 1)} / ${pad2(cards.length)}`;
    a.querySelector(".box-name").textContent = c.name;
    // 説明: 「すべて」は決まった文、ほかは新しいもの2つの名前
    a.querySelector(".box-sub").textContent = c.key === "all" ? "箱の外のものも全部"
      : c.key === "memo" ? (c.list.slice(0, 2).map((m) => shortName(m.shared_text || m.url || m.title || "")).join("、") || "思いついたことを書く")
      : c.list.slice(0, 2).map((i) => shortName(i.title || i.site)).join("、") || "まだ空です";
    a.querySelector(".box-n").textContent = c.list.length;
    a.setAttribute("aria-label", `${c.name}(${c.list.length}件)`);
    a.onclick = () => { if (moveMode) return; if (c.key === "memo") $("#memoBtn").click(); else enterBox(c.key); };
    attachSort(a, { sel: ".box-card.sortable", axis: "xy", instant: () => moveMode,
      onLift: () => { if (!moveMode) { moveMode = true; grid.classList.add("moving"); } },
      onDone: (keys) => {
        setPref("fixedPos", JSON.stringify({ all: keys.indexOf("all"), memo: keys.indexOf("memo") }));
        saveBoxOrder(keys.filter((k) => typeof k === "number"));
      },
      onDrop: endMove });   // 指を離したら、そこで並べ替えを終わる(2026-11-26 きよさん)
    grid.appendChild(a);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "box-add";
  add.textContent = "+ 箱を作る";
  add.onclick = () => { if (!moveMode) createBox(); };
  grid.appendChild(add);
}
// 並べ替え中: 指を離すと終わる(「並べ替え中」の帯と「完了」は 2026-11-26 に外した)。すきま・Esc でも終わる
function endMove() { if (!moveMode) return; moveMode = false; render(); }
$("#boxGrid").addEventListener("click", (e) => { if (moveMode && e.target === e.currentTarget) endMove(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && moveMode) endMove(); });

async function saveBoxOrder(ids) {
  boxes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  try {
    const res = await api("/api/boxes/order", { method: "POST", body: { ids } });
    if (!res || !res.ok) throw new Error("ng");
  } catch (e) { toast("並べ替えを保存できませんでした"); load(); return; }
  renderBoxes();
}

// 箱に入る(スマホの「戻る」で箱の並びに戻れるよう、履歴を1つ足す)
function enterBox(key) {
  history.pushState({ box: key }, "");
  activeBox = key;
  activeFolder = "all"; activeArea = "all"; activePref = "all"; activeGenre = null;
  render();
  window.scrollTo(0, 0);
}
function leaveBox() {
  activeBox = null;
  activeFolder = "all"; activeArea = "all"; activePref = "all"; activeGenre = null;
  render();
  window.scrollTo(0, 0);
}
$("#boxBack").onclick = () => { if (history.state && history.state.box != null) history.back(); else leaveBox(); };

async function createBox() {
  const name = (prompt("新しい箱の名前(例:食事、サイト、イベント、旅行)") || "").trim();
  if (!name) return null;
  const res = await api("/api/boxes", { method: "POST", body: { name } });
  if (res.error) { toast(res.error); return null; }
  await load();
  toast(`箱「${name}」を作りました`);
  if (folders.length) chooseBoxFolders(res.id);   // 今あるフォルダから、この箱に入れるものを選んでもらう
  return res.id;
}

// 箱に入れるフォルダを選ぶ(押すたびに入れる・出すが切り替わり、すぐ保存する)
function chooseBoxFolders(bid) {
  const dlg = $("#folderDlg"), list = $("#folderDlgList");
  $("#folderDlgTitle").textContent = `箱「${boxName(bid)}」に入れるフォルダ`;
  $("#folderDlgSub").hidden = true;
  $("#folderOrder").hidden = true;
  const fill = () => {
    list.innerHTML = "";
    folders.forEach((f) => {
      const b = document.createElement("button");
      const on = f.box_id === bid;
      b.className = on ? "cur" : "";
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = (on ? "✓ " : "") + "📁 " + escapeHtml(f.name) +
        (!on && f.box_id != null ? `<span class="hint">今は箱「${escapeHtml(boxName(f.box_id))}」</span>` : "");
      b.onclick = async () => {
        await api(`/api/folders/${f.id}`, { method: "PATCH", body: { box_id: on ? null : bid } });
        await load();
        fill();
      };
      list.appendChild(b);
    });
    if (!folders.length) list.innerHTML = `<p class="sheet-sub">フォルダはまだありません。箱の中で作れます。</p>`;
  };
  fill();
  $("#folderDlgClose").textContent = "決める";
  dlg.addEventListener("close", () => { $("#folderDlgClose").textContent = "閉じる"; }, { once: true });
  if (!dlg.open) dlg.showModal();
}

// 箱のメニュー(箱の中の見出しの「⋯」): 名前を変える・入れるフォルダを選ぶ・箱を削除
function openBoxMenu(bid) {
  const dlg = $("#folderDlg"), list = $("#folderDlgList");
  const name = boxName(bid);
  $("#folderDlgTitle").textContent = "📦 " + name;
  $("#folderDlgSub").hidden = true;
  $("#folderOrder").hidden = true;
  list.innerHTML = "";
  const btn = (label, fn, cls = "") => {
    const b = document.createElement("button");
    b.innerHTML = label;
    if (cls) b.className = cls;
    b.onclick = () => { dlg.close(); fn(); };
    list.appendChild(b);
  };
  btn("📁 入れるフォルダを選ぶ", () => chooseBoxFolders(bid), "accent");
  btn("✏️ 名前を変える", async () => {
    const v = (prompt("新しい名前", name) || "").trim();
    if (!v || v === name) return;
    const res = await api(`/api/boxes/${bid}`, { method: "PATCH", body: { name: v } });
    if (res && res.error) toast(res.error);
    load();
  });
  btn("🗑 箱を削除<span class=\"hint\">中のフォルダ・お店は消えません</span>", async () => {
    if (!await askYesNo(`箱「${name}」を削除してよろしいですか?`, "中のフォルダやお店は消えずに、箱の外(「すべて」)に戻ります。")) return;
    await api(`/api/boxes/${bid}`, { method: "DELETE" });
    if (history.state && history.state.box != null) history.back(); else leaveBox();
    await load();
    toast(`箱「${name}」を削除しました`);
  }, "danger");
  dlg.showModal();
}
$("#boxMenuBtn").onclick = () => { if (inBoxView()) openBoxMenu(activeBox); };

// ---------------------------------------------------------------- 入力
// 保存: 「保存」を押したら、フォルダを選ぶ画面を出してから保存する。
// URLだけのときは、その画面に名前の欄も出す(通信しないので題名を取れず、そのままだとサイト名になるため)。
// メモの欄はいつも出す。URLの無い文のときは「メモとして保存」も選べる(種類が「メモ」になり、地域を聞かない)。
const bareUrl = (v) => /^https?:\/\/\S+$/.test(v);
const needsName = (v) => bareUrl(v) && !/google\.[^/]+\/maps\/place\//.test(v);   // マップの場所のURLは名前が入っている
function startSave() {
  const v = $("#addInput").value.trim();
  if (!v) return;
  $("#addInput").blur();
  $("#clipBar").hidden = true;
  const ask = needsName(v);
  const dlg = $("#saveDlg");
  $("#saveName").textContent = v.length > 60 ? v.slice(0, 60) + "…" : v;
  const nameIn = $("#saveTitleInput");
  nameIn.hidden = !ask;
  nameIn.value = "";
  // メモの欄(いつも出す)と、「メモとして保存」(URLの無い文のときだけ。メモらしい文なら最初から印を付ける)
  const noteIn = $("#saveNoteInput"), memoChk = $("#saveMemoChk");
  noteIn.value = "";
  const hasUrl = /https?:\/\//.test(v);
  $("#saveMemoRow").hidden = hasUrl;
  memoChk.checked = !hasUrl && memoLike(v);
  // 保存の画面で入れたもの: 名前(URLだけのとき)・メモ・メモとして保存するか
  const name = () => ({ name: ask ? nameIn.value.trim() : "", note: noteIn.value.trim(), kind: !hasUrl && memoChk.checked ? "memo" : "" });
  const list = $("#saveList");
  list.innerHTML = "";
  const opt = (label, fid, cls = "") => {
    const b = document.createElement("button");
    b.innerHTML = label;
    if (cls) b.className = cls;
    b.onclick = () => { dlg.close(); saveItem(v, fid, name()); };
    list.appendChild(b);
  };
  // メモとして保存するときは、フォルダを聞かない(メモはメモの画面にだけ出る)
  const fill = () => {
    const memo = !hasUrl && memoChk.checked;
    list.innerHTML = "";
    const fl = boxFolders();
    $("#saveHead").textContent = memo ? "メモに保存します" : fl.length ? "どのフォルダに入れますか?" : inBoxView() ? `箱「${boxName(activeBox)}」に保存します` : "保存します";
    $("#saveNew").hidden = memo;
    if (memo) opt("📝 メモに保存する", null, "accent");
    else if (fl.length) {
      opt('🗂 自動で選ぶ<span class="hint">名前・地名・種類で振り分け</span>', null, "accent");
      boxFolders().forEach((f) => opt("📁 " + escapeHtml(f.name), f.id));
    } else opt("保存する", null, "accent");
  };
  memoChk.onchange = fill;
  fill();
  $("#saveNew").onclick = async () => {
    const nm = name();
    dlg.close();
    const id = await createFolder();
    if (id) { await load(); saveItem(v, id, nm); }
  };
  dlg.showModal();
  if (dlg.contains(document.activeElement)) document.activeElement.blur();   // 開いただけでキーボードを出さない(フォルダの一覧が隠れる)
}
// メモらしい文: 「。」「?」があり、ひらがなが入った8文字以上の文で、料理のジャンルも地名も無い。
// 長いだけの名前・「!」の付く店名(「やよい軒!」)・短い名前(「モーニング娘。」)には印を付けない
const memoLike = (v) => /[。｡?？]/.test(v) && /[ぁ-ん]/.test(v) && v.length >= 8 && !Sorter.detectGenres(v).length && !Sorter.detectPlace(v);
$("#addForm").onsubmit = (e) => { e.preventDefault(); startSave(); };
$("#saveTitleInput").onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.target.blur(); } };   // 「完了」でキーボードを閉じる

async function saveItem(v, fid, extra = {}) {
  const body = /^https?:\/\//.test(v) ? (bareUrl(v) ? { url: v, name: extra.name || "" } : { url: "", text: v }) : { text: v };
  body.folder_id = fid;
  body.box_id = inBoxView() ? activeBox : null;   // 箱の中で保存したら、その箱のフォルダから選ぶ
  body.note = extra.note || "";
  body.kind = extra.kind || "";
  $("#addInput").value = "";
  try {
    const res = await api("/api/items", { method: "POST", body });
    await afterSave(res.id, fid == null, res.learned, res.named);
  } catch (err) {
    toast("保存できませんでした");
  }
}

// ---------------------------------------------------------------- コピーしたものを貼り付けて保存(通信しない。この端末のクリップボードを読むだけ)
// 📋 ボタン: 押したときだけ読む(iPhone は毎回「ペースト」の確認が出る。Android は初回だけ許可を聞かれる)。
// 帯(#clipBar): 許可がもう出ているときだけ、開いたときにコピーしてあるURLを見つけて「保存」を出す。勝手に許可は聞かない。
const canPaste = !!(navigator.clipboard && navigator.clipboard.readText);
async function readClip() {
  try { return (await navigator.clipboard.readText()).trim().slice(0, 2000); } catch (e) { return null; }
}
const oneLine = (t) => t.replace(/\s*\n\s*/g, " ");   // 入力欄は1行。改行をそのまま入れると前後がつながって壊れる
async function pasteAndSave() {
  const t = await readClip();
  if (t == null) { toast("貼り付けできませんでした。欄を長押しして「貼り付け」を選んでください"); return; }
  if (!t) { toast("コピーしたものがありません"); return; }
  $("#addInput").value = oneLine(t);
  // URLが入っていれば保存の画面へ。文だけのときは欄に入れるだけ(見てから「保存」を押してもらう)
  if (/https?:\/\//.test(t)) startSave();
  else toast("貼り付けました。「保存」を押してください");
}
$("#pasteBtn").hidden = !canPaste;
$("#pasteBtn").onclick = pasteAndSave;
async function checkClip() {
  const bar = $("#clipBar");
  if (!canPaste || !navigator.permissions || !document.hasFocus() || document.querySelector("dialog[open]")) return;
  try {
    if ((await navigator.permissions.query({ name: "clipboard-read" })).state !== "granted") return;
  } catch (e) { return; }   // iPhone など、調べられない所では何もしない(📋 ボタンを使う)
  const t = await readClip();
  const url = ((t || "").match(/https?:\/\/\S+/) || [""])[0];
  // 一度「保存」「✕」を押したURL(新しい20個まで、改行で区切って覚える)
  const seenList = getPref("clipSeen", "").split("\n").filter(Boolean);
  if (!url || seenList.includes(url) || items.some((i) => i.url === url)) { bar.hidden = true; return; }
  const seen = () => { setPref("clipSeen", [url, ...seenList].slice(0, 20).join("\n")); bar.hidden = true; };
  bar.innerHTML = `<span>📋 コピーしたURLがあります<br><small>${escapeHtml(url.replace(/^https?:\/\/(www\.)?/, ""))}</small></span>
    <button type="button" class="go">保存</button><button type="button" class="bar-close" aria-label="閉じる">✕</button>`;
  bar.querySelector(".go").onclick = () => { seen(); $("#addInput").value = oneLine(t); startSave(); };
  bar.querySelector(".bar-close").onclick = seen;
  bar.hidden = false;
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkClip(); });
window.addEventListener("focus", checkClip);

// 保存のあと: 入ったフォルダを知らせる。自動で決まらなかったら、どこに入れるかその場で聞く
// (選んだものは「自分で選んだ」になり、同じ名前・同じチェーンの店を次から同じフォルダに入れる)
async function afterSave(id, auto, learned = false, named = false) {
  await load();
  // 「メモとして保存」したものは一覧に出ない。メモの画面にあることを知らせる
  if (memos.some((x) => x.id === id)) { toast("メモに保存しました(右上のえんぴつから見られます)"); return; }
  let it = items.find((x) => x.id === id);
  const memo = named && it && folderName(it.folder_id);   // 名前だけのメモが、フォルダ名の言葉でフォルダに入った → 地域は聞かない
  if (it && auto && isPlace(it) && !memo && !(it.area || areaOf(it))) {   // 場所なのに地域が分からない → 先に聞く(入れるとフォルダも振り分け直す)
    await openArea(it, true);
    it = items.find((x) => x.id === id);
  }
  const where = it && folderName(it.folder_id);
  if (it && !where && auto && boxFolders().length) { openMove(it, true); return; }
  // learned: 2つのフォルダで迷ったが、前に自分で選んだのと同じ側に入れた
  toast(where ? `「${where}」に保存しました` + (learned ? "(前と同じ分け方)" : "") : "とっとくに保存しました");
}

// ---------------------------------------------------------------- メモだけの場所(書いて保存しておくだけ。操作は「保存」と「削除」)
// 中身は、種類が「メモ」のもの(保存の画面で「メモとして保存」を選んだものも、ここに入る)。バックアップにも入る。
function renderMemos() {
  const list = $("#memoList");
  list.innerHTML = "";
  $("#memoEmpty").hidden = memos.length > 0;
  // えんぴつのボタンと、ホーム画面のアイコンに、メモの件数を出す(0件なら出さない)
  const n = memos.length, cnt = $("#memoCount");
  cnt.hidden = !n;
  cnt.textContent = n > 99 ? "99+" : String(n);
  $("#memoBtn").setAttribute("aria-label", n ? `メモ(${n}件)` : "メモ");
  setBadge(n);
  $("#memoStat").textContent = `MEMO / ${String(n).padStart(2, "0")}`;
  memos.forEach((m, k) => {
    // メモはカード(2枚ずつ)。色の点は順番で変える
    const li = document.createElement("li");
    li.className = "memo-card m-" + (k % 4);
    li.innerHTML = `<p class="memo-date"><span class="dot"></span><span></span></p><p class="memo-text"></p><p class="memo-sub" hidden></p>
      <button type="button" class="memo-del">削除</button>`;
    li.querySelector(".memo-text").textContent = m.shared_text || m.url || m.title;
    if (m.note) { const sub = li.querySelector(".memo-sub"); sub.textContent = m.note; sub.hidden = false; }
    li.querySelector(".memo-date span:last-child").textContent = fmtDate(m.created_at);
    li.querySelector(".memo-del").onclick = async () => {
      // お店と同じく、はい・いいえ で確かめてから消す(8秒だけ「元に戻す」も出す)
      if (!await askYesNo("このメモを削除してよろしいですか?")) return;
      await api(`/api/items/${m.id}`, { method: "DELETE" });
      undoItems.push(m);
      await load();
      toast(undoItems.length > 1 ? `${undoItems.length}件を削除しました` : "メモを削除しました", undoAct());
    };
    list.appendChild(li);
  });
}
// ホーム画面のアイコンの数字(Web のバッジ)。使えない環境では何もしない。通知の許可はこちらからは求めない
function setBadge(n) {
  try {
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (!n && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch (e) { /* 出せなくてもよい */ }
}
const memoOpen = () => !$("#memoView").hidden;
function showMemo(on) {
  $("#memoView").hidden = !on;
  document.body.style.overflow = on ? "hidden" : "";
  if (on && !memos.length) $("#memoInput").focus();   // まだ1つも無いときだけ、すぐ書けるように
}
// スマホの「戻る」でもメモの画面が閉じるように、開くとき履歴を1つ足す
$("#memoBtn").onclick = () => { if (memoOpen()) return; history.pushState({ memo: 1 }, ""); showMemo(true); };
$("#memoBack").onclick = () => history.back();
window.addEventListener("popstate", () => {
  if (memoOpen()) { showMemo(false); return; }
  if (activeBox != null && boxes.length) leaveBox();   // 箱の中から「戻る」で、箱の並びへ
});
$("#memoForm").onsubmit = async (e) => {
  e.preventDefault();
  const input = $("#memoInput");
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  try {
    await api("/api/items", { method: "POST", body: { text, kind: "memo" } });
    input.value = "";
    await load();
    toast("メモを保存しました");
  } catch (err) {
    toast("保存できませんでした");
  }
};

// ---------------------------------------------------------------- Webで探す(AIなし: 同じ言葉でほかのサイトを開くだけ)
const googleUrl = (q) => "https://www.google.com/search?q=" + encodeURIComponent(q);
function webLinks(q, big = false) {
  const e = encodeURIComponent(q);
  return `<div class="web-links${big ? " big" : ""}"><span>${big ? "開く" : "Webで探す"}</span>
    <a href="https://www.google.com/search?q=${e}" target="_blank" rel="noopener">Google</a>
    <a href="https://www.google.com/maps/search/?api=1&query=${e}" target="_blank" rel="noopener">マップ</a>
    <a href="https://tabelog.com/rstLst/?vs=1&sw=${e}" target="_blank" rel="noopener">食べログ</a></div>`;
}

$("#filterInput").oninput = render;
$("#filterInput").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (searchMode === "web") {
    const w = searchText();
    if (w) { $("#filterInput").blur(); window.open(googleUrl(w), "_blank", "noopener"); }
  } else showResults();
};
function setSearchMode(m) {
  searchMode = m;
  setPref("smode", m);
  $("#searchSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("#filterInput").placeholder = m === "web"
    ? "🌐 Webで探す 例:御殿場 焼肉 個室"
    : "🔍 保存したものから探す 例:焼肉 六本木";
  render();
}
$("#searchSeg").querySelectorAll("button").forEach((b) => { b.onclick = () => { setSearchMode(b.dataset.mode); $("#filterInput").focus(); }; });
$("#searchSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === searchMode));
if (searchMode === "web") $("#filterInput").placeholder = "🌐 Webで探す 例:御殿場 焼肉 個室";
$("#sortSel").onchange = async () => {
  setPref("sort", $("#sortSel").value);
  if ($("#sortSel").value === "near" && !myPos) {
    toast("現在地を調べています…");
    if (!(await getPos())) toast("現在地が使えません(位置情報の許可を確認してください)");
  }
  render();
};
document.querySelectorAll("#viewSeg button").forEach((b) => {
  b.onclick = () => {
    view = b.dataset.view; setPref("view", view); render();
    if (view === "map" && !myPos) getPos().then((p) => p && render());
  };
});

// ダイアログ共通: 外側を押すか「閉じる」で閉じる
["#moveDlg", "#areaDlg", "#noteDlg", "#settingsDlg"].forEach((id) => {
  $(id).addEventListener("click", (e) => { if (e.target === $(id)) $(id).close(); });
});
$("#moveCancel").onclick = () => $("#moveDlg").close();
$("#noteCancel").onclick = () => $("#noteDlg").close();

// ---------------------------------------------------------------- 設定(色・データ)
const ACCENTS = [
  ["ai", "あお(既定)", "#3d5bf5"], ["orange", "オレンジ", "#e8590c"], ["red", "ローズ", "#d6336c"], ["pink", "ピンク", "#c2255c"],
  ["purple", "むらさき", "#7048e8"], ["blue", "あお", "#1c7ed6"], ["teal", "みずいろ", "#0c8599"],
  ["green", "みどり", "#2b8a3e"], ["brown", "ちゃいろ", "#9c6644"], ["gray", "グレー", "#495057"],
];

const BGS = [["fuwa", "ふんわり"], ["sakura", "さくら"], ["sora", "そら"], ["mint", "ミント"], ["shiro", "しろ"]];
const CARD_COLORS = [["white", "しろ"], ["cream", "クリーム"], ["sakura", "さくら"], ["sora", "そら"], ["mint", "ミント"], ["lavender", "ふじ"]];
const SHAPES = [["float", "浮かぶ", "少し傾いて浮く"], ["stack", "重なる", "うしろに2枚"], ["seal", "シール", "箱ごとに色を塗る"], ["plain", "すっきり", "線だけ・傾けない"]];

const darkMQ = matchMedia("(prefers-color-scheme: dark)");
darkMQ.addEventListener && darkMQ.addEventListener("change", () => applyLook(getLook()));   // 端末の明暗が変わったら合わせる

function getLook() {
  try { return JSON.parse(localStorage.getItem("tottoku-look") || "{}"); } catch (e) { return {}; }
}

function applyLook(look) {
  const root = document.documentElement;
  root.dataset.accent = look.accent || "ai";
  root.dataset.bg = look.bg || "fuwa";
  root.dataset.card = look.card || "float";
  root.dataset.cardbg = look.cardbg || "white";
  if (look.theme && look.theme !== "auto") root.dataset.theme = look.theme;
  else delete root.dataset.theme;
  // 暗い表示か(「自動」なら端末の設定)。CSS は data-dark を見る
  const dark = look.theme === "dark" || (look.theme !== "light" && darkMQ.matches);
  if (dark) root.dataset.dark = ""; else delete root.dataset.dark;
  // スマホの帯の色を、ボタンの色(差し色)に合わせる(2026-11-25 きよさん「下の帯はボタンの色と同じ色に」)。
  // ホーム画面に置いたアプリの下の帯は、端末・Chrome によっては manifest の theme_color(既定の差し色)のままのことがある
  requestAnimationFrame(() => {
    const c = getComputedStyle(root).getPropertyValue("--accent").trim();
    document.querySelector('meta[name="theme-color"]').setAttribute("content", c);
  });
}

function saveLook(change) {
  const look = { ...getLook(), ...change };
  try { localStorage.setItem("tottoku-look", JSON.stringify(look)); } catch (e) { /* 保存できなくても今の画面には反映 */ }
  applyLook(look);
  renderSettings();
}

function renderSettings() {
  const look = getLook();
  const box = $("#swatches");
  box.innerHTML = "";
  ACCENTS.forEach(([key, label, color]) => {
    const wrap = document.createElement("div");
    const b = document.createElement("button");
    b.className = "swatch" + ((look.accent || "ai") === key ? " on" : "");
    b.style.background = color;
    b.setAttribute("aria-label", label);
    b.onclick = () => saveLook({ accent: key });
    const name = document.createElement("span");
    name.className = "swatch-name"; name.textContent = label;
    wrap.append(b, name);
    box.appendChild(wrap);
  });
  // 背景の色(5つ)とカードの形(4つ)。押すとすぐ変わる
  const bgBox = $("#bgSwatches");
  bgBox.innerHTML = "";
  BGS.forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bg-swatch bg-" + key + ((look.bg || "fuwa") === key ? " on" : "");
    b.innerHTML = `<span aria-hidden="true"></span>${label}`;
    b.setAttribute("aria-pressed", String((look.bg || "fuwa") === key));
    b.onclick = () => saveLook({ bg: key });
    bgBox.appendChild(b);
  });
  const ccBox = $("#cardColors");
  ccBox.innerHTML = "";
  CARD_COLORS.forEach(([key, label]) => {
    const on = (look.cardbg || "white") === key;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bg-swatch cc-" + key + (on ? " on" : "");
    b.innerHTML = `<span aria-hidden="true"></span>${label}`;
    b.setAttribute("aria-pressed", String(on));
    b.onclick = () => saveLook({ cardbg: key });
    ccBox.appendChild(b);
  });
  const shapeBox = $("#cardShapes");
  shapeBox.innerHTML = "";
  SHAPES.forEach(([key, label, note]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "shape" + ((look.card || "float") === key ? " on" : "");
    b.setAttribute("aria-pressed", String((look.card || "float") === key));
    b.innerHTML = `<b>${label}</b><small>${note}</small>`;
    b.onclick = () => saveLook({ card: key });
    shapeBox.appendChild(b);
  });
  document.querySelectorAll("#themeSeg button").forEach((b) => {
    b.classList.toggle("on", (look.theme || "auto") === b.dataset.theme);
    b.onclick = () => saveLook({ theme: b.dataset.theme });
  });
  const last = getPref("exported", "");
  $("#backupNote").textContent = `保存したもの ${items.length + memos.length}件${memos.length ? `(うちメモ ${memos.length}件)` : ""}・フォルダ ${folders.length}個。` +
    "データはこの端末の中だけにあります。機種変更やブラウザのデータ削除で消えるので、ときどき書き出してください。" +
    (last ? `(前回の書き出し: ${last})` : "");
}

// 書き出し: ファイルにして保存(スマホでは「共有」から LINE・Googleドライブ・ファイルなどへ送れる)
$("#exportBtn").onclick = async () => {
  const data = LocalAPI.exportData();
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const name = `tottoku-${ymd}.json`;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  let done = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      done = true;
    }
  } catch (e) { if (e && e.name === "AbortError") return; }
  if (!done) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  setPref("exported", `${d.getMonth() + 1}/${d.getDate()}`);
  setPref("exportedAt", d.getTime());
  renderBackup();
  renderSettings();
  toast(`${data.items.length}件を書き出しました`);
};

// 読み込み: 書き出したファイル(PC版の書き出しファイルも可)で、今のデータを置き換える
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch (err) { toast("ファイルを読めませんでした"); return; }
  const n = Array.isArray(data.items) ? data.items.length : 0;
  if (!await askYesNo(`このファイルの${n}件で、今のデータ(${items.length + memos.length}件)を置き換えてよろしいですか?`, "今のデータは消えます。")) return;
  try {
    const r = LocalAPI.importData(data);
    await LocalAPI.saveState();
    activeFolder = "all";
    await load();
    renderSettings();
    toast(`${r.items}件・フォルダ${r.folders}個を読み込みました`);
  } catch (err) { toast(err.message || "読み込めませんでした"); }
};

$("#settingsBtn").onclick = () => {
  $("#folderSetBtn").innerHTML = folders.length ? "📁 フォルダの管理<small>作る・並べ替え・振り分け</small>" : "📁 フォルダを作る";
  $("#boxSetBtn").innerHTML = boxes.length ? `📦 箱を作る<small>今 ${boxes.length}個</small>` : "📦 箱を作る<small>食事・サイト・旅行…のまとまり</small>";
  renderSettings(); $("#settingsDlg").showModal();
};
$("#boxSetBtn").onclick = async () => { $("#settingsDlg").close(); await createBox(); };
$("#folderSetBtn").onclick = () => { $("#settingsDlg").close(); openFolderMenu(null); };
$("#settingsClose").onclick = () => $("#settingsDlg").close();
applyLook(getLook());

// ---------------------------------------------------------------- 起動
$("#sortSel").value = getPref("sort", "new");
if (!$("#sortSel").value) $("#sortSel").value = "new";   // 前に「評価順」を選んでいた人
view = getPref("view", "list");
if ($("#sortSel").value === "near") getPos().then(() => render());

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => { /* なくても動く */ });

(async () => {
  const p = new URLSearchParams(location.search);
  if (p.has("url") || p.has("text") || p.has("title")) {   // Android の共有メニューから届いた
    history.replaceState(null, "", location.pathname);
    const res = await api("/api/items", { method: "POST",
      body: { url: p.get("url") || "", text: p.get("text") || "", title: p.get("title") || "" } });
    await afterSave(res.id, true, res.learned, res.named);
  } else {
    await load();
    checkClip();
  }
})();
