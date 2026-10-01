import { describe, expect, it } from 'vitest';
import { canRoleSeeJobsheetStatus, canRoleSeeStatus, orderStatusForJobsheets } from './statuses';
import { can } from './roles';
import {
  cleanMeters,
  cleanTakaNo,
  compareTakaNo,
  hasTakaErrors,
  jobsheetQrUrl,
  parseJobsheetQr,
  formatMeters,
  parseMeters,
  takaSummary,
  totalMeters,
  validateTakaNumbers,
} from './takas';
import { takaEditSchema, takaEntrySchema } from './schemas';

describe('taka number validation (one jobsheet)', () => {
  it('accepts digits, keeps leading zeros as distinct text', () => {
    expect(validateTakaNumbers(['6245', '0123', '123'])).toEqual([null, null, null]);
  });

  it('rejects non-digits and more than 10 digits', () => {
    expect(validateTakaNumbers(['12a', '12 3', '-5', '12345678901'])).toEqual(['digits', 'digits', 'digits', 'too_long']);
  });

  it('flags duplicates within the list (the first one stays valid)', () => {
    expect(validateTakaNumbers(['6245', '6246', '6245'])).toEqual([null, null, 'duplicate']);
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

  it('cleans typed / pasted input to digits (max 10)', () => {
    expect(cleanTakaNo('62-45 a')).toBe('6245');
    expect(cleanTakaNo('123456789012')).toBe('1234567890');
  });

  it('server schemas: digits only, at least one taka on entry, empty set allowed on edit', () => {
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '0045', isDamaged: true }] }).success).toBe(true);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '45a' }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [] }).success).toBe(false);
    expect(takaEditSchema.safeParse({ takas: [], note: '' }).success).toBe(true);
    const parsed = takaEntrySchema.parse({ takas: [{ takaNo: ' 7 ' }], note: '  ' });
    expect(parsed.takas[0]).toEqual({ takaNo: '7', meters: null, isDamaged: false });
    expect(parsed.note).toBeNull();
  });

  it('summaries and sorting', () => {
    expect(takaSummary([{ isDamaged: false }, { isDamaged: true }, { isDamaged: false }])).toBe('3 takas (1 damage)');
    expect(takaSummary([{ isDamaged: false }])).toBe('1 taka');
    expect(['10', '9', '0009', '100'].sort(compareTakaNo)).toEqual(['0009', '9', '10', '100']);
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
    const ok = takaEntrySchema.parse({ takas: [{ takaNo: '1', meters: 105.555 }, { takaNo: '2' }] });
    expect(ok.takas.map((t) => t.meters)).toEqual([105.56, null]);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '1', meters: 0 }] }).success).toBe(false);
    expect(takaEntrySchema.safeParse({ takas: [{ takaNo: '1', meters: 10000 }] }).success).toBe(false);
    expect(takaEditSchema.parse({ takas: [{ id: 3, takaNo: '1', meters: 98 }], note: '' }).takas[0].meters).toBe(98);
  });
});
