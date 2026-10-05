import { describe, expect, it } from 'vitest';
import { canRoleSeeJobsheetStatus, canRoleSeeStatus, jobsheetStatusLabel, orderStatusForJobsheets } from './statuses';
import { can } from './roles';
import {
  cleanMeters,
  cleanPcs,
  cleanTakaNo,
  compareTakaNo,
  damageLabel,
  damagePcsErrorText,
  damageResolvedText,
  formatPcs,
  hasOpenDamage,
  initialTakaStage,
  isFreshAfterDamage,
  parseDamagePcs,
  takaUsedText,
  hasTakaErrors,
  jobsheetQrUrl,
  parseJobsheetQr,
  formatMeters,
  parseMeters,
  parsePcs,
  TAKA_NO_REGEX,
  takaSummary,
  totalMeters,
  totalPcs,
  validateTakaNumbers,
} from './takas';
import { customerInputSchema, orderCreateSchema, takaDamageSchema, takaEditSchema, takaEntrySchema } from './schemas';

describe('taka number validation (one jobsheet)', () => {
  it('accepts digits, keeps leading zeros as distinct text', () => {
    expect(validateTakaNumbers(['6245', '0123', '123'])).toEqual([null, null, null]);
  });

  it('accepts single - or / separators between digits', () => {
    expect(validateTakaNumbers(['6245', '6245-1', '62/45', '1-2/3'])).toEqual([null, null, null, null]);
    for (const v of ['6245', '6245-1', '62/45']) expect(TAKA_NO_REGEX.test(v), v).toBe(true);
  });

  it('rejects letters, leading / trailing / double separators and more than 15 characters', () => {
    for (const v of ['-6245', '6245-', '62--45', '62/-45', 'A12', '12a', '12 3']) expect(TAKA_NO_REGEX.test(v), v).toBe(false);
    expect(validateTakaNumbers(['-6245', '6245-', '62--45', 'A12', '1234567890123456'])).toEqual([
      'format',
      'format',
      'format',
      'format',
      'too_long',
    ]);
  });

  it('a dash or slash makes a different number (exact match for duplicates)', () => {
    expect(validateTakaNumbers(['6245', '6245-1', '6245/1', '6245-1'])).toEqual([null, null, null, 'duplicate']);
  });

  it('flags duplicates within the list (the first one stays valid)', () => {
    expect(validateTakaNumbers(['6245', '6246', '6245'])).toEqual([null, null, 'duplicate']);
  });

  it('flags numbers already used anywhere (global uniqueness) — the used list wins over duplicates', () => {
    const used = new Map([['6245', '#26 (319)']]);
    expect(validateTakaNumbers(['6245', '6250', '6250'], [], { used })).toEqual(['already_used', null, 'duplicate']);
    expect(takaUsedText('6245', '#26 (319)')).toEqual({
      en: 'Taka 6245 is already used (Order #26 (319))',
      hi: 'टाका 6245 पहले से है',
    });
    expect(takaUsedText('6245').en).toBe('Taka 6245 is already used');
  });

  it('flags numbers already entered on the same jobsheet', () => {
    const errors = validateTakaNumbers(['6245', '6250'], ['6245', '6246']);
    expect(errors).toEqual(['already_entered', null]);
    expect(hasTakaErrors(errors)).toBe(true);
  });

  it('ignores empty rows on the entry screen, requires them in the edit form', () => {
    expect(validateTakaNumbers(['', '  ', '7'], [], { ignoreEmpty: true })).toEqual([null, null, null]);
    expect(validateTakaNumbers(['', '7'])).toEqual(['required', null]);
  });

  it('trims before comparing', () => {
    expect(validateTakaNumbers([' 7', '7 '])).toEqual([null, 'duplicate']);
  });

  it('cleans typed / pasted input: digits, - and / (max 15), no leading or double separators', () => {
    expect(cleanTakaNo('62-45 a')).toBe('62-45');
    expect(cleanTakaNo('62//45')).toBe('62/45');
    expect(cleanTakaNo('62-/45')).toBe('62-45');
    expect(cleanTakaNo('-6245')).toBe('6245');
    expect(cleanTakaNo('6245-')).toBe('6245-');
    expect(cleanTakaNo('A12')).toBe('12');
    expect(cleanTakaNo('12345678901234567')).toBe('123456789012345');
  });

  it('server schemas: number format, pcs required, at least one taka on entry, empty set allowed on edit', () => {
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '0045', pcs: 12, damages: [{ damageId: 3, pcs: 2 }] }] }).success).toBe(true);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '62/45-1', pcs: 1 }] }).success).toBe(true);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '45a', pcs: 1 }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '45-', pcs: 1 }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '45' }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [] }).success).toBe(false);
    expect(takaEditSchema.safeParse({ takas: [], note: '' }).success).toBe(true);
    const parsed = takaEntrySchema.parse({ takas: [{ takaNo: ' 7 ', pcs: 10 }], note: '  ' });
    expect(parsed.takas[0]).toEqual({ takaNo: '7', meters: null, pcs: 10, damages: [] });
    expect(parsed.note).toBeNull();
  });

  it('summaries and sorting', () => {
    expect(takaSummary([{ isDamaged: false }, { isDamaged: true }, { isDamaged: false }])).toBe('3 takas (1 damage)');
    expect(takaSummary([{ isDamaged: false }])).toBe('1 taka');
    expect(['10', '9', '0009', '100'].sort(compareTakaNo)).toEqual(['0009', '9', '10', '100']);
    expect(['63', '62/10', '62', '62/9', '62-1'].sort(compareTakaNo)).toEqual(['62', '62-1', '62/9', '62/10', '63']);
  });
});

