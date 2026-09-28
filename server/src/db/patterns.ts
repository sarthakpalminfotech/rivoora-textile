/**
 * Programmatic textile patterns for demo data (no downloads).
 * Each function returns an 800×800 SVG for a given palette.
 */
export interface Palette {
  base: string;
  main: string;
  accent: string;
  light: string;
}

const S = 800;
const wrap = (body: string, bg: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="${bg}"/>${body}</svg>`;

/** Vertical stripes with thin gold pinstripes. */
function stripes(p: Palette) {
  let b = '';
  for (let x = 0; x < S; x += 100) {
    b += `<rect x="${x}" y="0" width="56" height="${S}" fill="${p.main}"/>`;
    b += `<rect x="${x + 66}" y="0" width="6" height="${S}" fill="${p.accent}"/>`;
    b += `<rect x="${x + 80}" y="0" width="3" height="${S}" fill="${p.light}"/>`;
  }
  return wrap(b, p.base);
}

/** Madras-style checks with translucent overlapping bands. */
function checks(p: Palette) {
  let b = '';
  for (let i = 0; i < S; i += 160) {
    b += `<rect x="${i}" y="0" width="80" height="${S}" fill="${p.main}" opacity="0.55"/>`;
    b += `<rect x="0" y="${i}" width="${S}" height="80" fill="${p.main}" opacity="0.55"/>`;
    b += `<rect x="${i + 110}" y="0" width="10" height="${S}" fill="${p.accent}" opacity="0.8"/>`;
    b += `<rect x="0" y="${i + 110}" width="${S}" height="10" fill="${p.accent}" opacity="0.8"/>`;
  }
  return wrap(b, p.base);
}

/** Paisley-like teardrops and dots on a grid. */
function paisley(p: Palette) {
  let b = '';
  let row = 0;
  for (let y = 60; y < S + 80; y += 140, row++) {
    for (let x = row % 2 ? 130 : 60; x < S + 80; x += 140) {
      b += `<g transform="translate(${x} ${y}) rotate(${row % 2 ? 30 : -20})">`;
      b += `<path d="M0 -44 C 34 -40 40 10 12 34 C -8 50 -34 30 -26 6 C -20 -12 4 -8 2 6 C 0 16 -12 14 -12 8" fill="none" stroke="${p.main}" stroke-width="7" stroke-linecap="round"/>`;
      b += `<path d="M0 -44 C 34 -40 40 10 12 34 C -8 50 -34 30 -26 6 C -30 -20 -18 -40 0 -44Z" fill="${p.main}" opacity="0.25"/>`;
      b += `<circle cx="-2" cy="4" r="7" fill="${p.accent}"/></g>`;
      b += `<circle cx="${x + 70}" cy="${y + 70}" r="6" fill="${p.accent}"/>`;
    }
  }
  return wrap(b, p.base);
}

/** Plain field with a temple border band of triangles and zigzags. */
function border(p: Palette) {
  let b = `<rect x="0" y="520" width="${S}" height="280" fill="${p.main}"/>`;
  b += `<rect x="0" y="540" width="${S}" height="10" fill="${p.accent}"/>`;
  b += `<rect x="0" y="770" width="${S}" height="10" fill="${p.accent}"/>`;
  for (let x = 0; x < S; x += 80) {
    b += `<polygon points="${x},700 ${x + 40},600 ${x + 80},700" fill="${p.accent}"/>`;
    b += `<polygon points="${x + 20},700 ${x + 40},650 ${x + 60},700" fill="${p.main}"/>`;
  }
  let z = '';
  for (let x = 0; x <= S; x += 40) z += `${x},${x % 80 ? 740 : 725} `;
  b += `<polyline points="${z}" fill="none" stroke="${p.light}" stroke-width="5"/>`;
  for (let y = 60; y < 500; y += 90)
    for (let x = (y / 90) % 2 ? 90 : 45; x < S; x += 90) b += `<circle cx="${x}" cy="${y}" r="7" fill="${p.accent}" opacity="0.9"/>`;
  return wrap(b, p.base);
}

/** Chevron / zigzag rows. */
function chevron(p: Palette) {
  let b = '';
  let i = 0;
  for (let y = -40; y < S + 80; y += 70, i++) {
    let pts = '';
    for (let x = 0; x <= S; x += 80) pts += `${x},${y + (x % 160 ? 40 : 0)} `;
    const color = i % 3 === 0 ? p.accent : i % 3 === 1 ? p.main : p.light;
    b += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${i % 3 === 0 ? 10 : 22}" stroke-linejoin="miter"/>`;
  }
  return wrap(b, p.base);
}

/** Small five-petal flower butti in a half-drop repeat. */
function butti(p: Palette) {
  let b = '';
  let row = 0;
  for (let y = 70; y < S + 60; y += 130, row++) {
    for (let x = row % 2 ? 135 : 70; x < S + 60; x += 130) {
      b += `<g transform="translate(${x} ${y})">`;
      for (let k = 0; k < 5; k++) {
        b += `<ellipse cx="0" cy="-18" rx="11" ry="18" fill="${p.main}" transform="rotate(${k * 72})"/>`;
      }
      b += `<circle r="9" fill="${p.accent}"/><circle r="4" fill="${p.light}"/></g>`;
      b += `<path d="M${x + 50} ${y + 55} q 8 -10 16 0 q -8 10 -16 0z" fill="${p.accent}" opacity="0.8"/>`;
    }
  }
  return wrap(b, p.base);
}

export const PATTERNS = { stripes, checks, paisley, border, chevron, butti };
export type PatternName = keyof typeof PATTERNS;
