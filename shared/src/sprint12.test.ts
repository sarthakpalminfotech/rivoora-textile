import { describe, expect, it } from 'vitest';
import { defaultPassword, DEFAULT_USERS, resolveActingRole, switchableRoles } from './auth';
import {
  dispatchChallanLabel,
  dispatchLines,
  dispatchTotals,
  lumpRevisionTakas,
  markFreshResult,
  moveTotals,
  parseDispatchChallanNo,
  pcsToPcsRemaining,
  reducePcsAcrossRows,
  returnLot,
  validatePcsGr,
} from './dispatch';
import { orderInventoryPcs } from './inventory';
import { CHALLAN_KIND_CONFIG, isTakaReady, sendableStages, splitReadyTakas } from './challans';
import { SUB_STAGES, TAKA_STAGES, takaStageMain } from './pipeline';
import { reButtaTag, reworkSelectable, sendBackSummaryLines, stageAfterButtaQc } from './rework';
import { ROLES, can } from './roles';
import { canRoleSeeStatus, getStatus, orderStatusForJobsheets } from './statuses';

const done = { status: 'completed', takaCount: 3 };

describe('stageAfterButtaQc', () => {
  it('a taka that has been to the mill goes back to the godown', () => {
    expect(stageAfterButtaQc({ hasMillHistory: true })).toBe('final');
    expect(stageAfterButtaQc({ hasMillHistory: false, refinishCount: 1 })).toBe('final');
  });
  it('otherwise the normal flow: waiting for the mill', () => {
    expect(stageAfterButtaQc({})).toBe('waiting_mill');
    expect(stageAfterButtaQc({ hasMillHistory: false, refinishCount: 0 })).toBe('waiting_mill');
  });
});

describe('send-back selection rules', () => {
  it('takas with us can be selected', () => {
    for (const s of ['entered', 'waiting_mill', 'butta_qc', 'mill_qc', 'final', 'ready_dispatch', 'refinish']) {
      expect(reworkSelectable(s).selectable, s).toBe(true);
    }
  });
  it('takas at butta cutting / the mill and dispatched takas are greyed with a reason', () => {
    for (const s of ['at_butta', 'at_mill', 'dispatched']) {
      const r = reworkSelectable(s);
      expect(r.selectable, s).toBe(false);
      expect(r.reason, s).toBeTruthy();
    }
    expect(reworkSelectable('dispatched').reason).toMatch(/GR/);
  });
  it('summary lines per current stage', () => {
    expect(sendBackSummaryLines([{ stage: 'final' }, { stage: 'final' }, { stage: 'final' }, { stage: 'ready_dispatch' }])).toEqual(['3 from godown', '1 ready for dispatch']);
  });
  it('re-butta tag shows the count from the second time on', () => {
    expect(reButtaTag(1)).toBe('Re-butta');
    expect(reButtaTag(2)).toBe('Re-butta ×2');
  });
  it('butta cutting sends rework takas too; the mill does not treat them as ready', () => {
    expect(isTakaReady('rework_butta', 'butta')).toBe(true);
    expect(isTakaReady('entered', 'butta')).toBe(true);
    expect(isTakaReady('rework_butta', 'mill')).toBe(false);
    expect(sendableStages('butta')).toEqual(['entered', 'rework_butta']);
    expect(CHALLAN_KIND_CONFIG.mill.notSentStages).toContain('rework_butta');
    const { ready, notReady } = splitReadyTakas([{ id: 1, takaNo: '1', stage: 'rework_butta' }, { id: 2, takaNo: '2', stage: 'at_mill' }], 'butta');
    expect(ready).toHaveLength(1);
    expect(notReady).toHaveLength(1);
  });
});

