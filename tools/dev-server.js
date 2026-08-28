/**
 * dev-server.js
 * -----------------------------------------------------------
 * ローカルで表示確認するための簡易 HTTP サーバー（開発用のみ）。
 * ブラウザで file:// を開くと data/*.json を読み込めないため、これを使います。
 *
 * 使い方:
 *   node tools/dev-server.js
 *   → ブラウザで http://localhost:5500 を開く
 *
 * ・依存ライブラリなし（Node 標準モジュールのみ）
 * ・GitHub Pages 公開時にはこのファイルは不要です
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5500;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // ルート外へのアクセスを防ぐ
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: " + urlPath);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log("[dev-server] http://localhost:" + PORT + "  (Ctrl+C で終了)");
});
