import { describe, expect, it } from 'vitest';
import {
  coverageWarnings,
  jobsheetPcs,
  jobsheetQuantityWarning,
  latestSections,
  orderJobsheetPlan,
  planFramesEdit,
  planJobsheets,
  remainingPieces,
  type AdjustJobsheet,
} from './jobsheets';
import { buildOrderDashboard, type DashboardJobsheetInput } from './orderDashboard';
import { orderInventoryPcs } from './inventory';
import {
  bulkRowProblems,
  orderQualityGroups,
  otherQualitiesHint,
  parseQualityParam,
  qualityOnPick,
  type BulkDesignRow,
} from './designs';
import { designBulkSchema, designInputSchema, jobsheetGenerateSchema, jobsheetSingleSchema, jobsheetUpdateSchema, orderCreateSchema } from './schemas';

const NOW = new Date('2026-10-26T12:00:00.000Z');

/* ------------------------------------------------------------------ */
/* §3 sections per beam                                                */
/* ------------------------------------------------------------------ */

describe('sections per beam — planJobsheets', () => {
  it('304 pcs ÷ 4 sections = 76 frames, split by frames per jobsheet', () => {
    const p = planJobsheets(304, 20, 4)!;
    expect(p).toMatchObject({ sections: 4, exactFrames: 76, totalFrames: 76, jobsheetCount: 4, frames: [20, 20, 20, 16] });
  });
  it('default stays 3; invalid sections give no plan', () => {
    expect(planJobsheets(300, 10)!.totalFrames).toBe(100);
    expect(planJobsheets(300, 10, 0)).toBeNull();
    expect(planJobsheets(300, 10, 13)).toBeNull();
    expect(planJobsheets(300, 10, 2.5)).toBeNull();
  });
});

describe('sections per beam — mixed jobsheets in one order', () => {
  // Run 1: 3 sections, 50 frames = 150 pcs. Run 2: 4 sections, 38 frames = 152 pcs. Order 300 pcs.
  const mixed = [
    { jobsheetNo: 10, frames: 50, sections: 3 },
    { jobsheetNo: 11, frames: 38, sections: 4 },
  ];

  it('jobsheet pcs = Σ frames × each jobsheet’s sections; frames needed use the latest run', () => {
    const plan = orderJobsheetPlan(300, mixed);
    expect(plan).toMatchObject({ jobsheetPieces: 302, totalFrames: 88, sections: 4, targetFrames: 75 });
    // 302 covers 300 by less than one frame of 4 → on target, no warnings.
    expect(coverageWarnings(plan)).toEqual([]);
  });

  it('a short mixed plan warns in pcs and in frames of the latest run', () => {
    const plan = orderJobsheetPlan(300, [mixed[0], { jobsheetNo: 11, frames: 30, sections: 4 }]);
    expect(plan.jobsheetPieces).toBe(270);
    expect(coverageWarnings(plan).map((w) => w.message)).toEqual([
      'Jobsheet quantity (270 pcs) is less than the order (300 pcs).',
      'Jobsheets cover 80 frames, but 88 frames are needed (8 short).',
    ]);
  });

  it('latest run = highest jobsheet number; no jobsheets = default 3', () => {
    expect(latestSections([{ jobsheetNo: 12, sections: 5 }, { jobsheetNo: 11, sections: 4 }])).toBe(5);
    expect(latestSections([])).toBe(3);
    expect(orderJobsheetPlan(300, []).targetFrames).toBe(100);
  });

  it('a Completed jobsheet counts its actual frames × its sections', () => {
    expect(jobsheetPcs({ frames: 20, status: 'completed', completedFrames: 18, sections: 4 })).toBe(72);
    expect(jobsheetPcs({ frames: 20, status: 'ongoing', completedFrames: null })).toBe(60);
  });

  it('the create-form warning adds new frames × the chosen sections to the pcs already there', () => {
    // 150 pcs already (3 sections); 38 frames × 4 = 152 → 302: fine.
    expect(jobsheetQuantityWarning(300, 150, 38, 4)).toBeNull();
    // 37 × 4 = 148 → 298: 2 less.
    expect(jobsheetQuantityWarning(300, 150, 37, 4)).toBe('This makes the jobsheet quantity 298 pcs — 2 less than the order (300 pcs).');
    // prefill for the next run = what is left
    expect(remainingPieces(300, 150)).toBe(150);
  });
});

