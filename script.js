/* =========================================================
   釣り情報ツール - script.js
   ① アングラーズで釣果を見る（外部サイトを開くだけ）
   ② 天気・海況を見る（Open-Meteo）
   ③ 自分の釣果を記録する（localStorage）
   ========================================================= */

// ===== localStorageのキー =====
const CATCH_STORAGE_KEY = "fishingCatches"; // 既存の釣果データ（互換性維持のためキー名は変更しない）
const SPOT_STORAGE_KEY = "fishingSpots";    // 釣り場データ

// ===== 地域（エリア方面）の分類 =====
// 行政区分そのものではなく、釣り人が直感的に分かる方面でまとめています。
// 釣り場データは「アングラーズに実際に登録されている釣り場」のみを対象とし、
// ユーザー側からの追加はできません（管理者がこのファイルを更新して追加します）。
const AREA_GROUPS = [
  "知多半島南部",
  "知多半島西部",
  "半田・武豊方面",
  "碧南・高浜方面",
  "西尾・幡豆方面",
  "蒲郡方面",
  "豊橋方面",
  "田原方面",
];

// ===== 初期登録しておく釣り場（初回起動時のみ） =====
// ※ 緯度・経度はおおよその位置です。
const DEFAULT_SPOTS = [
  { id: 1, name: "豊浜漁港", prefecture: "愛知県", region: "南知多町", areaGroup: "知多半島南部", latitude: 34.7055, longitude: 136.9376, anglersUrl: "https://anglers.jp/areas/771/catches" },
  { id: 2, name: "師崎漁港", prefecture: "愛知県", region: "南知多町", areaGroup: "知多半島南部", latitude: 34.549, longitude: 136.756, anglersUrl: "https://anglers.jp/areas/772/catches" },
  // 「福崎漁港」は実在せず「冨具崎港」の誤りだったため、正しい名称・所在地に修正（愛知県知多郡美浜町）
  { id: 3, name: "冨具崎港", prefecture: "愛知県", region: "知多郡美浜町", areaGroup: "知多半島西部", latitude: 34.635, longitude: 136.875, anglersUrl: "https://anglers.jp/areas/775/catches" },
];

// ===== 追加登録：アングラーズ上で実在確認できた釣り場のみ =====
const ADDITIONAL_SPOTS_V2 = [
  { id: 10, name: "河和漁港", prefecture: "愛知県", region: "知多郡美浜町", areaGroup: "知多半島西部", latitude: 34.766, longitude: 136.905, anglersUrl: "https://anglers.jp/areas/2773/catches" },
  { id: 11, name: "大野漁港", prefecture: "愛知県", region: "常滑市", areaGroup: "知多半島西部", latitude: 34.883, longitude: 136.827, anglersUrl: "https://anglers.jp/areas/778/catches" },
  { id: 13, name: "形原漁港", prefecture: "愛知県", region: "蒲郡市", areaGroup: "蒲郡方面", latitude: 34.807, longitude: 137.183, anglersUrl: "https://anglers.jp/areas/5335/catches" },
];
const SPOT_MIGRATION_KEY = "fishingSpotsMigrationV2";

// ===== 修正：既存ユーザーの「福崎漁港」を「冨具崎港」に直し、確認済みのアングラーズURLを反映する（一度だけ実行） =====
const SPOT_MIGRATION_KEY_V3 = "fishingSpotsMigrationV3";
const SPOT_FIXES_V3 = [
  {
    matchNames: ["福崎漁港", "冨具崎港"],
    name: "冨具崎港",
    prefecture: "愛知県",
    region: "知多郡美浜町",
    latitude: 34.635,
    longitude: 136.875,
    anglersUrl: "https://anglers.jp/areas/775/catches",
  },
  { matchNames: ["豊浜漁港"], anglersUrl: "https://anglers.jp/areas/771/catches" },
  { matchNames: ["師崎漁港"], anglersUrl: "https://anglers.jp/areas/772/catches" },
  { matchNames: ["大野漁港"], anglersUrl: "https://anglers.jp/areas/778/catches" },
  { matchNames: ["河和漁港"], anglersUrl: "https://anglers.jp/areas/2773/catches" },
  { matchNames: ["形原漁港"], anglersUrl: "https://anglers.jp/areas/5335/catches" },
];

// ===== 追加登録V4：「アングラーズに実際に登録されている釣り場」を基準に選定した10か所 =====
const ADDITIONAL_SPOTS_V4 = [
  { id: 14, name: "佐久島", prefecture: "愛知県", region: "西尾市（一色町）", areaGroup: "西尾・幡豆方面", latitude: 34.716, longitude: 137.007, anglersUrl: "https://anglers.jp/areas/770/catches" },
  { id: 15, name: "日間賀島", prefecture: "愛知県", region: "知多郡南知多町", areaGroup: "知多半島南部", latitude: 34.633, longitude: 136.933, anglersUrl: "https://anglers.jp/areas/768/catches" },
  { id: 16, name: "篠島", prefecture: "愛知県", region: "知多郡南知多町", areaGroup: "知多半島南部", latitude: 34.617, longitude: 136.977, anglersUrl: "https://anglers.jp/areas/769/catches" },
  { id: 17, name: "片名漁港", prefecture: "愛知県", region: "知多郡南知多町", areaGroup: "知多半島南部", latitude: 34.68, longitude: 136.93, anglersUrl: "https://anglers.jp/areas/773/catches" },
  { id: 18, name: "宮崎漁港（吉良サンライズパーク）", prefecture: "愛知県", region: "西尾市（吉良町）", areaGroup: "西尾・幡豆方面", latitude: 34.783, longitude: 137.10, anglersUrl: "https://anglers.jp/areas/4163/catches" },
  { id: 19, name: "一色さかな広場前", prefecture: "愛知県", region: "西尾市（一色町）", areaGroup: "西尾・幡豆方面", latitude: 34.777, longitude: 136.988, anglersUrl: "https://anglers.jp/areas/2775/catches" },
  { id: 20, name: "爆釣美浜フィッシングパーク", prefecture: "愛知県", region: "知多郡美浜町", areaGroup: "知多半島西部", latitude: 34.72, longitude: 136.87, anglersUrl: "https://anglers.jp/areas/4878/catches" },
  { id: 21, name: "セントレア常滑港前島", prefecture: "愛知県", region: "常滑市", areaGroup: "知多半島西部", latitude: 34.858, longitude: 136.805, anglersUrl: "https://anglers.jp/areas/777/catches" },
  { id: 22, name: "碧南海釣り公園", prefecture: "愛知県", region: "碧南市", areaGroup: "碧南・高浜方面", latitude: 34.895, longitude: 136.965, anglersUrl: "https://anglers.jp/areas/3931/catches" },
  { id: 23, name: "西浦", prefecture: "愛知県", region: "蒲郡市", areaGroup: "蒲郡方面", latitude: 34.845, longitude: 137.19, anglersUrl: "https://anglers.jp/areas/764/catches" },
];
const SPOT_MIGRATION_KEY_V4 = "fishingSpotsMigrationV4";

