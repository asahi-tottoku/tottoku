const $ = (s) => document.querySelector(s);
const ICONS = { "飲食店": "🍽", "お出かけ": "📍", "買い物": "🛍", "記事": "📰", "動画": "▶", "レシピ": "🍳", "その他": "🔖" };
const WD = "日月火水木金土";
let items = [];
let folders = [];
let activeFolder = "all";   // "all" | "none" | フォルダid
let activeGenre = null;      // 選んだジャンル(null = 全ジャンル)
let activeArea = "all";      // 選んだ地域("all" | "none" = 地域なし | 地域の名前)
let hitIds = null;          // (旧「AIに聞く」の名残。今は常に null)
let view = "list";          // "list" | "map"
let myPos = null;           // 現在地 {lat, lng}

// Web版: データはこの端末の中(localdb.js)。PC版と同じ呼び方で読み書きする
async function api(path, opts = {}) {
  return LocalAPI.request(opts.method || "GET", path, opts.body || {});
}

// act = { label, fn, ms }: お知らせの中にボタンを1つ出す(「元に戻す」)
function toast(msg, act) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  if (act) {
    const b = document.createElement("button");
    b.textContent = act.label;
    b.onclick = () => { t.hidden = true; act.fn(); };
    t.appendChild(b);
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), act ? act.ms : 2800);
}

function getPref(k, d) { try { return localStorage.getItem("tottoku-" + k) || d; } catch (e) { return d; } }
function setPref(k, v) { try { localStorage.setItem("tottoku-" + k, v); } catch (e) { /* 保存できなくてもよい */ } }

async function load() {
  let data = { items, folders };
  try { data = await api("/api/items"); } catch (e) { toast("データを読み込めませんでした"); }
  items = data.items || [];
  folders = data.folders || [];
  if (activeFolder !== "all" && activeFolder !== "none" && !folders.some((f) => f.id === activeFolder)) activeFolder = "all";
  render();
}

const folderName = (id) => (folders.find((f) => f.id === id) || {}).name;