describe('order status with rework + dispatch', () => {
  const js = [done];
  it('a taka sent back to butta cutting puts the order in butta cutting', () => {
    expect(orderStatusForJobsheets(js, ['final', 'final', 'rework_butta'])).toBe('in_butta_cutting');
  });
  it('some dispatched → Partly dispatched, all dispatched → Dispatched', () => {
    expect(orderStatusForJobsheets(js, ['dispatched', 'final', 'at_mill'])).toBe('partly_dispatched');
    expect(orderStatusForJobsheets(js, ['dispatched', 'dispatched', 'ready_dispatch'])).toBe('partly_dispatched');
    expect(orderStatusForJobsheets(js, ['dispatched', 'dispatched', 'dispatched'])).toBe('dispatched');
  });
  it('a return brings the order back to Partly dispatched', () => {
    expect(orderStatusForJobsheets(js, ['dispatched', 'dispatched', 'final'])).toBe('partly_dispatched');
  });
  it('dispatch statuses: sequence + visibility', () => {
    expect(getStatus('partly_dispatched')).toMatchObject({ label: 'Partly dispatched', sequence: 130 });
    expect(getStatus('dispatched')).toMatchObject({ label: 'Dispatched', sequence: 140 });
    for (const r of ['jemish', 'gaurang', 'dhruvil', 'godown_supervisor'] as const) expect(canRoleSeeStatus(r, 'dispatched'), r).toBe(true);
    for (const r of ['supervisor', 'taka_entry', 'qc'] as const) expect(canRoleSeeStatus(r, 'dispatched'), r).toBe(false);
  });
  it('earlier statuses are unchanged', () => {
    expect(orderStatusForJobsheets(js, ['ready_dispatch', 'ready_dispatch', 'ready_dispatch'])).toBe('ready_for_dispatch');
    expect(orderStatusForJobsheets(js, ['final', 'final', 'final'])).toBe('mill_qc_done');
  });
});

describe('pipeline', () => {
  it('new stages are mapped to sub-stages (rework → butta, dispatched → ready)', () => {
    expect(TAKA_STAGES).toContain('rework_butta');
    expect(TAKA_STAGES).toContain('dispatched');
    expect(takaStageMain('rework_butta')).toBe('butta');
    expect(takaStageMain('dispatched')).toBe('ready');
    expect(SUB_STAGES.find((s) => s.key === 'rework_butta')).toMatchObject({ label: 'Sent back to butta cutting · waiting', connected: true });
    expect(SUB_STAGES.filter((s) => s.mainStage === 'ready').at(-1)?.key).toBe('dispatched');
  });
});

describe('dispatch challan labels', () => {
  it('DC-n and revisions', () => {
    expect(dispatchChallanLabel(12)).toBe('DC-12');
    expect(dispatchChallanLabel(12, 1)).toBe('DC-12 R1');
    expect(parseDispatchChallanNo('dc 12')).toEqual({ no: 12, revision: null });
    expect(parseDispatchChallanNo('DC-12 R2')).toEqual({ no: 12, revision: 2 });
    expect(parseDispatchChallanNo('abc')).toBeNull();
  });
  it('totals and pcs-to-pcs lines', () => {
    expect(dispatchTotals([{ meters: 10.5, pcs: 12 }, { meters: null, pcs: 8 }])).toEqual({ takas: 2, pcs: 20, meters: 10.5 });
    expect(dispatchLines([{ quality: 'Georgette', design: 'D101', pcs: 12 }, { quality: 'Georgette', design: 'D101', pcs: 8 }, { quality: 'Satin', design: 'D5', pcs: 4 }])).toEqual([
      { quality: 'Georgette', design: 'D101', pcs: 20 },
      { quality: 'Satin', design: 'D5', pcs: 4 },
    ]);
  });
});

