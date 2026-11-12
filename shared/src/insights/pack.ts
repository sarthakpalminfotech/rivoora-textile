/**
 * Sprint 26 — rows without holes. Each card asks for a span (desktop 12 columns: small 3 · normal 4 · wide 6 · full 12;
 * tablet 3 / 2 columns). A row is filled in Arrange order; when the next card does not fit, a later card of the SAME
 * section that does fit moves up to fill the gap (the only reordering). A row that still has room is stretched: its
 * narrowest cards step up to the next standard width (6 + 4 → 6 + 6, 4 → 12), so every row ends at the right edge.
 */
export interface PackedCard {
  /** Index in the input list. */
  index: number;
  span: number;
}

export function packRows(spans: readonly number[], cols: number): PackedCard[][] {
  const left = spans.map((s, index) => ({ index, span: Math.max(1, Math.min(cols, s)) }));
  const rows: PackedCard[][] = [];
  while (left.length) {
    const row: PackedCard[] = [];
    let used = 0;
    for (let i = 0; i < left.length && used < cols; ) {
      if (used + left[i].span <= cols) {
        used += left[i].span;
        row.push(left.splice(i, 1)[0]);
      } else i += 1;
    }
    rows.push(stretch(row, cols));
  }
  return rows;
}

/** The widths a card may take: 12 columns → the standard small / normal / wide / full; tablet → every column count. */
const ladderOf = (cols: number) => (cols === 12 ? [3, 4, 6, 12] : Array.from({ length: cols }, (_, k) => k + 1));

function stretch(row: PackedCard[], cols: number): PackedCard[] {
  const out = row.map((c) => ({ ...c }));
  const ladder = ladderOf(cols);
  let used = out.reduce((s, c) => s + c.span, 0);
  // step the narrowest card up to the next standard width while it fits (6 + 4 → 6 + 6, 4 + 4 → 6 + 6, 4 → 12)
  while (used < cols) {
    const pick = [...out.keys()]
      .map((k) => ({ k, next: ladder.find((w) => w > out[k].span) }))
      .filter((x) => x.next !== undefined && used - out[x.k].span + x.next <= cols)
      .sort((a, b) => out[a.k].span - out[b.k].span || a.k - b.k)[0];
    if (!pick) break;
    used += pick.next! - out[pick.k].span;
    out[pick.k].span = pick.next!;
  }
  // whatever is still free goes to the last card (never leaves a hole)
  if (used < cols && out.length) out[out.length - 1].span += cols - used;
  return out;
}
