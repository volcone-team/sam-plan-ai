// One-off (re-runnable) favicon generator.
//
//   node scripts/gen-favicons.mjs
//
// Source: public/image.png (navy circle with arrow/dot on a light-grey square).
// Outputs (Next.js App Router metadata file conventions):
//   src/app/icon.png        512x512, transparent outside the circle
//   src/app/apple-icon.png  180x180, opaque navy square, circle at ~85%
//   src/app/favicon.ico     16/32/48 px PNG entries, transparent circle
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "public/image.png");
const OUT = path.join(root, "src/app");

// Pixels differing from the background by more than this (max channel delta)
// count as part of the circle.
const BG_THRESHOLD = 40;
// Pull the mask in slightly so the anti-aliased grey edge of the source is cut.
const MASK_INSET = 1.5;

const { data, info } = await sharp(SRC)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const px = (x, y) => {
  const i = (y * W + x) * C;
  return [data[i], data[i + 1], data[i + 2]];
};
const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

// 1. Background colour: corners and edge midpoints should all agree.
const samples = {
  "top-left": px(0, 0),
  "top-right": px(W - 1, 0),
  "bottom-left": px(0, H - 1),
  "bottom-right": px(W - 1, H - 1),
  "top-mid": px(W >> 1, 0),
  "bottom-mid": px(W >> 1, H - 1),
  "left-mid": px(0, H >> 1),
  "right-mid": px(W - 1, H >> 1),
};
console.log(`source ${W}x${H}, ${C} channels`);
for (const [k, v] of Object.entries(samples)) console.log(`  ${k.padEnd(12)} ${hex(v)}`);
const bg = [0, 1, 2].map((c) => Math.round(Object.values(samples).reduce((s, v) => s + v[c], 0) / 8));
console.log(`background ≈ ${hex(bg)}`);

// 2. Bounding box of non-background pixels.
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = px(x, y);
    const d = Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2]));
    if (d > BG_THRESHOLD) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) throw new Error("No circle found in source image");
const bw = maxX - minX + 1;
const bh = maxY - minY + 1;
console.log(`circle bbox x ${minX}..${maxX}, y ${minY}..${maxY} (${bw}x${bh})`);
if (Math.abs(bw - bh) > 4) console.warn(`  warning: bbox is not square (${bw} vs ${bh})`);

// Square crop centred on the bbox.
const side = Math.max(bw, bh);
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const left = Math.max(0, Math.round(cx - side / 2));
const top = Math.max(0, Math.round(cy - side / 2));
const S = Math.min(side, W - left, H - top);
console.log(`crop ${S}x${S} at (${left}, ${top})`);

// 3. Navy: median of pixels on a ring at 93% radius (outside the arrow/dot).
const ring = [];
const r0 = (S / 2) * 0.93;
for (let a = 0; a < 360; a += 2) {
  const t = (a * Math.PI) / 180;
  ring.push(px(Math.round(cx + r0 * Math.cos(t)), Math.round(cy + r0 * Math.sin(t))));
}
const navy = [0, 1, 2].map((c) => {
  const vals = ring.map((p) => p[c]).sort((a, b) => a - b);
  return vals[vals.length >> 1];
});
console.log(`navy (ring median) ${hex(navy)}`);

// 4. Circular alpha mask -> square RGBA master.
const r = S / 2 - MASK_INSET;
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">` +
    `<circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="#fff"/></svg>`,
);
// Crop in its own pass: sharp applies removeAlpha() at the END of a pipeline,
// so chaining it with the mask composite would strip the mask again.
const cropped = await sharp(SRC)
  .removeAlpha()
  .extract({ left, top, width: S, height: S })
  .png()
  .toBuffer();
const master = await sharp(cropped)
  .ensureAlpha()
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toBuffer();

const resized = (size, sharpen = false) => {
  let img = sharp(master).resize(size, size, { kernel: "lanczos3" });
  if (sharpen) img = img.sharpen({ sigma: 0.5 });
  return img.png({ compressionLevel: 9 }).toBuffer();
};

// icon.png
const iconPath = path.join(OUT, "icon.png");
writeFileSync(iconPath, await resized(512));

// apple-icon.png: opaque navy square with the circle at 85%.
const APPLE = 180;
const inner = Math.round(APPLE * 0.85);
const offset = Math.round((APPLE - inner) / 2);
const applePath = path.join(OUT, "apple-icon.png");
const apple = await sharp({
  create: { width: APPLE, height: APPLE, channels: 3, background: { r: navy[0], g: navy[1], b: navy[2] } },
})
  .composite([{ input: await resized(inner), left: offset, top: offset }])
  .png({ compressionLevel: 9 })
  .toBuffer();
// Flatten in a second pass so the output is guaranteed 3-channel (opaque).
writeFileSync(applePath, await sharp(apple).removeAlpha().png({ compressionLevel: 9 }).toBuffer());

// favicon.ico: ICONDIR + ICONDIRENTRY[] + PNG payloads.
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map((s) => resized(s, s <= 32)));
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type 1 = icon
header.writeUInt16LE(pngs.length, 4);
let dataOffset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + 16 * i;
  const s = icoSizes[i];
  header.writeUInt8(s >= 256 ? 0 : s, e); // width
  header.writeUInt8(s >= 256 ? 0 : s, e + 1); // height
  header.writeUInt8(0, e + 2); // palette colours
  header.writeUInt8(0, e + 3); // reserved
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(dataOffset, e + 12);
  dataOffset += png.length;
});
const icoPath = path.join(OUT, "favicon.ico");
writeFileSync(icoPath, Buffer.concat([header, ...pngs]));

console.log("wrote", [iconPath, applePath, icoPath].map((p) => path.relative(root, p)).join(", "));
