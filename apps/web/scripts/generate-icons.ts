/**
 * Generates every app icon from the mark in @panorist/core/brand. Re-run after
 * changing it:
 *   node scripts/generate-icons.ts
 *
 * Outputs (all committed):
 *   app/icon.svg              favicon for modern browsers (Next serves it)
 *   app/favicon.ico           16/32/48 px fallback for older browsers
 *   app/apple-icon.png        180 px iOS home-screen icon (full-bleed; iOS rounds it)
 *   public/icons/icon-*.png   web manifest icons; maskable = full-bleed variant
 *   public/icons/badge-96.png monochrome Android notification badge
 *   ../mobile/assets/         Expo app icon, Android adaptive foreground, splash
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

import { markShapes, tile } from '@panorist/core/brand';

type Variant = 'rounded' | 'full-bleed' | 'badge' | 'adaptive-foreground';

// All shapes sit within the maskable safe zone (a centred circle of radius
// 0.4 × size). Android adaptive foregrounds are cropped harder (a 66/108
// circle), so that variant shrinks the mark and leaves the ground to app.json.
function iconSvg(variant: Variant): string {
  const background =
    variant === 'rounded' || variant === 'full-bleed'
      ? `<rect width="512" height="512" rx="${variant === 'rounded' ? tile.radius : 0}" fill="${tile.background}"/>`
      : '';
  const shapes =
    variant === 'badge'
      ? // Column lines are too thin to read at badge size.
        markShapes({ sun: '#ffffff', horizon: '#ffffff', lines: 'none' })
      : markShapes(tile);
  const body =
    variant === 'adaptive-foreground'
      ? `<g transform="translate(256 256) scale(0.72) translate(-256 -256)">${shapes}</g>`
      : shapes;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${background}${body}</svg>\n`;
}

const png = (svg: string, size: number): Promise<Buffer> =>
  sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toBuffer();

/** ICO container holding PNG images (supported by every browser since IE Vista). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0); // 0 means 256
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const rounded = iconSvg('rounded');
const fullBleed = iconSvg('full-bleed');

mkdirSync('public/icons', { recursive: true });
writeFileSync('app/icon.svg', rounded);
writeFileSync(
  'app/favicon.ico',
  ico(
    await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) }))),
  ),
);
writeFileSync('app/apple-icon.png', await png(fullBleed, 180));
writeFileSync('public/icons/icon-192.png', await png(rounded, 192));
writeFileSync('public/icons/icon-512.png', await png(rounded, 512));
writeFileSync('public/icons/icon-maskable-512.png', await png(fullBleed, 512));
writeFileSync('public/icons/badge-96.png', await png(iconSvg('badge'), 96));
writeFileSync('../mobile/assets/icon.png', await png(fullBleed, 1024));
writeFileSync(
  '../mobile/assets/adaptive-icon.png',
  await png(iconSvg('adaptive-foreground'), 1024),
);
writeFileSync('../mobile/assets/splash-icon.png', await png(rounded, 512));
console.log('icons written');
