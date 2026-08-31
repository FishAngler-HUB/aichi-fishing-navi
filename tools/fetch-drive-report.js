/**
 * fetch-drive-report.js
 * -----------------------------------------------------------
 * Google Drive の「釣り情報」フォルダから、最新の
 *   aichi-fishing-report-YYYYMMDD.md
 * を 1 件だけ取得して data/reports/ に保存します。
 *
 * ・取得には rclone を使います（drive.readonly スコープで設定）。
 * ・Drive 側のファイルは一切変更・削除・移動しません（読み取りのみ）。
 * ・すでに同じファイルをローカルに持っている場合は再取得しません。
 * ・新しいレポートが無い場合や取得に失敗した場合は、何も書き換えません。
 *
 * 設定は tools/.env（Git 管理外）から読み込みます:
 *   RCLONE_EXE    = tools\rclone.exe      … rclone の場所（省略時は tools/rclone.exe → PATH の順で探す）
 *   RCLONE_REMOTE = gdrive                … rclone config で作ったリモート名（必須）
 *   RCLONE_PATH   = 釣り情報               … フォルダ名（省略時は「釣り情報」）
 *
 * 終了コード:
 *   0 = 新しいレポートを 1 件取得した        → 呼び出し側は parse-report.js を実行してよい
 *   3 = 変更なし（Drive に該当なし / 既に最新をローカル保持） → parse はスキップ
 *   1 = エラー（.env 未設定 / rclone 実行不可 / Drive 接続失敗 / 取得物が壊れている / 名前が想定外）
 *       → 何も変更していない
 *
 * 単体テスト:
 *   node tools/fetch-drive-report.js
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "data", "reports");
const ENV_PATH = path.join(__dirname, ".env");

// 取得対象のファイル名（これ以外は一切さわらない）
const NAME_RE = /^aichi-fishing-report-(\d{8})\.md$/;

const EXIT_OK = 0; // 新規取得あり
const EXIT_NOCHANGE = 3; // 変更なし
const EXIT_ERROR = 1; // エラー

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
  console.log("[" + ts() + "] fetch-drive-report: " + line);
}
function done(code, reason) {
  log(
    (code === EXIT_OK ? "取得OK" : code === EXIT_NOCHANGE ? "変更なし" : "中止") +
    "（終了コード " + code + "）" + (reason ? " : " + reason : "")
  );
  process.exit(code);
}

/* ---------- .env 読み込み（最小実装・依存なし） ---------- */

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  });
  return out;
}

/* ---------- rclone の場所を決める ---------- */

function resolveRcloneExe(env) {
  if (env.RCLONE_EXE) {
    const p = path.isAbsolute(env.RCLONE_EXE)
      ? env.RCLONE_EXE
      : path.join(ROOT, env.RCLONE_EXE);
    if (fs.existsSync(p)) return p;
    done(EXIT_ERROR, "RCLONE_EXE で指定された rclone が見つかりません: " + p);
  }
  const local = path.join(__dirname, "rclone.exe");
  if (fs.existsSync(local)) return local;
  // PATH 上の rclone を試す（spawn 時に見つからなければエラー処理する）
  return "rclone";
}

