/**
 * update-forecast.js
 * -----------------------------------------------------------
 * 毎朝の自動更新の本体。次の順で実行します。
 *
 *   1. node tools/fetch-forecast.js  … Open-Meteo から天気・海況を取得
 *   2. data/forecast.json を検証     … 空・壊れ・古い・釣り場不足なら中止
 *   3. git add data/forecast.json
 *   4. 変更があれば git commit
 *   5. origin があれば git push
 *
 * 安全策:
 *   ・取得に失敗（fetch-forecast.js が異常終了）したら、以降へ進みません。
 *   ・検証に失敗したら、git 操作へ進みません。
 *   ・git add するのは data/forecast.json だけ（他の編集中ファイルを巻き込まない）。
 *   ・git 未設定 / origin 未設定なら、push はスキップして正常終了（ローカルは更新済み）。
 *
 * ログ: tools/fetch.log に追記します（実行方法にかかわらず）。
 * 実行方法:
 *   手動 : npm run update:forecast   （または tools/run-update.bat をダブルクリック）
 *   自動 : タスクスケジューラから tools/run-update.bat を実行
 *
 * 終了コード: 0 = 成功またはスキップ / 0以外 = 失敗（push まで到達せず）
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const FORECAST_PATH = path.join(ROOT, "data", "forecast.json");
const SPOTS_PATH = path.join(ROOT, "data", "spots.json");

const MIN_SPOTS_RATIO = 0.8; // forecast.json に必要な釣り場数の割合

/* ---------- ログ ---------- */

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

// ログは標準出力に書く。tools/run-update.bat が fetch.log へ追記（リダイレクト）する。
// 手動実行（npm run update:forecast）では画面にそのまま表示される。
function log(line) {
  console.log("[" + ts() + "] " + line);
}

function logBlock(title, text) {
  if (!text) return;
  const body = String(text).trimEnd();
  if (!body) return;
  console.log("----- " + title + " -----");
  console.log(body);
}

function finish(code, reason) {
  log(
    (code === 0 ? "完了" : "中止") +
    "（終了コード " + code + "）" + (reason ? " : " + reason : "")
  );
  process.exit(code);
}

/* ---------- git ヘルパー ---------- */

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function isGitRepo() {
  const r = git(["rev-parse", "--is-inside-work-tree"]);
  return r.status === 0 && String(r.stdout).trim() === "true";
}

function hasOrigin() {
  const r = git(["remote"]);
  return r.status === 0 && String(r.stdout).split(/\r?\n/).includes("origin");
}

function ensureGitIdentity() {
  const email = git(["config", "user.email"]);
  const name = git(["config", "user.name"]);
  if (String(email.stdout).trim() && String(name.stdout).trim()) return;
  // 未設定なら、このリポジトリ限定で最低限の identity を設定する
  if (!String(name.stdout).trim()) git(["config", "user.name", "fishing-navi auto"]);
  if (!String(email.stdout).trim())
    git(["config", "user.email", "haruban0102@gmail.com"]);
  log("git のコミット名が未設定だったため、このリポジトリ用に設定しました。");
}

/* ---------- 1. 取得 ---------- */

function runFetch() {
  log("天気・海況データの取得を開始します（tools/fetch-forecast.js）");
  const r = spawnSync(process.execPath, [path.join(__dirname, "fetch-forecast.js")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  logBlock("fetch-forecast.js の出力", (r.stdout || "") + (r.stderr || ""));
  if (r.status !== 0) {
    finish(1, "天気データの取得に失敗しました（forecast.json は更新されていません）");
  }
  log("天気・海況データの取得に成功しました");
}

/* ---------- 2. 検証 ---------- */

function validateForecast() {
  if (!fs.existsSync(FORECAST_PATH)) {
    finish(1, "forecast.json が見つかりません");
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(FORECAST_PATH, "utf8"));
  } catch (e) {
    finish(1, "forecast.json が壊れています（JSON として読めません）");
  }
  if (!data || typeof data !== "object" || !data.spots || typeof data.spots !== "object") {
    finish(1, "forecast.json の中身が不正です（spots がありません）");
  }

  const spotIds = Object.keys(data.spots);
  let expected = spotIds.length;
  try {
    const s = JSON.parse(fs.readFileSync(SPOTS_PATH, "utf8"));
    expected = (s.spots || s).length;
  } catch (e) {}
  if (spotIds.length < Math.ceil(expected * MIN_SPOTS_RATIO)) {
    finish(
      1,
      "forecast.json の釣り場数が不足しています（" + spotIds.length + " / " + expected + "）"
    );
  }

  // 少なくとも半数以上の釣り場で、先頭の日付が「今日または前日」であること
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let fresh = 0;
  spotIds.forEach((id) => {
    const days = (data.spots[id] && data.spots[id].days) || [];
    if (!days.length) return;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(days[0].date || ""));
    if (!m) return;
    const d0 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const ageDays = Math.round((t0 - d0) / 86400000);
    if (ageDays <= 1 && ageDays >= -1) fresh++;
  });
  if (fresh < spotIds.length / 2) {
    finish(
      1,
      "forecast.json の日付が古いようです（新しい釣り場 " + fresh + " / " + spotIds.length + "）"
    );
  }

  log(
    "forecast.json 検証OK（釣り場 " + spotIds.length + " / 新しい日付 " + fresh +
    " / generatedAt " + (data.generatedAt || "不明") + "）"
  );
}

/* ---------- 3〜5. git ---------- */

function commitAndPush() {
  if (!isGitRepo()) {
    finish(
      0,
      "ここは git リポジトリではないため、forecast.json のローカル更新のみ完了しました" +
      "（GitHub 公開設定後は commit / push まで自動で行われます）"
    );
  }

  ensureGitIdentity();

  // forecast.json だけをステージする（他の編集中ファイルを巻き込まない）
  const add = git(["add", "--", "data/forecast.json"]);
  if (add.status !== 0) {
    logBlock("git add の出力", (add.stdout || "") + (add.stderr || ""));
    finish(1, "git add に失敗しました");
  }

  // 変更が無ければ commit しない
  const diff = git(["diff", "--cached", "--quiet", "--", "data/forecast.json"]);
  if (diff.status === 0) {
    finish(0, "forecast.json に変更がなかったため commit はスキップしました");
  }

  const message = "chore: update forecast.json (auto " + ts() + ")";
  const commit = git(["commit", "-m", message, "--", "data/forecast.json"]);
  logBlock("git commit の出力", (commit.stdout || "") + (commit.stderr || ""));
  if (commit.status !== 0) {
    finish(1, "git commit に失敗しました");
  }
  log("git commit 成功: " + message);

  if (!hasOrigin()) {
    finish(
      0,
      "リモート（origin）が未設定のため push はスキップしました。" +
      "ローカルには commit 済みです。GitHub リポジトリ作成後に origin を追加してください"
    );
  }

  const push = git(["push"]);
  logBlock("git push の出力", (push.stdout || "") + (push.stderr || ""));
  if (push.status !== 0) {
    finish(1, "git push に失敗しました（認証やネットワークを確認してください）");
  }
  log("git push 成功。数分後に GitHub Pages へ反映されます");
}

/* ---------- 実行 ---------- */

console.log("===== " + ts() + " 自動更新 開始 =====");
log("自動更新を開始します（作業フォルダ: " + ROOT + "）");

runFetch();
validateForecast();
commitAndPush();

finish(0, "すべて正常に完了しました");