describe('goods return maths', () => {
  it('lump: the revision holds everything except the returned takas', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(lumpRevisionTakas(rows, [2])).toEqual([{ id: 1 }, { id: 3 }]);
    expect(lumpRevisionTakas(rows, [])).toHaveLength(3);
    expect(lumpRevisionTakas(rows, [1, 2, 3])).toEqual([]);
  });
  it('pcs to pcs: validation', () => {
    expect(validatePcsGr({ challanPcs: 50, returnedPcs: 25, damagedPcs: 5, hasDamageName: true })).toBeNull();
    expect(validatePcsGr({ challanPcs: 50, returnedPcs: 0, damagedPcs: 0, hasDamageName: false })).toBe('returned_range');
    expect(validatePcsGr({ challanPcs: 50, returnedPcs: 51, damagedPcs: 0, hasDamageName: false })).toBe('returned_range');
    expect(validatePcsGr({ challanPcs: 50, returnedPcs: 10, damagedPcs: 11, hasDamageName: true })).toBe('damaged_range');
    expect(validatePcsGr({ challanPcs: 50, returnedPcs: 10, damagedPcs: 2, hasDamageName: false })).toBe('damage_missing');
    expect(validatePcsGr({ challanPcs: 50, returnedPcs: 10, damagedPcs: 0, hasDamageName: false })).toBeNull();
  });
  it('pcs to pcs: the challan pcs are reduced and the return lot has the returned pcs', () => {
    expect(pcsToPcsRemaining(50, 25)).toBe(25);
    expect(pcsToPcsRemaining(50, 50)).toBe(0);
    expect(returnLot(25, 5)).toEqual({ pcs: 25, meters: null, damagedPcs: 5, freshPcs: 20 });
    const rows = [{ id: 1, pcs: 20 }, { id: 2, pcs: 30 }];
    expect(reducePcsAcrossRows(rows, 25)).toEqual([{ id: 1, before: 20, after: 20 }, { id: 2, before: 30, after: 5 }]);
    expect(reducePcsAcrossRows(rows, 40)).toEqual([{ id: 1, before: 20, after: 10 }, { id: 2, before: 30, after: 0 }]);
    expect(reducePcsAcrossRows(rows, 0).map((r) => r.after)).toEqual([20, 30]);
  });
});

describe('moving stock between orders (totals)', () => {
  it('totals move correctly between two orders', () => {
    const order = { unit: 'pcs', quantity: 100 };
    const takasA = [
      { jobsheetId: 1, stage: 'final', pcs: 12 },
      { jobsheetId: 1, stage: 'final', pcs: 12 },
      { jobsheetId: 1, stage: 'ready_dispatch', pcs: 10 },
    ];
    const takasB = [{ jobsheetId: 2, stage: 'final', pcs: 8 }];
    const jsA = [{ id: 1, status: 'completed', frames: 5, completedFrames: 5 }];
    const jsB = [{ id: 2, status: 'completed', frames: 3, completedFrames: 3 }];
    const before = [orderInventoryPcs(order, jsA, takasA)!, orderInventoryPcs(order, jsB, takasB)!];
    expect(before[0].inGodown).toBe(24);
    expect(before[1].inGodown).toBe(8);
    const moved = takasA.slice(0, 1);
    const after = [orderInventoryPcs(order, jsA, takasA.slice(1))!, orderInventoryPcs(order, jsB, [...takasB, ...moved])!];
    expect(after[0].inGodown).toBe(12);
    expect(after[1].inGodown).toBe(20);
    expect(after[0].inGodown + after[1].inGodown).toBe(before[0].inGodown + before[1].inGodown);
    expect(moveTotals([{ pcs: 12, actualPcs: null }, { pcs: 12, actualPcs: 10 }])).toEqual({ takas: 2, pcs: 22 });
  });
  it('dispatched takas are never in the godown stock', () => {
    const p = orderInventoryPcs({ unit: 'pcs', quantity: 50 }, [{ id: 1, status: 'completed', frames: 5, completedFrames: 5 }], [
      { jobsheetId: 1, stage: 'dispatched', pcs: 20 },
      { jobsheetId: 1, stage: 'final', pcs: 10 },
      { jobsheetId: 1, stage: 'rework_butta', pcs: 5 },
    ])!;
    expect(p.inGodown).toBe(10);
    expect(p.readyDispatch).toBe(0);
    expect(p.inMaking).toBe(5);
  });
});

