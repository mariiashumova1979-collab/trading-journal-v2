// Post-Event Gap Continuation (B2)
// Scoring-based strategy: D0 quality score + D1 compression score
// Requires market regime filter + score thresholds before entry

import type { TradeType } from '$lib/types';

export function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return isNaN(v) ? NaN : v;
  const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  return n;
}

export interface PEGD0Data {
  prevClose: number;
  open: number; high: number; low: number; close: number; volume: number;
  avgVol20: number;
  atr14: number;
  highestClose10: number;   // HighestClose(10) для LONG
  lowestClose10: number;    // LowestClose(10) для SHORT
  highestClose20: number;   // для D0Score
  lowestClose20: number;
  // Market regime
  spyAboveEma20: boolean;
  qqqAboveEma20: boolean;
  vix: number;
  sectorAboveEma20: boolean;
}

export interface PEGD0Metrics {
  direction: TradeType | null;
  gapPct: number;
  rangePct: number;
  volRatio: number;
  closePosition: number;
  range: number;
  midpoint: number;
  breakout10: boolean;       // > highestClose10 (LONG) или < lowestClose10 (SHORT)
  breakout20: boolean;       // для D0Score
  marketOk: boolean;         // SPY/QQQ/VIX regime filter
  d0Score: number;           // 0..6
}

export interface PEGD0Validation {
  valid: boolean;            // прошёл core conditions + marketOk + d0Score >= 3
  coreValid: boolean;        // прошёл базовые условия D0
  errors: string[];
  warnings: string[];
}

export interface PEGD1Data {
  high: number; low: number; close: number; volume: number;
}

export interface PEGD1Metrics {
  valid: boolean;
  isInsideDay: boolean;
  volRatioD1D0: number;
  rangeRatio: number;             // RangeD1 / RangeD0
  retracement: number;            // 0..1
  closeAboveMid: boolean;
  closeBelowMid: boolean;
  lowAboveLowD0: boolean;         // LONG only
  highBelowHighD0: boolean;       // SHORT only
  compressionScore: number;       // 0..6
  errors: string[];
  details: string[];
}

export interface PEGPosition {
  entry: number;
  stop: number;
  target1: number;      // +1.5R partial
  target2: number;      // +2.2R final
  riskPerShare: number;
  shares: number;
  positionValue: number;
  riskAmount: number;
  riskAtrRatio: number;
}

// ─── D0 Metrics + Score ───
export function calcPEGD0Metrics(d: PEGD0Data): PEGD0Metrics {
  const range = d.high - d.low;
  const midpoint = (d.high + d.low) / 2;
  const gapPct = d.prevClose > 0 ? (d.open - d.prevClose) / d.prevClose : 0;
  const rangePct = d.atr14 > 0 ? range / d.atr14 : 0;
  const volRatio = d.avgVol20 > 0 ? d.volume / d.avgVol20 : 0;
  const closePosition = range > 0 ? (d.close - d.low) / range : 0;

  const isLongSide = gapPct >= 0;
  const breakout10 = isLongSide ? d.close > d.highestClose10 : d.close < d.lowestClose10;
  const breakout20 = isLongSide ? d.close > d.highestClose20 : d.close < d.lowestClose20;

  // Core D0 conditions
  const coreLong =
    gapPct >= 0.04 && volRatio >= 3.0 && rangePct >= 1.5 &&
    closePosition >= 0.70 && d.close > d.open && breakout10;

  const coreShort =
    gapPct <= -0.04 && volRatio >= 3.0 && rangePct >= 1.5 &&
    closePosition <= 0.30 && d.close < d.open && breakout10;

  // Market regime filter
  let marketOk = false;
  if (coreLong) {
    marketOk = d.spyAboveEma20 && d.qqqAboveEma20 && d.vix < 25;
  } else if (coreShort) {
    marketOk = !d.spyAboveEma20 && !d.qqqAboveEma20;
  }

  let direction: TradeType | null = null;
  if (coreLong) direction = 'LONG';
  else if (coreShort) direction = 'SHORT';

  // D0 Quality Score (0..6)
  let d0Score = 0;
  if (direction === 'LONG') {
    if (gapPct >= 0.06) d0Score++;
    if (volRatio >= 5) d0Score++;
    if (rangePct >= 2) d0Score++;
    if (closePosition >= 0.85) d0Score++;
    if (breakout20) d0Score++;
    if (d.sectorAboveEma20) d0Score++;
  } else if (direction === 'SHORT') {
    if (gapPct <= -0.06) d0Score++;
    if (volRatio >= 5) d0Score++;
    if (rangePct >= 2) d0Score++;
    if (closePosition <= 0.15) d0Score++;
    if (breakout20) d0Score++;
    if (!d.sectorAboveEma20) d0Score++;
  }

  return {
    direction, gapPct, rangePct, volRatio, closePosition,
    range, midpoint, breakout10, breakout20, marketOk, d0Score
  };
}

