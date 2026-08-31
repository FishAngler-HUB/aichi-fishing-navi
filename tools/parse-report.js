/**
 * parse-report.js
 * -----------------------------------------------------------
 * Google Drive の「釣り情報」フォルダに置かれる
 *   aichi-fishing-report-YYYYMMDD.md
 * という Markdown 釣果レポートを読み込み、
 * 釣り情報ナビで使いやすい JSON（data/catches.json）へ変換します。
 *
 * この段階では Drive へ自動接続しません。
 * あらかじめ手元にダウンロードした .md ファイルを読み込むだけです。
 *   1. Drive から最新の aichi-fishing-report-YYYYMMDD.md を
 *      data/reports/ フォルダに保存する（手動）
 *   2. node tools/parse-report.js を実行する
 *   3. data/catches.json が生成される
 *
 * 使い方:
 *   node tools/parse-report.js
 *       … data/reports/ の中で一番新しい aichi-fishing-report-*.md を変換
 *   node tools/parse-report.js data/reports/aichi-fishing-report-20260830.md
 *       … ファイルを指定して変換
 *   node tools/parse-report.js --dry-run
 *       … 変換結果を画面に表示するだけ（catches.json は書き換えない）
 *   node tools/parse-report.js --out data/catches.parsed.json
 *       … 出力先を変更
 *
 * 方針:
 *   ・元の .md ファイルは読み取るだけ。変更・削除しません。
 *   ・レポートに書かれていない項目は推測で埋めず null（または空配列）にします。
 *   ・同じ釣り場×魚種×釣行日は 1 レコードにまとめます。
 *   ・出力 JSON の "catches" 配列は、既存の osusume.js がそのまま読める形
 *     （spotId / species / date / count / location / source）を必ず含みます。
 *     追加項目（市町村・サイズ・釣り方・信頼度・URL など）は osusume.js から
 *     見えても無視されるだけなので、既存機能には影響しません。
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "data", "reports");
const SPOTS_PATH = path.join(ROOT, "data", "spots.json");
const DEFAULT_OUT = path.join(ROOT, "data", "catches.json");

/* =========================================================
   小さなユーティリティ
   ========================================================= */

// "2026/08/29" や "2026-08-29" → "2026-08-29"。読めなければ null。
function toISODate(str) {
  const m = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(String(str || ""));
  if (!m) return null;
  const y = m[1];
  const mo = String(m[2]).padStart(2, "0");
  const d = String(m[3]).padStart(2, "0");
  const iso = y + "-" + mo + "-" + d;
  const chk = new Date(Number(y), Number(mo) - 1, Number(d));
  if (isNaN(chk.getTime())) return null;
  return iso;
}