describe('order status: Taka entry done', () => {
  it('all Completed and every jobsheet has a taka → Taka entry done', () => {
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'completed', takaCount: 1 }])).toBe(
      'taka_entry_done',
    );
  });

  it('all Completed but one without takas → Production completed', () => {
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'completed', takaCount: 0 }])).toBe(
      'production_completed',
    );
    // Jemish removes all takas of a jobsheet.
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 0 }])).toBe('production_completed');
  });

  it('a new jobsheet added later moves the order back', () => {
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'pending' }])).toBe('in_production');
    expect(orderStatusForJobsheets([{ status: 'completed', takaCount: 3 }, { status: 'ongoing' }])).toBe('in_production');
  });

  it('plain status strings still work (no takas)', () => {
    expect(orderStatusForJobsheets(['completed'])).toBe('production_completed');
  });
});

describe('taka_entry role', () => {
  it('sees every jobsheet status and no order status', () => {
    for (const s of ['pending', 'sent', 'ongoing', 'completed']) expect(canRoleSeeJobsheetStatus('taka_entry', s)).toBe(true);
    expect(canRoleSeeJobsheetStatus('supervisor', 'pending')).toBe(false);
    expect(canRoleSeeStatus('taka_entry', 'taka_entry_done')).toBe(false);
    expect(canRoleSeeStatus('gaurang', 'taka_entry_done')).toBe(true);
  });

  it('permissions', () => {
    expect(can('taka_entry', 'canEnterTakas')).toBe(true);
    expect(can('taka_entry', 'canEditTakas')).toBe(false);
    expect(can('taka_entry', 'canViewOrders')).toBe(false);
    expect(can('taka_entry', 'canViewMachineView')).toBe(false);
    expect(can('jemish', 'canEditTakas')).toBe(true);
    expect(can('supervisor', 'canViewTakas')).toBe(false);
  });
});

