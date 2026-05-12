// Event-Driven Compression Continuation
// D0 = impulse day, D1 = compression day, D2 = entry day

import type { TradeType } from '$lib/types';

export function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return isNaN(v) ? NaN : v;
  const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  return n;
}

export interface EventD0Data {
  prevClose: number;        // Close D-1
  open: number;             // Open D0
  high: number;             // High D0
  low: number;              // Low D0
  close: number;            // Close D0
  volume: number;           // Volume D0
  avgVol20: number;         // AvgVolume(20)
  atr14: number;            // ATR(14)
  high10d: number;          // Highest High за 10 дней до D0 (для LONG breakout)
  low10d: number;           // Lowest Low за 10 дней до D0 (для SHORT breakout)
}

export interface EventD0Metrics {
  direction: TradeType | null;
  gapPct: number;           // (Open_D0 - Close_D-1) / Close_D-1
  rangePct: number;         // Day Range / ATR14
  volRatio: number;         // Volume_D0 / AvgVol20
  closePosition: number;    // (Close - Low) / (High - Low)
  range: number;            // High - Low абсолютный
  midpoint: number;         // (High + Low) / 2
  breakout10d: boolean;     // Close > High10d (LONG) или Close < Low10d (SHORT)
}

export interface EventD0Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface EventD1Data {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EventD1Metrics {
  valid: boolean;
  isInsideDay: boolean;
  volRatioD1D0: number;     // Volume_D1 / Volume_D0
  lowAboveMid: boolean;     // Low_D1 > midpoint_D0 (LONG)
  highBelowMid: boolean;    // High_D1 < midpoint_D0 (SHORT)
  closeAboveMid: boolean;   // Close_D1 > midpoint_D0 (LONG)
  closeBelowMid: boolean;   // Close_D1 < midpoint_D0 (SHORT)
  errors: string[];
  details: string[];
}

export interface EventPosition {
  entry: number;
  stop: number;
  target1: number;          // +1R (50% exit)
  target2: number;          // +3R (final exit)
  riskPerShare: number;
  shares: number;
  positionValue: number;
  riskAmount: number;
  riskAtrRatio: number;
  entryStopRatio: number;   // (entry - stop) / ATR14 — должен быть ≤ 1.2
  invalidated: boolean;
  invalidReason: string;
}

// ─── D0 Metrics ───
export function calcEventD0Metrics(d: EventD0Data): EventD0Metrics {
  const range = d.high - d.low;
  const midpoint = (d.high + d.low) / 2;
  const gapPct = d.prevClose > 0 ? (d.open - d.prevClose) / d.prevClose : 0;
  const rangePct = d.atr14 > 0 ? range / d.atr14 : 0;
  const volRatio = d.avgVol20 > 0 ? d.volume / d.avgVol20 : 0;
  const closePosition = range > 0 ? (d.close - d.low) / range : 0;

  // Определяем направление
  let direction: TradeType | null = null;
  const isLong =
    gapPct >= 0.04 &&
    rangePct >= 1.5 &&
    volRatio >= 2.5 &&
    closePosition >= 0.75 &&
    d.close > d.high10d;

  const isShort =
    gapPct <= -0.04 &&
    rangePct >= 1.5 &&
    volRatio >= 2.5 &&
    closePosition <= 0.25 &&
    d.close < d.low10d;

  if (isLong) direction = 'LONG';
  else if (isShort) direction = 'SHORT';

  return {
    direction,
    gapPct,
    rangePct,
    volRatio,
    closePosition,
    range,
    midpoint,
    breakout10d: isLong ? d.close > d.high10d : isShort ? d.close < d.low10d : false
  };
}

// ─── D0 Validation ───
export function validateEventD0(d: EventD0Data, m: EventD0Metrics): EventD0Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (d.prevClose <= 0) errors.push('Close D-1 должен быть > 0');
  if (d.atr14 <= 0) errors.push('ATR14 должен быть > 0');

  // Gap
  const absgap = Math.abs(m.gapPct);
  if (absgap < 0.04) errors.push(`Gap ${(m.gapPct * 100).toFixed(1)}% — нужен ≥ 4%`);

  // Range / ATR
  if (m.rangePct < 1.5) errors.push(`Range/ATR = ${m.rangePct.toFixed(2)} — нужен ≥ 1.5`);
  if (m.rangePct > 4.0) warnings.push(`Range/ATR = ${m.rangePct.toFixed(2)} — очень широкий день`);

  // Volume
  if (m.volRatio < 2.5) errors.push(`VolRatio = ${m.volRatio.toFixed(2)}× — нужен ≥ 2.5×`);

  // Close position
  if (m.gapPct >= 0) {
    // LONG side
    if (m.closePosition < 0.75) errors.push(`ClosePosition = ${m.closePosition.toFixed(2)} — нужен ≥ 0.75 (закрытие в верхних 25%)`);
    if (!m.breakout10d) errors.push(`Close не выше 10-дневного максимума (${d.high10d.toFixed(2)})`);
  } else {
    // SHORT side
    if (m.closePosition > 0.25) errors.push(`ClosePosition = ${m.closePosition.toFixed(2)} — нужен ≤ 0.25 (закрытие в нижних 25%)`);
    if (!m.breakout10d) errors.push(`Close не ниже 10-дневного минимума (${d.low10d.toFixed(2)})`);
  }

