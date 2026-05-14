// IBS Mean Reversion в тренде
// Universe: S&P 500 + Nasdaq-100
// T0 = сигнальный день, D+1 = вход, D+5 = time stop

import type { TradeType } from '$lib/types';

export function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
}

// ─── Market Regime (SPY) ───
export type SpyRegime = 'LONG' | 'SHORT' | 'NEUTRAL';

export function getSpyRegime(spyClose: number, spySma200: number): SpyRegime {
  if (spySma200 <= 0) return 'NEUTRAL';
  const pct = Math.abs(spyClose - spySma200) / spySma200;
  if (pct <= 0.001) return 'NEUTRAL';     // ±0.1% = запрещено
  return spyClose > spySma200 ? 'LONG' : 'SHORT';
}

// ─── D0 Input ───
export interface IBSD0Data {
  // SPY
  spyClose: number;
  spySma200: number;
  // Stock
  open: number;
  high: number;
  low: number;
  close: number;
  sma200: number;
  sma200_20ago: number;    // SMA200(T0-20) для тренда SMA200
  rsi2: number;            // RSI(2)
  atr14: number;           // ATR(14)
}

export interface IBSD0Metrics {
  direction: TradeType | null;
  spyRegime: SpyRegime;
  ibs: number;              // (Close − Low) / (High − Low)
  range: number;            // High − Low
  rangeAtrRatio: number;    // Range / ATR14
  sma200Trend: 'UP' | 'DOWN' | 'FLAT';  // SMA200(T0) vs SMA200(T0-20)
  aboveSma200: boolean;     // Close > SMA200 (LONG)
  belowSma200: boolean;     // Close < SMA200 (SHORT)
}

export interface IBSD0Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: { label: string; ok: boolean; value: string }[];
}

// ─── D0 Metrics ───
export function calcIBSD0Metrics(d: IBSD0Data): IBSD0Metrics {
  const range = d.high - d.low;
  const ibs = range > 0 ? (d.close - d.low) / range : 0.5;
  const rangeAtrRatio = d.atr14 > 0 ? range / d.atr14 : 0;
  const spyRegime = getSpyRegime(d.spyClose, d.spySma200);

  const sma200Trend: 'UP' | 'DOWN' | 'FLAT' =
    d.sma200 > d.sma200_20ago * 1.0001 ? 'UP' :
    d.sma200 < d.sma200_20ago * 0.9999 ? 'DOWN' : 'FLAT';

  const aboveSma200 = d.close > d.sma200;
  const belowSma200 = d.close < d.sma200;

  const longValid =
    aboveSma200 &&
    sma200Trend === 'UP' &&
    ibs < 0.20 &&
    d.rsi2 < 10 &&
    rangeAtrRatio < 2.0 &&
    spyRegime === 'LONG';

  const shortValid =
    belowSma200 &&
    sma200Trend === 'DOWN' &&
    ibs > 0.80 &&
    d.rsi2 > 90 &&
    rangeAtrRatio < 2.0 &&
    spyRegime === 'SHORT';

  return {
    direction: longValid ? 'LONG' : shortValid ? 'SHORT' : null,
    spyRegime, ibs, range, rangeAtrRatio, sma200Trend,
    aboveSma200, belowSma200
  };
}