// Markdown のエスケープ（\#, \*, \[ など）を外して素の記号に戻す。
function unescapeMarkdown(text) {
  return String(text).replace(/\\([\\*#_\[\]\->`~|])/g, "$1");
}

function collapseSpaces(text) {
  return String(text == null ? "" : text)
    .replace(/　/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " / ")
    .trim();
}

function stripBold(text) {
  return String(text == null ? "" : text).replace(/\*\*/g, "").trim();
}

// "マダイ（チャリコ）" → "マダイ"、"アジ（マアジ）" → "アジ"
function cleanSpeciesName(name) {
  return stripBold(name)
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[.。、,]\s*$/, "")
    .trim();
}

const NO_INFO_WORDS = ["情報なし", "なし", "確認できる情報なし", "判定不能", "不明", "他", "等", "など"];

function splitSpeciesList(raw) {
  if (!raw) return [];
  const body = stripBold(raw).split(/\n/)[0];
  return body
    .split(/[、,／]/)
    .map(cleanSpeciesName)
    .filter((s) => s && !NO_INFO_WORDS.includes(s));
}

/* ---------------------------------------------------------
   魚種名の正規化（別名 → fish.json の正式名称）
   ・ユーザー指定：
       セイゴ / フッコ / スズキ → シーバス
       キス                     → シロギス
       ショゴ / ワカシ / イナダ → 青物
   ・その他は「同一魚種と断定できる別名・出世名・地方名」のみ登録。
     断定できない表記（マダイ／チャリコ／ヘダイ／ハゼ 等）は変換せず原名を保持する。
   ・正規化前の名前は各レコードの rawSpecies に必ず残す。
   --------------------------------------------------------- */
const SPECIES_ALIASES = {
  // --- シーバス（スズキ）---
  "セイゴ": "シーバス",
  "フッコ": "シーバス",
  "スズキ": "シーバス",
  "ハネ": "シーバス",
  "マダカ": "シーバス",
  "マルスズキ": "シーバス",
  // --- シロギス ---
  "キス": "シロギス",
  // --- 青物（ブリ・カンパチ・サワラ系の出世名／地方名）---
  "ショゴ": "青物",
  "ワカシ": "青物",
  "イナダ": "青物",
  "ワラサ": "青物",
  "ハマチ": "青物",
  "ツバス": "青物",
  "メジロ": "青物",
  "ブリ": "青物",
  "カンパチ": "青物",
  "ヒラマサ": "青物",
  "サゴシ": "青物",
  "サワラ": "青物",
  // --- fish.json 正式名の別表記・標準和名 ---
  "マアジ": "アジ",
  "マサバ": "サバ",
  "ゴマサバ": "サバ",
  "マイワシ": "イワシ",
  "カタクチイワシ": "イワシ",
  "ウルメイワシ": "イワシ",
  "ガシラ": "カサゴ",
  "アラカブ": "カサゴ",
  "チヌ": "クロダイ",
  "カイズ": "クロダイ",
  "モイカ": "アオリイカ",
};

// 別名テーブルで正式名称に寄せる。該当が無ければ原名をそのまま返す。
// 環境変数 NO_SPECIES_NORM=1 のときは正規化を無効化（正規化前後の比較用）。
function canonicalSpecies(name) {
  const clean = cleanSpeciesName(name);
  if (process.env.NO_SPECIES_NORM) return clean;
  return SPECIES_ALIASES[clean] || clean;
}

/* =========================================================
   釣り場名 → spots.json の id を推定する
   ========================================================= */

function normalizeSpotName(name) {
  return stripBold(name)
    .replace(/[（(【].*?[）)】]/g, "")
    .replace(/[【】\s　]/g, "")
    .trim();
}

const SPOT_SUFFIX = /(漁港|港|釣り桟橋|海釣り公園|フィッシングパーク|緑地公園|緑地|サーフ|海岸|岬|大橋|突堤|護岸|前島)$/;

function spotCore(name) {
  return normalizeSpotName(name).replace(SPOT_SUFFIX, "");
}

function buildSpotResolver(spots) {
  const entries = spots.map((s) => {
    // 「宮崎漁港（吉良サンライズパーク）」→ 別名「吉良サンライズパーク」も一致対象にする
    const aliasM = /[（(]([^）)]+)[）)]/.exec(String(s.name));
    return {
      id: s.id,
      name: s.name,
      norm: normalizeSpotName(s.name),
      core: spotCore(s.name),
      alias: aliasM ? aliasM[1].replace(/[\s　]/g, "").trim() : null,
    };
  });

  return function resolve(reportName) {
    const rn = normalizeSpotName(reportName);
    const rc = spotCore(reportName);
    if (!rn) return { id: null, matchedName: null, how: "empty" };

    // 1) 正規化した名前どうしの部分一致（長い一致を優先）
    let best = null;
    for (const e of entries) {
      if (!e.norm) continue;
      if (rn.indexOf(e.norm) !== -1 || e.norm.indexOf(rn) !== -1) {
        const score = Math.min(e.norm.length, rn.length);
        if (!best || score > best.score) best = { e, score, how: "name" };
      }
      if (e.alias && (rn.indexOf(e.alias) !== -1 || e.alias.indexOf(rn) !== -1)) {
        const score = Math.min(e.alias.length, rn.length) + 1;
        if (!best || score > best.score) best = { e, score, how: "alias" };
      }
    }
    if (best) return { id: best.e.id, matchedName: best.e.name, how: best.how };

    // 2) 語幹（末尾の「漁港」「港」などを外した部分）の完全一致
    if (rc && rc.length >= 2) {
      const hits = entries.filter((e) => e.core && e.core === rc);
      if (hits.length === 1) {
        return { id: hits[0].id, matchedName: hits[0].name, how: "core" };
      }
      if (hits.length > 1) {
        return { id: null, matchedName: null, how: "ambiguous-core" };
      }
    }

    return { id: null, matchedName: null, how: "no-match" };
  };
}

/* =========================================================
   レポート本文（Markdown）のパース
   ========================================================= */

// "* **キー**：値" の行からキーと値を取り出す。無ければ null。
function matchKeyLine(line) {
  const m = /^\*\s+\*\*(.+?)\*\*\s*[:：]\s*(.*)$/.exec(line);
  if (!m) return null;
  return { key: stripBold(m[1]).trim(), value: m[2].trim() };
}

const FIELD_MAP = {
  "市町村": "city",
  "直近釣行日": "tripDate",
  "最終釣行日": "tripDate",
  "確認された魚種": "speciesRaw",
  "主な魚種": "speciesRaw",
  "釣果": "catchRaw",
  "釣果状況": "catchRaw",
  "サイズ": "sizeRaw",
  "釣り方": "methodRaw",
  "使用ルアー・エギ": "lureRaw",
  "使用エギ": "lureRaw",
  "使用ルアー": "lureRaw",
  "使用ルアー・エサ": "lureRaw",
  "釣れた仕掛け・ルアー": "lureRaw",
  "仕掛け": "rigRaw",
  "エサ": "baitRaw",
  "水深": "depthRaw",
  "時間帯": "timeRaw",
  "天候": "weatherRaw",
  "天気": "weatherRaw",
  "記事投稿日": "articleDateRaw",
  "投稿日": "articleDateRaw",
  "直近7日間の情報件数": "infoCountRaw",
  "確認情報件数": "infoCountRaw",
  "情報源": "sourceNameRaw",
  "URL": "urlRaw",
  "信頼度": "confidenceRaw",
};

// 出典番号（[8] / [3, 8, 57] / ［9］ など、角カッコ内が数字だけのもの）を除去する。
// Markdown リンク [ラベル](URL) は数字だけではないので影響しない。
function stripCitations(text) {
  return String(text).replace(/\s*[\[［]\s*\d+(?:\s*[,，、]\s*\d+)*\s*[\]］]/g, "");
}

function parseReport(md) {
  const text = stripCitations(unescapeMarkdown(md)).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  const out = {
    surveyDate: null,
    periodStart: null,
    periodEnd: null,
    compiledBy: null,
    summaryRows: [], // 直近7日間の釣果サマリー表
    speciesTrends: [], // 「直近7日で釣果が目立つ魚種」セクション
    blocks: [], // 釣り場別 釣果情報
    topSpots: [], // 直近7日で特に釣果が目立つ釣り場
    sources: [], // 情報源一覧
  };

  let section = "head";
  let areaGroup = null;
  let block = null;
  let currentField = null;
  let trendItem = null;

  const flushBlock = () => {
    if (block) out.blocks.push(block);
    block = null;
    currentField = null;
  };
  const flushTrend = () => {
    if (trendItem) out.speciesTrends.push(trendItem);
    trendItem = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    // 調査日・対象期間・作成者
    if (section === "head" || !out.surveyDate) {
      const sv = /調査日\s*[:：]\s*([\d/.\-]+)/.exec(line);
      if (sv) out.surveyDate = toISODate(sv[1]);
      const pd = /対象期間\s*[:：]\s*([\d/.\-]+)\s*[〜~\-]\s*([\d/.\-]+)/.exec(line);
      if (pd) {
        out.periodStart = toISODate(pd[1]);
        out.periodEnd = toISODate(pd[2]);
      }
    }
    const cb = /Report Compiled by (.+?) on /i.exec(line);
    if (cb) out.compiledBy = cb[1].trim();

    // セクション見出し（### ■ ....）
    const sec = /^#{2,3}\s*■\s*(.+)$/.exec(line);
    if (sec) {
      flushBlock();
      flushTrend();
      const t = sec[1];
      if (t.indexOf("サマリー") !== -1) section = "summary";
      else if (t.indexOf("釣り場別") !== -1) section = "spots";
      else if (t.indexOf("特に釣果が目立つ釣り場") !== -1) section = "topSpots";
      else if (t.indexOf("釣果が目立つ魚種") !== -1) section = "topSpecies";
      else if (t.indexOf("情報源一覧") !== -1) section = "sources";
      else section = "other";
      continue;
    }

    // エリア見出し（#### 【○○エリア】）
    const area = /^#{3,4}\s*【(.+?)】\s*$/.exec(line);
    if (area) {
      flushBlock();
      areaGroup = area[1].trim();
      continue;
    }

    // 区切り線
    if (/^-{3,}$/.test(line) || /^={3,}$/.test(line) || /^＝{3,}$/.test(line)) {
      flushBlock();
      flushTrend();
      continue;
    }

    /* ---- サマリー表 ---- */
    if (section === "summary" && line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length >= 5 && !/^:?-{2,}:?$/.test(cells[0]) && cells[0] !== "魚種") {
        out.summaryRows.push({
          species: cleanSpeciesName(cells[0]),
          reports: parseCount(cells[1]),
          spots: cells[2].split(/[、,]/).map((s) => s.trim()).filter(Boolean),
          size: stripBold(cells[3]) || null,
          trend: firstSentence(stripBold(cells[4])),
          note: stripBold(cells[4]) || null,
        });
      }
      continue;
    }

    /* ---- 情報源一覧表 ---- */
    if (section === "sources" && line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length >= 5 && !/^:?-{2,}:?$/.test(cells[0]) && cells[0] !== "情報源名") {
        out.sources.push({
          name: stripBold(cells[0]) || null,
          url: (extractUrls(cells[1])[0] || null),
          articleCount: parseCount(cells[2]),
          lastUpdated: toISODate(cells[3]),
          spots: cells[4].split(/[、,]/).map((s) => s.trim()).filter(Boolean),
        });
      }
      continue;
    }

    /* ---- 釣り場別 釣果情報 / 特に目立つ釣り場 ---- */
    if (section === "spots" || section === "topSpots") {
      const head = /^\*\*【(.+?)】\*\*\s*$/.exec(line) || /^\*\*(\d+位[:：].+?)\*\*\s*$/.exec(line);
      if (head) {
        flushBlock();
        let name = head[1].trim();
        let rank = null;
        const rm = /^(\d+)位\s*[:：]\s*(.+)$/.exec(name);
        if (rm) {
          rank = Number(rm[1]);
          name = rm[2].trim();
        }
        block = {
          spot: name.replace(/[（(【].*$/,"").trim() || name,
          spotFull: name,
          areaGroup: areaGroup,
          rank: rank,
          fields: {},
        };
        currentField = null;
        continue;
      }

      if (block) {
        const kv = matchKeyLine(line);
        if (kv) {
          const internal = FIELD_MAP[kv.key];
          currentField = internal || ("_" + kv.key);
          if (block.fields[currentField]) {
            block.fields[currentField] += "\n" + kv.value;
          } else {
            block.fields[currentField] = kv.value;
          }
          continue;
        }
        // インデントされた「 * ...」は直前のキーの続き（釣果や URL の箇条書き）
        const sub = /^\s+\*\s+(.*)$/.exec(raw);
        if (sub && currentField) {
          block.fields[currentField] =
            (block.fields[currentField] ? block.fields[currentField] + "\n" : "") + sub[1].trim();
          continue;
        }
      }
      continue;
    }

    /* ---- 直近7日で釣果が目立つ魚種 ---- */
    if (section === "topSpecies") {
      const sh = /^\*\s+\*\*(.+?)\*\*\s*$/.exec(line);
      if (sh) {
        flushTrend();
        trendItem = { species: cleanSpeciesName(sh[1]), fields: {} };
        currentField = null;
        continue;
      }
      if (trendItem) {
        const kv = matchKeyLine(line) || matchKeyLine(line.replace(/^\s*\*\s+/, "* "));
        if (kv) {
          const internal = FIELD_MAP[kv.key] || ("_" + kv.key);
          trendItem.fields[internal] = stripBold(kv.value);
          continue;
        }
      }
      continue;
    }
  }

  flushBlock();
  flushTrend();
  return out;
}