describe('mark as fresh', () => {
  it('resolves every open damage in full', () => {
    expect(
      markFreshResult([
        { pcs: 5, resolvedPcs: 2, status: 'open' },
        { pcs: 3, resolvedPcs: 0, status: 'open' },
        { pcs: 4, resolvedPcs: 4, status: 'resolved' },
      ]),
    ).toEqual({ resolved: 2, openPcsBefore: 6, openPcsAfter: 0 });
  });
});

describe('login helpers', () => {
  it('default password = Rivoora@ + the first 3 digits of the phone', () => {
    expect(defaultPassword('9999999999')).toBe('Rivoora@999');
    expect(defaultPassword('3333333333')).toBe('Rivoora@333');
    expect(defaultPassword('8123456789')).toBe('Rivoora@812');
  });
  it('the seven default users', () => {
    expect(DEFAULT_USERS.map((u) => u.role)).toEqual(['jemish', 'gaurang', 'supervisor', 'taka_entry', 'qc', 'godown_supervisor', 'dhruvil']);
    expect(new Set(DEFAULT_USERS.map((u) => u.phone)).size).toBe(7);
  });
  it('X-Act-As: only Jenish and Gaurang may switch', () => {
    expect(resolveActingRole('jemish', 'supervisor')).toEqual({ role: 'supervisor', ignored: false });
    expect(resolveActingRole('gaurang', 'dhruvil')).toEqual({ role: 'dhruvil', ignored: false });
    expect(resolveActingRole('supervisor', 'jemish')).toEqual({ role: 'supervisor', ignored: true });
    expect(resolveActingRole('dhruvil', 'jemish')).toEqual({ role: 'dhruvil', ignored: true });
    expect(resolveActingRole('jemish', undefined)).toEqual({ role: 'jemish', ignored: false });
    expect(resolveActingRole('jemish', 'nonsense')).toEqual({ role: 'jemish', ignored: true });
    expect(switchableRoles('qc')).toEqual([]);
    expect(switchableRoles('jemish')).toContain('dhruvil');
  });
});

describe('sprint 12 roles', () => {
  it('Dhruvil: the godown Orders module, dispatch, GR, move; sees client and rate', () => {
    expect(ROLES.dhruvil.landing).toBe('/godown/orders');
    expect(ROLES.dhruvil.title).toBe('Dispatch');
    for (const p of ['canUseGodownOrders', 'canDispatch', 'canGoodsReturn', 'canMoveToInventory', 'canSeeClient', 'canSeeRate'] as const) expect(can('dhruvil', p), p).toBe(true);
    for (const p of ['canViewOrders', 'canViewMasters', 'canMarkFresh', 'canReworkTakas', 'canManageUsers', 'canSwitchRoles'] as const) expect(can('dhruvil', p), p).toBe(false);
  });
  it('the godown supervisor lost Orders but keeps butta cutting and mill', () => {
    expect(can('godown_supervisor', 'canUseGodownOrders')).toBe(false);
    expect(can('godown_supervisor', 'canUseButtaModule')).toBe(true);
    expect(can('godown_supervisor', 'canUseMillModule')).toBe(true);
    expect(ROLES.godown_supervisor.landing).toBe('/butta');
  });
  it('Jenish and Gaurang get the owner permissions', () => {
    for (const r of ['jemish', 'gaurang'] as const) {
      for (const p of ['canReworkTakas', 'canDispatch', 'canGoodsReturn', 'canMoveToInventory', 'canMarkFresh', 'canSwitchRoles', 'canManageUsers'] as const) expect(can(r, p), `${r} ${p}`).toBe(true);
    }
    for (const r of ['supervisor', 'taka_entry', 'qc', 'godown_supervisor'] as const) {
      for (const p of ['canReworkTakas', 'canDispatch', 'canSwitchRoles', 'canManageUsers'] as const) expect(can(r, p), `${r} ${p}`).toBe(false);
    }
  });
});
