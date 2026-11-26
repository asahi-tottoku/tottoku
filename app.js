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
// 箱の選択肢(新しいフォルダ・編集の「箱」欄)。value は箱のid、"" = 箱に入れない
function fillBoxSelect(sel, cur) {
  sel.innerHTML = "";
  const add = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; sel.appendChild(o); };
  boxes.forEach((b) => add(String(b.id), b.name));
  add("", "箱に入れない(「すべて」だけに出る)");
  sel.value = cur == null ? "" : String(cur);
}
// 箱を移ったときの知らせ
const movedMsg = (box, folder) => (box == null ? "箱の外に移しました(「すべて」に出ます)" : `箱「${boxName(box)}」${folder ? `の「${folder}」` : ""}に移しました`);
const selBox = (sel) => (sel.value === "" ? null : Number(sel.value));

// 新しいフォルダを作る。名前と「入れる箱」を聞く(2026-11-26 きよさん「作ったフォルダがどこにも出てこない」。
// 箱の外で作ると、どの箱にも入らず箱の並びから見えなかった)。箱の中で作るときは、その箱を選んだ状態で開く。
// 箱の外で作るときは、先頭の箱を選んだ状態(箱に入れないも選べる)。箱が1つも無ければ箱の欄は出さない
// defBox: はじめに選んでおく箱(お店のフォルダを選ぶ画面から作るときは、そのお店の箱)
function createFolder(defBox) {
  const dlg = $("#newFolderDlg"), input = $("#newFolderName"), sel = $("#newFolderBox");
  input.value = "";
  $("#newFolderBoxRow").hidden = !boxes.length;
  fillBoxSelect(sel, defBox !== undefined ? defBox : inBoxView() ? activeBox : boxes.length ? boxes[0].id : null);
  return new Promise((resolve) => {
    let id = null, busy = false;
    const ok = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      if (busy) return;   // 「作る」を続けて2回押しても1回だけ(2回目が「同じ名前のフォルダがあります」になっていた)
      busy = true;
      const box_id = boxes.length ? selBox(sel) : null;
      const res = await api("/api/folders", { method: "POST", body: { name, box_id } });
      busy = false;
      if (res.error) { toast(res.error); return; }
      id = res.id;
      // 今いる箱と違う箱に入れたら、どこに入ったかを知らせる
      toast(box_id != null && box_id !== activeBox ? `「${name}」を箱「${boxName(box_id)}」に作りました` : `「${name}」を作りました`);
      dlg.close();
    };
    $("#newFolderOk").onclick = ok;
    input.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ok(); } };
    $("#newFolderCancel").onclick = () => dlg.close();
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
    dlg.onclose = () => resolve(id);
    dlg.showModal();
    input.focus();
  });
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
    // 「フォルダなし」は0件なら出さない(選んでいる最中は残す。2026-11-26 デザインチェック C5)
    const nNone = count((i) => !folderName(i.folder_id));
    if (nNone || activeFolder === "none") entries.push(["none", "フォルダなし", nNone]);
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
      if (value === null) body.box = home;
      await api(`/api/items/${item.id}`, { method: "PATCH", body });
      await load();
      // 今いる箱から出たら、どこへ行ったかを知らせる(一覧から消えて見失わないように)
      const now = items.find((x) => x.id === item.id);
      toast(now && inBoxView() && boxOf(now) !== activeBox ? movedMsg(boxOf(now), folderName(now.folder_id))
        : value === "auto" ? "自動で選びました" : "移動しました");
    };
    list.appendChild(b);
  };
  if (!ask) opt("🗂 自動で選ぶ", "auto", !item.folder_manual, "地名とジャンルで選びます");
  // お店の箱のフォルダを先に。ほかの箱のフォルダには箱の名前を添える(選ぶと、お店もその箱へ移る)。
  // 前は「今いる箱」を先にしていたので、編集で箱を変えてからフォルダを選ぶと、元の箱のフォルダが並び、
  // 「フォルダなし」を選ぶと元の箱に戻っていた(2026-11-26 きよさん「箱とフォルダを変えようとすると変えられなくなる」)
  const home = boxes.length ? boxOf(item) : null;
  const here = boxes.length ? folders.filter((f) => (f.box_id ?? null) === home) : folders, others = folders.filter((f) => !here.includes(f));
  here.forEach((f) => opt("📁 " + f.name, f.id, item.folder_manual && item.folder_id === f.id));
  others.forEach((f) => opt("📁 " + f.name, f.id, item.folder_manual && item.folder_id === f.id,
    escapeHtml(f.box_id != null ? `箱「${boxName(f.box_id)}」` : "箱の外")));
  opt("フォルダなし", null, item.folder_manual && !folderName(item.folder_id));
  $("#moveNew").onclick = async () => {
    dlg.close();
    const id = await createFolder(home);
    if (!id) return;
    await api(`/api/items/${item.id}`, { method: "PATCH", body: { folder: id } });
    load();
  };
  dlg.showModal();
}