function firstSentence(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  return t.split(/[。\.]/)[0].trim() || null;
}

function parseCount(text) {
  const m = /(\d[\d,]*)/.exec(String(text || ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/* =========================================================
   ブロックの生テキストから各項目を取り出す
   ========================================================= */

function extractUrls(text) {
  const s = String(text || "");
  if (!s || /^なし$/.test(s.trim())) return [];
  const urls = [];
  const md = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = md.exec(s))) urls.push(m[1].replace(/\\+$/, ""));
  if (urls.length === 0) {
    const bare = /(https?:\/\/[^\s)\]]+)/g;
    while ((m = bare.exec(s))) urls.push(m[1].replace(/\\+$/, ""));
  }
  return Array.from(new Set(urls));
}

// 釣果テキストからその魚種の尾数を推定（匹/尾/杯/本/枚）。無ければ null。
// speciesCount が 1（そのブロックの魚種が1種だけ）のときは、魚種名が
// 書かれていなくても本文中の「○匹」を採用する。
function extractCount(catchText, species, speciesCount) {
  if (!catchText || !species) return null;
  const fragments = String(catchText).split(/[\n、,]/).map((f) => f.trim());
  let max = null;
  let mentioned = false;
  for (const f of fragments) {
    if (f.indexOf(species) === -1) continue;
    mentioned = true;
    const re = /(\d[\d,]*)\s*(匹|尾|杯|本|枚)/g;
    let m;
    while ((m = re.exec(f))) {
      const n = Number(m[1].replace(/,/g, ""));
      if (!isNaN(n) && (max === null || n > max)) max = n;
    }
  }
  if (max === null && speciesCount === 1) {
    const re = /(\d[\d,]*)\s*(匹|尾|杯|本|枚)/g;
    let m;
    while ((m = re.exec(String(catchText)))) {
      const n = Number(m[1].replace(/,/g, ""));
      if (!isNaN(n) && (max === null || n > max)) max = n;
    }
  }
  return mentioned || max !== null ? max : null;
}

