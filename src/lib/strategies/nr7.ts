// NR7 Volatility Expansion Breakout
// T0 = NR7 setup, D+1 = entry trigger, D+2 = adverse check, D+5 = time stop

import type { TradeType } from '$lib/types';

export function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
}

// ─── Market Regime ───
export type SpyRegime = 'LONG' | 'SHORT' | 'NEUTRAL';

export function getNr7Regime(spyClose: number, spyEma50: number, vix: number): SpyRegime {
  if (vix >= 35) return 'NEUTRAL';
  if (spyEma50 <= 0) return 'NEUTRAL';
  return spyClose > spyEma50 ? 'LONG' : 'SHORT';
}

// ─── T0 Input ───
export interface NR7D0Data {
  // SPY/VIX
  spyClose: number;
  spyEma50: number;
  vix: number;
  // Stock T0
  open: number;
  high: number;
  low: number;
  close: number;
  ema21: number;
  ema50: number;
  atr14: number;
  // Prev 6 days
  minRangePrev6: number;   // Минимальный Range за 6 дней до T0 (для NR7 нужен Range_T0 < minRangePrev6)
  high7: number;           // Maximum High за последние 7 дней (включая T0)
  low7: number;            // Minimum Low за последние 7 дней (включая T0)
}

export interface NR7D0Metrics {
  direction: TradeType | null;
  spyRegime: SpyRegime;
  range: number;
  rangeAtrRatio: number;
  isNR7: boolean;
  mid7: number;
  closeAboveMid7: boolean;
  closeBelowMid7: boolean;
  ema21AboveEma50: boolean;
  ema21BelowEma50: boolean;
  closeAboveEma21: boolean;
  closeBelowEma21: boolean;
}

export interface NR7D0Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: { label: string; ok: boolean; value: string }[];
}

// ─── T0 Metrics ───
export function calcNR7D0Metrics(d: NR7D0Data): NR7D0Metrics {
  const range = d.high - d.low;
  const rangeAtrRatio = d.atr14 > 0 ? range / d.atr14 : 0;
  const spyRegime = getNr7Regime(d.spyClose, d.spyEma50, d.vix);
  const isNR7 = d.minRangePrev6 > 0 && range < d.minRangePrev6;
  const mid7 = d.low7 + 0.5 * (d.high7 - d.low7);
  const closeAboveMid7 = d.close >= mid7;
  const closeBelowMid7 = d.close <= mid7;
  const ema21AboveEma50 = d.ema21 > d.ema50;
  const ema21BelowEma50 = d.ema21 < d.ema50;
  const closeAboveEma21 = d.close > d.ema21;
  const closeBelowEma21 = d.close < d.ema21;

  const longValid =
    spyRegime === 'LONG' &&
    isNR7 &&
    closeAboveEma21 && ema21AboveEma50 &&
    closeAboveMid7 &&
    rangeAtrRatio < 0.75;

  const shortValid =
    spyRegime === 'SHORT' &&
    isNR7 &&
    closeBelowEma21 && ema21BelowEma50 &&
    closeBelowMid7 &&
    rangeAtrRatio < 0.75;

  return {
    direction: longValid ? 'LONG' : shortValid ? 'SHORT' : null,
    spyRegime, range, rangeAtrRatio, isNR7, mid7,
    closeAboveMid7, closeBelowMid7,
    ema21AboveEma50, ema21BelowEma50,
    closeAboveEma21, closeBelowEma21
  };
}

