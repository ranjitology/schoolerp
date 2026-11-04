#!/usr/bin/env node
/**
 * Generates the 1024x1024 source icon used by `tauri icon`.
 * Kept in the repo so the branded icon can be regenerated without design tools.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const size = 1024;
const radius = 180;
const brand = [27, 111, 245];
const white = [255, 255, 255];

const pixels = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y += 1) {
  const row = y * (size * 4 + 1);
  pixels[row] = 0; // filter: none
  for (let x = 0; x < size; x += 1) {
    const offset = row + 1 + x * 4;
    const inside = roundedRect(x, y, radius);
    const isE =
      inside &&
      ((x >= 300 && x < 392 && y >= 280 && y < 744) ||
        (x >= 300 && x < 720 && y >= 280 && y < 372) ||
        (x >= 300 && x < 676 && y >= 456 && y < 548) ||
        (x >= 300 && x < 720 && y >= 652 && y < 744));
    const color = isE ? white : brand;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = inside ? 255 : 0;
  }
}

function roundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), size - 1 - r);
  const cy = Math.min(Math.max(y, r), size - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/icons/source.png');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png);
console.log(`Wrote ${target} (${png.length} bytes)`);