// サイズテキストからその魚種のサイズ表記を取り出す。無ければ（1魚種だけなら全体を）返す。
function extractSize(sizeText, species, speciesCount) {
  if (!sizeText) return null;
  const fragments = String(sizeText).split(/[\n、,]/).map((f) => f.trim()).filter(Boolean);
  for (const f of fragments) {
    const idx = f.indexOf(species);
    if (idx !== -1) {
      const rest = f.slice(idx + species.length).replace(/^[:：\s]+/, "").trim();
      return rest || f.trim();
    }
  }
  if (speciesCount === 1) {
    const joined = fragments.join("、");
    if (/cm|ｃｍ|胴長|g\b|ｇ|kg/.test(joined)) return joined;
  }
  return null;
}

const RIG_WORDS = [
  "投げサビキ", "ジグサビキ", "サビキ", "ちょい投げ", "投げ釣り", "本格投げ",
  "胴突き", "ブッコミ", "ぶっこみ", "ヘチ", "落とし込み", "前打ち", "エギング",
  "穴釣り", "ミャク釣り", "電気ウキ", "ウキ釣り", "ワインド", "ショアジギング",
  "のべ竿", "フカセ", "アジング", "メバリング", "プラッキング",
];

function extractRig(methodText, rigText) {
  const hay = [rigText, methodText].filter(Boolean).join(" ");
  if (!hay) return [];
  const hits = [];
  for (const w of RIG_WORDS) {
    if (hay.indexOf(w) !== -1 && hits.indexOf(w) === -1) hits.push(w);
  }
  return hits;
}

