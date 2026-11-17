/**
 * Generates every app icon from the SVG design below. Re-run after changing it:
 *   node scripts/generate-icons.ts
 *
 * Outputs (all committed):
 *   app/icon.svg              favicon for modern browsers (Next serves it)
 *   app/favicon.ico           16/32/48 px fallback for older browsers
 *   app/apple-icon.png        180 px iOS home-screen icon (full-bleed; iOS rounds it)
 *   public/icons/icon-*.png   web manifest icons; maskable = full-bleed variant
 *   public/icons/badge-96.png monochrome Android notification badge
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BACKGROUND = '#1c1917'; // stone-900
const SUN = '#fbbf24'; // amber-400
const HORIZON = '#fafaf9'; // stone-50
const TEXT_LINE = '#a8a29e'; // stone-400

type Variant = 'rounded' | 'full-bleed' | 'badge';

// Sunrise over a horizon, with a "news line" beneath. All shapes sit within
// the maskable safe zone (a centred circle of radius 0.4 × size).
function iconSvg(variant: Variant): string {
  const badge = variant === 'badge';
  const background = badge
    ? ''
    : `<rect width="512" height="512" rx="${variant === 'rounded' ? 112 : 0}" fill="${BACKGROUND}"/>`;
  const fill = (color: string): string => (badge ? '#ffffff' : color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${background}
  <path d="M136 262a120 120 0 0 1 240 0z" fill="${fill(SUN)}"/>
  <rect x="96" y="290" width="320" height="28" rx="14" fill="${fill(HORIZON)}"/>
  ${badge ? '' : `<rect x="160" y="346" width="192" height="24" rx="12" fill="${TEXT_LINE}"/>`}
</svg>
`;
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
console.log('icons written');