describe('sections per beam — edit with auto-adjust', () => {
  it('the adjust is in frames; the coverage then uses each jobsheet’s sections', () => {
    const sheets: AdjustJobsheet[] = [
      { id: 1, jobsheetNo: 1, frames: 25, sections: 4 },
      { id: 2, jobsheetNo: 2, frames: 25, sections: 4 },
    ];
    const plan = planFramesEdit({ jobsheets: sheets, editedId: 1, newFrames: 20, framesPerJobsheet: 25 });
    // The last one would become 30 > F = 25: it stays at 25 and a new 5-frame jobsheet is created (the server copies
    // the last jobsheet's machines AND sections onto it).
    expect(plan.updated).toEqual([{ id: 1, jobsheetNo: 1, from: 25, to: 20, edited: true }]);
    expect(plan.created).toEqual([{ frames: 5 }]);
    const after = [
      { jobsheetNo: 1, frames: 20, sections: 4 },
      { jobsheetNo: 2, frames: 25, sections: 4 },
      { jobsheetNo: 3, frames: 5, sections: 4 },
    ];
    expect(orderJobsheetPlan(200, after)).toMatchObject({ totalFrames: 50, jobsheetPieces: 200 });
    expect(coverageWarnings(orderJobsheetPlan(200, after))).toEqual([]);
  });
});

describe('sections per beam — taka entry warning, dashboard bar, inventory', () => {
  it('taka entry expects frames × that jobsheet’s sections', () => {
    // A completed 4-section jobsheet with 25 frames expects 100 pcs (not 75).
    expect(jobsheetPcs({ frames: 25, status: 'completed', completedFrames: 25, sections: 4 })).toBe(100);
  });

  const js = (p: Partial<DashboardJobsheetInput> & Pick<DashboardJobsheetInput, 'id' | 'status' | 'frames'>): DashboardJobsheetInput => ({
    jobsheetNo: 100 + p.id,
    completedFrames: p.status === 'completed' ? p.frames : null,
    sentAt: null,
    startedAt: null,
    completedAt: null,
    runningMachineId: null,
    ...p,
  });

  it('the dashboard bar counts each jobsheet’s frames × its own sections', () => {
    const d = buildOrderDashboard(
      {
        order: { orderNo: 26, unit: 'pcs', quantity: 300 },
        jobsheets: [js({ id: 1, status: 'pending', frames: 50, sections: 3 }), js({ id: 2, status: 'ongoing', frames: 38, sections: 4 })],
        takas: [],
      },
      NOW,
    );
    expect(d.barTotalPcs).toBe(302);
    expect(d.progress.targetPcs).toBe(302);
  });

  it('a taka without pcs gets its share of its jobsheet’s frames × sections', () => {
    const d = buildOrderDashboard(
      {
        order: { orderNo: 26, unit: 'pcs', quantity: 100 },
        jobsheets: [js({ id: 1, status: 'completed', frames: 25, sections: 4 })],
        takas: [{ jobsheetId: 1, stage: 'entered', isDamaged: false, count: 2, pcs: null }],
      },
      NOW,
    );
    expect(d.barTotalPcs).toBe(100);
  });

  it('inventory "in making" uses the jobsheet’s sections for pcs not yet takas', () => {
    const p = orderInventoryPcs({ unit: 'pcs', quantity: 300 }, [
      { id: 1, status: 'ongoing', frames: 38, completedFrames: null, sections: 4 },
      { id: 2, status: 'pending', frames: 50, completedFrames: null },
    ], []);
    expect(p?.inMaking).toBe(302);
  });
});

