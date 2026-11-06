import { describe, expect, it } from 'vitest';
import { allowedUntil, checkLocation, DEFAULT_LOGIN_HOURS, haversineMeters, istInstant, timeLabel, timeLabelHi } from './loginLimits';

const at = (ymd: string, hhmm: string) => istInstant(ymd, hhmm);
const place = { name: 'Factory', latitude: 21.17, longitude: 72.83, radiusM: 200 };

describe('QC login hours', () => {
  it('allows inside the window until the end time', () => {
    const u = allowedUntil(at('2026-11-05', '10:00'), DEFAULT_LOGIN_HOURS, []);
    expect(u?.getTime()).toBe(at('2026-11-05', '19:20').getTime());
  });
  it('refuses before the start and from the end time on', () => {
    expect(allowedUntil(at('2026-11-05', '08:29'), DEFAULT_LOGIN_HOURS, [])).toBeNull();
    expect(allowedUntil(at('2026-11-05', '19:20'), DEFAULT_LOGIN_HOURS, [])).toBeNull();
  });
  it('respects the allowed days (Sunday = 7)', () => {
    const hours = { ...DEFAULT_LOGIN_HOURS, days: [1, 2, 3, 4, 5, 6] };
    expect(allowedUntil(at('2026-11-08', '10:00'), hours, [])).toBeNull(); // a Sunday
    expect(allowedUntil(at('2026-11-09', '10:00'), hours, [])).not.toBeNull();
  });
  it('an extra-time grant lets him in after hours, only that day, until its time', () => {
    const g = [{ grantDate: '2026-11-05', untilTime: '21:00' }];
    expect(allowedUntil(at('2026-11-05', '20:00'), DEFAULT_LOGIN_HOURS, g)?.getTime()).toBe(at('2026-11-05', '21:00').getTime());
    expect(allowedUntil(at('2026-11-05', '21:00'), DEFAULT_LOGIN_HOURS, g)).toBeNull();
    expect(allowedUntil(at('2026-11-06', '20:00'), DEFAULT_LOGIN_HOURS, g)).toBeNull();
  });
  it('labels', () => {
    expect(timeLabel('19:20')).toBe('7:20 pm');
    expect(timeLabelHi('19:20')).toContain('7:20');
  });
});

describe('QC login place', () => {
  it('no places configured → not enforced', () => {
    expect(checkLocation(null, []).inside).toBe(true);
  });
  it('a missing location is outside once places exist', () => {
    expect(checkLocation(null, [place]).inside).toBe(false);
  });
  it('radius + accuracy (capped at 100 m)', () => {
    const north = (m: number) => ({ lat: place.latitude + m / 111_195, lng: place.longitude });
    expect(Math.round(haversineMeters(north(150), { lat: place.latitude, lng: place.longitude }))).toBeGreaterThan(145);
    expect(checkLocation({ ...north(150), accuracy: 0 }, [place]).inside).toBe(true);
    expect(checkLocation({ ...north(250), accuracy: 0 }, [place]).inside).toBe(false);
    expect(checkLocation({ ...north(250), accuracy: 80 }, [place]).inside).toBe(true);
    expect(checkLocation({ ...north(350), accuracy: 5000 }, [place]).inside).toBe(false); // cap 100 m
  });
});