// ─── D0 Validation ───
export function validatePEGD0(d: PEGD0Data, m: PEGD0Metrics): PEGD0Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (d.prevClose <= 0) errors.push('Close D-1 должен быть > 0');
  if (d.atr14 <= 0) errors.push('ATR14 должен быть > 0');
  if (d.avgVol20 <= 0) errors.push('AvgVol20 должен быть > 0');

  const absgap = Math.abs(m.gapPct);
  if (absgap < 0.04) errors.push(`Gap ${(m.gapPct * 100).toFixed(1)}% — нужен ≥ ±4%`);
  if (m.volRatio < 3.0) errors.push(`RVOL = ${m.volRatio.toFixed(2)}× — нужен ≥ 3.0×`);
  if (m.rangePct < 1.5) errors.push(`Range/ATR = ${m.rangePct.toFixed(2)} — нужен ≥ 1.5`);

  if (m.gapPct >= 0) {
    if (m.closePosition < 0.70) errors.push(`ClosePosition = ${m.closePosition.toFixed(2)} — нужен ≥ 0.70`);
    if (d.close <= d.open) errors.push(`Close ≤ Open — нужно зелёное закрытие`);
    if (!m.breakout10) errors.push(`Close ≤ HighestClose(10) = ${d.highestClose10.toFixed(2)}`);
  } else {
    if (m.closePosition > 0.30) errors.push(`ClosePosition = ${m.closePosition.toFixed(2)} — нужен ≤ 0.30`);
    if (d.close >= d.open) errors.push(`Close ≥ Open — нужно красное закрытие`);
    if (!m.breakout10) errors.push(`Close ≥ LowestClose(10) = ${d.lowestClose10.toFixed(2)}`);
  }

  if (d.atr14 / d.close > 0.08) warnings.push(`ATR/Price = ${(d.atr14 / d.close * 100).toFixed(1)}% > 8%`);
  if (d.atr14 / d.close < 0.02) warnings.push(`ATR/Price < 2% — слишком тихая бумага`);

  const coreValid = errors.length === 0;

  // Дополнительные ошибки для финального valid: market regime + score
  if (coreValid && !m.marketOk) {
    if (m.direction === 'LONG') {
      errors.push('Market regime: SPY/QQQ должны быть выше EMA20, VIX < 25');
    } else {
      errors.push('Market regime: SPY/QQQ должны быть ниже EMA20');
    }
  }
  if (coreValid && m.d0Score < 3) {
    errors.push(`D0Score = ${m.d0Score}/6 — нужен ≥ 3`);
  }

  return { valid: errors.length === 0, coreValid, errors, warnings };
}