const BAIT_WORDS = [
  "石ゴカイ", "青イソメ", "アオイソメ", "赤イソメ", "イソメ", "剥きアサリ", "アサリ",
  "岩ガニ", "カニ", "ミジンコ", "ミジダンゴ", "オキアミ", "コーン", "練り餌", "ゴールド",
];

function extractBait(text) {
  const s = String(text || "");
  const out = [];
  const label = /エサ\s*[:：]\s*([^）)\n]+)/g;
  let m;
  while ((m = label.exec(s))) {
    m[1].split(/[、,]/).forEach((x) => {
      const v = x.trim();
      if (v && out.indexOf(v) === -1) out.push(v);
    });
  }
  for (const w of BAIT_WORDS) {
    if (s.indexOf(w) !== -1 && out.indexOf(w) === -1) out.push(w);
  }
  return out.length ? out.join("、") : null;
}

// 釣果欄の原文から、その魚種に触れている行だけを取り出す。
// 該当行が無ければ（＝1魚種ブロックなど）全文を返す。
function catchTextForSpecies(catchText, species, speciesCount) {
  if (!catchText) return null;
  const frags = String(catchText)
    .split(/\n/)
    .map((f) => f.trim())
    .filter(Boolean);
  const hit = frags.filter((f) => f.indexOf(species) !== -1);
  if (hit.length) return hit.join(" / ");
  if (speciesCount === 1 || frags.length <= 1) return frags.join(" / ");
  return null;
}

function extractLureColor(lureText) {
  const m = /カラー\s*[:：]\s*([^）)\n]+)/.exec(String(lureText || ""));
  return m ? m[1].trim() : null;
}

function extractDepth(text) {
  const s = String(text || "");
  const m = /(沖合|飛距離|水深|遠投|水深約|水深)\s*([0-9]+\s*m)/.exec(s) ||
    /([0-9]+\s*m)\s*(以上|前後|付近|ライン)/.exec(s);
  if (!m) return null;
  return (m[2] || m[1]).replace(/\s+/g, "");
}

const TIME_WORDS = [
  "未明", "深夜", "早朝", "朝マズメ", "夕マズメ", "マズメ", "朝方", "明け方",
  "夜間", "夜釣り", "日中", "満潮", "干潮", "上げ潮", "下げ潮", "時合",
];

function extractTimeOfDay(text) {
  const s = String(text || "");
  const hits = [];
  for (const w of TIME_WORDS) {
    if (s.indexOf(w) !== -1 && hits.indexOf(w) === -1) hits.push(w);
  }
  // 「深夜〜早朝」のような並びはまとめる
  if (hits.indexOf("深夜") !== -1 && hits.indexOf("早朝") !== -1) {
    return "深夜〜早朝" + hits.filter((w) => w !== "深夜" && w !== "早朝").map((w) => "・" + w).join("");
  }
  return hits.length ? hits.join("・") : null;
}

const WEATHER_WORDS = ["晴れ", "晴", "曇り", "曇", "雨", "小雨", "強風", "無風", "凪", "濁り", "澄み潮"];

function extractWeather(text) {
  const s = String(text || "");
  const hits = WEATHER_WORDS.filter((w) => s.indexOf(w) !== -1);
  return hits.length ? Array.from(new Set(hits)).join("・") : null;
}

function extractConfidence(text) {
  const s = stripBold(text || "");
  const mk = /[◎○◯△▲×✕✖]/.exec(s);
  const mark = mk ? mk[0].replace(/[◯]/, "○").replace(/[✕✖]/, "×") : null;
  let note = null;
  const nm = /[（(]([^）)]+)[）)]/.exec(s);
  if (nm) note = nm[1].trim();
  else if (mark) note = s.replace(mark, "").trim() || null;
  else note = s || null;
  return { mark, note };
}

/* =========================================================
   パース結果 → 出力 JSON
   ========================================================= */

