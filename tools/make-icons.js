/**
 * make-icons.js
 * -----------------------------------------------------------
 * アプリのアイコン画像（PNG）を生成するローカル実行専用スクリプト。
 * 依存ライブラリなし（Node 標準の zlib のみ）。
 *
 * 出力:
 *   icons/icon-192.png       … manifest 用
 *   icons/icon-512.png       … manifest 用
 *   icons/apple-touch-icon.png (180) … iOS のホーム画面追加用
 *
 * デザイン: 紺色の背景に「釣りウキ（上=赤 / 下=白）」。
 * 作り直したいときだけ実行すればOK（通常は再実行不要）。
 *
 * 使い方: node tools/make-icons.js
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "icons");

/* ---- CRC32（PNG チャンク用） ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/* ---- 1ピクセルの色を決める ---- */
function pixel(x, y, N) {
  const cx = N / 2;
  const cy = N / 2;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const r = N * 0.34;

  // 背景（紺）
  let col = [30, 95, 140];

  if (dist <= r) {
    // ウキ本体
    if (dy < -r * 0.12) col = [214, 75, 61]; // 上部＝赤
    else col = [245, 246, 247]; // 下部＝白
    // ふち
    if (dist >= r - Math.max(2, N * 0.012)) col = [18, 58, 88];
  }

  // 水面のライン（下寄り）
  const waterY = N * 0.76;
  if (y >= waterY && y < waterY + Math.max(2, N * 0.02) && dist > r) {
    col = [70, 140, 180];
  }

  return col;
}

function makePng(N) {
  // raw: 各行 = フィルタバイト(0) + RGB×N
  const stride = 1 + N * 3;
  const raw = Buffer.alloc(stride * N);
  for (let y = 0; y < N; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < N; x++) {
      const [r, g, b] = pixel(x, y, N);
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
];
for (const [name, size] of targets) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, makePng(size));
  console.log("wrote " + path.relative(path.join(__dirname, ".."), p) + " (" + size + "x" + size + ")");
}