// ─── T0 Validation ───
export function validateNR7D0(d: NR7D0Data, m: NR7D0Metrics): NR7D0Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (d.atr14 <= 0) errors.push('ATR14 должен быть > 0');
  if (d.high <= d.low) errors.push('High должен быть > Low');
  if (d.high7 <= d.low7) errors.push('High7 должен быть > Low7');

  const checks: { label: string; ok: boolean; value: string }[] = [];

  // Market
  checks.push({
    label: 'Market Regime',
    ok: m.spyRegime !== 'NEUTRAL',
    value: m.spyRegime === 'NEUTRAL'
      ? (d.vix >= 35 ? `VIX ${d.vix.toFixed(1)} ≥ 35 — сделки запрещены` : 'SPY vs EMA50')
      : `${m.spyRegime} (SPY ${d.spyClose.toFixed(2)} vs EMA50 ${d.spyEma50.toFixed(2)}, VIX ${d.vix.toFixed(1)})`
  });

  // NR7
  checks.push({
    label: 'NR7 (Range < min Range[-6..-1])',
    ok: m.isNR7,
    value: `Range ${m.range.toFixed(2)} vs minRange(6) ${d.minRangePrev6.toFixed(2)}`
  });

  // Trend
  if (m.spyRegime === 'LONG' || (!m.direction && d.close > d.ema21)) {
    checks.push({ label: 'Close > EMA21', ok: m.closeAboveEma21, value: `${d.close.toFixed(2)} vs ${d.ema21.toFixed(2)}` });
    checks.push({ label: 'EMA21 > EMA50', ok: m.ema21AboveEma50, value: `${d.ema21.toFixed(2)} vs ${d.ema50.toFixed(2)}` });
    checks.push({ label: 'Close ≥ Mid7', ok: m.closeAboveMid7, value: `${d.close.toFixed(2)} vs Mid7 ${m.mid7.toFixed(2)}` });
  } else if (m.spyRegime === 'SHORT' || (!m.direction && d.close < d.ema21)) {
    checks.push({ label: 'Close < EMA21', ok: m.closeBelowEma21, value: `${d.close.toFixed(2)} vs ${d.ema21.toFixed(2)}` });
    checks.push({ label: 'EMA21 < EMA50', ok: m.ema21BelowEma50, value: `${d.ema21.toFixed(2)} vs ${d.ema50.toFixed(2)}` });
    checks.push({ label: 'Close ≤ Mid7', ok: m.closeBelowMid7, value: `${d.close.toFixed(2)} vs Mid7 ${m.mid7.toFixed(2)}` });
  }

  // Range/ATR compression
  checks.push({
    label: 'Range/ATR < 0.75',
    ok: m.rangeAtrRatio < 0.75,
    value: m.rangeAtrRatio.toFixed(3)
  });

  // ATR/Close ≥ 1.5%
  const atrPct = d.atr14 / d.close;
  checks.push({
    label: 'ATR/Close ≥ 1.5%',
    ok: atrPct >= 0.015,
    value: (atrPct * 100).toFixed(2) + '%'
  });

  if (m.spyRegime === 'NEUTRAL') {
    if (d.vix >= 35) errors.push(`VIX = ${d.vix.toFixed(1)} ≥ 35 — новые сделки запрещены`);
    else errors.push('SPY режим не определён');
  }

  if (atrPct > 0.10) warnings.push(`ATR/Close = ${(atrPct * 100).toFixed(1)}% — очень волатильная`);

  return { valid: m.direction !== null && errors.length === 0, errors, warnings, checks };
}

// ─── Entry & Stop ───
export interface NR7Entry {
  entry: number;           // BuyStop / SellStop trigger price
  stop: number;
  stopDistance: number;
  target1: number;         // +1.5×ATR
  target2: number;         // +3×ATR
  shares: number;
  positionValue: number;
  riskAmount: number;
  excluded: boolean;
  excludedReason: string;
}