// ---------------------------------------------------------------- メモ・教えてくれた人
// メモ欄の高さを書いた量に合わせる。CSS の field-sizing が使えないブラウザ(Safari・Firefox の一部)だけ JS で
const FIELD_SIZING = typeof CSS !== "undefined" && CSS.supports && CSS.supports("field-sizing", "content");
function growNote() {
  if (FIELD_SIZING) return;
  const t = $("#noteInput");
  t.style.height = "auto";
  t.style.height = t.scrollHeight + 2 + "px";   // 最低・最大の高さは CSS(min-height・max-height)
}
$("#noteInput").addEventListener("input", growNote);
function openNote(item) {
  const dlg = $("#noteDlg");
  $("#noteName").textContent = item.title;
  $("#titleInput").value = item.title || "";
  $("#areaInput").value = item.area || "";
  $("#noteInput").value = item.note || "";
  growNote();
  // 「教えてくれた人」の欄は外し、フォルダを変えるボタンにした(2026-11-26 きよさん)。入っていた人の名前はデータに残す
  const fname = folderName(item.folder_id);
  $("#noteFolder").textContent = `${fname || "フォルダなし"}${fname && !item.folder_manual ? "(自動)" : ""}`;
  // 前に入れた「教えてくれた人」は、ここで消せる(押すと保存のときに消える)
  let dropWho = false;
  const who = $("#noteWho");
  who.hidden = !item.recommender;
  who.textContent = `👤 ${item.recommender || ""}のおすすめ を消す`;
  who.onclick = () => { dropWho = true; who.hidden = true; };
  // 箱: 箱があるときだけ出す。今の箱と違う箱を選んだら、フォルダから出してその箱の「フォルダなし」に置く
  // (フォルダは箱の中にあるので、フォルダごと移すとほかのお店まで動いてしまう。2026-11-26 きよさん)
  const nb = $("#noteBox");
  $("#noteBoxRow").hidden = !boxes.length;
  fillBoxSelect(nb, boxOf(item));
  const boxEdit = () => {
    if (!boxes.length) return {};
    const b = selBox(nb);
    // 箱を変えたら、手で選んだ「フォルダなし」にする(自動のままだと、保存したとたん新しい箱のフォルダや、
    // 「箱に入れない」でもほかの箱のフォルダに自動で入ってしまう。2026-11-26 code-review)
    return b === boxOf(item) ? {} : { box: b, folder: null };
  };
  nb.onchange = () => {
    const f = folderName(item.folder_id);
    $("#noteFolder").textContent = selBox(nb) !== boxOf(item) ? "フォルダなし(箱を変えるため)" : `${f || "フォルダなし"}${f && !item.folder_manual ? "(自動)" : ""}`;
  };
  const edits = () => ({ title: $("#titleInput").value.trim() || item.title, area: $("#areaInput").value.trim(),
    note: $("#noteInput").value.trim(), ...(dropWho ? { recommender: "" } : {}), ...boxEdit() });
  // フォルダを選ぶ画面へ。ここまでに書いた名前・地域・メモは先に保存し、一覧も読み直す
  // (読み直さないと、フォルダの画面を閉じたとき古い名前のまま。自動のフォルダが変わることもある)
  $("#noteFolder").onclick = async () => {
    const e = edits();
    await api(`/api/items/${item.id}`, { method: "PATCH", body: e });
    dlg.close();
    await load();
    // 箱を変えていたら、ここで移っている。フォルダを選ばずに閉じても見失わないよう、先に知らせる(確かめ役の指摘)
    if ("box" in e) toast(movedMsg(e.box));
    openMove(items.find((x) => x.id === item.id) || { ...item, ...edits() });
  };
  // 送る: 編集の画面の中から(カードの「送る」はここにまとめた)
  $("#noteShare").onclick = () => { dlg.close(); shareItem(item); };
  $("#noteDelete").onclick = () => { dlg.close(); deleteItem(item); };
  $("#noteSave").onclick = async () => {
    const e = edits();
    await api(`/api/items/${item.id}`, { method: "PATCH", body: e });
    dlg.close(); load();
    if ("box" in e) toast(movedMsg(e.box));
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
// ジャンルの写真(2026-11-26 きよさんが画像生成AIで作った21枚。元は docs/box-art-source/genre-sheet.webp)
const GENRE_ART = { "焼肉": "yakiniku", "和食": "washoku", "寿司": "sushi", "天ぷら": "tempura", "蕎麦": "soba", "うなぎ": "unagi",
  "焼き鳥": "yakitori", "洋食": "yoshoku", "イタリアン": "italian", "フレンチ": "french", "スペイン料理": "spanish", "中華": "chuka",
  "ラーメン": "ramen", "韓国料理": "korean", "エスニック": "ethnic", "カレー": "curry", "ハンバーガー": "burger", "居酒屋": "izakaya",
  "カフェ": "cafe", "スイーツ": "sweets", "パン": "pan" };
const GENRE_LABEL = { "蕎麦": "蕎麦・うどん", "お好み焼き": "お好み焼き・たこ焼き", "バー": "バー・お酒" };   // ボタンに出す名前(うどんの店も「蕎麦」に入るので)
let genreMemo = new WeakMap();   // load() のたびに作り直す
function genreOf(i) {
  if (!genreMemo.has(i)) genreMemo.set(i, genreOf0(i));
  return genreMemo.get(i);
}
// 場所(お店・お出かけ先)かどうか。サイト・動画・買い物などは false(決め方は localdb.js)
const isPlace = LocalAPI.isPlace;
// いくつかのジャンルに当たったら、細かいほう(「割烹 鰻の…」は和食とうなぎ → うなぎ)。親は Sorter.GENRES の2つ目
const finestGenre = (list) => {
  const parents = new Set(list.map((g) => (Sorter.GENRES[g] || [])[1]).filter(Boolean));
  return list.find((g) => !parents.has(g)) || list[0];
};
function genreOf0(i) {
  if (!isPlace(i)) return "その他";
  const t = finestGenre((i.tags || []).filter((g) => GENRE_NAMES.has(g)));
  if (t) return t;
  const d = finestGenre(Sorter.detectGenres([i.title, ...(i.tags || []), i.summary, i.description].join(" ")));
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
  // 上のフォルダの段と同じ名前のジャンル(フォルダ「スイーツ」とジャンル「スイーツ」)は出さない。2回出てしまうため
  // (2026-11-26 きよさん「C で」)。選んでいる最中のものは残す
  const fnames = new Set(boxFolders().map((f) => Sorter.fnorm(f.name)));
  const dup = (g) => [g, ...(GENRE_LABEL[g] || "").split("・")].some((w) => w && fnames.has(Sorter.fnorm(w)));
  const rows = order.filter(([g]) => g === activeGenre || !dup(g)).map(([g, n]) => [g, GENRE_LABEL[g] || g, n]);
  if (!rows.length) { box.hidden = true; box.innerHTML = ""; return; }
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
  if (grid && !searching) { shownKey = ""; renderBoxes(); renderSearchNote([]); return; }   // 箱の並びに戻ったら、次の一覧は60枚から
  renderFolders();
  fixFilters();
  renderAreas();
  renderGenres();
  $("#chipRow").hidden = $("#areaBar").hidden && $("#genreBar").hidden;
  const list = currentList();
  renderFilterLine(list.length);
  document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $("#empty").hidden = items.length > 0;
  $("#boxEmpty").hidden = !(inBoxView() && items.length && !scoped().length);
  const ul = $("#list");
  ul.innerHTML = "";
  $("#mapBox").hidden = view !== "map";
  ul.hidden = view === "map";
  if (moreObs) { moreObs.disconnect(); moreObs = null; }   // 前の一覧の「続き」の見張りを外す(地図に切り替えたときも)
  if (view === "map") renderMap(list);
  else renderCards(ul, list);
  renderSearchNote(list);
}

// カードは最初に PAGE 枚だけ作り、下までスクロールしたら続きを足す(2026-11-26 重さの点検。前は全件をいっぺんに作っていた)。
// 同じ絞り込みのまま描き直すとき(編集・保存のあと)は、前に出ていた枚数までは作る(スクロールの位置が飛ばないように)
const PAGE = 60;
let shownKey = "", shownN = PAGE, moreObs = null;
function renderCards(ul, list) {
  const key = JSON.stringify([activeBox, activeFolder, activeGenre, activeArea, activePref, filterQ(), $("#sortSel").value]);
  if (key !== shownKey) { shownKey = key; shownN = PAGE; }
  if (moreObs) { moreObs.disconnect(); moreObs = null; }
  let n = 0;
  const more = () => {
    const end = Math.min(list.length, Math.max(n + PAGE, n === 0 ? shownN : 0));
    const frag = document.createDocumentFragment();
    for (; n < end; n++) frag.appendChild(card(list[n]));
    ul.appendChild(frag);
    shownN = Math.max(shownN, n);
    ul.querySelector(".more-sentinel")?.remove();
    if (n >= list.length) return;
    // 一番下に「続きを表示」。近づくと自動で足す(自動で足せないときも、押せば出る)
    const s = document.createElement("li");
    s.className = "more-sentinel";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `続きを表示(残り ${list.length - n}件)`;
    b.onclick = () => { if (moreObs) { moreObs.disconnect(); moreObs = null; } more(); };
    s.appendChild(b);
    ul.appendChild(s);
    if ("IntersectionObserver" in window) {
      // 描き直しで外れた古い目印からの知らせは無視する
      moreObs = new IntersectionObserver((es) => { if (s.isConnected && es.some((e) => e.isIntersecting)) b.onclick(); }, { rootMargin: "600px 0px" });
      moreObs.observe(s);
    }
  };
  more();
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

// よく出るサイトは日本語の名前で出す(2026-11-26 デザインチェック)。ほかはドメインのまま
const SITE_NAME = { "tabelog.com": "食べログ", "s.tabelog.com": "食べログ", "hotpepper.jp": "ホットペッパー", "retty.me": "Retty",
  "gnavi.co.jp": "ぐるなび", "r.gnavi.co.jp": "ぐるなび", "ikyu.com": "一休", "restaurant.ikyu.com": "一休",
  "amazon.co.jp": "Amazon", "rakuten.co.jp": "楽天", "item.rakuten.co.jp": "楽天", "youtube.com": "YouTube", "m.youtube.com": "YouTube",
  "youtu.be": "YouTube", "instagram.com": "Instagram", "x.com": "X", "twitter.com": "X", "tiktok.com": "TikTok",
  "google.com": "Google", "maps.google.com": "Google マップ", "maps.app.goo.gl": "Google マップ", "jalan.net": "じゃらん" };
function siteLabel(site) {
  if (!site) return "";
  const h = site.replace(/^www\./, "");
  return SITE_NAME[h] || h;
}

function card(i) {
  const el = $("#cardTpl").content.firstElementChild.cloneNode(true);
  // URL が無いお店は、リンクにしない(href="#" だと押すたびに履歴が増え、戻ると箱の並びへ戻ってしまう)
  const link = i.url || null;
  const setLink = (a) => { if (link) a.href = link; else { a.removeAttribute("target"); a.classList.add("nolink"); } };
  if (i.status === "processing") el.classList.add("processing");
  const th = el.querySelector(".thumb");
  setLink(th);
  // 絵が無いときは、箱の名前(2026-11-25 きよさん。ジャンルはフォルダの札で分かるので)を、種類ごとの淡い色の上に出す。
  // 箱に入っていなければ、今までどおりジャンル(焼肉・スイーツ…)か種類(動画・買い物…)
  const g = genreOf(i);
  const bname = boxOf(i) != null ? boxName(boxOf(i)) : "";
  // 色: 箱に入っていれば箱のカードと同じ色(種類ごとだと同じ箱の中で色がばらばらになるため)。箱の外は種類ごとの色
  if (bname) th.classList.add("bt", "tint-" + tintOf(boxOf(i)));
  else th.classList.add("k-" + (KIND_TINT[i.category] ?? 4));
  // 写真の上の名前は、フォルダの名前だけ(2026-11-26 きよさん「ショップに入れても写真に『その他』と出る。
  // フォルダ名が写真に入れば、下のフォルダの札はいらない」。ジャンルと混ざると「スイーツ」もフォルダに見えるので、
  // フォルダに入っていなければ写真の上には何も出さない。デザインチェック C1)
  // 絵が無いとき(字だけの四角)は、今までどおり フォルダ → 箱の名前(箱の中では出さない)→ ジャンル → 種類
  const fname0 = folderName(i.folder_id) || "";
  const glabel = g !== "その他" ? (GENRE_LABEL[g] || g).split("・")[0] : i.category;
  const label = fname0 || (inBoxView() ? "" : bname) || glabel;
  const addCap = () => {
    th.classList.add("genre-pic");
    const cap = document.createElement("span");
    cap.className = "thumb-cap";
    cap.textContent = fname0;
    if ([...fname0].length >= 5) cap.classList.add("long");   // 入りきらなければ1行で「…」(C3)
    th.appendChild(cap);
  };
  const noimg = () => {
    th.classList.add("noimg");
    th.textContent = label;
    if (th.textContent.length > 6) th.classList.add("long");
  };
  // ジャンルの写真が無ければ、入っている箱の絵(ゴルフ場・旅行など)
  // ただし料理の絵(パスタ・ケーキ…)は、ジャンルの分からない店に出すと別の料理の店に見えるので使わない(2026-11-26)
  const bart0 = bname ? boxArtOf(boxOf(i), bname) : "";
  const bart = ["food", "sweets", "yakiniku", "yoshoku", "italian"].includes(bart0) || bart0.startsWith("g:") ? "" : bart0;
  const gart = GENRE_ART[g] ? `genre-art/${GENRE_ART[g]}` : bart ? `box-art/${bart}` : "";
  // ジャンルが分かれば、ジャンルの写真(きよさんが作った絵)。下に小さく名前を重ねる(2026-11-26)
  const showArt = () => {
    th.classList.add("genre-pic");
    const img = th.querySelector("img");
    img.onerror = () => { th.classList.remove("genre-pic"); th.querySelector(".thumb-cap")?.remove(); noimg(); };
    img.src = `${gart}.webp`;
    if (fname0 && !th.querySelector(".thumb-cap")) addCap();
  };
  if (i.image) {
    // お店の写真が読めないときは、ジャンルの写真に(無ければ字)(2026-11-26 点検の残り)
    th.querySelector("img").onerror = gart ? showArt : () => { th.querySelector(".thumb-cap")?.remove(); th.classList.remove("genre-pic"); noimg(); };
    th.querySelector("img").src = i.image;
    if (fname0) addCap();   // お店の写真にも、フォルダの名前を重ねる(下の札を出さないので)
  } else if (gart) showArt();
  else noimg();
  el.querySelector(".cat").textContent = i.status === "processing" ? "整理中…" : "";   // 種類(その他・飲食店…)は左の四角と重なるので出さない
  const d = distKm(i);
  el.querySelector(".dist").textContent = d != null ? "📍" + fmtKm(d) : "";
  // 保存した日時は出さない(2026-11-25 きよさん「いらない」。並びの「新しい順」は今までどおり)。サイト名だけ残す
  el.querySelector(".date").textContent = siteLabel(i.site);
  const meta = el.querySelector(".meta");
  if (![...meta.children].some((s) => s.textContent)) meta.remove();
  const t = el.querySelector(".title");
  t.textContent = i.title || i.url; setLink(t);
  el.querySelector(".summary").textContent = i.summary || "";

  const ft = el.querySelector(".folder-tag");
  const fname = folderName(i.folder_id);
  // フォルダに入っていれば、名前は左の四角に出すので札は出さない(変えるのは「編集」から)。入っていなければ「フォルダなし ›」
  if (!fname && folders.length) {
    // フォルダを変えるのは、この表示を押す(カードの「フォルダ」ボタンは 2026-11-11 に外した)
    ft.textContent = "+ フォルダ";   // 地域の「+ 地域を入れる」と同じうすい札(C2)
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
  // フォルダと地域の札が両方あるときは、サイト名を出さない(一番下の段を1行に収めるため。2026-11-26)
  if (el.contains(ft) && el.contains(at)) {
    const dt = el.querySelector(".date"); if (dt) dt.textContent = "";
    const m = el.querySelector(".meta"); if (m && ![...m.children].some((s) => s.textContent)) m.remove();
  }

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
  return el;
}

// 削除: カードからは外し、編集の画面の一番下に置いた(2026-11-26 デザインチェック B4)。
// はい・いいえ で確かめてから消す。消したあと8秒だけ「元に戻す」も出す。続けて消したら、まとめて戻せる
async function deleteItem(i) {
  const short = (i.title || "").length > 20 ? i.title.slice(0, 19) + "…" : (i.title || "これ");
  if (!await askYesNo("削除してよろしいですか?", `「${short}」`)) return;
  await api(`/api/items/${i.id}`, { method: "DELETE" });
  undoItems.push(i);
  await load();
  const name = (i.title || "").length > 14 ? i.title.slice(0, 13) + "…" : i.title;
  toast(undoItems.length > 1 ? `${undoItems.length}件を削除しました` : `「${name}」を削除しました`, undoAct());
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
      (i.url ? `<br><a href="${escapeHtml(i.url)}" target="_blank" rel="noopener">開く</a>` : "") +
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

// 箱の絵と線のアイコン(2026-11-26 きよさん「サンプル画像みたいにして使いたい」)。
// 箱の名前に入っている言葉で選ぶ。上から順に見て、最初に合ったもの。合わなければ絵なし・箱のアイコン
const BOX_ART = [
  ["sweets", ["スイーツ", "ケーキ", "カフェ", "甘", "パン", "和菓子", "お菓子"]],
  ["yakiniku", ["焼肉", "焼き肉", "ステーキ", "肉", "bbq"]],
  ["italian", ["イタリア", "パスタ", "ピザ", "ピッツァ"]],
  ["yoshoku", ["洋食", "ハンバーグ", "フレンチ", "ビストロ"]],
  ["food", ["食事", "ごはん", "ご飯", "グルメ", "レストラン", "ランチ", "ディナー", "飲食", "食べ", "ラーメン", "中華", "和食", "寿司", "居酒屋", "飲み"]],
  ["golf", ["ゴルフ"]],
  ["shop", ["ショップ", "買い物", "ショッピング", "通販", "ほしい", "欲しい"]],
  ["site", ["サイト", "web", "ウェブ", "ネット", "リンク", "hp", "ｈｐ", "ホームページ", "url", "ブログ"]],
  ["memo", ["メモ", "ノート"]],
  ["travel", ["旅行", "旅", "観光", "ホテル", "宿泊", "民宿", "旅館", "温泉", "おでかけ", "お出かけ"]],
  ["map", ["地図", "場所", "スポット", "マップ"]],
  ["video", ["動画", "映画", "youtube", "ドラマ", "アニメ"]],
  ["music", ["音楽", "曲", "ライブ", "歌謡", "カラオケ"]],
  ["event", ["イベント", "予定", "行事", "チケット"]],
  ["docs", ["資料", "本屋", "書店", "読", "勉強", "仕事", "記事"]],
  ["fav", ["お気に入り", "好き", "★", "推し"]],
  ["tag", ["タグ"]],
];
const BOX_ICON = {
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3.5 4-3.5 8H17"/>',
  sweets: '<path d="M4 21h16M5 21v-7h14v7M5 14c2.3-1.6 4.7 1.6 7 0s4.7 1.6 7 0M12 14v-3M12 8.5a1.2 1.2 0 1 0 0-.01"/>',
  yakiniku: '<path d="M12 3c1 4 6 5.5 6 11a6 6 0 0 1-12 0c0-3 1.5-5 3-6 0 2 1 3.3 2.2 3.3C11.2 8.5 10 6 12 3z"/>',
  italian: '<path d="M3.5 6.5 12 21l8.5-14.5M3.5 6.5C9 3.5 15 3.5 20.5 6.5M10 10.5h.01M14 11h.01M12 15h.01"/>',
  golf: '<path d="M6 21V3l11 4.5L6 12"/>',
  shop: '<path d="M3 4h2.5l2.3 11h10.4l2-8H6.3"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="19.5" r="1.3"/>',
  site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.4 3.2 14.6 0 18M12 3c-3.2 3.4-3.2 14.6 0 18"/>',
  memo: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  travel: '<path d="M2.5 13.5 21.5 6l-3.5 13-6-4.5-3 4v-5.5z"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  event: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  docs: '<path d="M2.5 5.5h6.5a3 3 0 0 1 3 3V21a2 2 0 0 0-2-2H2.5zM21.5 5.5H15a3 3 0 0 0-3 3V21a2 2 0 0 1 2-2h7.5z"/>',
  all: '<path d="m12 3 9 4.8-9 4.8-9-4.8zM3 12.2l9 4.8 9-4.8M3 16.6l9 4.8 9-4.8"/>',
  fav: '<path d="m12 3 2.8 5.8 6.2.8-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.8z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8zM7.5 7.5h.01"/>',
  box: '<path d="m3 8 9-5 9 5v8.5l-9 5-9-5zM3 8l9 5 9-5M12 13v8.5"/>',
};
BOX_ICON.yoshoku = BOX_ICON.food;
function boxArtOf(key, name) {
  if (key === "all" || key === "memo") return key;
  // 地名・会社名の中の言葉では選ばない(「新宿」の宿・「熊本」の本・「ジャパン」のパン など)
  const n = String(name || "").toLowerCase().replace(/ジャパン|japan|パンダ|甘楽|肉付/g, "");
  const hit = BOX_ART.find(([, words]) => words.some((w) => n.includes(w)));
  // 名前が料理のジャンル(天ぷら・寿司・ラーメン…)なら、そのジャンルの写真(「g:tempura」)。
  // 焼肉・スイーツ・イタリアン・洋食は箱の絵が先(2026-11-26 きよさん「天ぷらの箱に画像が出ない」)
  if (!hit || hit[0] === "food") {
    const g = finestGenre(Sorter.detectGenres(n));
    if (GENRE_ART[g]) return "g:" + GENRE_ART[g];
  }
  return hit ? hit[0] : "";
}
const artSrc = (art) => (art.startsWith("g:") ? `genre-art/${art.slice(2)}` : `box-art/${art}`) + ".webp";
const boxIconSvg = (art) => `<svg class="box-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BOX_ICON[art.startsWith("g:") ? "food" : art] || BOX_ICON.box}</svg>`;

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
    // 「01 / 05」の番号は意味がないので出さない(2026-11-26 デザインチェック)
    const art = boxArtOf(c.key, c.name);
    a.innerHTML = (art ? `<img class="box-art" src="${artSrc(art)}" alt="" loading="lazy" decoding="async">` : "") +
      `<span class="box-title">${boxIconSvg(art)}<span class="box-name"></span></span><span class="box-sub"></span><span class="box-n"></span>`;
    if (art) a.classList.add("has-art");
    a.querySelector(".box-name").textContent = c.name;
    // 5文字以上の名前は、字を少し小さくして2行まで(2026-11-26 デザインチェック「行きた…」)
    if ([...c.name].length >= 5) a.classList.add("long-name");
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
  showBox(key);
}
function showBox(key) {
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

// 箱の管理(設定から): 新しい箱を作る・箱の一覧。箱を押すと、その箱のメニュー(名前を変える・削除…)
// (2026-11-26 きよさん「フォルダの管理のように、箱の管理も。一覧・名前を変える・削除(中身は消えない)」)
function openBoxManage() {
  const dlg = $("#folderDlg"), list = $("#folderDlgList");
  $("#folderDlgTitle").textContent = "箱の管理";
  $("#folderDlgSub").hidden = true;
  $("#folderOrder").hidden = true;
  list.innerHTML = "";
  const add = document.createElement("button");
  add.className = "accent";
  add.textContent = "＋ 新しい箱を作る";
  add.onclick = async () => { dlg.close(); await createBox(); };
  list.appendChild(add);
  boxes.forEach((b) => {
    const nf = folders.filter((f) => f.box_id === b.id).length, ni = items.filter((i) => boxOf(i) === b.id).length;
    const e = document.createElement("button");
    e.innerHTML = "📦 " + escapeHtml(b.name) + `<span class="hint">フォルダ ${nf}・${ni}件 ›</span>`;
    e.onclick = () => { dlg.close(); openBoxMenu(b.id, true); };
    list.appendChild(e);
  });
  const note = document.createElement("p");
  note.className = "sheet-sub";
  note.style.whiteSpace = "normal";   // 1行で切れないように
  note.textContent = boxes.length ? "押すと名前を変える・削除。並べ替えは最初の画面で箱を長押し" : "箱はまだありません";
  list.appendChild(note);
  if (!dlg.open) dlg.showModal();
}

// 箱のメニュー(箱の中の見出しの「⋯」・箱の管理から): 名前を変える・入れるフォルダを選ぶ・箱を削除
// fromManage: 箱の管理から開いたとき。終わったら箱の管理に戻る
function openBoxMenu(bid, fromManage = false) {
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
  const back = () => { if (fromManage) openBoxManage(); };
  btn("✏️ 名前を変える", async () => {
    const v = (prompt("新しい名前", name) || "").trim();
    if (!v || v === name) return back();
    const res = await api(`/api/boxes/${bid}`, { method: "PATCH", body: { name: v } });
    if (res && res.error) toast(res.error);
    else toast(`箱の名前を「${v}」にしました`);
    await load();
    back();
  });
  btn("🗑 箱を削除<span class=\"hint\">中のフォルダ・お店は消えません</span>", async () => {
    if (!await askYesNo(`箱「${name}」を削除してよろしいですか?`, "中のフォルダやお店は消えずに、箱の外(「すべて」)に戻ります。")) return back();
    await api(`/api/boxes/${bid}`, { method: "DELETE" });
    // 消した箱の中にいたときだけ箱の並びへ戻る(箱の管理から、ほかの箱を消したときは今の画面のまま)
    if (activeBox === bid) { if (history.state && history.state.box != null) history.back(); else leaveBox(); }
    await load();
    toast(`箱「${name}」を削除しました`);
    back();
  }, "danger");
  if (fromManage) btn("‹ 箱の管理に戻る", back);
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
  if (memoOpen()) showMemo(false);
  // 履歴の中身に画面を合わせる(箱の中から「戻る」で箱の並びへ。再読み込みのあとに戻った先が箱の中なら、その箱へ)
  const key = (history.state || {}).box;
  if (key == null) { if (activeBox != null && boxes.length) leaveBox(); }
  else if (key !== activeBox && (key === "all" || boxes.some((b) => b.id === key))) {
    showBox(key);
  }
});
$("#memoForm").onsubmit = async (e) => {
  e.preventDefault();
  const input = $("#memoInput");
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  const go = $("#memoForm .go");
  if (go.disabled) return;   // 二度押しで2件できないように
  go.disabled = true;
  try {
    await api("/api/items", { method: "POST", body: { text, kind: "memo" } });
    input.value = "";
    await load();
    toast("メモを保存しました");
  } catch (err) {
    toast("保存できませんでした");
  } finally {
    go.disabled = false;
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

// 検索欄: 打つたびに全件を描き直すと、件数が多いとき文字の入力がもたつくので、打ち終わりを少し待ってから(2026-11-26)
let filterTimer = 0;
$("#filterInput").oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { filterTimer = 0; render(); }, items.length > 150 ? 180 : 0); };
$("#filterInput").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (filterTimer) { clearTimeout(filterTimer); filterTimer = 0; render(); }   // 待っている描き直しを先に済ませる
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
  ["purple", "むらさき", "#7048e8"], ["blue", "そらいろ", "#1c7ed6"], ["teal", "みずいろ", "#0c8599"],
  ["green", "みどり", "#2b8a3e"], ["brown", "ちゃいろ", "#9c6644"], ["gray", "グレー", "#495057"],
];

const BGS = [["fuwa", "ふんわり"], ["sakura", "さくら"], ["sora", "そら"], ["mint", "ミント"], ["shiro", "しろ"]];
const CARD_COLORS = [["white", "しろ"], ["cream", "クリーム"], ["sakura", "さくら"], ["sora", "そら"], ["mint", "ミント"], ["lavender", "ふじ"]];
// カードの形の見本の絵(2026-11-26 きよさん「グラフィックに表して」)。塗りは --card-bg なので、カードの色を選ぶと絵の色も変わる
const SP_LINES = (x, y, w) => `<rect class="sp-ln" x="${x}" y="${y}" width="${w}" height="3" rx="1.5"/><rect class="sp-ln" x="${x}" y="${y + 6}" width="${w * 0.6}" height="3" rx="1.5"/>`;
const SHAPE_PICS = {
  float: `<svg class="sp sp-float" viewBox="0 0 88 50" aria-hidden="true">
    <g transform="rotate(-7 28 26)"><rect class="sp-card" x="10" y="10" width="34" height="30" rx="6"/>${SP_LINES(16, 18, 20)}</g>
    <g transform="rotate(6 60 24)"><rect class="sp-card" x="44" y="8" width="34" height="30" rx="6"/>${SP_LINES(50, 16, 20)}</g></svg>`,
  stack: `<svg class="sp sp-stack" viewBox="0 0 88 50" aria-hidden="true">
    <rect class="sp-back2" x="24" y="4" width="40" height="30" rx="6"/>
    <rect class="sp-back1" x="18" y="9" width="52" height="30" rx="6"/>
    <rect class="sp-card" x="12" y="15" width="64" height="31" rx="7"/>${SP_LINES(20, 24, 34)}</svg>`,
  seal: `<svg class="sp sp-seal" viewBox="0 0 88 50" aria-hidden="true">
    <rect class="sp-card sp-thick" x="8" y="9" width="34" height="32" rx="7"/>${SP_LINES(15, 18, 18)}
    <rect class="sp-tint sp-thick" x="46" y="9" width="34" height="32" rx="7"/>${SP_LINES(53, 18, 18)}</svg>`,
  plain: `<svg class="sp sp-plain" viewBox="0 0 88 50" aria-hidden="true">
    <rect class="sp-card sp-outline" x="12" y="10" width="64" height="30" rx="6"/>${SP_LINES(20, 19, 34)}</svg>`,
};
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
    b.innerHTML = `${SHAPE_PICS[key] || ""}<b>${label}</b><small>${note}</small>`;
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
  $("#boxSetBtn").innerHTML = boxes.length ? `📦 箱の管理<small>作る・名前を変える・削除(今 ${boxes.length}個)</small>` : "📦 箱を作る<small>食事・サイト・旅行…のまとまり</small>";
  renderSettings(); $("#settingsDlg").showModal();
};
$("#boxSetBtn").onclick = async () => { $("#settingsDlg").close(); if (boxes.length) openBoxManage(); else await createBox(); };
$("#folderSetBtn").onclick = () => { $("#settingsDlg").close(); openFolderMenu(null); };
$("#settingsClose").onclick = $("#settingsX").onclick = () => $("#settingsDlg").close();
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
    // 箱の中・メモの画面で再読み込みしたら、その画面に戻す(履歴は残っているので、戻さないと「戻る」が1回空振りする)
    const st = history.state || {};
    if (st.box != null) activeBox = st.box;
    await load();
    if (st.box != null && (activeBox == null || !boxes.length)) { activeBox = null; history.back(); }   // 箱が消えていた
    else if (st.memo) showMemo(true);
    checkClip();
  }
})();