  // ATR > 12% предупреждение
  if (d.atr14 / d.close > 0.12) warnings.push(`ATR/Price = ${(d.atr14 / d.close * 100).toFixed(1)}% > 12% — очень волатильная акция`);

  return { valid: errors.length === 0, errors, warnings };
}

// ─── D1 Compression ───
export function checkEventD1Compression(
  d0: { high: number; low: number; volume: number; atr14: number },
  d1: EventD1Data,
  direction: TradeType
): EventD1Metrics {
  const midpoint = (d0.high + d0.low) / 2;
  const volRatioD1D0 = d0.volume > 0 ? d1.volume / d0.volume : 0;
  const isInsideDay = d1.high <= d0.high && d1.low >= d0.low;
  const lowAboveMid = d1.low > midpoint;
  const highBelowMid = d1.high < midpoint;
  const closeAboveMid = d1.close > midpoint;
  const closeBelowMid = d1.close < midpoint;

  const errors: string[] = [];
  const details: string[] = [];

  // Volume compression
  if (volRatioD1D0 <= 0.7) {
    details.push(`✓ Volume D1/D0 = ${volRatioD1D0.toFixed(2)} ≤ 0.7 — объём снизился`);
  } else {
    errors.push(`Volume D1/D0 = ${volRatioD1D0.toFixed(2)} > 0.7 — объём слишком высокий`);
  }

  if (direction === 'LONG') {
    if (lowAboveMid) {
      details.push(`✓ Low D1 (${d1.low.toFixed(2)}) > Mid D0 (${midpoint.toFixed(2)}) — не пробил середину`);
    } else {
      errors.push(`Low D1 (${d1.low.toFixed(2)}) ≤ Mid D0 (${midpoint.toFixed(2)}) — пробил середину D0`);
    }
    if (closeAboveMid) {
      details.push(`✓ Close D1 (${d1.close.toFixed(2)}) > Mid D0 — закрытие выше середины`);
    } else {
      errors.push(`Close D1 (${d1.close.toFixed(2)}) ≤ Mid D0 (${midpoint.toFixed(2)}) — слабое закрытие`);
    }
  } else {
    if (highBelowMid) {
      details.push(`✓ High D1 (${d1.high.toFixed(2)}) < Mid D0 (${midpoint.toFixed(2)}) — не пробил середину`);
    } else {
      errors.push(`High D1 (${d1.high.toFixed(2)}) ≥ Mid D0 (${midpoint.toFixed(2)}) — пробил середину D0`);
    }
    if (closeBelowMid) {
      details.push(`✓ Close D1 (${d1.close.toFixed(2)}) < Mid D0 — закрытие ниже середины`);
    } else {
      errors.push(`Close D1 (${d1.close.toFixed(2)}) ≥ Mid D0 (${midpoint.toFixed(2)}) — слабое закрытие`);
    }
  }

  if (isInsideDay) details.push(`✓ Inside Day — High/Low внутри D0`);
  else details.push(`ℹ Не Inside Day (желательно, но не обязательно)`);

  return {
    valid: errors.length === 0,
    isInsideDay,
    volRatioD1D0,
    lowAboveMid,
    highBelowMid,
    closeAboveMid,
    closeBelowMid,
    errors,
    details
  };
}

// ─── Position Calculation ───
export function calcEventPosition(
  d0: { atr14: number },
  d1: EventD1Data,
  direction: TradeType,
  accountRisk: number
): EventPosition {
  const atr = d0.atr14;
  const entry = direction === 'LONG'
    ? d1.high + 0.1 * atr
    : d1.low - 0.1 * atr;
  const stop = direction === 'LONG'
    ? d1.low - 0.2 * atr
    : d1.high + 0.2 * atr;

  const riskPerShare = Math.abs(entry - stop);
  const entryStopRatio = atr > 0 ? riskPerShare / atr : 0;

  // Invalidation: (entry - stop) > 1.2 * ATR
  const invalidated = entryStopRatio > 1.2;
  const invalidReason = invalidated
    ? `Risk/ATR = ${entryStopRatio.toFixed(2)} > 1.2 — стоп слишком широкий`
    : '';

  const shares = invalidated || riskPerShare <= 0
    ? 0
    : Math.floor(accountRisk / riskPerShare);

  const riskAmount = shares * riskPerShare;
  const positionValue = shares * entry;

  // Targets
  const target1 = direction === 'LONG'
    ? entry + riskPerShare      // +1R
    : entry - riskPerShare;
  const target2 = direction === 'LONG'
    ? entry + 3 * riskPerShare  // +3R
    : entry - 3 * riskPerShare;

  return {
    entry,
    stop,
    target1,
    target2,
    riskPerShare,
    shares,
    positionValue,
    riskAmount,
    riskAtrRatio: entryStopRatio,
    entryStopRatio,
    invalidated,
    invalidReason
  };
}
