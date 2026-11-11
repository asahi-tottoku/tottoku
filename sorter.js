// とっとく - フォルダの自動振り分け(AIを使わない)。sorter.py を JavaScript に移したもの。
//
// フォルダ名を「地名」と「ジャンル」の言葉に分けて、アイテムがその全部に合うフォルダを選ぶ。
//   - ジャンルは同義語で広げる(例: 焼肉 ← ホルモン・カルビ)
//   - 地名は、同じ区・隣の町まで広げる(例: 六本木 ← 西麻布・港区)
//   - 辞書に無い言葉は、その言葉そのものがアイテムに入っていれば合う
//   - 決めきれないとき(合うフォルダが無い・同じくらい合うものが複数)は null を返す
//     → 呼ぶ側は今のフォルダのまま動かさない
// 辞書を変えるときは、sorter.py と同じにしておく(test_sorter_js.py で食い違いを調べられる)。
(function (root) {
  "use strict";

  // 比べるための正規化: 全角/半角・空白・大文字小文字の違いをなくす
  const fnorm = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ---------------------------------------------------------------- ジャンルの辞書
  // 名前: [同義語, 親ジャンル]。親ジャンルのフォルダは、子ジャンルの言葉でも合う。
  const GENRES = {
    "焼肉": [["焼肉", "焼き肉", "やきにく", "ホルモン", "カルビ", "ジンギスカン", "ステーキ", "肉バル"], null],
    "和食": [["和食", "日本料理", "会席", "懐石", "割烹", "料亭", "小料理", "おばんざい",
              "しゃぶしゃぶ", "すき焼", "おでん", "とんかつ", "炉端"], null],
    "寿司": [["寿司", "鮨", "鮓", "スシ", "寿し", "すし処", "回転すし", "すしざんまい"], "和食"],
    "天ぷら": [["天ぷら", "天麩羅", "天婦羅"], "和食"],
    "蕎麦": [["蕎麦", "そば処", "そば屋", "手打ちそば", "うどん"], "和食"],
    "うなぎ": [["うなぎ", "鰻", "ひつまぶし"], "和食"],
    "焼き鳥": [["焼き鳥", "焼鳥", "やきとり"], "和食"],
    "洋食": [["洋食", "ハンバーグ", "オムライス"], null],
    "イタリアン": [["イタリアン", "イタリア料理", "パスタ", "ピザ", "ピッツァ", "トラットリア",
                    "リストランテ", "オステリア"], "洋食"],
    "フレンチ": [["フレンチ", "フランス料理", "ビストロ", "ブラッスリー"], "洋食"],
    "スペイン料理": [["スペイン料理", "スペインバル", "パエリア", "タパス"], "洋食"],
    "中華": [["中華料理", "中国料理", "四川", "広東", "点心", "飲茶", "餃子", "小籠包", "麻婆"], null],
    "ラーメン": [["ラーメン", "らーめん", "拉麺", "つけ麺", "中華そば", "担々麺"], null],
    "韓国料理": [["韓国料理", "サムギョプサル", "チゲ", "ビビンバ", "韓国"], null],
    "エスニック": [["エスニック", "タイ料理", "ベトナム料理", "インド料理", "フォー", "ガパオ"], null],
    "カレー": [["カレー"], null],
    "ハンバーガー": [["ハンバーガー", "バーガー"], null],
    "居酒屋": [["居酒屋", "酒場", "立ち飲み", "立飲み"], null],
    "カフェ": [["カフェ", "喫茶", "珈琲", "コーヒー"], null],
    "スイーツ": [["スイーツ", "ケーキ", "パティスリー", "洋菓子", "和菓子", "甘味", "クレープ", "パフェ",
                  "パンケーキ", "ジェラート", "アイスクリーム", "ドーナツ", "タルト", "チョコレート",
                  "プリン", "かき氷"], null],
    "パン": [["ベーカリー", "パン屋", "ブーランジェリー"], null],
  };

  // ---------------------------------------------------------------- 地名の辞書
  const AREAS = {
    // 東京23区
    "千代田区": ["丸の内", "大手町", "有楽町", "日比谷", "神田", "秋葉原", "御茶ノ水", "神保町", "九段", "飯田橋", "麹町", "永田町"],
    "中央区": ["銀座", "日本橋", "築地", "月島", "勝どき", "八重洲", "京橋", "人形町", "茅場町", "東銀座"],
    "港区": ["六本木", "西麻布", "東麻布", "元麻布", "麻布十番", "麻布", "赤坂", "青山", "南青山", "北青山", "乃木坂",
             "広尾", "白金", "白金台", "高輪", "新橋", "虎ノ門", "浜松町", "芝浦", "芝公園", "田町", "三田", "お台場", "表参道"],
    "新宿区": ["新宿", "西新宿", "歌舞伎町", "神楽坂", "四谷", "高田馬場", "大久保", "新大久保", "早稲田", "市ヶ谷", "荒木町"],
    "渋谷区": ["渋谷", "恵比寿", "代官山", "原宿", "神宮前", "代々木", "代々木上原", "初台", "笹塚", "幡ヶ谷", "富ヶ谷", "千駄ヶ谷"],
    "目黒区": ["目黒", "中目黒", "自由が丘", "学芸大学", "祐天寺", "都立大学"],
    "品川区": ["品川", "大崎", "五反田", "戸越", "武蔵小山", "大井町", "旗の台"],
    "世田谷区": ["三軒茶屋", "下北沢", "二子玉川", "経堂", "用賀", "桜新町", "成城", "駒沢"],
    "豊島区": ["池袋", "大塚", "巣鴨", "目白"],
    "台東区": ["上野", "浅草", "御徒町", "蔵前", "谷中", "入谷"],
    "墨田区": ["押上", "錦糸町", "両国", "向島"],
    "江東区": ["豊洲", "門前仲町", "清澄白河", "亀戸", "有明", "木場"],
    "文京区": ["本郷", "後楽園", "湯島", "根津", "千駄木", "茗荷谷"],
    "大田区": ["蒲田", "大森", "田園調布", "羽田"],
    "中野区": ["中野"],
    "杉並区": ["高円寺", "阿佐ヶ谷", "荻窪", "西荻窪"],
    "北区": ["赤羽", "王子", "十条"],
    "荒川区": ["日暮里", "西日暮里", "町屋"],
    "練馬区": ["練馬", "石神井", "大泉学園"],
    "板橋区": ["板橋", "成増"],
    "足立区": ["北千住", "綾瀬", "西新井"],
    "葛飾区": ["柴又", "亀有", "金町", "新小岩"],
    "江戸川区": ["葛西", "小岩", "船堀"],
    // 静岡県東部
    "御殿場市": ["御殿場", "東田中", "神山", "川島田", "萩原", "二の岡", "仁杉", "印野", "中畑", "保土沢"],
    "裾野市": ["裾野"],
    "小山町": ["須走", "足柄"],
    "三島市": ["三島"],
    "沼津市": ["沼津"],
    "長泉町": ["長泉"],
    "富士市": ["吉原"],
    "富士宮市": ["富士宮"],
    "熱海市": ["熱海"],
    "伊豆の国市": ["伊豆長岡", "韮山"],
    "伊東市": ["伊東"],
    "静岡市": ["静岡駅", "清水", "葵区", "駿河区"],
    // 神奈川県
    "箱根町": ["箱根", "強羅", "仙石原", "芦ノ湖", "湯本"],
    "鎌倉市": ["鎌倉", "大船", "長谷"],
    "横浜市": ["横浜", "みなとみらい", "中華街", "元町", "関内", "桜木町", "野毛", "新横浜"],
    "川崎市": ["川崎", "武蔵小杉", "溝の口"],
    "小田原市": ["小田原"],
  };

  // 隣の市町(区どうしは広くなりすぎるので入れない)
  const NEIGHBORS = {
    "御殿場市": ["裾野市", "小山町"],
    "裾野市": ["御殿場市", "長泉町", "三島市"],
    "小山町": ["御殿場市"],
    "三島市": ["沼津市", "長泉町", "裾野市"],
    "沼津市": ["三島市", "長泉町"],
    "長泉町": ["三島市", "沼津市", "裾野市"],
    "富士市": ["富士宮市"],
    "富士宮市": ["富士市"],
  };

  // ---------------------------------------------------------------- 全国の市区町村(Web版だけ)
  // places_jp.js(self.PLACES_JP)があれば、全国の市区町村を地名の辞書に足す。
  // 無いとき(Node のテスト)は上の辞書だけ = sorter.py と同じ答えになる。
  // 上の辞書に元からある地名は、そちらが先(町の名前や隣の市町が付いているので)。
  const NATIONAL = new Set();   // 全国の表から足した市区町村(文の中から探すときは、よくある言葉を外す)
  const PLACES = [];            // { pref, name, lat, lng } 座標からいちばん近い市区町村を探す用
  let PREF_RE = null;           // 都道府県名・郡名(文から地名を探す前に外す。「長野県北佐久郡軽井沢町」を「長野」「佐久」と間違えない)
  const PREF_OF = new Map();    // まとめた地域の名前(「御殿場」)→ 都道府県(「静岡県」)。1つに決まるものだけ
  if (root.PLACES_JP) {
    const counties = new Set();
    const byKey = new Map();    // 市区町村(「御殿場市」)→ その名前がある都道府県
    for (const p of root.PLACES_JP.list) {
      const g = p.name.match(/^(.+?郡)/);
      if (g) counties.add(g[1]);
      const name = p.name.replace(/^.+?郡/, "");          // 「北佐久郡軽井沢町」→「軽井沢町」
      const m = name.match(/^(.+?市)(.+区)$/);            // 政令市の区「横浜市中区」は「横浜市」の中に入れる
      const key = m ? m[1] : name;
      PLACES.push({ pref: p.pref, name, lat: p.lat, lng: p.lng });
      if (!AREAS[key]) { AREAS[key] = []; NATIONAL.add(key); }
      if (m && !AREAS[key].includes(name)) AREAS[key].push(name);
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(p.pref);
    }
    // 同じ名前が複数の県にあるとき: 上の手書きの辞書にある市町(小山町)→ 市・区(川崎市。川崎町より先)→ それ以外、の順に見て、
    // その中で県が1つならそれに決める。2つ以上(府中・伊達)なら決めない
    const cand = new Map();
    for (const [key, ps] of byKey) {
      const g = bare(key);
      if (!cand.has(g)) cand.set(g, [new Set(), new Set(), new Set()]);
      const c = cand.get(g);
      const rank = !NATIONAL.has(key) ? 0 : /[市区]$/.test(key) ? 1 : 2;
      ps.forEach((x) => c[rank].add(x));
    }
    for (const [g, c] of cand) {
      const first = c.find((s) => s.size);
      if (first.size === 1) PREF_OF.set(g, [...first][0]);
    }
    PREF_RE = new RegExp([...root.PLACES_JP.prefs, ...counties].map((s) => s.normalize("NFKC")).join("|"), "g");
  }
  // Web版だけのジャンル(PC版の辞書と答えを変えないため、全国の表があるときだけ足す)
  if (root.PLACES_JP) Object.assign(GENRES, {
    "お好み焼き": [["お好み焼", "おこのみやき", "もんじゃ", "たこ焼", "たこやき"], null],
    "鉄板焼き": [["鉄板焼", "鉄板料理"], null],
    "バー": [["ワインバー", "ダイニングバー", "ショットバー", "スポーツバー", "カフェバー", "オイスターバー",
              "ビアバー", "ビアホール", "ビアガーデン", "クラフトビール"], null],
  });
  // 短いカタカナのジャンル名は、ほかの言葉の一部のときは数えない(「ジャパン」「パンケーキ」「ハンバーガー」)。
  // 前後がカタカナでないときだけ合う。Web版だけ。
  const STRICT = {
    "パン": "(?:^|[^ァ-ヶー])パン(?![ァ-ヶー])",
    "バー": "(?:^|[^ァ-ヶー])バー(?![ァ-ヶー])",
  };
  const wordPat = (w) => (NATIONAL.size && STRICT[w]) || esc(fnorm(w));

  // 名前から「市」などを外すと、ふつうの言葉と同じになる市町村(文の中では「〇〇市」「〇〇町」と書いてあるときだけ合わせる)
  const COMMON_WORDS = new Set(["中央", "大和", "朝日", "昭和", "明和", "美里", "美郷", "美浜", "南部", "太子", "日高",
    "池田", "金山", "高森", "本山", "大町", "清水", "緑", "青葉", "旭", "白山", "長和", "和光", "大洗", "東", "西",
    "南", "北", "平和", "共和", "協和", "福井", "幸", "栄", "豊", "三和", "八幡", "神山", "小山", "大石", "大平",
    "大川", "大野", "高野", "上野", "神田", "佐賀", "宮崎", "熊本", "大分", "長崎", "福島"]);

  // 「御殿場市」「御殿場駅」→「御殿場」
  function bare(name) {
    const b = name.replace(/(都|道|府|県|市|区|町|村|駅)$/, "");
    return b.length >= 2 ? b : name;
  }

  // 全国の表があるとき(Web版)は、「中央区」→「中央」のような、ふつうの言葉になる短い形は使わない
  const bareOk = (k) => (NATIONAL.size && COMMON_WORDS.has(bare(k)) ? k : bare(k));
  function areaWords(key) {
    let words = [key, bareOk(key), ...AREAS[key]];
    for (const n of NEIGHBORS[key] || []) words = words.concat([n, bareOk(n)], AREAS[n] || []);
    return words;
  }

  // 「港区」「北区」などは大阪市港区・名古屋市北区にもあるので、「〇〇市港区」は除く
  function placePattern(word) {
    const w = esc(fnorm(word));
    return word.endsWith("区") ? "(?<!市)" + w : w;
  }

  // フォルダ名の1語を、[種類, 合う言葉の正規表現のリスト, 親ジャンル] にする
  const tokenCache = new Map();
  function resolveToken(token) {
    if (!tokenCache.has(token)) tokenCache.set(token, resolveToken0(token));
    return tokenCache.get(token);
  }
  function resolveToken0(token) {
    const t = fnorm(token);
    for (const [name, [words, parent]] of Object.entries(GENRES)) {
      if ([...words, name].some((w) => fnorm(w) === t)) {
        let all = [...words, name];
        for (const [child, [cw, cp]] of Object.entries(GENRES)) if (cp === name) all = all.concat(cw, [child]);
        return ["genre", all.map(wordPat), parent];
      }
    }
    for (const key of Object.keys(AREAS)) {
      if (t === fnorm(key) || t === fnorm(bare(key))) return ["place", areaWords(key).map(placePattern), null];
    }
    for (const [key, members] of Object.entries(AREAS)) {
      const ms = members.map(fnorm);
      if (ms.includes(t) || ms.includes(fnorm(bare(token)))) {
        return ["place", [token, ...areaWords(key)].map(placePattern), null];
      }
    }
    return ["word", [esc(t)], null];
  }

  const splitName = (name) => String(name || "").normalize("NFKC").split(/[\s/・,、&＆+＋]+/).filter(Boolean);

  // フォルダ名の言葉が全部合えば [言葉の数, 子ジャンルの数] を返す。合わなければ null
  // Web版(全国の表があるとき)は、フォルダ名のジャンルどうしは「どれか1つ」に合えばよい。
  //   「ラーメン うどん 蕎麦」= ラーメンか蕎麦(うどん)の店。「御殿場 焼肉」= 御殿場の、焼肉の店(地名とジャンルは両方)。
  //   ジャンルはまとめて1語と数える(「御殿場 焼肉」と同じ強さ)。
  // PC版(表が無いとき)は今までどおり、全部の言葉に合うこと。
  function folderMatch(name, genreText, placeText) {
    const tokens = splitName(name);
    if (!tokens.length) return null;
    const anyGenre = NATIONAL.size > 0;
    let child = 0, n = 0, genreSeen = false, genreHit = false;
    for (const tok of tokens) {
      const [kind, pats, parent] = resolveToken(tok);
      const text = kind === "place" ? placeText : genreText + " " + placeText;
      const ok = pats.some((p) => new RegExp(p).test(text));
      if (anyGenre && kind === "genre") {
        genreSeen = true;
        if (ok) { genreHit = true; if (parent) child++; }
        continue;
      }
      if (!ok) return null;
      n++;
      if (kind === "genre" && parent) child++;
    }
    if (genreSeen) { if (!genreHit) return null; n++; }
    return [n, child];
  }

  // アイテムから、ジャンルを見る文と地名を見る文を作る。
  // 地名は名前・地域・住所だけで見る。住所も地域も無いときだけ、説明文も使う。
  function itemTexts(item) {
    const g = (k) => String(item[k] || "");
    const tags = item.tags || [];
    const sep = NATIONAL.size ? "|" : " ";
    const genre = fnorm([g("title"), g("category"), g("summary"), g("description"), g("note"), tags.join(sep)].join(sep));
    const place = [g("title"), g("area"), g("address")];
    if (!g("area") && !g("address")) place.push(g("description"));
    return [genre, fnorm(place.join(" "))];
  }

  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];

  // いちばんよく合うフォルダの id を全部返す(同じくらい合うものが複数あれば複数。合うものが無ければ空)
  function topFolders(items, folderList) {
    const texts = items.map(itemTexts);
    const genre = texts.map((t) => t[0]).join(" ");
    const place = texts.map((t) => t[1]).join(" ");
    const scored = [];
    for (const f of folderList) {
      const s = folderMatch(f.name, genre, place);
      if (s) scored.push([s, f.id]);
    }
    if (!scored.length) return [];
    const best = scored.reduce((m, x) => (cmp(x[0], m) > 0 ? x[0] : m), scored[0][0]);
    return scored.filter(([s]) => cmp(s, best) === 0).map(([, id]) => id);
  }

  // items(同じお店をまとめたアイテムのリスト)に合うフォルダの id を返す。決めきれなければ null。
  // current: 今入っているフォルダの id。同じくらい合う候補にそれが含まれていれば、そのままにする。
  function pickFolder(items, folderList, current = null) {
    const top = topFolders(items, folderList);
    if (!top.length) return null;
    if (top.length === 1) return top[0];
    if (top.includes(current)) return current;
    return null;
  }

  // ---------------------------------------------------------------- 保存するときの手がかり(Web版だけで使う)
  // 文の中から、辞書にあるジャンルの名前を全部返す(タグにする)
  // 店名などの英字(「Wine&Pasta」「Cafe」)も、URL と同じローマ字の表で見る
  function detectGenres(text) {
    const t = fnorm(text);
    const latin = t.replace(/[^a-z]+/g, " ");
    const raw = String(text || "").normalize("NFKC");
    const has = (w) => (STRICT[w] ? new RegExp(STRICT[w]).test(raw) : t.includes(fnorm(w)));
    return Object.entries(GENRES).filter(([name, [words]]) => [...words, name].some(has) ||
      (URL_GENRES[name] || []).some((w) => latin.includes(w)) ||
      (name === "バー" && /(^| )bar( |$)/.test(latin)) ||
      (MORE_WORDS[name] || []).some((w) => t.includes(fnorm(w))) ||
      (KANA_WORDS[name] || []).some(([w, bad]) => hasKanaWord(raw, w, bad)))
      .map(([name]) => name);
  }

  // かな書きの店名(「すし匠」「そば 田中」)。Web版だけ。PC版と同じ辞書(GENRES)には足さない。
  // 短いかなは、ふつうの文にも出てくる(「すぐそば」「焼きそば」)ので、前後がひらがなのときは数えない。
  // 前が「お」のときは数える(「おすし」「おそば」)。bad は、前にあったら数えない言葉。
  const KANA_WORDS = {
    "寿司": [["すし", null]],
    "蕎麦": [["そば", /(中華|焼|油|汁なし|支那|台湾)$/]],
  };
  // 長めの言葉は、そのまま探す
  const MORE_WORDS = {
    "天ぷら": ["てんぷら", "天丼"],
    "うなぎ": ["うな重", "うな丼"],
    "焼き鳥": ["焼きとり", "串焼"],
    "ラーメン": ["らぁ麺", "らあめん", "ラー麺", "麺屋"],
    "中華": ["ぎょうざ", "ギョーザ", "ギョウザ"],
    "イタリアン": ["ピッツェリア", "スパゲッティ", "スパゲティ"],
    "パン": ["メロンパン", "カレーパン", "コッペパン", "クロワッサン", "ベーグル"],
  };
  const HIRA = /[ぁ-ん]/;
  function hasKanaWord(t, w, bad) {
    for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
      const b = t[i - 1] || "", a = t[i + w.length] || "";
      if (HIRA.test(a) || (HIRA.test(b) && b !== "お")) continue;
      if (b === "お" && HIRA.test(t[i - 2] || "")) continue;
      if (bad && bad.test(t.slice(0, i))) continue;
      return true;
    }
    return false;
  }

  // 文の中から、辞書にある地名を1つ返す(地域の欄にする)。町の名前を先に、なければ市区町
  function detectPlace(text) {
    let t = fnorm(text);
    if (PREF_RE) t = t.replace(PREF_RE, " ");
    let hit = null;
    for (const [key, members] of Object.entries(AREAS)) {
      for (const m of members) {
        const i = t.indexOf(fnorm(m));
        if (i >= 0 && (!hit || i < hit.i || (i === hit.i && m.length > hit.w.length))) hit = { i, w: m };
      }
    }
    if (hit) return hit.w;
    if (!NATIONAL.size) {   // 全国の表が無いとき(PC版と同じ)
      for (const key of Object.keys(AREAS)) {
        if (new RegExp(placePattern(key)).test(t) || t.includes(fnorm(bare(key)))) return bare(key);
      }
      return "";
    }
    // 全国の表があるとき: 文の中でいちばん前に出てくる市区町村(同じ位置なら長い名前)
    for (const key of Object.keys(AREAS)) {
      const full = t.search(new RegExp(placePattern(key)));
      const b = bare(key);
      const short = b !== key && !(NATIONAL.has(key) && COMMON_WORDS.has(b)) ? t.indexOf(fnorm(b)) : -1;
      for (const [i, len] of [[full, key.length], [short, b.length]]) {
        if (i >= 0 && (!hit || i < hit.i || (i === hit.i && len > hit.len))) hit = { i, len, w: b };
      }
    }
    return hit ? hit.w : "";
  }

  // 地域の欄の言葉を、市区町村ごとにまとめた名前にする(地域で絞り込む欄に使う)。
  // 「六本木」→「港区」、「御殿場市」「御殿場・裾野」→「御殿場」、「横浜市中区」→「横浜」。分からなければ ""
  const groupCache = new Map();
  function areaGroup(text) {
    const s = String(text || "");
    if (!s) return "";
    if (groupCache.has(s)) return groupCache.get(s);
    let out = "";
    const w = detectPlace(s);
    if (w) {
      const t = fnorm(w);
      for (const [key, ms] of Object.entries(AREAS)) {
        if (fnorm(key) === t || fnorm(bare(key)) === t || ms.some((m) => fnorm(m) === t)) { out = bare(key); break; }
      }
      out = out || w;
    }
    groupCache.set(s, out);
    return out;
  }

  // 都道府県を調べる(Web版だけ。全国の表が無いときは、いつも "")
  // prefOf: areaGroup の答え(「御殿場」)→「静岡県」。同じ名前が複数の県にあって決まらないときは ""
  const prefOf = (group) => PREF_OF.get(String(group || "")) || "";
  // prefIn: 文(住所)に書いてある都道府県。いちばん前にあるもの(「東京都府中市」を「京都府」と間違えない)
  function prefIn(text) {
    if (!root.PLACES_JP) return "";
    const s = String(text || "").normalize("NFKC");
    let best = "", at = -1;
    for (const p of root.PLACES_JP.prefs) {
      const k = s.indexOf(p);
      if (k >= 0 && (at < 0 || k < at)) { best = p; at = k; }
    }
    return best;
  }

  // 座標から、いちばん近い市区町村の名前(「御殿場市」「港区」「横浜市中区」)。表が無いか、25km より遠ければ ""
  function placeFromCoords(lat, lng) {
    if (!PLACES.length || lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return "";
    const k = Math.cos(lat * Math.PI / 180);
    let best = null, bd = Infinity;
    for (const p of PLACES) {
      const d = (p.lat - lat) ** 2 + ((p.lng - lng) * k) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return Math.sqrt(bd) * 111 <= 25 ? best.name : "";
  }

  // ---------------------------------------------------------------- URL の手がかり(Web版だけで使う。通信はしない)
  // お店の公式サイトやSNSのアドレスに入っているローマ字(例: yakiniku-suruga.com)からジャンルを推す
  const URL_GENRES = {
    "焼肉": ["yakiniku", "horumon", "jingisukan", "steak"],
    "寿司": ["sushi"],
    "ラーメン": ["ramen", "menya", "chukasoba", "tsukemen"],
    "蕎麦": ["soba", "udon"],
    "天ぷら": ["tempura", "tenpura"],
    "うなぎ": ["unagi"],
    "焼き鳥": ["yakitori"],
    "和食": ["washoku", "kappo", "ryotei", "kaiseki", "shabushabu", "sukiyaki", "tonkatsu"],
    "洋食": ["yoshoku"],
    "イタリアン": ["italian", "italia", "trattoria", "ristorante", "osteria", "pizza", "pasta"],
    "フレンチ": ["french", "bistro", "brasserie", "francais"],
    "中華": ["chinese", "chuka", "gyoza", "dimsum"],
    "韓国料理": ["korean"],
    "エスニック": ["thai", "vietnam", "indian"],
    "カレー": ["curry"],
    "ハンバーガー": ["burger"],
    "居酒屋": ["izakaya", "sakaba"],
    "カフェ": ["cafe", "coffee", "kissa"],
    "スイーツ": ["sweets", "patisserie", "cake", "crepe", "gelato", "dessert", "chocolat", "donut", "parfait"],
    "パン": ["bakery", "boulangerie", "bread"],
  };

  // 食べログのURLの地域番号 → 地域の名前(例: /tokyo/A1307/A130701/ → 六本木)。
  // 東京・神奈川・静岡のぶん。2026-11 に食べログの地域ページから写した。小さい地域が無ければ大きい地域を使う
  const TABELOG_AREAS = Object.fromEntries("1301:銀座・新橋・有楽町|130101:銀座|130102:有楽町・日比谷|130103:新橋・汐留|1302:東京・日本橋|130201:丸の内・大手町|130202:日本橋・京橋|130203:茅場町・八丁堀|130204:人形町・小伝馬町|1303:渋谷・恵比寿・代官山|130301:渋谷|130302:恵比寿|130303:代官山|1304:新宿・代々木・大久保|130401:新宿|130402:新宿御苑|130403:代々木|130404:大久保・新大久保|1305:池袋～高田馬場・早稲田|130501:池袋|130502:目白|130503:高田馬場|130504:早稲田|1306:原宿・表参道・青山|130601:原宿|130602:表参道|130603:青山一丁目・外苑前|1307:六本木・麻布・広尾|130701:六本木|130702:麻布十番|130703:広尾|130704:神谷町|1308:赤坂・永田町・溜池|130801:赤坂|130802:溜池山王・霞ヶ関|130803:永田町・麹町・半蔵門|1309:四ツ谷・市ヶ谷・飯田橋|130901:千駄ヶ谷・信濃町|130902:四ツ谷|130903:曙橋・四ツ谷三丁目|130904:市ヶ谷|130905:飯田橋・神楽坂|130906:九段下|1310:秋葉原・神田・水道橋|131001:秋葉原|131002:神田・御茶ノ水|131003:神保町・水道橋|131004:本郷・東大周辺|1311:上野・浅草・日暮里|131101:上野・御徒町・湯島|131102:浅草|131103:浅草橋・蔵前|131104:鶯谷・入谷|131105:日暮里|131106:根津・千駄木・谷中|1312:両国・錦糸町・小岩|131201:両国・錦糸町|131202:亀戸・平井|131203:曳舟・向島・押上周辺|131204:小岩・新小岩|131205:船堀～篠崎|1313:築地・湾岸・お台場|131301:築地|131302:月島・勝どき|131304:京葉線沿線|131305:葛西・西葛西|131306:お台場|131307:豊洲|1314:浜松町・田町・品川|131401:浜松町・芝公園|131402:田町・三田|131403:品川|131404:天王洲アイル|131405:北品川・新馬場|1315:大井・蒲田|131501:大井町・青物横丁|131502:大森・平和島|131503:蒲田|131504:羽田空港周辺|1316:目黒・白金・五反田|131601:目黒|131602:白金|131603:五反田・高輪台|131604:大崎|1317:東急沿線|131701:中目黒・祐天寺|131702:学芸大学・都立大学|131703:自由が丘|131704:田園調布・多摩川|131705:池尻大橋・三宿|131706:三軒茶屋|131707:駒沢|131708:二子玉川|131711:洗足・大岡山・奥沢|131713:馬込・西馬込|131714:長原～蓮沼（池上線）|1318:京王・小田急沿線|131801:駒場東大前・池ノ上|131802:下北沢|131803:新代田・東松原|131804:明大前|131805:永福町～浜田山|131806:高井戸～久我山|131807:初台・幡ヶ谷|131808:笹塚・代田橋|131809:下高井戸～千歳烏山|131810:参宮橋・代々木八幡|131811:代々木上原・東北沢|131812:世田谷代田・梅ヶ丘|131814:祖師ヶ谷大蔵・成城|1319:中野～西荻窪|131901:東中野|131902:中野|131903:中野坂上～方南町|131904:高円寺|131905:阿佐ヶ谷|131906:荻窪|131907:西荻窪|1320:吉祥寺・三鷹・武蔵境|132001:吉祥寺|132002:三鷹|132003:武蔵境|1321:西武沿線|132101:椎名町～桜台|132103:石神井公園・大泉学園|1322:板橋・東武沿線|132201:北池袋・板橋駅周辺|132204:赤塚・成増|1323:大塚・巣鴨・駒込・赤羽|132301:巣鴨・駒込・白山|132302:大塚・護国寺|132303:王子|132304:十条|132305:赤羽|1324:千住・綾瀬・葛飾|132401:町屋・南千住|132402:北千住|132403:葛飾・柴又|132404:綾瀬・竹ノ塚|1325:小金井・国分寺・国立|132501:小金井|132502:国分寺|132503:国立|1326:調布・府中・狛江|132601:調布|132602:府中|132603:狛江|1327:町田・稲城・多摩|132701:町田|132702:多摩・聖蹟桜ヶ丘|132703:稲城|1328:西東京市周辺|132801:西東京|132802:東久留米|132803:清瀬|132804:小平|132805:東大和|132806:東村山|1329:立川市・八王子市周辺|132901:立川|132902:昭島・拝島|132903:日野・豊田|132904:八王子|132905:高尾山周辺|1330:福生・青梅周辺|133001:熊川～秋川渓谷|133002:福生・羽村|133003:青梅|133004:奥多摩町|1331:伊豆諸島・小笠原|133101:伊豆諸島|133102:小笠原諸島|1401:横浜市|140101:横浜駅周辺|140102:桜木町・高島町|140103:みなとみらい|140104:関内・伊勢佐木町|140105:元町・中華街・石川町|140106:山手・本牧|140201:たまプラーザ～市が尾|140202:藤が丘・青葉台・田奈|140203:港北ニュータウン|140204:日吉・綱島・大倉山|140205:菊名～反町|140206:新横浜|140207:小机～中山（横浜線）|140208:長津田・十日市場|140209:三ッ沢・羽沢|140210:鶴見|140211:子安・新子安|140212:神奈川・東神奈川|140302:和田町～鶴ヶ峰|140304:いずみ野線・中田周辺|140305:戸塚・東戸塚|140307:上大岡・永谷|140308:磯子・根岸・杉田|1404:鎌倉・湘南|140401:大船・北鎌倉|140402:鎌倉|140403:江の島|140404:藤沢・辻堂|140405:湘南台|140406:茅ヶ崎|140407:平塚|140408:大磯・二宮|1405:川崎市|140501:川崎駅周辺|140502:川崎区その他|140503:幸区|140505:高津区（溝の口周辺）|140506:多摩区|140507:宮前区|1406:横須賀・逗子・葉山・三浦|140601:横須賀|140602:逗子・葉山|140603:三浦海岸・三崎|1407:相模原・大和周辺|140701:相模原|140702:大和市|140703:座間市|140704:愛川町・清川村|1408:海老名・厚木周辺|140801:海老名市|140802:厚木市|140803:伊勢原市|140804:秦野市|1409:小田原周辺|140901:小田原|140902:南足柄・足柄上郡|1410:箱根・湯河原|141001:箱根|141002:湯河原・真鶴|2201:静岡市（静岡・清水）|220101:葵区・駿河区|220102:清水|2202:浜松・掛川・磐田|220201:浜松|220202:袋井・磐田・森町|220203:掛川市|220204:湖西・新居|2203:焼津・藤枝・御前崎|220301:焼津・藤枝|220302:島田・大井川河口|220303:菊川・御前崎・牧之原|220304:大井川鉄道沿線|2204:富士山周辺|220401:富士・富士宮|220402:御殿場・裾野|2205:沼津・伊豆半島|220501:沼津・三島|220502:熱海・函南|220503:伊東～下田|220504:韮山～修善寺|220505:西伊豆・南伊豆"
    .split("|").map((s) => s.split(":")));

  // URL から { genres: [ジャンル名], place: "地域" } を取り出す
  function urlHints(url) {
    let u;
    try { u = new URL(String(url || "")); } catch (e) { return { genres: [], place: "" }; }
    const h = u.hostname.toLowerCase();
    let place = "";
    const m = /(^|\.)tabelog\.com$/.test(h) && u.pathname.match(/^\/[a-z]+\/A(\d{4})\/(?:A(\d{6})\/)?/);
    if (m) place = TABELOG_AREAS[m[2]] || TABELOG_AREAS[m[1]] || "";
    const s = (h + u.pathname).toLowerCase().replace(/[^a-z]/g, "");
    const genres = Object.entries(URL_GENRES).filter(([, ws]) => ws.some((w) => s.includes(w))).map(([g]) => g);
    return { genres, place };
  }

  const api = { fnorm, GENRES, AREAS, NEIGHBORS, resolveToken, splitName, folderMatch, itemTexts, pickFolder, topFolders,
    detectGenres, detectPlace, urlHints, placeFromCoords, areaGroup, prefOf, prefIn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Sorter = api;
})(typeof self !== "undefined" ? self : this);