// ===== 追加登録V6：愛知県全域の網羅を目指して新規追加した9釣り場 =====
// ・すべて実際にアングラーズの該当ページにアクセスし、その釣り場名で
//   登録されていることを確認済みです。
// ・これまで登録が0件だった「半田・武豊方面」「田原方面」を中心に追加しています。
// ・「豊橋方面」は今回複数のキーワードで調査しましたが、アングラーズ上で
//   明確に該当する釣り場ページを確認できなかったため、今回は見送りました
//   （今後の追加調査の対象です）。
const ADDITIONAL_SPOTS_V6 = [
  { id: 24, name: "半田港", prefecture: "愛知県", region: "半田市", areaGroup: "半田・武豊方面", latitude: 34.90, longitude: 136.93, anglersUrl: "https://anglers.jp/areas/4346/catches" },
  { id: 25, name: "半田緑地公園", prefecture: "愛知県", region: "半田市", areaGroup: "半田・武豊方面", latitude: 34.905, longitude: 136.925, anglersUrl: "https://anglers.jp/areas/761/catches" },
  { id: 26, name: "武豊緑地", prefecture: "愛知県", region: "知多郡武豊町", areaGroup: "半田・武豊方面", latitude: 34.87, longitude: 136.91, anglersUrl: "https://anglers.jp/areas/4091/catches" },
  { id: 27, name: "伊良湖岬", prefecture: "愛知県", region: "田原市", areaGroup: "田原方面", latitude: 34.60, longitude: 137.00, anglersUrl: "https://anglers.jp/areas/3150/catches" },
  { id: 28, name: "伊良湖サーフ", prefecture: "愛知県", region: "田原市", areaGroup: "田原方面", latitude: 34.605, longitude: 137.02, anglersUrl: "https://anglers.jp/areas/3151/catches" },
  { id: 29, name: "田原サーフ", prefecture: "愛知県", region: "田原市", areaGroup: "田原方面", latitude: 34.63, longitude: 137.13, anglersUrl: "https://anglers.jp/areas/3152/catches" },
  { id: 30, name: "伊良湖港", prefecture: "愛知県", region: "田原市", areaGroup: "田原方面", latitude: 34.598, longitude: 137.003, anglersUrl: "https://anglers.jp/areas/2779/catches" },
  { id: 31, name: "田原湾", prefecture: "愛知県", region: "田原市", areaGroup: "田原方面", latitude: 34.67, longitude: 137.20, anglersUrl: "https://anglers.jp/areas/766/catches" },
  { id: 32, name: "赤羽根港", prefecture: "愛知県", region: "田原市", areaGroup: "田原方面", latitude: 34.62, longitude: 137.27, anglersUrl: "https://anglers.jp/areas/1414/catches" },
];
const SPOT_MIGRATION_KEY_V6 = "fishingSpotsMigrationV6";

/* =========================================================
   共通ユーティリティ
   ========================================================= */

// ===== HTMLエスケープ（入力内容をそのまま表示しても安全にするため） =====
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===== 数値を安全に丸めて表示する（データが無ければ「---」） =====
function fmt(value, digits, unit) {
  if (value === null || value === undefined || isNaN(value)) return "---";
  return value.toFixed(digits) + unit;
}

/* =========================================================
   画面切り替え（ホーム／天気・海況／釣果記録）
   ========================================================= */

const screens = {
  home: document.getElementById("screen-home"),
  weather: document.getElementById("screen-weather"),
  record: document.getElementById("screen-record"),
};
const backBtn = document.getElementById("back-btn");

