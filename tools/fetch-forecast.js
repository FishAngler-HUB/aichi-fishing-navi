/**
 * fetch-forecast.js
 * -----------------------------------------------------------
 * data/spots.json の全釣り場について、Open-Meteo から
 * 天気（api.open-meteo.com）と海況（marine-api.open-meteo.com）を取得し、
 * data/forecast.json を生成する「ローカル実行専用」スクリプトです。
 *
 * ・APIキー不要。秘密情報は一切扱いません。
 * ・ブラウザ（GitHub Pages 側）はこのスクリプトを読み込みません。
 *   生成された data/forecast.json を読むだけです。
 * ・取得項目・パラメータは既存の script.js（天気・海況画面）と揃えています。
 *
 * 使い方:
 *   node tools/fetch-forecast.js
 *
 * 出力（1釣り場×3日ぶん）:
 *   { date, weatherCode, tempMax, tempMin, precipProb, precipSum,
 *     windSpeed, windGust, windDir, wave, waveDir, sst, pressure }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SPOTS_PATH = path.join(ROOT, "data", "spots.json");
const OUT_PATH = path.join(ROOT, "data", "forecast.json");

const FORECAST_DAYS = 3;
const REQUEST_TIMEOUT_MS = 15000;
const GAP_BETWEEN_SPOTS_MS = 250; // Open-Meteo への配慮（無料枠: 600回/分）
const MIN_SUCCESS_RATIO = 0.8; // この割合を下回ったら forecast.json を更新しない

/* ---------- ユーティリティ ---------- */

function round(v, digits) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url, label) {
  try {
    return await fetchJson(url);
  } catch (e1) {
    await sleep(800);
    try {
      return await fetchJson(url);
    } catch (e2) {
      throw new Error(label + ": " + e2.message);
    }
  }
}

// hourly 配列を日付ごとに平均する（気圧・海面水温用）
function averageByDate(times, values) {
  const sums = {};
  const counts = {};
  if (!Array.isArray(times) || !Array.isArray(values)) return {};
  times.forEach((t, i) => {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const d = String(t).slice(0, 10);
    sums[d] = (sums[d] || 0) + v;
    counts[d] = (counts[d] || 0) + 1;
  });
  const out = {};
  Object.keys(sums).forEach((d) => (out[d] = sums[d] / counts[d]));
  return out;
}

/* ---------- 1釣り場ぶんの取得 ---------- */

function buildWeatherUrl(lat, lon) {
  return (
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" + lat +
    "&longitude=" + lon +
    "&daily=weathercode,temperature_2m_max,temperature_2m_min," +
    "precipitation_probability_max,precipitation_sum," +
    "windspeed_10m_max,windgusts_10m_max,winddirection_10m_dominant" +
    "&hourly=surface_pressure" +
    "&timezone=Asia%2FTokyo" +
    "&forecast_days=" + FORECAST_DAYS +
    "&windspeed_unit=ms"
  );
}

function buildMarineUrl(lat, lon) {
  return (
    "https://marine-api.open-meteo.com/v1/marine" +
    "?latitude=" + lat +
    "&longitude=" + lon +
    "&daily=wave_height_max,wave_direction_dominant,wave_period_max" +
    "&hourly=sea_surface_temperature" +
    "&timezone=Asia%2FTokyo" +
    "&forecast_days=" + FORECAST_DAYS
  );
}

