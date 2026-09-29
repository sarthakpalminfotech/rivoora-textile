import { describe, expect, it } from 'vitest';
import {
  coverageWarnings,
  describeFrameGroups,
  formatExactFrames,
  jobsheetQuantityWarning,
  planFramesEdit,
  planJobsheets,
  remainingPieces,
  type AdjustJobsheet,
} from './jobsheets';
import { SECTIONS_PER_BEAM } from './production';

/** n jobsheets numbered from `start`, each with `frames` frames (ids = numbers). */
function sheets(frames: number[], start = 1): AdjustJobsheet[] {
  return frames.map((f, i) => ({ id: start + i, jobsheetNo: start + i, frames: f }));
}

describe('planJobsheets (7.1)', () => {
  it('uses 3 sections per beam', () => {
    expect(SECTIONS_PER_BEAM).toBe(3);
  });

  it('300 pcs, 10 per jobsheet → 100 frames → 10 × 10', () => {
    const p = planJobsheets(300, 10)!;
    expect(p.totalFrames).toBe(100);
    expect(p.jobsheetCount).toBe(10);
    expect(p.frames).toEqual(Array(10).fill(10));
    expect(describeFrameGroups(p.frames)).toBe('10 × 10 frames');
  });

  it('300 pcs, 11 per jobsheet → 100 frames → 9 × 11 + 1 × 1', () => {
    const p = planJobsheets(300, 11)!;
    expect(p.totalFrames).toBe(100);
    expect(p.jobsheetCount).toBe(10);
    expect(p.frames).toEqual([...Array(9).fill(11), 1]);
    expect(describeFrameGroups(p.frames)).toBe('9 × 11 frames + 1 × 1 frame');
  });

  it('304 pcs, 10 per jobsheet → 102 frames (rounded up) → 10 × 10 + 1 × 2', () => {
    const p = planJobsheets(304, 10)!;
    expect(formatExactFrames(p.exactFrames)).toBe('101.33');
    expect(p.totalFrames).toBe(102);
    expect(p.jobsheetCount).toBe(11);
    expect(p.frames).toEqual([...Array(10).fill(10), 2]);
  });

  it('2 pcs, 5 per jobsheet → 1 frame → 1 × 1', () => {
    const p = planJobsheets(2, 5)!;
    expect(p.totalFrames).toBe(1);
    expect(p.jobsheetCount).toBe(1);
    expect(p.frames).toEqual([1]);
  });

  it('rejects non-positive or fractional inputs', () => {
    expect(planJobsheets(0, 10)).toBeNull();
    expect(planJobsheets(10, 0)).toBeNull();
    expect(planJobsheets(10.5, 2)).toBeNull();
  });
});