function showScreen(name) {
  Object.keys(screens).forEach((key) => {
    screens[key].style.display = key === name ? "block" : "none";
  });
  backBtn.style.display = name === "home" ? "none" : "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

backBtn.addEventListener("click", function () {
  // ホームに戻るときは、釣り場の選択肢を最新の状態に更新しておく
  refreshAllSpotSelects();
  showScreen("home");
});

/* =========================================================
   釣り場（スポット）データの管理
   ========================================================= */

function loadSpots() {
  const data = localStorage.getItem(SPOT_STORAGE_KEY);
  if (data === null) {
    // 初回起動時：デフォルトの釣り場を保存しておく
    saveSpots(DEFAULT_SPOTS);
    return DEFAULT_SPOTS;
  }
  return JSON.parse(data);
}

function saveSpots(spots) {
  localStorage.setItem(SPOT_STORAGE_KEY, JSON.stringify(spots));
}

// ===== 追加の10漁港を、まだ登録されていないものだけ安全に追加する（一度だけ実行） =====
// ・既存の釣り場は削除・変更しない
// ・名前が一致する釣り場がすでにあれば、重複登録しない
// ・一度追加したら二度と自動実行しない（あとでユーザーが削除しても復活しない）
function ensureAdditionalSpotsV2() {
  if (localStorage.getItem(SPOT_MIGRATION_KEY)) return;

  const spots = loadSpots();
  const existingNames = new Set(spots.map((s) => s.name));

  let added = false;
  ADDITIONAL_SPOTS_V2.forEach((spot) => {
    if (!existingNames.has(spot.name)) {
      spots.push(spot);
      added = true;
    }
  });

  if (added) {
    saveSpots(spots);
  }
  localStorage.setItem(SPOT_MIGRATION_KEY, "done");
}

// ===== 「福崎漁港」の名称修正 ＆ アングラーズURLの反映（一度だけ実行） =====
function ensureSpotFixesV3() {
  if (localStorage.getItem(SPOT_MIGRATION_KEY_V3)) return;

  const spots = loadSpots();
  let changed = false;

  spots.forEach((s) => {
    const fix = SPOT_FIXES_V3.find((f) => f.matchNames.includes(s.name));
    if (!fix) return;

    if (fix.name) s.name = fix.name;
    if (fix.prefecture) s.prefecture = fix.prefecture;
    if (fix.region) s.region = fix.region;
    if (fix.latitude !== undefined) s.latitude = fix.latitude;
    if (fix.longitude !== undefined) s.longitude = fix.longitude;
    s.anglersUrl = fix.anglersUrl || "";
    changed = true;
  });

  if (changed) {
    saveSpots(spots);
  }
  localStorage.setItem(SPOT_MIGRATION_KEY_V3, "done");
}

// ===== 追加のV4：10釣り場を、まだ登録されていないものだけ安全に追加する（一度だけ実行） =====
// ・既存の釣り場は削除・変更しない
// ・名前が一致する釣り場がすでにあれば、重複登録しない
function ensureAdditionalSpotsV4() {
  if (localStorage.getItem(SPOT_MIGRATION_KEY_V4)) return;

  const spots = loadSpots();
  const existingNames = new Set(spots.map((s) => s.name));

  let added = false;
  ADDITIONAL_SPOTS_V4.forEach((spot) => {
    if (!existingNames.has(spot.name)) {
      spots.push(spot);
      added = true;
    }
  });

  if (added) {
    saveSpots(spots);
  }
  localStorage.setItem(SPOT_MIGRATION_KEY_V4, "done");
}

// ===== V5：アングラーズ上でページを確認できなかった7件を削除し、既存の釣り場にエリア（方面）を付与する =====
// ・削除対象は「名前」で照合するため、他の釣り場やユーザーが自分で追加した釣り場には影響しません。
// ・削除しても、これらの釣り場を使って記録された過去の釣果データ（魚種・日付・写真など）は消えません。
//   釣果データには釣り場名や緯度経度がそのまま保存されているため、一覧には引き続き正しく表示されます。
const REMOVED_SPOT_NAMES_V5 = [
  "二川漁港",
  "福江漁港",
  "御馬漁港",
  "一色漁港",
  "西幡豆漁港",
  "大浜漁港",
  "三谷漁港",
];

// 既存の釣り場名 → エリア（方面）の対応表
const AREA_GROUP_BY_NAME_V5 = {
  "豊浜漁港": "知多半島南部",
  "師崎漁港": "知多半島南部",
  "片名漁港": "知多半島南部",
  "日間賀島": "知多半島南部",
  "篠島": "知多半島南部",
  "冨具崎港": "知多半島西部",
  "河和漁港": "知多半島西部",
  "大野漁港": "知多半島西部",
  "爆釣美浜フィッシングパーク": "知多半島西部",
  "セントレア常滑港前島": "知多半島西部",
  "碧南海釣り公園": "碧南・高浜方面",
  "佐久島": "西尾・幡豆方面",
  "宮崎漁港（吉良サンライズパーク）": "西尾・幡豆方面",
  "一色さかな広場前": "西尾・幡豆方面",
  "西浦": "蒲郡方面",
  "形原漁港": "蒲郡方面",
};
const SPOT_MIGRATION_KEY_V5 = "fishingSpotsMigrationV5";

function ensureAreaGroupsV5() {
  if (localStorage.getItem(SPOT_MIGRATION_KEY_V5)) return;

  let spots = loadSpots();

  // ① アングラーズ上で確認できなかった7件を削除
  spots = spots.filter((s) => !REMOVED_SPOT_NAMES_V5.includes(s.name));

  // ② エリア（方面）が未設定、または旧分類（知多方面）のままの釣り場を、対応表から付与し直す
  spots.forEach((s) => {
    if (!s.areaGroup || s.areaGroup === "知多方面") {
      s.areaGroup = AREA_GROUP_BY_NAME_V5[s.name] || "知多半島南部";
    }
  });

  saveSpots(spots);
  localStorage.setItem(SPOT_MIGRATION_KEY_V5, "done");
}

// ===== V6：愛知県全域の網羅を目指して追加した9釣り場を、未登録の分だけ安全に追加する（一度だけ実行） =====
// ・既存の釣り場は削除・変更しない
// ・名前が一致する釣り場がすでにあれば、重複登録しない
function ensureAdditionalSpotsV6() {
  if (localStorage.getItem(SPOT_MIGRATION_KEY_V6)) return;

  const spots = loadSpots();
  const existingNames = new Set(spots.map((s) => s.name));

  let changed = false;
  ADDITIONAL_SPOTS_V6.forEach((spot) => {
    if (!existingNames.has(spot.name)) {
      spots.push(spot);
      changed = true;
    }
  });

  // 以前のバージョンで「知多方面」に分類されたままの釣り場を、
  // 新しい「知多半島南部」「知多半島西部」に分け直す
  spots.forEach((s) => {
    if (s.areaGroup === "知多方面") {
      s.areaGroup = AREA_GROUP_BY_NAME_V5[s.name] || "知多半島南部";
      changed = true;
    }
  });

  if (changed) {
    saveSpots(spots);
  }
  localStorage.setItem(SPOT_MIGRATION_KEY_V6, "done");
}

function findSpot(spotId) {
  const spots = loadSpots();
  return spots.find((s) => String(s.id) === String(spotId));
}

// ===== 釣り場を選択する<select>を組み立てる共通関数 =====
function buildSpotOptionsHtml(spots) {
  if (spots.length === 0) {
    return '<option value="">登録された釣り場がありません</option>';
  }
  return spots
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");
}

// ホーム画面・天気画面・登録フォームの<select>をすべて最新の状態に更新する
function refreshAllSpotSelects() {
  const spots = loadSpots();

  // ---- ホーム画面：① 地域を選択 ----
  const areaSelect = document.getElementById("area-select");
  const spotSelectEmpty = document.getElementById("spot-select-empty");
  const prevAreaValue = areaSelect.value;

  // データが登録されているエリアだけを、AREA_GROUPSの順番で一覧にする
  const areasWithSpots = AREA_GROUPS.filter((area) =>
    spots.some((s) => s.areaGroup === area)
  );

  if (spots.length === 0) {
    areaSelect.innerHTML = '<option value="">登録された釣り場がありません</option>';
    areaSelect.disabled = true;
    spotSelectEmpty.style.display = "block";
  } else {
    areaSelect.innerHTML =
      '<option value="">-- 地域を選択 --</option>' +
      areasWithSpots.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");
    areaSelect.disabled = false;
    spotSelectEmpty.style.display = "none";
    if (areasWithSpots.includes(prevAreaValue)) {
      areaSelect.value = prevAreaValue;
    }
  }

  // ---- ホーム画面：② 釣り場を選択（選ばれている地域の分だけ表示） ----
  updateHomeSpotSelect();

  // ---- 天気・海況画面の釣り場選択 ----
  const weatherSpotSelect = document.getElementById("weather-spot-select");
  const prevWeatherValue = weatherSpotSelect.value;
  weatherSpotSelect.innerHTML = buildSpotOptionsHtml(spots);
  if (spots.some((s) => String(s.id) === prevWeatherValue)) {
    weatherSpotSelect.value = prevWeatherValue;
  }
  weatherSpotSelect.disabled = spots.length === 0;

  // ---- 釣果登録フォームの釣り場選択 ----
  const locationSelect = document.getElementById("location-select");
  const prevLocationValue = locationSelect.value;
  locationSelect.innerHTML =
    '<option value="">-- 釣り場を選択 --</option>' +
    buildSpotOptionsHtml(spots) +
    '<option value="__custom__">その他（自由入力）</option>';
  if (
    prevLocationValue === "__custom__" ||
    spots.some((s) => String(s.id) === prevLocationValue)
  ) {
    locationSelect.value = prevLocationValue;
  }
}

// ホーム画面②の釣り場<select>を、選ばれている地域の釣り場だけに絞り込んで表示する
// 15件以上ある地域でのみ表示する検索欄
const SEARCH_THRESHOLD = 15;

function updateHomeSpotSelect() {
  const spots = loadSpots();
  const areaSelect = document.getElementById("area-select");
  const spotSelect = document.getElementById("spot-select");
  const spotSelectWrap = document.getElementById("spot-select-wrap");
  const spotSearchInput = document.getElementById("spot-search-input");

  const selectedArea = areaSelect.value;

  if (!selectedArea) {
    spotSelectWrap.style.display = "none";
    spotSelect.innerHTML = "";
    spotSearchInput.style.display = "none";
    spotSearchInput.value = "";
    return;
  }

  const spotsInArea = spots.filter((s) => s.areaGroup === selectedArea);

  // 15か所以上ある地域でのみ、釣り場名で絞り込む検索欄を表示する
  if (spotsInArea.length >= SEARCH_THRESHOLD) {
    spotSearchInput.style.display = "block";
  } else {
    spotSearchInput.style.display = "none";
    spotSearchInput.value = "";
  }

  renderHomeSpotOptions(spotsInArea, spotSearchInput.value);
  spotSelectWrap.style.display = "block";
}

// 検索キーワード（部分一致）で釣り場一覧を絞り込んで<select>に反映する
function renderHomeSpotOptions(spotsInArea, keyword) {
  const spotSelect = document.getElementById("spot-select");
  const trimmed = (keyword || "").trim();

  const filtered = trimmed
    ? spotsInArea.filter((s) => s.name.includes(trimmed))
    : spotsInArea;

  spotSelect.innerHTML = buildSpotOptionsHtml(filtered);
}

document.getElementById("area-select").addEventListener("change", function () {
  updateHomeSpotSelect();
});

// 検索欄への入力に応じて、選択中の地域内の釣り場を絞り込む
document.getElementById("spot-search-input").addEventListener("input", function () {
  const spots = loadSpots();
  const selectedArea = document.getElementById("area-select").value;
  const spotsInArea = spots.filter((s) => s.areaGroup === selectedArea);
  renderHomeSpotOptions(spotsInArea, this.value);
});

/* =========================================================
   ホーム画面の3つのボタン
   ========================================================= */

// ① アングラーズで釣果を見る
// 選択中の釣り場に対応するアングラーズの検索結果ページが登録されていればそこへ、
// 無ければアングラーズのトップページを開く
document.getElementById("go-anglers-btn").addEventListener("click", function () {
  const homeSpotId = document.getElementById("spot-select").value;
  const spot = homeSpotId ? findSpot(homeSpotId) : null;

  const url = spot && spot.anglersUrl ? spot.anglersUrl : "https://anglers.jp/";
  window.open(url, "_blank", "noopener");
});

// 地図を見る：選択中の釣り場名（＋都道府県・地域）でGoogleマップ検索を開く
// 漁港ごとにURLを手作業で登録するのではなく、釣り場データの名前・所在地から自動生成する
document.getElementById("go-map-btn").addEventListener("click", function () {
  const homeSpotId = document.getElementById("spot-select").value;
  const spot = homeSpotId ? findSpot(homeSpotId) : null;

  if (!spot) {
    alert("釣り場を選択してください。");
    return;
  }

  const query = [spot.name, spot.prefecture, spot.region].filter(Boolean).join(" ");
  const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  window.open(mapUrl, "_blank", "noopener");
});

// ② 天気・海況を見る
document.getElementById("go-weather-btn").addEventListener("click", function () {
  const homeSpotId = document.getElementById("spot-select").value;
  const weatherSpotSelect = document.getElementById("weather-spot-select");

  showScreen("weather");

  if (homeSpotId) {
    weatherSpotSelect.value = homeSpotId;
    fetchWeatherForSelectedSpot();
  }
});

// ③ 釣果を記録する
document.getElementById("go-record-btn").addEventListener("click", function () {
  const homeSpotId = document.getElementById("spot-select").value;
  const locationSelect = document.getElementById("location-select");

  showScreen("record");

  // ホーム画面で釣り場が選ばれていれば、登録フォームにも引き継ぐ
  if (homeSpotId) {
    locationSelect.value = homeSpotId;
    locationSelect.dispatchEvent(new Event("change"));
  }
});

/* =========================================================
   天気・海況予報（Open-Meteo）
   ========================================================= */

const weatherResultEl = document.getElementById("weather-result");
const weatherCurrentNameEl = document.getElementById("weather-current-name");

document.getElementById("weather-fetch-btn").addEventListener("click", function () {
  fetchWeatherForSelectedSpot();
});

function fetchWeatherForSelectedSpot() {
  const spotId = document.getElementById("weather-spot-select").value;
  const spot = findSpot(spotId);

  if (!spot) {
    weatherResultEl.innerHTML =
      '<div class="weather-error">釣り場を選択してください。</div>';
    return;
  }

  weatherCurrentNameEl.textContent = `📍 ${spot.name}${spot.region ? "（" + spot.region + "）" : ""}`;
  loadWeatherAndMarine(spot.latitude, spot.longitude);
}

// ----- 釣果一覧の「この場所の天気を見る」ボタンから呼ばれる -----
function showWeatherForLocation(lat, lng, name) {
  const weatherSpotSelect = document.getElementById("weather-spot-select");

  // 釣り場一覧の中に、同じ緯度経度の釣り場があれば選択状態にする
  const spots = loadSpots();
  const matched = spots.find(
    (s) => Number(s.latitude) === Number(lat) && Number(s.longitude) === Number(lng)
  );
  if (matched) {
    weatherSpotSelect.value = matched.id;
  }

  weatherCurrentNameEl.textContent = `📍 ${name || "選択した釣り場"}`;
  showScreen("weather");
  loadWeatherAndMarine(lat, lng);
}

// ----- 天気予報 ＆ 海況情報をまとめて取得して表示する -----
async function loadWeatherAndMarine(lat, lng) {
  weatherResultEl.innerHTML = '<div class="weather-loading">読み込み中...</div>';

  try {
    const weatherUrl =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=" + lat +
      "&longitude=" + lng +
      "&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,windgusts_10m_max,winddirection_10m_dominant" +
      "&hourly=surface_pressure,cloudcover" +
      "&timezone=Asia%2FTokyo" +
      "&forecast_days=3" +
      "&windspeed_unit=ms";

    const marineUrl =
      "https://marine-api.open-meteo.com/v1/marine" +
      "?latitude=" + lat +
      "&longitude=" + lng +
      "&daily=wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max,swell_wave_direction_dominant,swell_wave_period_max" +
      "&hourly=sea_surface_temperature" +
      "&timezone=Asia%2FTokyo" +
      "&forecast_days=3";

    const [weatherRes, marineRes] = await Promise.all([fetch(weatherUrl), fetch(marineUrl)]);

    if (!weatherRes.ok) {
      throw new Error("weather fetch failed");
    }
    const weatherData = await weatherRes.json();

    // 海況情報は取得できないことがあるため、失敗しても天気だけは表示できるようにする
    let marineData = null;
    if (marineRes.ok) {
      marineData = await marineRes.json();
    }

    const days = buildDailySummaries(weatherData, marineData);
    renderWeatherDays(days);
  } catch (err) {
    weatherResultEl.innerHTML =
      '<div class="weather-error">天気情報を取得できませんでした。時間を置いて再度お試しください。</div>';
  }
}

// ----- hourlyデータを日付ごとに平均する（気圧・雲量・海面水温用） -----
function averageByDate(times, values) {
  if (!times || !values) return {};

  const sums = {};
  const counts = {};

  times.forEach((t, i) => {
    const date = t.slice(0, 10);
    const v = values[i];
    if (v === null || v === undefined) return;
    sums[date] = (sums[date] || 0) + v;
    counts[date] = (counts[date] || 0) + 1;
  });

  const result = {};
  Object.keys(sums).forEach((date) => {
    result[date] = sums[date] / counts[date];
  });
  return result;
}

// ----- 天気APIと海況APIの結果を、日付ごとの1つのデータにまとめる -----
function buildDailySummaries(weatherData, marineData) {
  const daily = weatherData.daily || {};
  const dates = daily.time || [];

  const pressureByDate = averageByDate(weatherData.hourly && weatherData.hourly.time, weatherData.hourly && weatherData.hourly.surface_pressure);
  const cloudByDate = averageByDate(weatherData.hourly && weatherData.hourly.time, weatherData.hourly && weatherData.hourly.cloudcover);

  const marineDaily = (marineData && marineData.daily) || {};
  const sstByDate = marineData
    ? averageByDate(marineData.hourly && marineData.hourly.time, marineData.hourly && marineData.hourly.sea_surface_temperature)
    : {};

  return dates.map((date, i) => ({
    date: date,
    weatherCode: daily.weathercode ? daily.weathercode[i] : null,
    tempMax: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
    tempMin: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
    precipProb: daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null,
    precipSum: daily.precipitation_sum ? daily.precipitation_sum[i] : null,
    windSpeed: daily.windspeed_10m_max ? daily.windspeed_10m_max[i] : null,
    windGust: daily.windgusts_10m_max ? daily.windgusts_10m_max[i] : null,
    windDir: daily.winddirection_10m_dominant ? daily.winddirection_10m_dominant[i] : null,
    pressure: pressureByDate[date],
    cloudcover: cloudByDate[date],
    waveHeight: marineDaily.wave_height_max ? marineDaily.wave_height_max[i] : null,
    waveDir: marineDaily.wave_direction_dominant ? marineDaily.wave_direction_dominant[i] : null,
    wavePeriod: marineDaily.wave_period_max ? marineDaily.wave_period_max[i] : null,
    swellHeight: marineDaily.swell_wave_height_max ? marineDaily.swell_wave_height_max[i] : null,
    swellDir: marineDaily.swell_wave_direction_dominant ? marineDaily.swell_wave_direction_dominant[i] : null,
    swellPeriod: marineDaily.swell_wave_period_max ? marineDaily.swell_wave_period_max[i] : null,
    sst: sstByDate[date],
  }));
}

// ----- WMO天気コード → 日本語の天気表記 -----
const WEATHER_CODE_JA = {
  0: "快晴", 1: "晴れ", 2: "一部曇り", 3: "曇り",
  45: "霧", 48: "霧（霧氷）",
  51: "小雨（弱い霧雨）", 53: "霧雨", 55: "強い霧雨",
  56: "着氷性の霧雨（弱）", 57: "着氷性の霧雨（強）",
  61: "弱い雨", 63: "雨", 65: "強い雨",
  66: "着氷性の雨（弱）", 67: "着氷性の雨（強）",
  71: "弱い雪", 73: "雪", 75: "強い雪", 77: "霧雪",
  80: "弱いにわか雨", 81: "にわか雨", 82: "強いにわか雨",
  85: "弱いにわか雪", 86: "強いにわか雪",
  95: "雷雨", 96: "雷雨（ひょうを伴う）", 99: "雷雨（激しいひょうを伴う）",
};

function weatherCodeToJa(code) {
  if (code === null || code === undefined) return "不明";
  return WEATHER_CODE_JA[code] || "不明";
}

// ----- 風向・波向（角度）→ 日本語8方位 -----
const DIRECTIONS_JA = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

function degToDirectionJa(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) return "不明";
  const index = Math.round(deg / 45) % 8;
  return DIRECTIONS_JA[index];
}

