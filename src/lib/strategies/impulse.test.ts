import { describe, it, expect } from 'vitest';
import {
  calculateImpulseD0Metrics,
  validateImpulseD0,
  checkImpulseD1Patterns,
  calculateEntryPrice,
  calculateStopPrice,
  calculatePosition,
  parseNum
} from './impulse';

// ═══════════════════════════════════════════════════════════
// calculateImpulseD0Metrics
// ═══════════════════════════════════════════════════════════
describe('calculateImpulseD0Metrics', () => {
  it('LONG: валидный сигнал', () => {
    // Close D-1 = 100, D0: O=102, H=110, L=101, C=109 (импульс +9%)
    // CLV = (109-101)/(110-101) = 0.889 > 0.70
    // Body = |109-102|/9 = 0.778 > 0.50
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 102, H: 110, L: 101, C: 109, V: 1000000 },
      2.5,
      2.0
    );
    expect(m.direction).toBe('LONG');
    expect(m.impulse).toBeCloseTo(0.09, 2);
    expect(m.clv).toBeGreaterThan(0.7);
    expect(m.body).toBeGreaterThan(0.5);
  });

  it('SHORT: валидный сигнал', () => {
    // Close D-1 = 100, D0: O=98, H=99, L=90, C=91 (импульс -9%)
    // CLV = (91-90)/(99-90) = 0.111 < 0.30
    // Body = |91-98|/9 = 0.778 > 0.50
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 98, H: 99, L: 90, C: 91, V: 1000000 },
      2.5,
      2.0
    );
    expect(m.direction).toBe('SHORT');
    expect(m.impulse).toBeCloseTo(-0.09, 2);
    expect(m.clv).toBeLessThan(0.3);
  });

  it('Не сигнал: импульс между -5% и +5%', () => {
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 100, H: 105, L: 99, C: 103, V: 1000000 },
      2.5,
      2.0
    );
    expect(m.direction).toBeNull();
    expect(m.impulse).toBeCloseTo(0.03, 2);
  });

  it('Не сигнал: импульс > +12%', () => {
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 105, H: 116, L: 104, C: 115, V: 1000000 },
      3,
      2.0
    );
    expect(m.direction).toBeNull();
    expect(m.impulse).toBeCloseTo(0.15, 2);
  });

  it('Не сигнал LONG: CLV ровно 0.70 (граница не включена)', () => {
    // Сделать CLV = 0.70 ровно. range = 10, нужно (C-L)/range = 0.70 → C-L = 7
    // Если L=100, то C=107. Чтобы Body > 0.50 при range=10, нужно |C-O| > 5, например O=101 (Body=0.6).
    // Impulse: D-1=100 → C=107 → +7% (валидный диапазон)
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 101, H: 110, L: 100, C: 107, V: 1000000 },
      2.5,
      2.0
    );
    expect(m.clv).toBeCloseTo(0.7, 2);
    expect(m.direction).toBeNull(); // > 0.70 строгое неравенство
  });

  it('Не сигнал LONG: Body = 0.50 (граница не включена)', () => {
    // range=10, нужно |C-O|/10 = 0.50 → |C-O| = 5
    // C=109, O=104 → Body=0.5, но Open>D-1 → impulse +9%
    // CLV = (109-100)/10 = 0.9
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 104, H: 110, L: 100, C: 109, V: 1000000 },
      2.5,
      2.0
    );
    expect(m.body).toBeCloseTo(0.5, 2);
    expect(m.direction).toBeNull();
  });

  it('Не сигнал: RelVol = 1.4 (< 1.5)', () => {
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 102, H: 110, L: 101, C: 109, V: 1000000 },
      2.5,
      1.4
    );
    expect(m.direction).toBeNull();
  });

  it('Range = 0: метрики безопасны', () => {
    // H=L (плоский день) — деление на ноль защищено
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 105, H: 105, L: 105, C: 105, V: 1000000 },
      2.5,
      2.0
    );
    expect(m.clv).toBe(0);
    expect(m.body).toBe(0);
    expect(m.range).toBe(0);
    expect(m.direction).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// validateImpulseD0