function build(reportObj, reportFileName, spots) {
  const resolve = buildSpotResolver(spots);

  // 魚種 → 増減傾向（「目立つ魚種」セクション優先、無ければサマリー表）
  const trendBySpecies = {};
  reportObj.speciesTrends.forEach((t) => {
    const key = t.species;
    const v = t.fields["_最近の増減傾向"] || t.fields["trend"] || null;
    trendBySpecies[key] = {
      trend: v ? firstSentence(v) : null,
      note: v || null,
      catchCountText: t.fields["_釣果数"] || null,
      rigText: t.fields["lureRaw"] || null,
    };
  });
  reportObj.summaryRows.forEach((r) => {
    if (!trendBySpecies[r.species]) {
      trendBySpecies[r.species] = { trend: r.trend, note: r.note, catchCountText: null, rigText: null };
    }
  });

  function trendFor(species) {
    if (trendBySpecies[species]) return trendBySpecies[species];
    const k = Object.keys(trendBySpecies).find(
      (key) => key.indexOf(species) !== -1 || species.indexOf(key) !== -1
    );
    return k ? trendBySpecies[k] : { trend: null, note: null };
  }

  const catches = [];
  const coverage = [];
  const unresolved = [];
  const seen = new Map();
  const speciesRemap = {}; // 実際に正規化が起きたものだけ { セイゴ: "シーバス", ... }

  function canonOf(rawName) {
    const c = canonicalSpecies(rawName);
    const raw = cleanSpeciesName(rawName);
    if (c !== raw) speciesRemap[raw] = c;
    return c;
  }
  function trendForEither(rawSp, canonSp) {
    const a = trendFor(rawSp);
    if (a && (a.trend || a.note)) return a;
    return trendFor(canonSp);
  }

  reportObj.blocks
    .filter((b) => b.rank == null) // 「特に目立つ釣り場」ランキングはメタ情報として別扱い
    .forEach((b) => {
      const f = b.fields;
      const spotName = b.spotFull || b.spot;
      const r = resolve(spotName);
      const tripDate = toISODate(f.tripDate);
      const speciesList = splitSpeciesList(f.speciesRaw);
      const infoCount = parseCount(f.infoCountRaw);
      const conf = extractConfidence(f.confidenceRaw);
      const baseMeta = {
        spot: spotName,
        spotId: r.id,
        matchedSpotName: r.matchedName,
        areaGroup: b.areaGroup || null,
        city: f.city ? f.city.trim() : null,
        infoCount: infoCount,
        confidence: conf.mark,
        confidenceNote: conf.note,
      };

      const noData =
        !tripDate ||
        speciesList.length === 0 ||
        infoCount === 0 ||
        /情報なし|確認できる情報なし/.test(String(f.catchRaw || "")) ;

      if (noData) {
        coverage.push({
          ...baseMeta,
          reason: collapseSpaces(f.tripDate || f.catchRaw || "情報なし"),
        });
        if (r.id == null) unresolved.push({ spot: spotName, how: r.how, hadCatch: false });
        return;
      }

      if (r.id == null) unresolved.push({ spot: spotName, how: r.how, hadCatch: true });

      const urls = extractUrls(f.urlRaw);
      const rig = extractRig(f.methodRaw, f.rigRaw);
      const bait = extractBait([f.baitRaw, f.methodRaw, f.catchRaw, f.lureRaw].filter(Boolean).join("\n"));
      const depth = extractDepth([f.methodRaw, f.catchRaw].filter(Boolean).join(" "));
      const timeOfDay = extractTimeOfDay([f.timeRaw, f.catchRaw, f.methodRaw].filter(Boolean).join(" "));
      const weather = extractWeather([f.weatherRaw, f.catchRaw, f.methodRaw].filter(Boolean).join(" "));

      speciesList.forEach((rawSp) => {
        const sp = canonOf(rawSp);
        const t = trendForEither(rawSp, sp);
        const rec = {
          // --- osusume.js が読む必須項目 ---
          spotId: r.id,
          location: spotName,
          species: sp, // 正規化後（fish.json の正式名称に寄せたもの）
          date: tripDate,
          count: extractCount(f.catchRaw, rawSp, speciesList.length),
          source: "report",
          // --- 追加項目（既存機能は無視する） ---
          rawSpecies: cleanSpeciesName(rawSp), // レポート原文の魚種名
          spot: spotName,
          matchedSpotName: r.matchedName,
          spotMatch: r.how,
          areaGroup: b.areaGroup || null,
          city: baseMeta.city,
          countText: collapseSpaces(catchTextForSpecies(f.catchRaw, rawSp, speciesList.length)) || null,
          size: extractSize(f.sizeRaw, rawSp, speciesList.length),
          method: f.methodRaw ? collapseSpaces(f.methodRaw) : null,
          rig: rig.length ? rig : null,
          bait: bait,
          lure: f.lureRaw ? collapseSpaces(f.lureRaw) : null,
          lureColor: extractLureColor(f.lureRaw),
          depth: depth,
          timeOfDay: timeOfDay,
          weather: weather,
          trend: t.trend || null,
          trendNote: t.note || null,
          infoCount: infoCount,
          sourceName: f.sourceNameRaw ? collapseSpaces(f.sourceNameRaw) : null,
          url: urls,
          confidence: conf.mark,
          confidenceNote: conf.note,
          reportFile: reportFileName,
          surveyDate: reportObj.surveyDate,
          periodStart: reportObj.periodStart,
          periodEnd: reportObj.periodEnd,
          articleDate: toISODate(f.articleDateRaw),
        };

        const key = (r.id != null ? "id" + r.id : "name:" + spotName) + "__" + sp + "__" + tripDate;
        if (seen.has(key)) {
          const prev = seen.get(key);
          if (rec.count != null && (prev.count == null || rec.count > prev.count)) prev.count = rec.count;
          if (rec.countText && prev.countText && prev.countText.indexOf(rec.countText) === -1) {
            prev.countText = prev.countText + " / " + rec.countText;
          }
          return;
        }
        seen.set(key, rec);
        catches.push(rec);
      });
    });

  // 「特に釣果が目立つ釣り場」ランキング（メタ情報）
  const topSpots = reportObj.blocks
    .filter((b) => b.rank != null)
    .map((b) => {
      const f = b.fields;
      const r = resolve(b.spotFull || b.spot);
      const rawMain = splitSpeciesList(f.speciesRaw);
      return {
        rank: b.rank,
        spot: b.spotFull || b.spot,
        spotId: r.id,
        mainSpecies: rawMain.map(canonOf),
        mainSpeciesRaw: rawMain,
        status: f.catchRaw ? collapseSpaces(stripBold(f.catchRaw)) : null,
        infoCount: parseCount(f.infoCountRaw),
        lastTripDate: toISODate(f.tripDate),
        sourceName: f.sourceNameRaw ? collapseSpaces(f.sourceNameRaw) : null,
      };
    });

  const spotsWithCatch = new Set(catches.map((c) => c.spot)).size;
  const spotsResolved = new Set(catches.filter((c) => c.spotId != null).map((c) => c.spotId)).size;

  return {
    _comment:
      "このファイルは tools/parse-report.js が data/reports/aichi-fishing-report-*.md から自動生成しました。" +
      "手で編集しても構いませんが、再実行すると上書きされます。" +
      "レポートに書かれていない項目は null（推測で埋めていません）。" +
      '"catches" 配列の spotId / species / date / count / location は osusume.js がそのまま利用します。',
    _generator: "tools/parse-report.js",
    _format: {
      spotId: "data/spots.json の id。レポートの釣り場名から推定。特定できなければ null",
      location: "レポート上の釣り場名（spotId が null でも名前一致で使えるように保持）",
      species: "魚種名（末尾の（別名）は除去）",
      date: "その釣り場ブロックの直近釣行日 YYYY-MM-DD",
      count: "その魚種の尾数の目安（匹/尾/杯/本/枚から推定）。数値が無ければ null",
      countText: "釣果欄の原文（そのまま）",
      size: "サイズ欄からその魚種の表記を抽出。無ければ null",
      rawSpecies: "レポート原文の魚種名（正規化前）。species と違う場合は別名変換された",
      trend: "直近の増減傾向（レポートのサマリー／魚種セクション由来）",
      confidence: "◎ / ○ / △ / × のいずれか",
      url: "情報源URLの配列",
      source: "常に 'report'（レポート由来）。手入力の釣果は 'self'",
    },
    speciesNormalization: {
      note:
        "レポート側の別名・出世名・地方名を fish.json の正式名称へ寄せています。" +
        "断定できない魚種（マダイ・チャリコ・ヘダイ・ヒイラギ・ハゼ・ウナギ・カニ 等）は変換せず rawSpecies のまま species に入ります。",
      rulesApplied: speciesRemap, // 今回の32件で実際に変換されたもの
      ruleTable: SPECIES_ALIASES, // 別名 → 正式名称 の全ルール
    },
    generatedAt: new Date().toISOString(),
    report: {
      file: reportFileName,
      surveyDate: reportObj.surveyDate,
      periodStart: reportObj.periodStart,
      periodEnd: reportObj.periodEnd,
      compiledBy: reportObj.compiledBy,
    },
    updatedAt: reportObj.surveyDate || new Date().toLocaleDateString("sv-SE"),
    counts: {
      catches: catches.length,
      spotsWithCatch: spotsWithCatch,
      spotsResolvedToSpotsJson: spotsResolved,
      coverageNoData: coverage.length,
      unresolvedSpotNames: unresolved.filter((u) => u.hadCatch).map((u) => u.spot),
    },
    catches: catches,
    coverage: coverage,
    speciesSummary: reportObj.summaryRows.map((r) => ({
      species: canonOf(r.species),
      rawSpecies: r.species,
      reports: r.reports,
      spots: r.spots,
      size: r.size,
      trend: r.trend,
      note: r.note,
    })),
    speciesTrends: reportObj.speciesTrends.map((t) => ({
      species: canonOf(t.species),
      rawSpecies: t.species,
      reports: parseCount(t.fields["_確認件数"]),
      spots: (t.fields["_主な釣り場"] || "").split(/[、,]/).map((s) => s.trim()).filter(Boolean),
      size: t.fields["sizeRaw"] || t.fields["_サイズ"] || null,
      catchCountText: t.fields["_釣果数"] || null,
      rigText: t.fields["lureRaw"] || null,
      trend: firstSentence(t.fields["_最近の増減傾向"] || ""),
      trendNote: t.fields["_最近の増減傾向"] || null,
    })),
    topSpots: topSpots,
    sources: reportObj.sources,
  };
}