describe('planFramesEdit (7.4)', () => {
  it('normal adjust: the last jobsheet absorbs the change', () => {
    // F = 10, 10 × 10. #3 → 12 ⇒ last (#10) becomes 8.
    const p = planFramesEdit({ jobsheets: sheets(Array(10).fill(10)), editedId: 3, newFrames: 12, framesPerJobsheet: 10 });
    expect(p.editedIsLast).toBe(false);
    expect(p.updated).toEqual([
      { id: 3, jobsheetNo: 3, from: 10, to: 12, edited: true },
      { id: 10, jobsheetNo: 10, from: 10, to: 8, edited: false },
    ]);
    expect(p.created).toEqual([]);
    expect(p.removed).toEqual([]);
    expect(p.totalFramesAfter).toBe(100);
  });

  it('spec example: last grows past F and splits into one new jobsheet', () => {
    // After the first edit: #3 = 12, last = 8. Now #5 → 5 ⇒ last 8 + 5 = 13 > 10 ⇒ last 10 + new 3.
    const js = sheets([10, 10, 12, 10, 10, 10, 10, 10, 10, 8]);
    const p = planFramesEdit({ jobsheets: js, editedId: 5, newFrames: 5, framesPerJobsheet: 10 });
    expect(p.updated).toEqual([
      { id: 5, jobsheetNo: 5, from: 10, to: 5, edited: true },
      { id: 10, jobsheetNo: 10, from: 8, to: 10, edited: false },
    ]);
    expect(p.created).toEqual([{ frames: 3 }]);
    expect(p.removed).toEqual([]);
    expect(p.totalFramesAfter).toBe(100);
  });

  it('last grows past F and splits into several new jobsheets', () => {
    // F = 5, #1 goes 20 → 1 (delta −19) ⇒ last 5 + 19 = 24 → 5 + [5, 5, 5, 4].
    const js = sheets([20, 5]);
    const p = planFramesEdit({ jobsheets: js, editedId: 1, newFrames: 1, framesPerJobsheet: 5 });
    expect(p.updated).toEqual([{ id: 1, jobsheetNo: 1, from: 20, to: 1, edited: true }]); // last already = F
    expect(p.created).toEqual([{ frames: 5 }, { frames: 5 }, { frames: 5 }, { frames: 4 }]);
    expect(p.totalFramesAfter).toBe(25);
  });

  it('last reaching exactly 0 is removed', () => {
    const js = sheets([10, 10, 4]);
    const p = planFramesEdit({ jobsheets: js, editedId: 1, newFrames: 14, framesPerJobsheet: 10 });
    expect(p.updated).toEqual([{ id: 1, jobsheetNo: 1, from: 10, to: 14, edited: true }]);
    expect(p.removed).toEqual([{ id: 3, jobsheetNo: 3, frames: 4 }]);
    expect(p.created).toEqual([]);
    expect(p.totalFramesAfter).toBe(24);
  });

  it('last going below 0 removes only the last one (total then exceeds the target)', () => {
    const js = sheets([10, 10, 4]);
    const p = planFramesEdit({ jobsheets: js, editedId: 1, newFrames: 20, framesPerJobsheet: 10 });
    expect(p.removed).toEqual([{ id: 3, jobsheetNo: 3, frames: 4 }]);
    // #2 is untouched
    expect(p.updated.map((u) => u.id)).toEqual([1]);
    expect(p.totalFramesAfter).toBe(30);
    const warnings = coverageWarnings({ orderedPieces: 72, jobsheetPieces: 72, targetFrames: 24, totalFrames: 30, jobsheetCount: 2 });
    expect(warnings.map((w) => w.kind)).toEqual(['frames_over']);
  });

  it('F = null: the last just grows', () => {
    const js = sheets([10, 10]);
    const p = planFramesEdit({ jobsheets: js, editedId: 1, newFrames: 2, framesPerJobsheet: null });
    expect(p.updated).toEqual([
      { id: 1, jobsheetNo: 1, from: 10, to: 2, edited: true },
      { id: 2, jobsheetNo: 2, from: 10, to: 18, edited: false },
    ]);
    expect(p.created).toEqual([]);
  });

  it('editing the last jobsheet changes nothing else', () => {
    const js = sheets([10, 10, 10]);
    const less = planFramesEdit({ jobsheets: js, editedId: 3, newFrames: 7, framesPerJobsheet: 10 });
    expect(less.editedIsLast).toBe(true);
    expect(less.updated).toEqual([{ id: 3, jobsheetNo: 3, from: 10, to: 7, edited: true }]);
    expect(less.created).toEqual([]);
    expect(less.removed).toEqual([]);
    expect(less.totalFramesAfter).toBe(27);

    const more = planFramesEdit({ jobsheets: js, editedId: 3, newFrames: 25, framesPerJobsheet: 10 });
    expect(more.created).toEqual([]);
    expect(more.totalFramesAfter).toBe(45);
  });

  it('works when jobsheet numbers are not contiguous and unsorted', () => {
    const js: AdjustJobsheet[] = [
      { id: 50, jobsheetNo: 330, frames: 10 },
      { id: 40, jobsheetNo: 320, frames: 10 },
      { id: 45, jobsheetNo: 325, frames: 10 },
    ];
    const p = planFramesEdit({ jobsheets: js, editedId: 45, newFrames: 12, framesPerJobsheet: 10 });
    expect(p.last.jobsheetNo).toBe(330);
    expect(p.updated[1]).toEqual({ id: 50, jobsheetNo: 330, from: 10, to: 8, edited: false });
  });

  it('no change when frames are the same', () => {
    const p = planFramesEdit({ jobsheets: sheets([10, 10]), editedId: 1, newFrames: 10, framesPerJobsheet: 10 });
    expect(p.updated).toEqual([]);
  });
});

describe('coverage (7.5)', () => {
  it('no warnings when everything matches or there are no jobsheets', () => {
    expect(coverageWarnings({ orderedPieces: 300, jobsheetPieces: 300, targetFrames: 100, totalFrames: 100, jobsheetCount: 10 })).toEqual([]);
    expect(coverageWarnings({ orderedPieces: 300, jobsheetPieces: 0, targetFrames: 0, totalFrames: 0, jobsheetCount: 0 })).toEqual([]);
  });

  it('pieces and frames messages', () => {
    const w = coverageWarnings({ orderedPieces: 300, jobsheetPieces: 304, targetFrames: 102, totalFrames: 95, jobsheetCount: 10 });
    expect(w.map((x) => x.message)).toEqual([
      'Jobsheet quantity (304 pcs) is more than the order (300 pcs).',
      'Jobsheets cover 95 frames, but 102 frames are needed (7 short).',
    ]);
    const w2 = coverageWarnings({ orderedPieces: 300, jobsheetPieces: 290, targetFrames: 100, totalFrames: 103, jobsheetCount: 11 });
    expect(w2.map((x) => x.message)).toEqual([
      'Jobsheet quantity (290 pcs) is less than the order (300 pcs).',
      'Jobsheets cover 103 frames, which is 3 more than the 100 needed.',
    ]);
  });

  it('jobsheet quantity warning in the forms', () => {
    expect(jobsheetQuantityWarning(300, 0, 290)).toBe(
      'This makes the jobsheet quantity 290 pcs — 10 less than the order (300 pcs).',
    );
    expect(jobsheetQuantityWarning(300, 300, 4)).toBe(
      'This makes the jobsheet quantity 304 pcs — 4 more than the order (300 pcs).',
    );
    expect(jobsheetQuantityWarning(300, 100, 200)).toBeNull();
  });

  it('remaining pieces prefill', () => {
    expect(remainingPieces(300, 0)).toBe(300);
    expect(remainingPieces(300, 120)).toBe(180);
    expect(remainingPieces(300, 304)).toBeNull();
  });
});