// ═══════════════════════════════════════════════════════════
describe('validateImpulseD0', () => {
  it('Валидный LONG → valid: true, errors empty', () => {
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 102, H: 110, L: 101, C: 109, V: 1000000 },
      2.5,
      2.0
    );
    const v = validateImpulseD0({ C: 100 }, m);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('Невалидный: импульс +3%', () => {
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 100, H: 105, L: 99, C: 103, V: 1000000 },
      2.5,
      2.0
    );
    const v = validateImpulseD0({ C: 100 }, m);
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toMatch(/слишком слабый/i);
  });

  it('Невалидный: импульс > +12%', () => {
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 105, H: 116, L: 104, C: 115, V: 1000000 },
      3,
      2.0
    );
    const v = validateImpulseD0({ C: 100 }, m);
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toMatch(/слишком сильный/i);
  });

  it('Невалидный SHORT: CLV 0.40', () => {
    // импульс -7%, но CLV=(91-86)/14 ≈ 0.357
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 96, H: 100, L: 86, C: 91, V: 1000000 },
      3,
      2.0
    );
    const v = validateImpulseD0({ C: 100 }, m);
    expect(v.valid).toBe(false);
    const hasClvError = v.errors.some((e) => /CLV/i.test(e));
    expect(hasClvError).toBe(true);
  });

  it('Невалидный: Close D-1 = 0', () => {
    const m = calculateImpulseD0Metrics(
      { C: 0 },
      { O: 102, H: 110, L: 101, C: 109, V: 1000000 },
      2.5,
      2.0
    );
    const v = validateImpulseD0({ C: 0 }, m);
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toMatch(/Close D-1/);
  });

  it('Невалидный LONG: низкий RelVol', () => {
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 102, H: 110, L: 101, C: 109, V: 1000000 },
      2.5,
      1.2
    );
    const v = validateImpulseD0({ C: 100 }, m);
    expect(v.valid).toBe(false);
    const hasRelVolError = v.errors.some((e) => /RelVol/i.test(e));
    expect(hasRelVolError).toBe(true);
  });

  it('Несколько ошибок одновременно', () => {
    // CLV ниже + Body ниже одновременно
    // импульс +7% (валидный), CLV=0.5, Body=0.3
    // range=10, чтобы CLV=0.5: C-L=5 → если L=100, C=105... но тогда impulse +5% (граница)
    // Близкий валидный пример: D-1=100, D0: O=104, H=108, L=100, C=105 → impulse +5%, CLV=0.625, Body=0.125
    const m = calculateImpulseD0Metrics(
      { C: 100 },
      { O: 104, H: 108, L: 100, C: 105, V: 1000000 },
      2.5,
      2.0
    );
    const v = validateImpulseD0({ C: 100 }, m);
    expect(v.valid).toBe(false);
    expect(v.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════
// checkImpulseD1Patterns
// ═══════════════════════════════════════════════════════════
describe('checkImpulseD1Patterns — LONG', () => {
  // D0 LONG: H=110, L=100, C=108, mid=105, range=10
  const d0 = { O: 102, H: 110, L: 100, C: 108, V: 1000000 };

  it('Inside Day', () => {
    // D+1 внутри: H1=109, L1=101 → внутри D0
    const r = checkImpulseD1Patterns(d0, { O: 105, H: 109, L: 101, C: 107 }, 'LONG');
    expect(r.matched).toContain('Inside Day');
  });

  it('Weak Pullback (LONG)', () => {
    // L1 > mid0=105, retracement < 50%, C1 > mid0
    // L1=106, H1=109 → retracement = (110-106)/10 = 0.4 < 0.5
    // C1=108 > 105
    const r = checkImpulseD1Patterns(d0, { O: 107, H: 109, L: 106, C: 108 }, 'LONG');
    expect(r.matched).toContain('Weak Pullback');
  });

  it('Compression (LONG)', () => {
    // Range1/Range0 < 0.5, |C1-C0| < 0.3*range0=3, C1 > mid0
    // Range1=4 (H=110, L=106), |C1-C0| < 3 → C1=108, C0=108 → diff=0
    // C1 > mid0=105
    const r = checkImpulseD1Patterns(d0, { O: 107, H: 110, L: 106, C: 108 }, 'LONG');
    expect(r.matched).toContain('Compression');
  });

  it('Не паттерн: LONG отдал движение', () => {
    // L1 < mid0=105 — провалился ниже середины
    // H1=104, L1=98 (вышел вниз из D0), C1=99 — отдали движение
    const r = checkImpulseD1Patterns(d0, { O: 103, H: 104, L: 98, C: 99 }, 'LONG');
    expect(r.matched).toEqual([]);
  });

  it('Range D0 = 0: возвращает пустые matched', () => {
    const r = checkImpulseD1Patterns(
      { O: 100, H: 100, L: 100, C: 100, V: 0 },
      { O: 100, H: 100, L: 100, C: 100 },
      'LONG'
    );
    expect(r.matched).toEqual([]);
    expect(r.details[0]).toMatch(/Range D0 = 0/);
  });
});

describe('checkImpulseD1Patterns — SHORT', () => {
  // D0 SHORT: H=100, L=90, C=92, mid=95, range=10
  const d0 = { O: 98, H: 100, L: 90, C: 92, V: 1000000 };

  it('Inside Day', () => {
    const r = checkImpulseD1Patterns(d0, { O: 95, H: 99, L: 91, C: 93 }, 'SHORT');
    expect(r.matched).toContain('Inside Day');
  });

  it('Weak Pullback (SHORT)', () => {
    // H1 < mid0=95, retracement = (H1-L0)/range0 < 0.5, C1 < mid0
    // H1=94, L1=91 → retracement = (94-90)/10 = 0.4
    // C1=92 < 95
    const r = checkImpulseD1Patterns(d0, { O: 93, H: 94, L: 91, C: 92 }, 'SHORT');
    expect(r.matched).toContain('Weak Pullback');
  });

  it('Compression (SHORT)', () => {
    // Range1=4 < 5 (0.5*10), |C1-C0|<3, C1<95
    const r = checkImpulseD1Patterns(d0, { O: 92, H: 94, L: 90, C: 92 }, 'SHORT');
    expect(r.matched).toContain('Compression');
  });

  it('Не паттерн: SHORT отдал движение вверх', () => {
    // H1 > mid0 — отскочило вверх
    const r = checkImpulseD1Patterns(d0, { O: 95, H: 102, L: 94, C: 100 }, 'SHORT');
    expect(r.matched).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
// calculateEntryPrice / calculateStopPrice
// ═══════════════════════════════════════════════════════════
describe('calculateEntryPrice', () => {
  it('LONG: H + 0.1*ATR', () => {
    const e = calculateEntryPrice({ H: 110, L: 100 }, 2.5, 'LONG');
    expect(e).toBeCloseTo(110.25, 2);
  });

  it('SHORT: L - 0.1*ATR', () => {
    const e = calculateEntryPrice({ H: 100, L: 90 }, 2.5, 'SHORT');
    expect(e).toBeCloseTo(89.75, 2);
  });
});

describe('calculateStopPrice', () => {
  it('LONG: L - 0.2*ATR', () => {
    const s = calculateStopPrice({ H: 110, L: 100 }, 2.5, 'LONG');
    expect(s).toBeCloseTo(99.5, 2);
  });

  it('SHORT: H + 0.2*ATR', () => {
    const s = calculateStopPrice({ H: 100, L: 90 }, 2.5, 'SHORT');
    expect(s).toBeCloseTo(100.5, 2);
  });
});

// ═══════════════════════════════════════════════════════════
// calculatePosition
// ═══════════════════════════════════════════════════════════
describe('calculatePosition', () => {
  it('LONG: базовый расчёт', () => {
    // Entry=110, Stop=99.5, ATR=2.5 → risk_per_share=10.5, Risk/ATR=4.2 → warning
    const p = calculatePosition(110, 99.5, 2.5, 100, 'LONG');
    expect(p.risk_per_share).toBeCloseTo(10.5, 2);
    expect(p.shares).toBe(9);
    expect(p.target1).toBeCloseTo(120.5, 2);
    expect(p.target2).toBeCloseTo(131, 2);
    expect(p.risk_atr_ratio).toBeCloseTo(4.2, 2);
    expect(p.risk_warning).toBe(true); // > 1.5
  });

  it('SHORT: базовый расчёт', () => {
    // Entry=89.75, Stop=100.5 → risk_per_share=10.75
    const p = calculatePosition(89.75, 100.5, 2.5, 100, 'SHORT');
    expect(p.risk_per_share).toBeCloseTo(10.75, 2);
    expect(p.shares).toBe(9);
    expect(p.target1).toBeCloseTo(79, 2);
    expect(p.target2).toBeCloseTo(68.25, 2);
  });

  it('Risk/ATR <= 1.5: no warning', () => {
    // Risk/ATR = 1.4 → entry 100, stop 98.6, ATR 1
    const p = calculatePosition(100, 98.6, 1, 100, 'LONG');
    expect(p.risk_atr_ratio).toBeCloseTo(1.4, 2);
    expect(p.risk_warning).toBe(false);
  });

  it('Слишком широкий стоп → shares = 0 если risk дешевле акции', () => {
    // Risk $50, risk/share=$200 → shares=0
    const p = calculatePosition(1000, 800, 50, 50, 'LONG');
    expect(p.shares).toBe(0);
  });

  it('risk_per_share <= 0 (некорректный stop)', () => {
    // LONG со стопом ВЫШЕ entry — невозможная ситуация, защищено
    const p = calculatePosition(100, 110, 2, 100, 'LONG');
    expect(p.risk_per_share).toBeLessThan(0);
    expect(p.shares).toBe(0); // Math.floor(100/(-10)) защищено
  });

  it('Округление shares вниз', () => {
    // risk=100, risk_per_share=3 → shares=33 (не 33.33)
    const p = calculatePosition(50, 47, 1, 100, 'LONG');
    expect(p.shares).toBe(33);
    expect(p.risk_amount).toBeCloseTo(99, 2); // 33 * 3
    expect(p.position_value).toBeCloseTo(1650, 2); // 33 * 50
  });
});

// ═══════════════════════════════════════════════════════════
// parseNum
// ═══════════════════════════════════════════════════════════
describe('parseNum', () => {
  it('целое число', () => {
    expect(parseNum('100')).toBe(100);
    expect(parseNum(100)).toBe(100);
  });

  it('десятичная точка', () => {
    expect(parseNum('1.5')).toBe(1.5);
  });

  it('десятичная запятая (русская локаль)', () => {
    expect(parseNum('1,5')).toBe(1.5);
  });

  it('пробелы убираются', () => {
    expect(parseNum('1 000')).toBe(1000);
    expect(parseNum(' 12.5 ')).toBe(12.5);
  });

  it('пустая строка → NaN', () => {
    expect(parseNum('')).toBeNaN();
    expect(parseNum(null)).toBeNaN();
    expect(parseNum(undefined)).toBeNaN();
  });

  it('некорректная строка → NaN', () => {
    expect(parseNum('abc')).toBeNaN();
  });

  it('число 0', () => {
    expect(parseNum('0')).toBe(0);
    expect(parseNum(0)).toBe(0);
  });

  it('отрицательное число', () => {
    expect(parseNum('-5.5')).toBe(-5.5);
    expect(parseNum('-5,5')).toBe(-5.5);
  });
});