// ─── D1 Compression + Score ───
export function calcPEGD1Compression(
  d0: { high: number; low: number; volume: number; midpoint: number; range: number },
  d1: PEGD1Data,
  direction: TradeType
): PEGD1Metrics {
  const volRatioD1D0 = d0.volume > 0 ? d1.volume / d0.volume : 0;
  const range1 = d1.high - d1.low;
  const rangeRatio = d0.range > 0 ? range1 / d0.range : 0;
  const isInsideDay = d1.high <= d0.high && d1.low >= d0.low;
  const closeAboveMid = d1.close > d0.midpoint;
  const closeBelowMid = d1.close < d0.midpoint;
  const lowAboveLowD0 = d1.low > d0.low;
  const highBelowHighD0 = d1.high < d0.high;

  // Retracement
  let retracement = 0;
  if (d0.range > 0) {
    if (direction === 'LONG') {
      retracement = (d0.high - d1.close) / d0.range;
    } else {
      retracement = (d1.close - d0.low) / d0.range;
    }
  }

  const errors: string[] = [];
  const details: string[] = [];

  // Volume
  if (volRatioD1D0 <= 0.70) {
    details.push(`✓ Volume D1/D0 = ${volRatioD1D0.toFixed(2)} ≤ 0.70`);
  } else {
    errors.push(`Volume D1/D0 = ${volRatioD1D0.toFixed(2)} > 0.70`);
  }

  // Range
  if (rangeRatio <= 0.75) {
    details.push(`✓ Range D1/D0 = ${rangeRatio.toFixed(2)} ≤ 0.75`);
  } else {
    errors.push(`Range D1/D0 = ${rangeRatio.toFixed(2)} > 0.75`);
  }

  // Retracement
  if (retracement <= 0.35) {
    details.push(`✓ Retracement = ${(retracement * 100).toFixed(0)}% ≤ 35%`);
  } else {
    errors.push(`Retracement = ${(retracement * 100).toFixed(0)}% > 35%`);
  }

  if (direction === 'LONG') {
    if (lowAboveLowD0) details.push(`✓ Low D1 > Low D0`);
    else errors.push(`Low D1 (${d1.low.toFixed(2)}) ≤ Low D0 (${d0.low.toFixed(2)})`);
    if (closeAboveMid) details.push(`✓ Close D1 > Mid D0`);
    else errors.push(`Close D1 (${d1.close.toFixed(2)}) ≤ Mid D0 (${d0.midpoint.toFixed(2)})`);
  } else {
    if (highBelowHighD0) details.push(`✓ High D1 < High D0`);
    else errors.push(`High D1 (${d1.high.toFixed(2)}) ≥ High D0 (${d0.high.toFixed(2)})`);
    if (closeBelowMid) details.push(`✓ Close D1 < Mid D0`);
    else errors.push(`Close D1 (${d1.close.toFixed(2)}) ≥ Mid D0 (${d0.midpoint.toFixed(2)})`);
  }

  // Compression Score (0..6)
  let compressionScore = 0;
  if (isInsideDay) compressionScore++;
  if (volRatioD1D0 <= 0.50) compressionScore++;
  if (rangeRatio <= 0.60) compressionScore++;
  if (retracement <= 0.25) compressionScore++;
  if (direction === 'LONG') {
    const closeInUpperThird = range1 > 0 && (d1.close - d1.low) / range1 >= 2/3;
    if (closeInUpperThird) compressionScore++;
  } else {
    const closeInLowerThird = range1 > 0 && (d1.close - d1.low) / range1 <= 1/3;
    if (closeInLowerThird) compressionScore++;
  }
  // 6-й балл за нечто условное — Inside + low retracement
  if (isInsideDay && retracement <= 0.20) compressionScore++;

  details.push(`Compression Score: ${compressionScore}/6`);

  // Финальная валидация — нужны все core conditions + score >= 2
  const baseValid = errors.length === 0;
  if (baseValid && compressionScore < 2) {
    errors.push(`Compression Score = ${compressionScore}/6 — нужен ≥ 2`);
  }

  return {
    valid: errors.length === 0,
    isInsideDay, volRatioD1D0, rangeRatio, retracement,
    closeAboveMid, closeBelowMid, lowAboveLowD0, highBelowHighD0,
    compressionScore, errors, details
  };
}

// ─── Position ───
export function calcPEGPosition(
  d0: { atr14: number },
  d1: PEGD1Data,
  direction: TradeType,
  accountRisk: number
): PEGPosition {
  const atr = d0.atr14;
  const entry = direction === 'LONG'
    ? d1.high + 0.10 * atr
    : d1.low - 0.10 * atr;
  const stop = direction === 'LONG'
    ? d1.low - 0.20 * atr
    : d1.high + 0.20 * atr;

  const riskPerShare = Math.abs(entry - stop);
  const riskAtrRatio = atr > 0 ? riskPerShare / atr : 0;
  const shares = riskPerShare > 0 ? Math.floor(accountRisk / riskPerShare) : 0;
  const positionValue = shares * entry;
  const riskAmount = shares * riskPerShare;

  // T1 +1.5R, T2 +2.2R
  const target1 = direction === 'LONG'
    ? entry + 1.5 * riskPerShare
    : entry - 1.5 * riskPerShare;
  const target2 = direction === 'LONG'
    ? entry + 2.2 * riskPerShare
    : entry - 2.2 * riskPerShare;

  return { entry, stop, target1, target2, riskPerShare, shares, positionValue, riskAmount, riskAtrRatio };
}