describe('jobsheet QR codes', () => {
  it('builds the URL without a double slash', () => {
    expect(jobsheetQrUrl('https://app.rivoora.in/', 319)).toBe('https://app.rivoora.in/j/319');
    expect(jobsheetQrUrl('http://192.168.1.5:5180', 7)).toBe('http://192.168.1.5:5180/j/7');
  });

  it('accepts /j/<digits> on any host', () => {
    expect(parseJobsheetQr('https://app.rivoora.in/j/319')).toBe(319);
    expect(parseJobsheetQr('http://192.168.1.5:5180/j/7/')).toBe(7);
    expect(parseJobsheetQr('https://new-domain.example/j/42?x=1#top')).toBe(42);
    expect(parseJobsheetQr('  https://app.rivoora.in/j/319  ')).toBe(319);
  });

  it('rejects everything else', () => {
    for (const text of [
      '319',
      'hello',
      'https://app.rivoora.in/',
      'https://app.rivoora.in/j/',
      'https://app.rivoora.in/j/abc',
      'https://app.rivoora.in/j/0',
      'https://app.rivoora.in/j/31a',
      'https://app.rivoora.in/x/j/319',
      'https://app.rivoora.in/j/319/extra',
      'ftp://app.rivoora.in/j/319',
      'javascript:alert(1)//j/1',
      'https://app.rivoora.in/j/1234567890',
    ]) {
      expect(parseJobsheetQr(text), text).toBeNull();
    }
  });
});

describe('meters per taka', () => {
  it('cleans typed meters: digits, one dot, 4 + 2 digits', () => {
    expect(cleanMeters('105.5')).toBe('105.5');
    expect(cleanMeters('105,75')).toBe('105.75');
    expect(cleanMeters('1a0b5')).toBe('105');
    expect(cleanMeters('12345.678')).toBe('1234.67');
    expect(cleanMeters('1.2.3')).toBe('1.23');
  });

  it('parses meters: empty is null, otherwise > 0 and <= 9999.99', () => {
    expect(parseMeters('')).toEqual({ meters: null, error: null });
    expect(parseMeters(' 105.5 ')).toEqual({ meters: 105.5, error: null });
    expect(parseMeters('.5')).toEqual({ meters: 0.5, error: null });
    expect(parseMeters('0').error).toBe('zero');
    expect(parseMeters('.').error).toBe('invalid');
    expect(parseMeters('12345').error).toBe('invalid');
  });

  it('formats and totals meters; takas without meters are skipped', () => {
    expect(formatMeters(105.5)).toBe('105.5 m');
    expect(formatMeters(1250)).toBe('1,250 m');
    expect(totalMeters([{ meters: 100.25 }, { meters: null }, { meters: 50.5 }])).toBe(150.75);
    expect(totalMeters([{ meters: null }, {}])).toBeNull();
  });

  it('adds the meters total to the summary only when meters were entered', () => {
    expect(takaSummary([{ isDamaged: false }, { isDamaged: true }])).toBe('2 takas (1 damage)');
    expect(takaSummary([{ isDamaged: false, meters: 100 }, { isDamaged: true, meters: 5.5 }])).toBe('2 takas (1 damage) · 105.5 m');
  });

  it('server schemas accept optional meters and reject bad values', () => {
    const ok = takaEntrySchema.parse({ takas: [{ takaNo: '1', meters: 105.555, pcs: 1 }, { takaNo: '2', pcs: 1 }] });
    expect(ok.takas.map((t) => t.meters)).toEqual([105.56, null]);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '1', meters: 0, pcs: 1 }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '1', meters: 10000, pcs: 1 }] }).success).toBe(false);
    expect(takaEditSchema.parse({ takas: [{ id: 3, takaNo: '1', meters: 98 }], note: '' }).takas[0].meters).toBe(98);
  });
});

