// PWA 아이콘(PNG) 생성기 — 의존성 없이 zlib 으로 직접 인코딩합니다.
//   node tools/make-icons.mjs
// 뷰파인더(코너 브래킷) + 가운데 점 = "화면을 인식한다" 는 뜻의 단순한 도형.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x0e, 0x11, 0x17];      // --bg
const ACCENT = [0x6e, 0xa8, 0xfe];  // --accent
const DOT = [0x7e, 0xe0, 0xb8];     // --accent-2

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      raw[row + 1 + x * 3] = p[0];
      raw[row + 2 + x * 3] = p[1];
      raw[row + 3 + x * 3] = p[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = new Array(size * size).fill(BG);
  const put = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < size && y < size) px[y * size + x] = c;
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(Math.round(x), Math.round(y), c);
  };

  // 코너 브래킷 (마스커블 안전영역 안쪽으로)
  const inset = size * 0.24;
  const t = Math.max(2, size * 0.05);   // 선 두께
  const arm = size * 0.15;              // 팔 길이
  const far = size - inset;
  for (const [cx, cy, sx, sy] of [
    [inset, inset, 1, 1],
    [far, inset, -1, 1],
    [inset, far, 1, -1],
    [far, far, -1, -1],
  ]) {
    const x = sx > 0 ? cx : cx - t;
    const y = sy > 0 ? cy : cy - t;
    rect(sx > 0 ? x : x - arm + t, y, arm, t, ACCENT);            // 가로 팔
    rect(x, sy > 0 ? y : y - arm + t, t, arm, ACCENT);            // 세로 팔
  }

  // 가운데 점
  const r = size * 0.085;
  const c = size / 2;
  for (let y = Math.floor(c - r); y <= Math.ceil(c + r); y++) {
    for (let x = Math.floor(c - r); x <= Math.ceil(c + r); x++) {
      if ((x - c + 0.5) ** 2 + (y - c + 0.5) ** 2 <= r * r) put(x, y, DOT);
    }
  }
  return px;
}

mkdirSync('icons', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`icons/icon-${size}.png`, png(size, draw(size)));
  console.log(`icons/icon-${size}.png`);
}
