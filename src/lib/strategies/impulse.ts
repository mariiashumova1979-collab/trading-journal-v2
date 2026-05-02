import type { OHLCV, SetupMetrics, TradeType } from '../types';

export interface ImpulseMetrics extends SetupMetrics {
  direction: TradeType | null;
}

export function calculateImpulseD0Metrics(
  d_1: { C: number },
  d0: OHLCV,
  atr: number,
  rel_vol: number
): ImpulseMetrics {
  const O = d0.O ?? 0;
  const H = d0.H ?? 0;
  const L = d0.L ?? 0;
  const C = d0.C ?? 0;

  const impulse = d_1.C > 0 ? (C - d_1.C) / d_1.C : 0;
  const range = H - L;
  const clv = range > 0 ? (C - L) / range : 0;
  const body = range > 0 ? Math.abs(C - O) / range : 0;
  const mid = (H + L) / 2;

  let direction: TradeType | null = null;
  if (impulse >= 0.05 && impulse <= 0.12 && clv > 0.7 && body > 0.5 && rel_vol >= 1.5) {
    direction = 'LONG';
  } else if (impulse <= -0.05 && impulse >= -0.12 && clv < 0.3 && body > 0.5 && rel_vol >= 1.5) {
    direction = 'SHORT';
  }

  return {
    impulse,
    clv,
    body,
    range,
    mid,
    vol_ratio: rel_vol,
    direction
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateImpulseD0(
  d_1: { C: number },
  metrics: ImpulseMetrics
): ValidationResult {
  const errors: string[] = [];
  const m = metrics;

  if (d_1.C === undefined || d_1.C === 0 || isNaN(d_1.C)) {
    errors.push('Close D-1: некорректное значение');
    return { valid: false, errors };
  }

  const impulse = m.impulse ?? 0;
  const isLong = impulse >= 0.05 && impulse <= 0.12;
  const isShort = impulse <= -0.05 && impulse >= -0.12;

  if (!isLong && !isShort) {
    if (impulse > 0 && impulse < 0.05) {
      errors.push('Impulse +' + (impulse * 100).toFixed(1) + '% < +5% — слишком слабый для LONG');
    } else if (impulse > 0.12) {
      errors.push('Impulse +' + (impulse * 100).toFixed(1) + '% > +12% — слишком сильный (риск разворота)');
    } else if (impulse < 0 && impulse > -0.05) {
      errors.push('Impulse ' + (impulse * 100).toFixed(1) + '% > −5% — слишком слабый для SHORT');
    } else if (impulse < -0.12) {
      errors.push('Impulse ' + (impulse * 100).toFixed(1) + '% < −12% — слишком сильный');
    } else {
      errors.push('Impulse ' + (impulse * 100).toFixed(1) + '% — недостаточен для LONG (>=+5%) или SHORT (<=-5%)');
    }
    return { valid: false, errors };
  }

  if (isLong) {
    if ((m.clv ?? 0) <= 0.7) errors.push('LONG: CLV ' + (m.clv ?? 0).toFixed(2) + ' <= 0.70 — закрытие не в верхней части свечи');
    if ((m.body ?? 0) <= 0.5) errors.push('LONG: Body ' + (m.body ?? 0).toFixed(2) + ' <= 0.50 — свеча слабая/дожи');
    if (m.vol_ratio !== undefined && m.vol_ratio < 1.5) errors.push('LONG: RelVol ' + m.vol_ratio.toFixed(2) + ' < 1.5 — объём слабый');
  }

  if (isShort) {
    if ((m.clv ?? 1) >= 0.3) errors.push('SHORT: CLV ' + (m.clv ?? 0).toFixed(2) + ' >= 0.30 — закрытие не в нижней части свечи');
    if ((m.body ?? 0) <= 0.5) errors.push('SHORT: Body ' + (m.body ?? 0).toFixed(2) + ' <= 0.50 — свеча слабая/дожи');
    if (m.vol_ratio !== undefined && m.vol_ratio < 1.5) errors.push('SHORT: RelVol ' + m.vol_ratio.toFixed(2) + ' < 1.5 — объём слабый');
  }

  if (m.direction === null && errors.length === 0) {
    errors.push('D0 не прошёл проверку — direction не определён');
  }

  return { valid: errors.length === 0 && m.direction !== null, errors };
}

export type PatternName = 'Inside Day' | 'Weak Pullback' | 'Compression';

export interface PatternCheckResult {
  matched: PatternName[];
  details: string[];
}

export function checkImpulseD1Patterns(
  d0: OHLCV,
  d1: OHLCV,
  direction: TradeType
): PatternCheckResult {
  const H0 = d0.H ?? 0;
  const L0 = d0.L ?? 0;
  const C0 = d0.C ?? 0;
  const H1 = d1.H ?? 0;
  const L1 = d1.L ?? 0;
  const C1 = d1.C ?? 0;

  const range0 = H0 - L0;
  const range1 = H1 - L1;
  const mid0 = (H0 + L0) / 2;

  if (range0 <= 0) {
    return { matched: [], details: ['Range D0 = 0, расчёт паттернов невозможен'] };
  }

  const isInsideDay = H1 <= H0 && L1 >= L0;

  let isWeakPullback = false;
  let isCompression = false;

  if (direction === 'LONG') {
    isWeakPullback = L1 > mid0 && (H0 - L1) / range0 < 0.5 && C1 > mid0;
    isCompression = range1 / range0 < 0.5 && Math.abs(C1 - C0) < 0.3 * range0 && C1 > mid0;
  } else {
    isWeakPullback = H1 < mid0 && (H1 - L0) / range0 < 0.5 && C1 < mid0;
    isCompression = range1 / range0 < 0.5 && Math.abs(C1 - C0) < 0.3 * range0 && C1 < mid0;
  }

  const matched: PatternName[] = [];
  if (isInsideDay) matched.push('Inside Day');
  if (isWeakPullback) matched.push('Weak Pullback');
  if (isCompression) matched.push('Compression');

  const details: string[] = [
    'Inside Day: ' + (isInsideDay ? 'ok' : 'no') + ' (H1 ' + H1.toFixed(2) + '<=' + H0.toFixed(2) + ' AND L1 ' + L1.toFixed(2) + '>=' + L0.toFixed(2) + ')',
    direction === 'LONG'
      ? 'Weak Pullback (LONG): ' + (isWeakPullback ? 'ok' : 'no') + ' (L1>' + mid0.toFixed(2) + ', retracement<50%, C1>' + mid0.toFixed(2) + ')'
      : 'Weak Pullback (SHORT): ' + (isWeakPullback ? 'ok' : 'no') + ' (H1<' + mid0.toFixed(2) + ', retracement<50%, C1<' + mid0.toFixed(2) + ')',
    'Compression: ' + (isCompression ? 'ok' : 'no') + ' (Range1/Range0=' + (range1 / range0).toFixed(2) + '<0.5)'
  ];

  return { matched, details };
}

export function calculateEntryPrice(d0: OHLCV, atr: number, direction: TradeType): number {
  const H = d0.H ?? 0;
  const L = d0.L ?? 0;
  return direction === 'LONG' ? H + 0.1 * atr : L - 0.1 * atr;
}

export function calculateStopPrice(d0: OHLCV, atr: number, direction: TradeType): number {
  const H = d0.H ?? 0;
  const L = d0.L ?? 0;
  return direction === 'LONG' ? L - 0.2 * atr : H + 0.2 * atr;
}

export interface PositionCalc {
  entry: number;
  stop: number;
  risk_per_share: number;
  shares: number;
  position_value: number;
  risk_amount: number;
  risk_atr_ratio: number;
  target1: number;
  target2: number;
  risk_warning: boolean;
}

export function calculatePosition(
  entry: number,
  stop: number,
  atr: number,
  risk_amount: number,
  direction: TradeType
): PositionCalc {
  const risk_per_share = direction === 'LONG' ? entry - stop : stop - entry;
  const shares = risk_per_share > 0 ? Math.floor(risk_amount / risk_per_share) : 0;
  const position_value = shares * entry;
  const risk_atr_ratio = atr > 0 ? risk_per_share / atr : 0;
  const target1 = direction === 'LONG' ? entry + risk_per_share : entry - risk_per_share;
  const target2 = direction === 'LONG' ? entry + 2 * risk_per_share : entry - 2 * risk_per_share;

  return {
    entry,
    stop,
    risk_per_share,
    shares,
    position_value,
    risk_amount: shares * risk_per_share,
    risk_atr_ratio,
    target1,
    target2,
    risk_warning: risk_atr_ratio > 1.5
  };
}

export function parseNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  return parseFloat(value.replace(',', '.').replace(/\s/g, ''));
}