/* =========================================================
   実行
   ========================================================= */

function pickLatestReport() {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => /^aichi-fishing-report-\d{8}\.md$/i.test(f))
    .sort();
  return files.length ? path.join(REPORTS_DIR, files[files.length - 1]) : null;
}

function main() {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outPath = DEFAULT_OUT;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run" || a === "--stdout") dryRun = true;
    else if (a === "--out") outPath = path.resolve(ROOT, args[++i] || "");
    else if (a.startsWith("--out=")) outPath = path.resolve(ROOT, a.slice(6));
    else if (!a.startsWith("--")) inputPath = path.resolve(process.cwd(), a);
  }

  if (!inputPath) inputPath = pickLatestReport();
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error(
      "レポートファイルが見つかりません。\n" +
        "  Drive からダウンロードした aichi-fishing-report-YYYYMMDD.md を\n" +
        "  " + REPORTS_DIR + " に置くか、パスを指定してください。"
    );
    process.exit(1);
  }

  if (!fs.existsSync(SPOTS_PATH)) {
    console.error("data/spots.json が見つかりません: " + SPOTS_PATH);
    process.exit(1);
  }

  const md = fs.readFileSync(inputPath, "utf8");
  const spotsJson = JSON.parse(fs.readFileSync(SPOTS_PATH, "utf8"));
  const spots = spotsJson.spots || spotsJson;

  const reportObj = parseReport(md);
  const result = build(reportObj, path.basename(inputPath), spots);

  const json = JSON.stringify(result, null, 2) + "\n";

  console.log("入力: " + path.relative(ROOT, inputPath));
  console.log("調査日: " + (result.report.surveyDate || "不明") +
    " / 対象期間: " + (result.report.periodStart || "?") + "〜" + (result.report.periodEnd || "?"));
  console.log("抽出した釣果レコード: " + result.counts.catches + " 件");
  console.log("  釣り場数（釣果あり）: " + result.counts.spotsWithCatch +
    " / うち spots.json と対応づけ: " + result.counts.spotsResolvedToSpotsJson);
  console.log("  釣果なし（coverage）: " + result.counts.coverageNoData + " 件");
  if (result.counts.unresolvedSpotNames.length) {
    console.log("  spots.json に無い釣り場: " + result.counts.unresolvedSpotNames.join("、"));
  }
  console.log("");
  console.log("釣果レコード内訳:");
  result.catches.forEach((c) => {
    console.log(
      "  - " + (c.spotId != null ? "[" + c.spotId + "] " : "[--] ") +
        c.spot + " / " + c.species + " / " + c.date +
        " / " + (c.count != null ? c.count + "匹相当" : "数不明") +
        " / 信頼度" + (c.confidence || "-")
    );
  });

  if (dryRun) {
    console.log("\n--dry-run のためファイルは書き込みません。");
    return;
  }

  safeWrite(outPath, json);
  console.log("\n書き込み完了: " + path.relative(ROOT, outPath) + "（" + json.length + " bytes）");
}

// 安全な書き込み:
//   1. <out>.tmp に書き出す
//   2. .tmp を JSON として読み直して検証（壊れていれば例外→ここで停止、既存ファイルは無傷）
//   3. 既存の <out> を <out>.bak に退避
//   4. .tmp を <out> にリネームして置換
function safeWrite(outPath, json) {
  const tmp = outPath + ".tmp";
  const bak = outPath + ".bak";
  fs.writeFileSync(tmp, json, "utf8");
  try {
    const parsed = JSON.parse(fs.readFileSync(tmp, "utf8"));
    if (!parsed || !Array.isArray(parsed.catches)) {
      throw new Error("catches 配列がありません");
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    console.error("生成した JSON の検証に失敗したため書き込みを中止しました: " + e.message);
    process.exit(1);
  }
  if (fs.existsSync(outPath)) fs.copyFileSync(outPath, bak);
  fs.renameSync(tmp, outPath);
}

main();