// ----- 日付ラベル（今日／明日／明後日）を作る -----
function dayLabel(dateStr, index) {
  const labels = ["今日", "明日", "明後日"];
  const label = labels[index] || "";
  return label ? `${label}（${dateStr}）` : dateStr;
}

// ----- 天気・海況の予報カードを描画する -----
function renderWeatherDays(days) {
  if (!days || days.length === 0) {
    weatherResultEl.innerHTML =
      '<div class="weather-error">天気情報を取得できませんでした。時間を置いて再度お試しください。</div>';
    return;
  }

  const cardsHtml = days
    .map((d, i) => {
      return `
        <div class="weather-day-card">
          <h3>${dayLabel(d.date, i)}の釣りコンディション</h3>
          <div class="weather-groups">
            <div class="weather-group">
              <h4>☀️ 天気</h4>
              <ul>
                <li><span>天気</span><span>${weatherCodeToJa(d.weatherCode)}</span></li>
                <li><span>気温</span><span>${fmt(d.tempMin, 0, "℃")} 〜 ${fmt(d.tempMax, 0, "℃")}</span></li>
                <li><span>降水確率</span><span>${d.precipProb !== null && d.precipProb !== undefined ? d.precipProb + "%" : "---"}</span></li>
                <li><span>降水量</span><span>${fmt(d.precipSum, 1, "mm")}</span></li>
                <li><span>雲量</span><span>${fmt(d.cloudcover, 0, "%")}</span></li>
                <li><span>気圧</span><span>${fmt(d.pressure, 0, "hPa")}</span></li>
              </ul>
            </div>
            <div class="weather-group">
              <h4>🌬 風</h4>
              <ul>
                <li><span>風向</span><span>${degToDirectionJa(d.windDir)}</span></li>
                <li><span>風速</span><span>${fmt(d.windSpeed, 1, "m/s")}</span></li>
                <li><span>最大風速</span><span>${fmt(d.windGust, 1, "m/s")}</span></li>
              </ul>
            </div>
            <div class="weather-group">
              <h4>🌊 海況</h4>
              <ul>
                <li><span>波高</span><span>${fmt(d.waveHeight, 1, "m")}</span></li>
                <li><span>波向</span><span>${degToDirectionJa(d.waveDir)}</span></li>
                <li><span>波周期</span><span>${fmt(d.wavePeriod, 1, "秒")}</span></li>
                <li><span>うねりの高さ</span><span>${fmt(d.swellHeight, 1, "m")}</span></li>
                <li><span>うねりの方向</span><span>${degToDirectionJa(d.swellDir)}</span></li>
                <li><span>うねりの周期</span><span>${fmt(d.swellPeriod, 1, "秒")}</span></li>
                <li><span>海面水温</span><span>${fmt(d.sst, 1, "℃")}</span></li>
              </ul>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  weatherResultEl.innerHTML = `<div class="weather-days">${cardsHtml}</div>`;
}

/* =========================================================
   釣果の登録・編集・削除・一覧・統計（既存機能）
   ========================================================= */

const form = document.getElementById("catch-form");
const catchListEl = document.getElementById("catch-list");
const speciesStatsEl = document.getElementById("species-stats");
const locationStatsEl = document.getElementById("location-stats");
const formTitleEl = document.getElementById("form-title");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit");

let editingId = null; // 編集中の釣果ID（編集中でなければnull）

// ===== localStorageからデータを読み込む =====
function loadCatches() {
  const data = localStorage.getItem(CATCH_STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

// ===== localStorageにデータを保存する =====
function saveCatches(catches) {
  localStorage.setItem(CATCH_STORAGE_KEY, JSON.stringify(catches));
}

// ===== 写真関連の要素 =====
const photoInput = document.getElementById("photo");
const photoPreview = document.getElementById("photo-preview");
let currentPhotoData = ""; // 選択中の写真（圧縮後のBase64データ）

// 写真が選択されたら、プレビュー表示 & 圧縮してBase64に変換しておく
photoInput.addEventListener("change", function () {
  const file = photoInput.files[0];
  if (!file) {
    currentPhotoData = "";
    photoPreview.style.display = "none";
    return;
  }

  compressImage(file, 800, 0.7).then((dataUrl) => {
    currentPhotoData = dataUrl;
    photoPreview.src = dataUrl;
    photoPreview.style.display = "block";
  });
});

// 画像を指定した最大幅・画質に圧縮してBase64（dataURL）で返す
// ※ localStorageの容量には限りがあるため、そのまま保存せず圧縮する
function compressImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ===== 「釣った場所」の選択欄：釣り場を選ぶか、自由入力するか =====
const locationSelect = document.getElementById("location-select");
const locationCustom = document.getElementById("location-custom");

locationSelect.addEventListener("change", function () {
  const value = locationSelect.value;

  if (value === "__custom__") {
    // 自由入力を選んだ場合
    locationCustom.style.display = "block";
    locationCustom.value = "";
    setFormCoords("", "");
    document.getElementById("spot-id").value = "";
    return;
  }

  locationCustom.style.display = "none";

  if (!value) {
    setFormCoords("", "");
    document.getElementById("spot-id").value = "";
    return;
  }

  // 釣り場が選ばれた場合：緯度経度を自動セット
  const spot = findSpot(value);
  if (spot) {
    setFormCoords(spot.latitude, spot.longitude);
    document.getElementById("spot-id").value = spot.id;
  }
});

function setFormCoords(lat, lng) {
  document.getElementById("latitude").value = lat;
  document.getElementById("longitude").value = lng;
}

// 現在のフォームの状態から「釣った場所」の名前を取得する
function getLocationNameFromForm() {
  if (locationSelect.value === "__custom__") {
    return locationCustom.value.trim();
  }
  if (locationSelect.value) {
    const spot = findSpot(locationSelect.value);
    return spot ? spot.name : "";
  }
  return "";
}

// ===== フォーム送信時の処理（新規登録 or 更新） =====
form.addEventListener("submit", function (e) {
  e.preventDefault(); // ページの再読み込みを防ぐ

  const catchData = {
    species: document.getElementById("species").value.trim(),
    location: getLocationNameFromForm(),
    spotId: locationSelect.value && locationSelect.value !== "__custom__" ? locationSelect.value : "",
    date: document.getElementById("date").value,
    size: document.getElementById("size").value,
    lure: document.getElementById("lure").value.trim(),
    memo: document.getElementById("memo").value.trim(),
    photo: currentPhotoData, // 圧縮済みの写真データ（未選択なら空文字）
    latitude: document.getElementById("latitude").value || "",
    longitude: document.getElementById("longitude").value || "",
  };

  if (!catchData.location) {
    alert("釣った場所を選択するか、自由入力してください。");
    return;
  }

  const catches = loadCatches();

  try {
    if (editingId !== null) {
      // ===== 更新処理：既存のデータをIDで探して上書き =====
      const index = catches.findIndex((c) => c.id === editingId);
      if (index !== -1) {
        catches[index] = { ...catchData, id: editingId };
      }
    } else {
      // ===== 新規登録処理 =====
      catches.push({ ...catchData, id: Date.now() });
    }
    saveCatches(catches);
  } catch (err) {
    // 容量オーバーなどでlocalStorageへの保存に失敗した場合
    alert("保存に失敗しました。写真のサイズが大きすぎる可能性があります。別の写真でお試しください。");
    return;
  }

  resetForm();
  render();
});

// ===== 編集開始処理 =====
function editCatch(id) {
  const catches = loadCatches();
  const target = catches.find((c) => c.id === id);
  if (!target) return;

  document.getElementById("species").value = target.species;
  document.getElementById("date").value = target.date;
  document.getElementById("size").value = target.size;
  document.getElementById("lure").value = target.lure;
  document.getElementById("memo").value = target.memo;

  // 場所の復元：登録済み釣り場に一致すればそれを選択、なければ自由入力欄に入れる
  if (target.spotId && findSpot(target.spotId)) {
    locationSelect.value = target.spotId;
    locationCustom.style.display = "none";
    setFormCoords(target.latitude || "", target.longitude || "");
    document.getElementById("spot-id").value = target.spotId;
  } else {
    locationSelect.value = "__custom__";
    locationCustom.style.display = "block";
    locationCustom.value = target.location || "";
    setFormCoords(target.latitude || "", target.longitude || "");
    document.getElementById("spot-id").value = "";
  }

  currentPhotoData = target.photo || "";
  if (currentPhotoData) {
    photoPreview.src = currentPhotoData;
    photoPreview.style.display = "block";
  } else {
    photoPreview.style.display = "none";
  }

  editingId = id;
  formTitleEl.textContent = "釣果を編集する";
  submitBtn.textContent = "更新する";
  cancelEditBtn.style.display = "inline-block";

  showScreen("record");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===== 編集キャンセル処理 =====
cancelEditBtn.addEventListener("click", function () {
  resetForm();
});

// ===== フォームを初期状態に戻す =====
function resetForm() {
  form.reset();
  currentPhotoData = "";
  photoPreview.style.display = "none";
  locationCustom.style.display = "none";
  setFormCoords("", "");
  document.getElementById("spot-id").value = "";
  editingId = null;
  formTitleEl.textContent = "釣果を登録する";
  submitBtn.textContent = "登録する";
  cancelEditBtn.style.display = "none";
}

// ===== 削除処理 =====
function deleteCatch(id) {
  let catches = loadCatches();
  catches = catches.filter((c) => c.id !== id);
  saveCatches(catches);

  // 編集中のデータを削除した場合は、フォームを初期状態に戻す
  if (editingId === id) {
    resetForm();
  }

  render();
}

// ===== 一覧表示 =====
function renderList() {
  const catches = loadCatches();

  if (catches.length === 0) {
    catchListEl.innerHTML = '<p class="empty-message">まだ釣果が登録されていません。</p>';
    return;
  }

  // 日付が新しい順に並べる
  const sorted = [...catches].sort((a, b) => (a.date < b.date ? 1 : -1));

  catchListEl.innerHTML = sorted
    .map(
      (c) => `
      <div class="catch-item">
        <div class="item-actions">
          <button class="edit-btn" onclick="editCatch(${c.id})">編集</button>
          <button class="delete-btn" onclick="deleteCatch(${c.id})">削除</button>
        </div>
        ${c.photo ? `<img src="${c.photo}" class="catch-photo" alt="釣果写真">` : ""}
        <h4>${escapeHtml(c.species)}</h4>
        <p>📅 日付：${c.date || "未入力"}</p>
        <p>📍 場所：${escapeHtml(c.location) || "未入力"}</p>
        <p>📏 サイズ：${c.size ? c.size + " cm" : "未入力"}</p>
        <p>🎣 ルアー・仕掛け：${escapeHtml(c.lure) || "未入力"}</p>
        ${c.memo ? `<p class="memo">📝 ${escapeHtml(c.memo)}</p>` : ""}
        ${
          c.latitude && c.longitude
            ? `<button type="button" class="weather-btn" onclick="showWeatherForLocation(${c.latitude}, ${c.longitude}, '${escapeHtml(c.location).replace(/'/g, "\\'")}')">🌤 この場所の天気を見る</button>`
            : ""
        }
      </div>
    `
    )
    .join("");
}

// ===== 統計表示（魚種別・釣り場別） =====
function renderStats() {
  const catches = loadCatches();

  const speciesCount = countBy(catches, "species");
  const locationCount = countBy(catches, "location");

  renderStatsList(speciesStatsEl, speciesCount);
  renderStatsList(locationStatsEl, locationCount);
}

// 指定したキーで件数を集計する
function countBy(catches, key) {
  const result = {};
  catches.forEach((c) => {
    const value = c[key] || "未入力";
    result[value] = (result[value] || 0) + 1;
  });
  return result;
}

// 集計結果をリストとして描画する
function renderStatsList(el, countObj) {
  const entries = Object.entries(countObj);

  if (entries.length === 0) {
    el.innerHTML = '<li class="empty-message">データがありません</li>';
    return;
  }

  // 件数が多い順に並べる
  entries.sort((a, b) => b[1] - a[1]);

  el.innerHTML = entries
    .map(
      ([name, count]) =>
        `<li><span>${escapeHtml(name)}</span><span class="count">${count} 件</span></li>`
    )
    .join("");
}

// ===== まとめて再描画 =====
function render() {
  renderList();
  renderStats();
}

/* =========================================================
   初期表示
   ========================================================= */
loadSpots();              // 初回起動時のみデフォルト釣り場を保存
ensureAdditionalSpotsV2(); // 追加の10漁港を、未登録の分だけ安全に追加
ensureSpotFixesV3();       // 「福崎漁港」の名称修正 ＆ アングラーズURLの反映
ensureAdditionalSpotsV4(); // アングラーズ実在確認済みの10釣り場を、未登録の分だけ安全に追加
ensureAreaGroupsV5();       // 未確認7件の削除 ＆ 既存釣り場へのエリア（方面）再分類
ensureAdditionalSpotsV6(); // 愛知県全域の網羅を目指した9釣り場を、未登録の分だけ安全に追加
refreshAllSpotSelects();
render();
showScreen("home");
