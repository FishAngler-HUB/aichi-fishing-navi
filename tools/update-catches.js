/**
 * update-catches.js
 * -----------------------------------------------------------
 * 釣果データ更新の本体。次の順で実行します。
 *
 *   1. node tools/fetch-drive-report.js
 *        … Google Drive「釣り情報」から最新 aichi-fishing-report-*.md を取得
 *   2. 新しいレポートがあったときだけ node tools/parse-report.js
 *        … data/reports/ の最新 .md から data/catches.json を生成
 *          （parse-report.js が .tmp→検証→リネーム、直前版は .bak）
 *   3. data/catches.json を検証（JSON 妥当 / catches 配列 / surveyDate）
 *   4. 問題なければそのまま確定、問題があれば .bak から元に戻す
 *
 * 安全策:
 *   ・Drive に新しいレポートが無い（fetch が終了コード3）→ 何もせず正常終了。
 *   ・Drive 接続失敗・取得物破損（fetch が終了コード1）→ catches.json を変更しない。
 *   ・パース失敗・検証失敗 → 直前の catches.json に戻す。
 *   ・git add / commit / push は一切しない（公開反映は手動）。
 *
 * ログ: tools/fetch.log に追記されます（run-update-catches.bat 経由）。
 * 実行方法:
 *   手動 : npm run update:catches   （または tools/run-update-catches.bat）
 *   自動 : タスクスケジューラから tools/run-update-catches.bat を実行
 *
 * 終了コード: 0 = 成功またはスキップ / 0以外 = 失敗（catches.json は元のまま）
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CATCHES_PATH = path.join(ROOT, "data", "catches.json");
const BAK_PATH = CATCHES_PATH + ".bak";

const FETCH_OK = 0;
const FETCH_NOCHANGE = 3;

/* ---------- ログ ---------- */

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}
function log(line) {
  console.log("[" + ts() + "] " + line);
}
function logBlock(title, text) {
  const body = String(text || "").trimEnd();
  if (!body) return;
  console.log("----- " + title + " -----");
  console.log(body);
  console.log("----- (ここまで) -----");
}
function finish(code, reason) {
  log(
    (code === 0 ? "完了" : "中止") +
    "（終了コード " + code + "）" + (reason ? " : " + reason : "")
  );
  process.exit(code);
}

/* ---------- 子プロセス実行 ---------- */

function runNode(scriptRelPath) {
  return spawnSync(process.execPath, [path.join(__dirname, scriptRelPath)], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
}

/* ---------- 1. Drive から取得 ---------- */

function fetchReport() {
  log("Google Drive から最新レポートを取得します（tools/fetch-drive-report.js）");
  const r = runNode("fetch-drive-report.js");
  logBlock("fetch-drive-report.js の出力", (r.stdout || "") + (r.stderr || ""));

  if (r.error) {
    finish(1, "fetch-drive-report.js を実行できませんでした: " + r.error.message);
  }
  if (r.status === FETCH_NOCHANGE) {
    finish(0, "新しいレポートが無いため catches.json は据え置きました");
  }
  if (r.status !== FETCH_OK) {
    finish(1, "レポート取得に失敗しました（catches.json は変更していません）");
  }
  log("新しいレポートを取得しました");
}

/* ---------- 2. パース ---------- */

function parseReport() {
  log("レポートを解析して catches.json を更新します（tools/parse-report.js）");
  const r = runNode("parse-report.js");
  logBlock("parse-report.js の出力", (r.stdout || "") + (r.stderr || ""));

  if (r.error) {
    restoreBak();
    finish(1, "parse-report.js を実行できませんでした: " + r.error.message);
  }
  if (r.status !== 0) {
    restoreBak();
    finish(1, "パースに失敗しました。catches.json は直前の状態に戻しました");
  }
}

/* ---------- 3. 検証 ---------- */

function validateCatches() {
  if (!fs.existsSync(CATCHES_PATH)) {
    restoreBak();
    finish(1, "catches.json が見つかりません");
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(CATCHES_PATH, "utf8"));
  } catch (e) {
    restoreBak();
    finish(1, "catches.json が JSON として壊れています。直前の状態に戻しました");
  }
  if (!data || !Array.isArray(data.catches)) {
    restoreBak();
    finish(1, "catches.json に catches 配列がありません。直前の状態に戻しました");
  }
  if (!data.report || !data.report.surveyDate) {
    restoreBak();
    finish(1, "catches.json に調査日（report.surveyDate）がありません。直前の状態に戻しました");
  }

  const bad = data.catches.filter(
    (c) => !c || !/^\d{4}-\d{2}-\d{2}/.test(String(c.date || "")) || typeof c.species !== "string"
  );
  if (bad.length) {
    restoreBak();
    finish(1, "catches.json に不正なレコードが " + bad.length + " 件あります。直前の状態に戻しました");
  }

  log(
    "検証OK（レコード " + data.catches.length + " 件 / 調査日 " + data.report.surveyDate +
    " / 元レポート " + (data.report.file || "不明") + "）"
  );
}

function restoreBak() {
  try {
    if (fs.existsSync(BAK_PATH)) {
      fs.copyFileSync(BAK_PATH, CATCHES_PATH);
      log("catches.json を " + path.basename(BAK_PATH) + " から復元しました");
    } else {
      log("復元元（" + path.basename(BAK_PATH) + "）がありません。catches.json はそのままにします");
    }
  } catch (e) {
    log("catches.json の復元に失敗しました: " + e.message);
  }
}

/* ---------- 実行 ---------- */

console.log("===== " + ts() + " 釣果データ更新 開始 =====");
log("作業フォルダ: " + ROOT);

fetchReport();
parseReport();
validateCatches();

finish(0, "catches.json を更新しました（git 操作は行っていません。公開反映は手動で commit / push してください）");
