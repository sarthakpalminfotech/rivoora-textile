import type { DashboardLayout, LayoutCard } from '@rivoora/shared';

/**
 * Sprint 25 (C11) — Arrange: pure edits of a dashboard layout. ↑ / ↓ move a card within its section and on across the
 * section edge into the previous / next section; drag drops a card before another card or at the end of a section.
 */

const clone = (l: DashboardLayout): DashboardLayout => ({ sections: l.sections.map((s) => ({ ...s, cards: s.cards.map((c) => ({ ...c })) })) });

export function findCard(l: DashboardLayout, id: string): { s: number; i: number } | null {
  for (let s = 0; s < l.sections.length; s++) {
    const i = l.sections[s].cards.findIndex((c) => c.id === id);
    if (i >= 0) return { s, i };
  }
  return null;
}

/** Can the card move up / down (across sections too)? */
export function canMove(l: DashboardLayout, id: string, dir: -1 | 1): boolean {
  const at = findCard(l, id);
  if (!at) return false;
  if (dir === -1) return at.i > 0 || at.s > 0;
  return at.i < l.sections[at.s].cards.length - 1 || at.s < l.sections.length - 1;
}

export function moveCard(l: DashboardLayout, id: string, dir: -1 | 1): DashboardLayout {
  const out = clone(l);
  const at = findCard(out, id);
  if (!at) return l;
  const cards = out.sections[at.s].cards;
  const [card] = cards.splice(at.i, 1);
  if (dir === -1) {
    if (at.i > 0) cards.splice(at.i - 1, 0, card);
    else if (at.s > 0) out.sections[at.s - 1].cards.push(card);
    else cards.unshift(card);
  } else if (at.i < cards.length) cards.splice(at.i + 1, 0, card);
  else if (at.s < out.sections.length - 1) out.sections[at.s + 1].cards.unshift(card);
  else cards.push(card);
  return out;
}

/** Drop `id` before `beforeId` (or at the end of `sectionKey` when `beforeId` is null). */
export function dropCard(l: DashboardLayout, id: string, target: { beforeId: string | null; sectionKey: string }): DashboardLayout {
  if (id === target.beforeId) return l;
  const out = clone(l);
  const at = findCard(out, id);
  if (!at) return l;
  const [card] = out.sections[at.s].cards.splice(at.i, 1);
  const sec = out.sections.find((s) => s.key === target.sectionKey);
  if (!sec) return l;
  const idx = target.beforeId ? sec.cards.findIndex((c) => c.id === target.beforeId) : -1;
  if (idx >= 0) sec.cards.splice(idx, 0, card);
  else sec.cards.push(card);
  return out;
}

export function patchCard(l: DashboardLayout, id: string, patch: Partial<LayoutCard>): DashboardLayout {
  return { sections: l.sections.map((s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) })) };
}

export function renameSection(l: DashboardLayout, key: string, title: string): DashboardLayout {
  return { sections: l.sections.map((s) => (s.key === key ? { ...s, title } : s)) };
}

export const sameLayout = (a: DashboardLayout | null | undefined, b: DashboardLayout | null | undefined) => JSON.stringify(a) === JSON.stringify(b);