// Уровни рассчитываются от T0 H/L
export function calcNR7Entry(
  highT0: number,
  lowT0: number,
  atr14: number,
  direction: TradeType,
  capital: number
): NR7Entry {
  const entry = direction === 'LONG'
    ? highT0 + 0.10 * atr14
    : lowT0 - 0.10 * atr14;
  const stop = direction === 'LONG'
    ? lowT0 - 0.10 * atr14
    : highT0 + 0.10 * atr14;
  const stopDistance = Math.abs(entry - stop);
  const target1 = direction === 'LONG' ? entry + 1.5 * atr14 : entry - 1.5 * atr14;
  const target2 = direction === 'LONG' ? entry + 3.0 * atr14 : entry - 3.0 * atr14;

  // Exclude if StopDistance > 2×ATR
  const excluded = stopDistance > 2 * atr14;
  const excludedReason = excluded
    ? `StopDistance ${stopDistance.toFixed(2)} > 2×ATR (${(2 * atr14).toFixed(2)}) — сделку исключить`
    : '';

  const shares = stopDistance > 0 && !excluded
    ? Math.floor((capital * 0.01) / stopDistance)
    : 0;
  const positionValue = shares * entry;
  const riskAmount = shares * stopDistance;

  return { entry, stop, stopDistance, target1, target2, shares, positionValue, riskAmount, excluded, excludedReason };
}

// ─── D+1 Gap Check ───
export type EntryMode = 'STOP_ORDER' | 'WAIT_PULLBACK' | 'GAP_FAR';

export function checkD1Gap(
  buyOrSellStop: number,
  openD1: number,
  highT0: number,
  lowT0: number,
  atr14: number,
  direction: TradeType
): { mode: EntryMode; reason: string; pullbackLevel: number } {
  const pullbackLevel = direction === 'LONG' ? highT0 : lowT0;

  if (direction === 'LONG') {
    if (openD1 <= buyOrSellStop) {
      return {
        mode: 'STOP_ORDER',
        reason: `Open ${openD1.toFixed(2)} ≤ BuyStop ${buyOrSellStop.toFixed(2)} — выставить Buy Stop ордер`,
        pullbackLevel
      };
    }
    // Open > BuyStop — gap up
    if (openD1 > buyOrSellStop + 1.0 * atr14) {
      return {
        mode: 'GAP_FAR',
        reason: `Open ${openD1.toFixed(2)} >> BuyStop (gap > 1×ATR) — пропустить сетап`,
        pullbackLevel
      };
    }
    return {
      mode: 'WAIT_PULLBACK',
      reason: `Open ${openD1.toFixed(2)} > BuyStop ${buyOrSellStop.toFixed(2)} — ждать отката к High_T0 ${highT0.toFixed(2)}`,
      pullbackLevel
    };
  } else {
    if (openD1 >= buyOrSellStop) {
      return {
        mode: 'STOP_ORDER',
        reason: `Open ${openD1.toFixed(2)} ≥ SellStop ${buyOrSellStop.toFixed(2)} — выставить Sell Stop ордер`,
        pullbackLevel
      };
    }
    if (openD1 < buyOrSellStop - 1.0 * atr14) {
      return {
        mode: 'GAP_FAR',
        reason: `Open ${openD1.toFixed(2)} << SellStop (gap > 1×ATR) — пропустить сетап`,
        pullbackLevel
      };
    }
    return {
      mode: 'WAIT_PULLBACK',
      reason: `Open ${openD1.toFixed(2)} < SellStop ${buyOrSellStop.toFixed(2)} — ждать отката к Low_T0 ${lowT0.toFixed(2)}`,
      pullbackLevel
    };
  }
}

// ─── D+2 Adverse Check ───
export function checkD2Adverse(
  entry: number,
  closeD2: number,
  direction: TradeType
): { shouldClose: boolean; reason: string } {
  if (direction === 'LONG') {
    const shouldClose = closeD2 <= entry;
    return {
      shouldClose,
      reason: shouldClose
        ? `Close D+2 (${closeD2.toFixed(2)}) ≤ Entry (${entry.toFixed(2)}) — закрыть всё по Close`
        : `Close D+2 (${closeD2.toFixed(2)}) > Entry (${entry.toFixed(2)}) — позиция остаётся`
    };
  } else {
    const shouldClose = closeD2 >= entry;
    return {
      shouldClose,
      reason: shouldClose
        ? `Close D+2 (${closeD2.toFixed(2)}) ≥ Entry (${entry.toFixed(2)}) — закрыть всё по Close`
        : `Close D+2 (${closeD2.toFixed(2)}) < Entry (${entry.toFixed(2)}) — позиция остаётся`
    };
  }
}