describe('pcs per taka', () => {
  it('cleans typed pcs to at most 4 digits', () => {
    expect(cleanPcs('12a3')).toBe('123');
    expect(cleanPcs('123456')).toBe('1234');
    expect(cleanPcs('1.5')).toBe('15');
  });

  it('parses pcs: required, whole number 1–9999', () => {
    expect(parsePcs('')).toEqual({ pcs: null, error: 'required' });
    expect(parsePcs(' 12 ')).toEqual({ pcs: 12, error: null });
    expect(parsePcs('9999')).toEqual({ pcs: 9999, error: null });
    expect(parsePcs('0').error).toBe('zero');
    expect(parsePcs('10000').error).toBe('too_big');
    expect(parsePcs('1.5').error).toBe('invalid');
  });

  it('formats and totals pcs; older takas without pcs are skipped', () => {
    expect(formatPcs(12)).toBe('12 pcs');
    expect(formatPcs(1250)).toBe('1,250 pcs');
    expect(totalPcs([{ pcs: 12 }, { pcs: null }, { pcs: 10 }])).toBe(22);
    expect(totalPcs([{ pcs: null }, {}])).toBeNull();
  });

  it('adds the pcs total to the summary', () => {
    expect(takaSummary([{ isDamaged: false, meters: 100, pcs: 12 }, { isDamaged: true, meters: 5.5, pcs: 1 }])).toBe(
      '2 takas (1 damage) · 105.5 m · 13 pcs',
    );
    expect(takaSummary([{ isDamaged: false, pcs: 6 }])).toBe('1 taka · 6 pcs');
  });

  it('server schemas: pcs is required on entry (1–9999), may stay null on edit', () => {
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '1', pcs: 0 }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '1', pcs: 10000 }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '1', pcs: 1.5 }] }).success).toBe(false);
    expect(takaEditSchema.parse({ takas: [{ id: 3, takaNo: '1' }], note: '' }).takas[0].pcs).toBeNull();
  });
});

describe('damage payload (a list per taka)', () => {
  it('accepts master damages and "Other" names, each with the damaged pcs', () => {
    expect(takaDamageSchema.parse({ damageId: 4, pcs: 2 })).toEqual({ damageId: 4, pcs: 2 });
    expect(takaDamageSchema.parse({ otherName: '  Oil stain ', pcs: 1 })).toEqual({ otherName: 'Oil stain', pcs: 1 });
    const parsed = takaEntrySchema.parse({
      takas: [{ takaNo: '1', pcs: 12, damages: [{ damageId: 1, pcs: 2 }, { otherName: 'Hole', pcs: 1 }] }],
    });
    expect(parsed.takas[0].damages).toHaveLength(2);
  });

  it('a damage needs a name and pcs: empty Other, both keys, missing pcs or id are rejected', () => {
    expect(takaDamageSchema.safeParse({ otherName: '   ', pcs: 1 }).success).toBe(false);
    expect(takaDamageSchema.safeParse({ damageId: 1, otherName: 'Hole', pcs: 1 }).success).toBe(false);
    expect(takaDamageSchema.safeParse({ damageId: 1 }).success).toBe(false);
    expect(takaDamageSchema.safeParse({ damageId: 1, pcs: 0 }).success).toBe(false);
    expect(takaDamageSchema.safeParse({ damageId: null, pcs: 1 }).success).toBe(false);
    expect(takaDamageSchema.safeParse({ otherName: 'x'.repeat(81), pcs: 1 }).success).toBe(false);
  });

  it('edit keeps an older nameless damage as { id, damageId: null, pcs: null }', () => {
    const parsed = takaEditSchema.parse({ takas: [{ id: 1, takaNo: '5', pcs: 2, damages: [{ id: 9, damageId: null, pcs: null }] }], note: null });
    expect(parsed.takas[0].damages).toEqual([{ id: 9, damageId: null, pcs: null }]);
    expect(takaEditSchema.parse({ takas: [{ id: 1, takaNo: '5', pcs: 2 }], note: null }).takas[0].damages).toEqual([]);
  });

  it('labels where + what + pcs', () => {
    expect(damageLabel('machine', 'Hole', 2)).toBe('Machine damage · Hole · 2 pcs');
    expect(damageLabel('machine', 'Hole')).toBe('Machine damage · Hole');
    expect(damageLabel('machine', null)).toBe('Machine damage');
    expect(damageLabel(null)).toBe('Machine damage');
    expect(damageLabel('butta', 'Cut', 1)).toBe('Butta cutting damage · Cut · 1 pcs');
  });

  it('open / resolved / Fresh', () => {
    const open = { status: 'open' };
    const resolved = { status: 'resolved', resolvedStage: 'butta_qc' };
    expect(hasOpenDamage([open, resolved])).toBe(true);
    expect(isFreshAfterDamage([resolved])).toBe(true);
    expect(isFreshAfterDamage([open, resolved])).toBe(false);
    expect(isFreshAfterDamage([])).toBe(false);
    expect(damageResolvedText(resolved)).toBe('Resolved at butta QC');
    expect(damageResolvedText(open)).toBeNull();
  });

  it('damaged pcs: 1 to the taka pcs', () => {
    expect(parseDamagePcs('', 12)).toEqual({ pcs: null, error: 'required' });
    expect(parseDamagePcs('3', 12)).toEqual({ pcs: 3, error: null });
    expect(parseDamagePcs('12', 12)).toEqual({ pcs: 12, error: null });
    expect(parseDamagePcs('13', 12).error).toBe('too_big');
    expect(parseDamagePcs('0', 12).error).toBe('zero');
    expect(parseDamagePcs('1.5', 12).error).toBe('invalid');
    expect(damagePcsErrorText('too_big', 12).en).toContain('12');
  });
});

