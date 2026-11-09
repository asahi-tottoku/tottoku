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

  // 「御殿場市」「御殿場駅」→「御殿場」
  function bare(name) {
    const b = name.replace(/(都|道|府|県|市|区|町|村|駅)$/, "");
    return b.length >= 2 ? b : name;
  }

  function areaWords(key) {
    let words = [key, bare(key), ...AREAS[key]];
    for (const n of NEIGHBORS[key] || []) words = words.concat([n, bare(n)], AREAS[n] || []);
    return words;
  }

  // 「港区」「北区」などは大阪市港区・名古屋市北区にもあるので、「〇〇市港区」は除く
  function placePattern(word) {
    const w = esc(fnorm(word));
    return word.endsWith("区") ? "(?<!市)" + w : w;
  }

  // フォルダ名の1語を、[種類, 合う言葉の正規表現のリスト, 親ジャンル] にする
  function resolveToken(token) {
    const t = fnorm(token);
    for (const [name, [words, parent]] of Object.entries(GENRES)) {
      if ([...words, name].some((w) => fnorm(w) === t)) {
        let all = [...words, name];
        for (const [child, [cw, cp]] of Object.entries(GENRES)) if (cp === name) all = all.concat(cw, [child]);
        return ["genre", all.map((w) => esc(fnorm(w))), parent];
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
  function folderMatch(name, genreText, placeText) {
    const tokens = splitName(name);
    if (!tokens.length) return null;
    let child = 0;
    for (const tok of tokens) {
      const [kind, pats, parent] = resolveToken(tok);
      const text = kind === "place" ? placeText : genreText + " " + placeText;
      if (!pats.some((p) => new RegExp(p).test(text))) return null;
      if (kind === "genre" && parent) child++;
    }
    return [tokens.length, child];
  }

  // アイテムから、ジャンルを見る文と地名を見る文を作る。
  // 地名は名前・地域・住所だけで見る。住所も地域も無いときだけ、説明文も使う。
  function itemTexts(item) {
    const g = (k) => String(item[k] || "");
    const tags = item.tags || [];
    const genre = fnorm([g("title"), g("category"), g("summary"), g("description"), g("note"), tags.join(" ")].join(" "));
    const place = [g("title"), g("area"), g("address")];
    if (!g("area") && !g("address")) place.push(g("description"));
    return [genre, fnorm(place.join(" "))];
  }

  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];

  // items(同じお店をまとめたアイテムのリスト)に合うフォルダの id を返す。決めきれなければ null。
  // current: 今入っているフォルダの id。同じくらい合う候補にそれが含まれていれば、そのままにする。
  function pickFolder(items, folderList, current = null) {
    const texts = items.map(itemTexts);
    const genre = texts.map((t) => t[0]).join(" ");
    const place = texts.map((t) => t[1]).join(" ");
    const scored = [];
    for (const f of folderList) {
      const s = folderMatch(f.name, genre, place);
      if (s) scored.push([s, f.id]);
    }
    if (!scored.length) return null;
    const best = scored.reduce((m, x) => (cmp(x[0], m) > 0 ? x[0] : m), scored[0][0]);
    const top = scored.filter(([s]) => cmp(s, best) === 0).map(([, id]) => id);
    if (top.length === 1) return top[0];
    if (top.includes(current)) return current;
    return null;
  }

  // ---------------------------------------------------------------- 保存するときの手がかり(Web版だけで使う)
  // 文の中から、辞書にあるジャンルの名前を全部返す(タグにする)
  function detectGenres(text) {
    const t = fnorm(text);
    return Object.entries(GENRES).filter(([name, [words]]) => [...words, name].some((w) => t.includes(fnorm(w))))
      .map(([name]) => name);
  }

  // 文の中から、辞書にある地名を1つ返す(地域の欄にする)。町の名前を先に、なければ市区町
  function detectPlace(text) {
    const t = fnorm(text);
    let hit = null;
    for (const [key, members] of Object.entries(AREAS)) {
      for (const m of members) {
        const i = t.indexOf(fnorm(m));
        if (i >= 0 && (!hit || i < hit.i || (i === hit.i && m.length > hit.w.length))) hit = { i, w: m };
      }
    }
    if (hit) return hit.w;
    for (const key of Object.keys(AREAS)) {
      if (new RegExp(placePattern(key)).test(t) || t.includes(fnorm(bare(key)))) return bare(key);
    }
    return "";
  }

  const api = { fnorm, GENRES, AREAS, NEIGHBORS, resolveToken, splitName, folderMatch, itemTexts, pickFolder,
    detectGenres, detectPlace };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Sorter = api;
})(typeof self !== "undefined" ? self : this);