// ─── D0 Validation ───
export function validateIBSD0(d: IBSD0Data, m: IBSD0Metrics): IBSD0Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Базовые проверки данных
  if (d.atr14 <= 0) errors.push('ATR14 должен быть > 0');
  if (d.sma200 <= 0) errors.push('SMA200 должен быть > 0');
  if (d.high <= d.low) errors.push('High должен быть > Low');
  if (d.close > d.high || d.close < d.low) errors.push('Close за пределами High/Low');

  // Для построения чек-листа — проверяем независимо от стороны
  const side = m.spyRegime === 'LONG' ? 'LONG' : m.spyRegime === 'SHORT' ? 'SHORT' : null;

  const checks: { label: string; ok: boolean; value: string }[] = [];

  // SPY Regime
  checks.push({
    label: 'SPY Regime',
    ok: m.spyRegime !== 'NEUTRAL',
    value: m.spyRegime === 'NEUTRAL'
      ? `NEUTRAL (±0.1% от SMA200 — сделки запрещены)`
      : m.spyRegime
  });

  if (side === 'LONG' || (!side && m.spyRegime === 'LONG')) {
    checks.push({ label: 'Close > SMA200', ok: m.aboveSma200, value: `${d.close.toFixed(2)} vs ${d.sma200.toFixed(2)}` });
    checks.push({ label: 'SMA200 Trend UP', ok: m.sma200Trend === 'UP', value: `${d.sma200.toFixed(2)} vs 20 days ago: ${d.sma200_20ago.toFixed(2)}` });
    checks.push({ label: 'IBS < 0.20', ok: m.ibs < 0.20, value: m.ibs.toFixed(3) });
    checks.push({ label: 'RSI(2) < 10', ok: d.rsi2 < 10, value: d.rsi2.toFixed(1) });
  } else if (side === 'SHORT' || (!side && m.spyRegime === 'SHORT')) {
    checks.push({ label: 'Close < SMA200', ok: m.belowSma200, value: `${d.close.toFixed(2)} vs ${d.sma200.toFixed(2)}` });
    checks.push({ label: 'SMA200 Trend DOWN', ok: m.sma200Trend === 'DOWN', value: `${d.sma200.toFixed(2)} vs 20 days ago: ${d.sma200_20ago.toFixed(2)}` });
    checks.push({ label: 'IBS > 0.80', ok: m.ibs > 0.80, value: m.ibs.toFixed(3) });
    checks.push({ label: 'RSI(2) > 90', ok: d.rsi2 > 90, value: d.rsi2.toFixed(1) });
  } else {
    // Neutral — показываем оба условия для информации
    checks.push({ label: 'IBS', ok: false, value: m.ibs.toFixed(3) });
    checks.push({ label: 'RSI(2)', ok: false, value: d.rsi2.toFixed(1) });
  }

  // Range < 2×ATR (для обеих сторон)
  checks.push({ label: 'Range < 2×ATR', ok: m.rangeAtrRatio < 2.0, value: `${m.range.toFixed(2)} / ATR ${d.atr14.toFixed(2)} = ${m.rangeAtrRatio.toFixed(2)}` });

  if (m.spyRegime === 'NEUTRAL') {
    errors.push('SPY в пределах ±0.1% от SMA200 — новые сделки запрещены');
  }
  if (d.atr14 / d.close > 0.08) warnings.push(`ATR/Price = ${(d.atr14 / d.close * 100).toFixed(1)}% — высокая волатильность`);

  return { valid: m.direction !== null && errors.length === 0, errors, warnings, checks };
}

// ─── D+1 Entry Calc ───
export interface IBSEntry {
  entry: number;
  stop: number;
  stopDistance: number;
  target1: number;   // +1×ATR
  target2: number;   // +2×ATR
  shares: number;
  positionValue: number;
  riskAmount: number;
  gapCancelled: boolean;
  gapCancelReason: string;
}

export function calcIBSEntry(
  closeT0: number,
  openD1: number,
  direction: TradeType,
  atr14: number,
  capital: number
): IBSEntry {
  // Gap cancel check
  let gapCancelled = false;
  let gapCancelReason = '';
  if (direction === 'LONG' && openD1 >= closeT0 * 1.02) {
    gapCancelled = true;
    gapCancelReason = `Open ${openD1.toFixed(2)} ≥ Close_T0 × 1.02 = ${(closeT0 * 1.02).toFixed(2)}`;
  } else if (direction === 'SHORT' && openD1 <= closeT0 * 0.98) {
    gapCancelled = true;
    gapCancelReason = `Open ${openD1.toFixed(2)} ≤ Close_T0 × 0.98 = ${(closeT0 * 0.98).toFixed(2)}`;
  }

  const entry = openD1;
  const stopDistance = Math.min(1.5 * atr14, 0.06 * entry);
  const stop = direction === 'LONG' ? entry - stopDistance : entry + stopDistance;
  const target1 = direction === 'LONG' ? entry + atr14 : entry - atr14;
  const target2 = direction === 'LONG' ? entry + 2 * atr14 : entry - 2 * atr14;
  const shares = stopDistance > 0 ? Math.floor((capital * 0.01) / stopDistance) : 0;
  const riskAmount = shares * stopDistance;
  const positionValue = shares * entry;

  return { entry, stop, stopDistance, target1, target2, shares, positionValue, riskAmount, gapCancelled, gapCancelReason };
}

// ─── D+1 Adverse Check ───
// Если favorable move < 0.5×ATR → закрыть всю позицию по Close D+1
export function checkD1Adverse(
  entry: number,
  highD1: number,
  lowD1: number,
  atr14: number,
  direction: TradeType
): { shouldClose: boolean; reason: string; favorableMove: number } {
  const favorableMove = direction === 'LONG'
    ? highD1 - entry
    : entry - lowD1;
  const threshold = 0.5 * atr14;
  const shouldClose = favorableMove < threshold;
  const reason = shouldClose
    ? `${direction === 'LONG' ? `High D+1 (${highD1.toFixed(2)}) - Entry (${entry.toFixed(2)})` : `Entry (${entry.toFixed(2)}) - Low D+1 (${lowD1.toFixed(2)})`} = ${favorableMove.toFixed(2)} < 0.5×ATR (${threshold.toFixed(2)}) → закрыть всё по Close D+1`
    : `Favorable move ${favorableMove.toFixed(2)} ≥ 0.5×ATR (${threshold.toFixed(2)}) — позиция остаётся`;
  return { shouldClose, reason, favorableMove };
}