async function fetchSpotForecast(spot) {
  const lat = spot.latitude;
  const lon = spot.longitude;

  const weather = await fetchJsonWithRetry(buildWeatherUrl(lat, lon), "weather");

  // 海況は湾奥などで取得できないことがある。失敗しても天気だけは残す。
  let marine = null;
  try {
    marine = await fetchJsonWithRetry(buildMarineUrl(lat, lon), "marine");
  } catch (e) {
    marine = null;
  }

  const wDaily = (weather && weather.daily) || {};
  const dates = wDaily.time || [];
  const pressureByDate = averageByDate(
    weather.hourly && weather.hourly.time,
    weather.hourly && weather.hourly.surface_pressure
  );

  const mDaily = (marine && marine.daily) || {};
  const sstByDate = marine
    ? averageByDate(
        marine.hourly && marine.hourly.time,
        marine.hourly && marine.hourly.sea_surface_temperature
      )
    : {};

  const days = dates.map((date, i) => ({
    date: date,
    weatherCode: wDaily.weathercode ? wDaily.weathercode[i] : null,
    tempMax: round(wDaily.temperature_2m_max ? wDaily.temperature_2m_max[i] : null, 1),
    tempMin: round(wDaily.temperature_2m_min ? wDaily.temperature_2m_min[i] : null, 1),
    precipProb: wDaily.precipitation_probability_max
      ? wDaily.precipitation_probability_max[i]
      : null,
    precipSum: round(wDaily.precipitation_sum ? wDaily.precipitation_sum[i] : null, 1),
    windSpeed: round(wDaily.windspeed_10m_max ? wDaily.windspeed_10m_max[i] : null, 1),
    windGust: round(wDaily.windgusts_10m_max ? wDaily.windgusts_10m_max[i] : null, 1),
    windDir: wDaily.winddirection_10m_dominant
      ? wDaily.winddirection_10m_dominant[i]
      : null,
    wave: round(mDaily.wave_height_max ? mDaily.wave_height_max[i] : null, 2),
    waveDir: mDaily.wave_direction_dominant ? mDaily.wave_direction_dominant[i] : null,
    sst: round(sstByDate[date], 1),
    pressure: round(pressureByDate[date], 0),
  }));

  return { days, hasMarine: !!marine };
}

/* ---------- メイン ---------- */

async function main() {
  const raw = JSON.parse(fs.readFileSync(SPOTS_PATH, "utf8"));
  const spots = raw.spots || raw;
  if (!Array.isArray(spots) || spots.length === 0) {
    console.error("spots.json に釣り場がありません。");
    process.exit(1);
  }

  console.log(
    "[fetch-forecast] " + spots.length + " 釣り場ぶんの天気・海況を取得します..."
  );

  const out = {
    generatedAt: new Date().toISOString(),
    source: "Open-Meteo.com (CC BY 4.0)",
    forecastDays: FORECAST_DAYS,
    spots: {},
  };

  let ok = 0;
  let failed = 0;
  let noMarine = 0;

  for (const spot of spots) {
    try {
      const { days, hasMarine } = await fetchSpotForecast(spot);
      out.spots[String(spot.id)] = { name: spot.name, days: days };
      ok++;
      if (!hasMarine) noMarine++;
      const d0 = days[0] || {};
      console.log(
        "  OK  " + spot.name +
        "  (" + (days.length) + "日" +
        (hasMarine ? "" : " / 海況なし") + ")" +
        "  今日: 風" + (d0.windSpeed ?? "-") + "m/s 波" + (d0.wave ?? "-") + "m 水温" + (d0.sst ?? "-") + "℃"
      );
    } catch (e) {
      failed++;
      console.warn("  NG  " + spot.name + "  " + e.message);
    }
    await sleep(GAP_BETWEEN_SPOTS_MS);
  }

  const ratio = ok / spots.length;
  if (ok === 0 || ratio < MIN_SUCCESS_RATIO) {
    console.error(
      "[fetch-forecast] 取得成功率が低いため forecast.json は更新しません " +
      "（成功 " + ok + " / " + spots.length + "）。既存の forecast.json はそのまま残します。"
    );
    process.exit(2);
  }

  // 一時ファイルに書いてから差し替える。
  // 書き込み途中で失敗しても、本番の forecast.json を壊さないため。
  const tmpPath = OUT_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(out, null, 2) + "\n");
  try {
    if (fs.existsSync(OUT_PATH)) fs.copyFileSync(OUT_PATH, OUT_PATH + ".bak");
  } catch (e) {
    /* バックアップ失敗は致命的ではない */
  }
  fs.renameSync(tmpPath, OUT_PATH);

  console.log(
    "[fetch-forecast] 完了: 成功 " + ok + " / 失敗 " + failed +
    " / 海況なし " + noMarine + "  -> " + path.relative(ROOT, OUT_PATH)
  );
}

main().catch((e) => {
  console.error("[fetch-forecast] 予期しないエラー:", e);
  process.exit(1);
});