describe('where a new taka goes (initialTakaStage)', () => {
  it('butta designs and orders without a design wait for butta cutting', () => {
    expect(initialTakaStage({ buttaCutting: true })).toBe('entered');
    expect(initialTakaStage(null)).toBe('entered');
    expect(initialTakaStage(undefined)).toBe('entered');
  });

  it('designs that skip butta cutting go straight to waiting for the mill', () => {
    expect(initialTakaStage({ buttaCutting: false })).toBe('waiting_mill');
  });
});

describe('customer brokers + order type schemas', () => {
  const customer = { name: 'Shree Fabrics' };

  it('drops empty broker rows and blocks duplicates within the customer', () => {
    expect(customerInputSchema.parse({ ...customer, brokers: [{ name: ' Ramesh ' }, { name: '' }] }).brokers).toEqual([{ name: 'Ramesh' }]);
    expect(customerInputSchema.parse(customer).brokers).toEqual([]);
    const dup = customerInputSchema.safeParse({ ...customer, brokers: [{ name: 'Ramesh' }, { name: 'ramesh ' }] });
    expect(dup.success).toBe(false);
    if (!dup.success) expect(dup.error.issues[0].path).toEqual(['brokers', 1, 'name']);
  });

  it('order type is required, broker optional', () => {
    const base = { customerId: 1, materialId: 1, quantity: 10, unit: 'pcs', orderDate: '2026-10-01' };
    expect(orderCreateSchema.safeParse(base).success).toBe(false);
    const ok = orderCreateSchema.parse({ ...base, orderType: 'lump' });
    expect(ok.orderType).toBe('lump');
    expect(ok.brokerId).toBeNull();
    expect(orderCreateSchema.parse({ ...base, orderType: 'pcs_to_pcs', brokerId: 5 }).brokerId).toBe(5);
    expect(orderCreateSchema.safeParse({ ...base, orderType: 'meters' }).success).toBe(false);
  });
});

describe('sprint 6 role + status labels', () => {
  it('Damage master rights: Jemish and Gaurang only', () => {
    expect(can('jemish', 'canManageDamages')).toBe(true);
    expect(can('gaurang', 'canManageDamages')).toBe(true);
    expect(can('supervisor', 'canManageDamages')).toBe(false);
    expect(can('taka_entry', 'canManageDamages')).toBe(false);
  });

  it('the supervisor sees Ongoing as On-loom; other roles keep Ongoing', () => {
    expect(jobsheetStatusLabel('ongoing', 'supervisor')).toBe('On-loom');
    expect(jobsheetStatusLabel('ongoing', 'jemish')).toBe('Ongoing');
    expect(jobsheetStatusLabel('sent', 'supervisor')).toBe('Pending');
  });
});