function runRclone(exe, args, opts) {
  // rclone 本体は rclone.exe（実行ファイル）。ただし scoop / choco などで
  // 入れると PATH 上が rclone.cmd（シム）のことがある。.cmd / .bat は
  // Node の spawn がそのまま実行できないため、その場合だけ shell 経由にし、
  // 引数はスペースを含んでも壊れないように個別にクオートする。
  const viaShell = /\.(cmd|bat)$/i.test(exe);
  const finalArgs = viaShell ? args.map((a) => '"' + String(a).replace(/"/g, '') + '"') : args;
  return spawnSync(exe, finalArgs, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: (opts && opts.timeout) || 90000,
    windowsHide: true,
    shell: viaShell,
  });
}

/* ---------- メイン ---------- */

function main() {
  log("開始");

  const env = loadEnv(ENV_PATH);
  if (!env.RCLONE_REMOTE) {
    done(
      EXIT_ERROR,
      "tools/.env が未設定です。RCLONE_REMOTE（rclone config で作ったリモート名）が必要です。" +
      "設定方法は tools/釣果データ自動取得の設定手順.md を参照してください。"
    );
  }
  const remote = env.RCLONE_REMOTE;
  const folder = (env.RCLONE_PATH || "釣り情報").replace(/^[\\/]+|[\\/]+$/g, "");
  const exe = resolveRcloneExe(env);
  const remotePath = remote + ":" + folder;

  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  // 1) フォルダ内のファイル一覧を JSON で取得（読み取りのみ）
  log("一覧取得: " + remotePath);
  const ls = runRclone(exe, ["lsjson", remotePath, "--files-only"]);

  if (ls.error) {
    if (ls.error.code === "ENOENT") {
      done(EXIT_ERROR, "rclone を実行できません（インストールと RCLONE_EXE を確認してください）: " + exe);
    }
    done(EXIT_ERROR, "rclone の実行に失敗しました: " + ls.error.message);
  }
  if (ls.status !== 0) {
    const err = (ls.stderr || ls.stdout || "").trim();
    done(
      EXIT_ERROR,
      "Drive のフォルダ一覧を取得できませんでした（リモート名 / フォルダ名 / 認証を確認）。\n" + err
    );
  }

  let items;
  try {
    items = JSON.parse(ls.stdout || "[]");
  } catch (e) {
    done(EXIT_ERROR, "rclone lsjson の出力を解釈できませんでした: " + e.message);
  }
  if (!Array.isArray(items)) {
    done(EXIT_ERROR, "rclone lsjson の出力が配列ではありません");
  }

  // 2) aichi-fishing-report-YYYYMMDD.md だけに絞る（フォルダ直下のファイルのみ）
  const reports = items
    .filter((it) => it && !it.IsDir && typeof it.Name === "string")
    .filter((it) => !it.Path || it.Path === it.Name) // サブフォルダ内は対象外
    .map((it) => {
      const m = NAME_RE.exec(it.Name);
      return m ? { name: it.Name, ymd: m[1], size: Number(it.Size) || 0 } : null;
    })
    .filter(Boolean);

  if (reports.length === 0) {
    done(EXIT_NOCHANGE, "Drive に aichi-fishing-report-*.md が見つかりません（新しいレポートなし）");
  }

  // 3) 最新（YYYYMMDD が最大）を選ぶ
  reports.sort((a, b) => (a.ymd < b.ymd ? 1 : a.ymd > b.ymd ? -1 : 0));
  const latest = reports[0];
  log("最新レポート: " + latest.name + "（" + latest.size + " bytes, Drive上）");

  // 5) すでに同じものをローカルに持っていれば再取得しない
  const localPath = path.join(REPORTS_DIR, latest.name);
  if (fs.existsSync(localPath)) {
    const localSize = fs.statSync(localPath).size;
    if (localSize === latest.size) {
      done(EXIT_NOCHANGE, "最新レポートは取得済みです（" + latest.name + "）");
    }
    log("ローカルに同名ファイルがありますがサイズが異なります（local " + localSize + " / drive " + latest.size + "）。取得し直します。");
  }

  // 4) 一時ファイルへコピー（Drive 側は読むだけ）
  const partPath = path.join(REPORTS_DIR, "." + latest.name + ".part");
  try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch (_) {}

  const src = remote + ":" + (folder ? folder + "/" : "") + latest.name;
  log("取得中: " + src);
  const cp = runRclone(exe, ["copyto", src, partPath, "--no-traverse"], { timeout: 120000 });

  if (cp.error || cp.status !== 0) {
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch (_) {}
    const err = (cp.stderr || cp.stdout || (cp.error && cp.error.message) || "").trim();
    done(EXIT_ERROR, "レポートの取得に失敗しました（catches.json は変更していません）。\n" + err);
  }

  // 6) 取得物の検証
  if (!fs.existsSync(partPath)) {
    done(EXIT_ERROR, "取得したはずのファイルが見つかりません: " + partPath);
  }
  const size = fs.statSync(partPath).size;
  let body = "";
  try {
    body = fs.readFileSync(partPath, "utf8");
  } catch (e) {
    try { fs.unlinkSync(partPath); } catch (_) {}
    done(EXIT_ERROR, "取得ファイルを読み込めませんでした: " + e.message);
  }
  const looksLikeReport =
    size >= 300 &&
    body.indexOf("釣果") !== -1 &&
    (body.indexOf("調査日") !== -1 || body.indexOf("釣り場別") !== -1 || /^#/m.test(body));

  if (!NAME_RE.test(latest.name) || !looksLikeReport) {
    try { fs.unlinkSync(partPath); } catch (_) {}
    done(
      EXIT_ERROR,
      "取得した Markdown がレポート形式ではない、またはファイル名が想定外です（" +
      latest.name + " / " + size + " bytes）。catches.json は変更していません。"
    );
  }

  // 正式なファイル名にリネームして確定
  fs.renameSync(partPath, localPath);
  log("保存しました: data/reports/" + latest.name + "（" + size + " bytes）");
  done(EXIT_OK, latest.name);
}

try {
  main();
} catch (e) {
  log("予期しないエラー: " + (e && e.stack ? e.stack : e));
  process.exit(EXIT_ERROR);
}