function fmtDate(sec) {
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------- フォルダ
async function createFolder() {
  const name = (prompt("新しいフォルダの名前(例:行きたい店、接待用、旅行)") || "").trim();
  if (!name) return null;
  const res = await api("/api/folders", { method: "POST", body: { name } });
  if (res.error) { toast(res.error); return null; }
  toast(`「${name}」を作りました`);
  return res.id;
}


function renderFolders() {
  const box = $("#folders");
  box.innerHTML = "";
  const q = filterQ();
  const count = (fn) => items.filter((i) => matches(i, q) && fn(i)).length;
  const entries = [["all", "すべて", count(() => true)]];
  folders.forEach((f) => entries.push([f.id, "📁 " + f.name, count((i) => i.folder_id === f.id)]));
  if (folders.length) entries.push(["none", "フォルダなし", count((i) => !folderName(i.folder_id))]);
  entries.forEach(([key, label, n]) => {
    const b = document.createElement("button");
    b.className = "fbtn" + (key === activeFolder ? " on" : "");
    b.innerHTML = `${escapeHtml(label)}<small>${n}</small>`;
    b.onclick = () => { activeFolder = key; render(); };
    if (typeof key === "number") attachFolderPress(b, key);
    box.appendChild(b);
  });
  // フォルダの操作は「⋯」ボタン(と、フォルダの長押し)のメニューにまとめる
  const more = $("#folderMore");   // 右端に固定(横にスクロールしても隠れない)
  more.textContent = folders.length ? "⋯" : "+ フォルダ";
  more.onclick = () => openFolderMenu(null);
}

// フォルダの長押し(スマホ)・右クリック(PC)で、そのフォルダのメニューを開く。
// 長押しの後のクリックは無視する。長押し前に指が動いたら(横スクロール)何もしない
function attachFolderPress(b, fid) {
  let timer = null, st = null, fired = false;
  b.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    st = { x: t.clientX, y: t.clientY }; fired = false; clearTimeout(timer);
    timer = setTimeout(() => { fired = true; openFolderMenu(fid); }, 550);
  }, { passive: true });
  b.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (st && Math.hypot(t.clientX - st.x, t.clientY - st.y) > 10) clearTimeout(timer);
  }, { passive: true });
  ["touchend", "touchcancel"].forEach((ev) => b.addEventListener(ev, () => { clearTimeout(timer); st = null; }));
  b.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!st && !fired) openFolderMenu(fid); });
  b.addEventListener("click", (e) => {
    if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
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
      if (!confirm(`フォルダ「${name}」を削除しますか?\n中に入っているものは消えずに「フォルダなし」に戻ります。`)) return;
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

function offerAutosort() {
  if (items.some((i) => !i.folder_manual) &&
      confirm("保存済みのものを、自動でフォルダに振り分け直しますか?\n(自分で選んだものは動かしません)")) runAutosort();
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
      await api(`/api/items/${item.id}`, { method: "PATCH", body: { folder: value } });
      toast(value === "auto" ? "自動で選びました" : "移動しました");
      load();
    };
    list.appendChild(b);
  };
  if (!ask) opt("🗂 自動で選ぶ", "auto", !item.folder_manual, "地名とジャンルで選びます");
  folders.forEach((f) => opt("📁 " + f.name, f.id, item.folder_manual && item.folder_id === f.id));
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
  head.textContent = ask ? "地域が分かりませんでした。\nどこのお店ですか?" : "📍 地域";
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
const genreMemo = new WeakMap();   // 読み込み直すと作り直される(items の中身が新しくなるので)
function genreOf(i) {
  if (!genreMemo.has(i)) genreMemo.set(i, genreOf0(i));
  return genreMemo.get(i);
}
function genreOf0(i) {
  const t = (i.tags || []).find((g) => GENRE_NAMES.has(g));
  if (t) return t;
  const d = Sorter.detectGenres([i.title, ...(i.tags || []), i.summary, i.description].join(" "))[0];
  if (d) return d;
  const fg = Sorter.detectGenres(folderName(i.folder_id) || "");   // 「イタリアン」フォルダに入れたなら、イタリアン
  return fg.length === 1 ? fg[0] : "その他";
}
// お店の「地域」(無ければ住所)を市区町村ごとにまとめる。地域が分からないものは ""(地域なし)。
const areaOf = (i) => Sorter.areaGroup(i.area) || Sorter.areaGroup(i.address) || "";
function inArea(i) {
  if (activeArea === "all") return true;
  return activeArea === "none" ? !areaOf(i) : areaOf(i) === activeArea;
}
const inGenre = (i) => !activeGenre || genreOf(i) === activeGenre;
const areaLabel = () => (activeArea === "none" ? "地域なし" : activeArea);

// 選んでいる地域・ジャンルに当たるものが無くなったら(フォルダを変えた・検索した・消した)、外す
function fixFilters() {
  const q = filterQ();
  const base = items.filter((i) => inFolder(i) && matches(i, q));
  if (activeArea !== "all" && !base.some(inArea)) activeArea = "all";
  if (activeGenre && !base.some((i) => inArea(i) && inGenre(i))) activeGenre = null;
}
// mark: 段の左端の印(📍・🍴。押せない)。rows: [値, 名前, 件数] の並び。cur: 今の値。pick(値): 押したとき
// 「全地域」「全ジャンル」のボタンは置かない(選んだボタンをもう一度押すか「✕ 解除」で外れる)
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
  const base = items.filter((i) => inFolder(i) && matches(i, q));
  if (new Set(base.map(areaOf)).size < 2) { box.hidden = true; box.innerHTML = ""; return; }
  const shown = base.filter(inGenre);
  const count = new Map();
  shown.forEach((i) => { const a = areaOf(i); count.set(a, (count.get(a) || 0) + 1); });
  const named = [...count].filter(([a]) => a).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "ja"));
  const rows = named.map(([a, n]) => [a, a, n]);
  if (count.has("")) rows.push(["none", "地域なし", count.get("")]);
  chipRow(box, "📍", rows, activeArea, (v) => { activeArea = v === activeArea ? "all" : v; });
}
function renderGenres() {
  const box = $("#genreBar");
  const q = filterQ();
  const base = items.filter((i) => inFolder(i) && matches(i, q));
  if (new Set(base.map(genreOf)).size < 2) { box.hidden = true; box.innerHTML = ""; return; }
  const shown = base.filter(inArea);
  const count = new Map();
  shown.forEach((i) => { const g = genreOf(i); count.set(g, (count.get(g) || 0) + 1); });
  const order = [...count].sort((a, b) => (a[0] === "その他") - (b[0] === "その他") || b[1] - a[1]);
  const rows = order.map(([g, n]) => [g, GENRE_LABEL[g] || g, n]);
  chipRow(box, "🍴", rows, activeGenre, (v) => { activeGenre = v === activeGenre ? null : v; });
}
// 今の絞り込みを1行で見せる(「📍御殿場 × 🍴焼肉 3件 ✕ 解除」)。地域もジャンルも選んでいなければ出さない
function renderFilterLine(n) {
  const box = $("#filterLine");
  const parts = [];
  if (activeArea !== "all") parts.push("📍" + areaLabel());
  if (activeGenre) parts.push("🍴" + (GENRE_LABEL[activeGenre] || activeGenre));
  box.hidden = !parts.length;
  if (!parts.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<span class="fl-what">${escapeHtml(parts.join(" × "))}</span><span class="fl-n">${n}件</span><button type="button">✕ 解除</button>`;
  box.querySelector("button").onclick = () => { activeArea = "all"; activeGenre = null; render(); };
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
  const base = items.filter((i) => inFolder(i) && matches(i, q) && inGenre(i) && inArea(i));
  let list = base;
  if ($("#sortSel").value === "near") list.sort((a, b) => (distKm(a) ?? 1e9) - (distKm(b) ?? 1e9));
  if (hitIds) {
    const rank = new Map(hitIds.map((id, n) => [id, n]));
    list = items.filter((i) => rank.has(i.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  }
  return list;
}

// バックアップのお知らせ: 5件以上あって、前回の書き出し(無ければ最初の保存)から30日たったら出す。
// 「あとで」で7日休む。通信はしない(この端末の中の日付を見るだけ)。
function renderBackup() {
  const box = $("#remind");
  const DAY = 86400000, now = Date.now();
  const last = Number(getPref("exportedAt", 0)) || 0;
  const first = items.reduce((m, i) => Math.min(m, (i.created_at || 0) * 1000 || now), now);
  const due = items.length >= 5 && now - (last || first) > 30 * DAY && now > (Number(getPref("backupSnooze", 0)) || 0);
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
  renderFolders();
  fixFilters();
  renderAreas();
  renderGenres();
  const list = currentList();
  renderFilterLine(list.length);
  document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $("#empty").hidden = items.length > 0;
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
  if (hitIds) el.classList.add("hit");
  const th = el.querySelector(".thumb");
  th.href = link;
  const noimg = () => { th.classList.add("noimg"); th.textContent = ICONS[i.category] || "🔖"; };
  if (i.image) {
    th.querySelector("img").src = i.image;
    th.querySelector("img").onerror = noimg;
  } else noimg();
  el.querySelector(".cat").textContent = i.status === "processing" ? "整理中…" : i.category;
  const d = distKm(i);
  el.querySelector(".dist").textContent = d != null ? "📍" + fmtKm(d) : "";
  el.querySelector(".date").textContent = fmtDate(i.created_at) + (i.site ? " · " + i.site.replace(/^www\./, "") : "");
  const t = el.querySelector(".title");
  t.textContent = i.title || i.url; t.href = link;
  el.querySelector(".summary").textContent = i.summary || "";

  const ft = el.querySelector(".folder-tag");
  const fname = folderName(i.folder_id);
  if (folders.length || fname) {
    // フォルダを変えるのは、この表示を押す(カードの「フォルダ」ボタンは 2026-11-11 に外した)
    ft.textContent = (fname ? `📁 ${fname}${i.folder_manual ? "" : " ✨"}` : "📁 フォルダなし") + " ▾";
    ft.title = fname && !i.folder_manual ? "自動で選んだフォルダ" : "";
    if (fname) ft.classList.add("set");
    ft.onclick = () => openMove(i);
  } else ft.remove();

  // 地域(分かっていれば濃く表示。分からなければ薄く「地域を入れる」)。押すと地域を直せる
  const at = el.querySelector(".area-tag");
  const place = i.area || areaOf(i);
  at.textContent = place ? `📍 ${place}` : "📍 地域を入れる";
  if (place) at.classList.add("set");
  at.title = "地域を直す";
  at.onclick = () => openArea(i);

  el.querySelector(".who").textContent = i.recommender ? `👤 ${i.recommender}のおすすめ` : "";

  const si = el.querySelector(".shopinfo");
  const today = todayHours(i);
  if (today || i.address || i.tel) {
    si.hidden = false;
    const sum = si.querySelector("summary");
    sum.textContent = "🕒 " + (today || "お店の情報");
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
  el.querySelector(".act-share").onclick = () => shareItem(i);
  const mapBtn = el.querySelector(".act-map");
  if (i.category === "飲食店" || i.category === "お出かけ" || i.lat) {
    mapBtn.hidden = false;
    mapBtn.onclick = () => {
      const q = i.lat ? `${i.lat},${i.lng}` : `${i.title} ${i.area || ""}`;
      window.open("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q), "_blank");
    };
  }
  el.querySelector(".act-note").onclick = () => openNote(i);
  const retry = el.querySelector(".act-retry");
  retry.hidden = true;   // Web版は、保存したその場で整理するので「再整理」は無い
  retry.onclick = async () => { await api(`/api/items/${i.id}/retry`, { method: "POST", body: {} }); toast("整理し直しています"); load(); };
  el.querySelector(".act-del").onclick = async () => {
    // 確かめの画面は出さず、消したあと8秒だけ「元に戻す」を出す
    await api(`/api/items/${i.id}`, { method: "DELETE" });
    await load();
    const name = (i.title || "").length > 14 ? i.title.slice(0, 13) + "…" : i.title;
    toast(`「${name}」を削除しました`, { label: "元に戻す", ms: 8000, fn: async () => {
      await api("/api/items/restore", { method: "POST", body: { item: i } });
      await load();
      toast("元に戻しました");
    } });
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

// ---------------------------------------------------------------- 入力
// 保存: 「保存」を押したら、フォルダを選ぶ画面を出してから保存する(フォルダが無ければそのまま保存)
$("#addForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("#addInput").value.trim();
  if (!v) return;
  $("#addInput").blur();
  if (!folders.length) { saveItem(v, null); return; }
  const dlg = $("#saveDlg");
  $("#saveName").textContent = v.length > 60 ? v.slice(0, 60) + "…" : v;
  const list = $("#saveList");
  list.innerHTML = "";
  const opt = (label, fid, cls = "") => {
    const b = document.createElement("button");
    b.innerHTML = label;
    if (cls) b.className = cls;
    b.onclick = () => { dlg.close(); saveItem(v, fid); };
    list.appendChild(b);
  };
  opt('🗂 自動で選ぶ<span class="hint">地名とジャンルで振り分け</span>', null, "accent");
  folders.forEach((f) => opt("📁 " + escapeHtml(f.name), f.id));
  $("#saveNew").onclick = async () => {
    dlg.close();
    const id = await createFolder();
    if (id) { await load(); saveItem(v, id); }
  };
  dlg.showModal();
};

async function saveItem(v, fid) {
  const body = /^https?:\/\//.test(v) ? { url: v } : { text: v };
  body.folder_id = fid;
  $("#addInput").value = "";
  try {
    const res = await api("/api/items", { method: "POST", body });
    await afterSave(res.id, fid == null, res.learned);
  } catch (err) {
    toast("保存できませんでした");
  }
}

// 保存のあと: 入ったフォルダを知らせる。自動で決まらなかったら、どこに入れるかその場で聞く
// (選んだものは「自分で選んだ」になり、同じ名前・同じチェーンの店を次から同じフォルダに入れる)
async function afterSave(id, auto, learned = false) {
  await load();
  let it = items.find((x) => x.id === id);
  if (it && auto && !(it.area || areaOf(it))) {   // 地域が分からない → 先に聞く(入れるとフォルダも振り分け直す)
    await openArea(it, true);
    it = items.find((x) => x.id === id);
  }
  const where = it && folderName(it.folder_id);
  if (it && !where && auto && folders.length) { openMove(it, true); return; }
  // learned: 2つのフォルダで迷ったが、前に自分で選んだのと同じ側に入れた
  toast(where ? `「${where}」に保存しました` + (learned ? "(前と同じ分け方)" : "") : "とっとくに保存しました");
}

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
  ["orange", "オレンジ", "#e8590c"], ["red", "ローズ", "#d6336c"], ["pink", "ピンク", "#c2255c"],
  ["purple", "むらさき", "#7048e8"], ["blue", "あお", "#1c7ed6"], ["teal", "みずいろ", "#0c8599"],
  ["green", "みどり", "#2b8a3e"], ["brown", "ちゃいろ", "#9c6644"], ["gray", "グレー", "#495057"],
];

function getLook() {
  try { return JSON.parse(localStorage.getItem("tottoku-look") || "{}"); } catch (e) { return {}; }
}

function applyLook(look) {
  const root = document.documentElement;
  root.dataset.accent = look.accent || "orange";
  if (look.theme && look.theme !== "auto") root.dataset.theme = look.theme;
  else delete root.dataset.theme;
  // スマホの上の帯(ステータスバー)の色も合わせる
  requestAnimationFrame(() => {
    const c = getComputedStyle(root).getPropertyValue("--bg").trim();
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
    b.className = "swatch" + ((look.accent || "orange") === key ? " on" : "");
    b.style.background = color;
    b.setAttribute("aria-label", label);
    b.onclick = () => saveLook({ accent: key });
    const name = document.createElement("span");
    name.className = "swatch-name"; name.textContent = label;
    wrap.append(b, name);
    box.appendChild(wrap);
  });
  document.querySelectorAll("#themeSeg button").forEach((b) => {
    b.classList.toggle("on", (look.theme || "auto") === b.dataset.theme);
    b.onclick = () => saveLook({ theme: b.dataset.theme });
  });
  const last = getPref("exported", "");
  $("#backupNote").textContent = `保存したもの ${items.length}件・フォルダ ${folders.length}個。` +
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
  if (!confirm(`このファイルの${n}件で、今のデータ(${items.length}件)を置き換えますか?\n今のデータは消えます。`)) return;
  try {
    const r = LocalAPI.importData(data);
    await LocalAPI.saveState();
    activeFolder = "all";
    await load();
    renderSettings();
    toast(`${r.items}件・フォルダ${r.folders}個を読み込みました`);
  } catch (err) { toast(err.message || "読み込めませんでした"); }
};

$("#settingsBtn").onclick = () => { renderSettings(); $("#settingsDlg").showModal(); };
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
    await afterSave(res.id, true, res.learned);
  } else {
    await load();
  }
})();