describe('sections per beam — request schemas', () => {
  it('generate / single default to 3; update leaves it out; 1–12 only', () => {
    expect(jobsheetGenerateSchema.parse({ pieces: 300, framesPerJobsheet: 10, machineIds: [1] }).sections).toBe(3);
    expect(jobsheetSingleSchema.parse({ frames: 10, sections: 4, machineIds: [1] }).sections).toBe(4);
    expect(jobsheetUpdateSchema.parse({ frames: 10, machineIds: [1] }).sections).toBeUndefined();
    expect(jobsheetSingleSchema.safeParse({ frames: 10, sections: 13, machineIds: [1] }).success).toBe(false);
    expect(jobsheetSingleSchema.safeParse({ frames: 10, sections: 0, machineIds: [1] }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §1 / §2 designs by quality                                           */
/* ------------------------------------------------------------------ */

describe('design library by quality', () => {
  const groups = [
    { materialId: null, name: 'No quality' },
    { materialId: 3, name: 'Silk' },
    { materialId: 1, name: 'Georgette' },
    { materialId: 2, name: 'chiffon' },
  ];

  it('drawer order: the order’s quality first, the rest by name, No quality last', () => {
    expect(orderQualityGroups(groups, 3).map((g) => g.name)).toEqual(['Silk', 'chiffon', 'Georgette', 'No quality']);
    expect(orderQualityGroups(groups).map((g) => g.name)).toEqual(['chiffon', 'Georgette', 'Silk', 'No quality']);
  });

  it('picking a design: one quality fills it, several ask, the current one is kept', () => {
    const silk = { id: 3, name: 'Silk' };
    const geo = { id: 1, name: 'Georgette' };
    expect(qualityOnPick([silk], null)).toEqual({ kind: 'set', quality: silk });
    expect(qualityOnPick([silk, geo], null)).toEqual({ kind: 'choose', options: [silk, geo] });
    expect(qualityOnPick([silk, geo], 1)).toEqual({ kind: 'keep' });
    expect(qualityOnPick([silk], 2)).toEqual({ kind: 'set', quality: silk });
    expect(qualityOnPick([], 2)).toEqual({ kind: 'none' });
  });

  it('"+2 qualities" hint under one group', () => {
    const q = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
    expect(otherQualitiesHint(q, 1)).toBe('+2 qualities');
    expect(otherQualitiesHint(q.slice(0, 2), 2)).toBe('+1 quality');
    expect(otherQualitiesHint(q.slice(0, 1), 1)).toBeNull();
    expect(otherQualitiesHint(q, null)).toBeNull();
  });

  it('?quality= parsing', () => {
    expect(parseQualityParam('7')).toBe(7);
    expect(parseQualityParam('none')).toBe('none');
    expect(parseQualityParam('x')).toBeNull();
    expect(parseQualityParam(undefined)).toBeNull();
  });

  it('a design needs at least one quality; duplicates are dropped', () => {
    const base = { code: 'd 201', imageUrl: null, thumbUrl: null, buttaCutting: true };
    expect(designInputSchema.safeParse({ ...base, materialIds: [] }).success).toBe(false);
    expect(designInputSchema.safeParse(base).success).toBe(false);
    expect(designInputSchema.parse({ ...base, materialIds: [2, 2, 5] })).toMatchObject({ code: 'D201', materialIds: [2, 5] });
  });
});

describe('Upload many — review rows', () => {
  const row = (key: string, p: Partial<BulkDesignRow> = {}): BulkDesignRow => ({
    key,
    code: `D${key}`,
    materialIds: [1],
    buttaCutting: true,
    uploaded: true,
    ...p,
  });

  it('valid rows have no problems', () => {
    expect(bulkRowProblems([row('1'), row('2')]).size).toBe(0);
  });

  it('flags missing code / quality / butta, uploads in progress, codes twice on the page and codes already used', () => {
    const problems = bulkRowProblems(
      [row('1', { code: '' }), row('2', { materialIds: [] }), row('3', { buttaCutting: null }), row('4', { uploaded: false }), row('5', { code: 'd 9' }), row('6', { code: 'D9' }), row('7', { code: 'D700' }), row('8', { code: 'D#1' })],
      new Set(['D700']),
    );
    expect(problems.get('1')?.code).toBe('Design code is required');
    expect(problems.get('2')?.materialIds).toBe('Pick at least one quality');
    expect(problems.get('3')?.buttaCutting).toBe('Choose Yes or No');
    expect(problems.get('4')?.image).toBeTruthy();
    expect(problems.get('5')?.code).toBe('Used twice on this page');
    expect(problems.get('6')?.code).toBe('Used twice on this page');
    expect(problems.get('7')?.code).toBe('Already used by another design');
    expect(problems.get('8')?.code).toMatch(/letters, numbers/);
  });

  it('bulk request schema: 1–100 rows, each with qualities and an image', () => {
    const ok = { code: 'D1', imageUrl: '/u/a.webp', thumbUrl: '/u/a-t.webp', materialIds: [1], buttaCutting: false };
    expect(designBulkSchema.safeParse({ designs: [ok] }).success).toBe(true);
    expect(designBulkSchema.safeParse({ designs: [] }).success).toBe(false);
    expect(designBulkSchema.safeParse({ designs: [{ ...ok, imageUrl: undefined }] }).success).toBe(false);
    expect(designBulkSchema.safeParse({ designs: [{ ...ok, materialIds: [] }] }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §5 outside order                                                     */
/* ------------------------------------------------------------------ */

describe('Outside order', () => {
  const base = { customerId: 1, orderType: 'lump', materialId: 1, quantity: 10, unit: 'pcs', orderDate: '2026-10-26' } as const;
  it('defaults to not outside; ticking it needs a party name', () => {
    expect(orderCreateSchema.parse(base)).toMatchObject({ isOutsideOrder: false, outsidePartyName: null });
    const missing = orderCreateSchema.safeParse({ ...base, isOutsideOrder: true, outsidePartyName: '  ' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0].path).toEqual(['outsidePartyName']);
    expect(orderCreateSchema.parse({ ...base, isOutsideOrder: true, outsidePartyName: ' Shree Fab ' })).toMatchObject({ isOutsideOrder: true, outsidePartyName: 'Shree Fab' });
  });
});
