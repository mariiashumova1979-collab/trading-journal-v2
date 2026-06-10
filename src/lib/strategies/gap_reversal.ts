// Gap Reversal 1
// T0 = watchlist (восходящий тренд + рыночный фильтр)
// D+1 = gap down вход, проверка 17:00 (через 30 мин)
// D+5 = time stop

import type { TradeType } from '$lib/types';

export function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return isNaN(v) ? NaN : v;
  return parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
}

// ─── Market regime ───
export function getGapRegime(spyClose: number, spySma200: number, vix: number): 'OK' | 'NO' {
  if (vix >= 30) return 'NO';
  if (spySma200 <= 0) return 'NO';
  return spyClose > spySma200 ? 'OK' : 'NO';
}

// ─── T0 Input (watchlist) ───
export interface GapD0Data {
  // SPY/VIX
  spyClose: number;
  spySma200: number;
  vix: number;
  // Stock T0
  close: number;          // Close T0
  sma100: number;         // SMA100 сегодня
  sma100_20ago: number;   // SMA100 20 дней назад
  sma50: number;          // SMA50 (для проверки на D+1)
  atr14: number;
}

export interface GapD0Metrics {
  inWatchlist: boolean;
  marketRegime: 'OK' | 'NO';
  aboveSma100: boolean;
  sma100Rising: boolean;
  atrPct: number;          // ATR14 / Close — волатильность
  atrPctOk: boolean;       // ATRp ≤ 5%
}

export interface GapD0Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: { label: string; ok: boolean; value: string }[];
}

export function calcGapD0Metrics(d: GapD0Data): GapD0Metrics {
  const marketRegime = getGapRegime(d.spyClose, d.spySma200, d.vix);
  const aboveSma100 = d.close > d.sma100;
  const sma100Rising = d.sma100 > d.sma100_20ago;
  const atrPct = d.close > 0 ? d.atr14 / d.close : 0;
  const atrPctOk = atrPct <= 0.05;   // отсев слишком волатильных: ATRp > 5%
  // В watchlist: тренд вверх + приемлемая волатильность
  const inWatchlist = aboveSma100 && sma100Rising && atrPctOk;
  return { inWatchlist, marketRegime, aboveSma100, sma100Rising, atrPct, atrPctOk };
}

export function validateGapD0(d: GapD0Data, m: GapD0Metrics): GapD0Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: { label: string; ok: boolean; value: string }[] = [];

  if (d.atr14 <= 0) errors.push('ATR14 должен быть > 0');
  if (d.sma100 <= 0) errors.push('SMA100 должен быть > 0');

  checks.push({ label: 'Close > SMA100', ok: m.aboveSma100, value: `${d.close.toFixed(2)} vs ${d.sma100.toFixed(2)}` });
  checks.push({ label: 'SMA100 растёт (vs 20D)', ok: m.sma100Rising, value: `${d.sma100.toFixed(2)} vs ${d.sma100_20ago.toFixed(2)}` });
  checks.push({
    label: 'ATRp ≤ 5% (ATR14/Close)',
    ok: m.atrPctOk,
    value: `${(m.atrPct * 100).toFixed(2)}%`
  });
  checks.push({
    label: 'Market: SPY > SMA200 & VIX < 30',
    ok: m.marketRegime === 'OK',
    value: `SPY ${d.spyClose.toFixed(2)} vs ${d.spySma200.toFixed(2)} · VIX ${d.vix.toFixed(1)}`
  });

  if (m.marketRegime === 'NO') {
    warnings.push('Рынок не подходит для LONG — но watchlist сохраняем, проверим утром D+1');
  }

  return { valid: m.inWatchlist && errors.length === 0, errors, warnings, checks };
}

// ─── D+1 Gap check ───
export interface GapEntryCheck {
  gapAbs: number;          // Close_T0 - Open_D1 (положительный = gap down)
  gapPct: number;          // gap в % от Close_T0
  gapATR: number;          // gap / ATR14
  gapValid: boolean;       // 1.0 ≤ GapATR ≤ 2.0
  aboveSma50: boolean;     // Open_D1 > SMA50
  passed: boolean;         // оба условия
  reason: string;
}

export function checkGapD1(
  closeT0: number,
  openD1: number,
  sma50: number,
  atr14: number
): GapEntryCheck {
  const gapAbs = closeT0 - openD1;          // gap down > 0
  const gapPct = closeT0 > 0 ? gapAbs / closeT0 * 100 : 0;
  const gapATR = atr14 > 0 ? gapAbs / atr14 : 0;
  // Расширенный фильтр 1.0 ≤ GapATR ≤ 2.0 (гэпы > 2 ATR часто реальная переоценка)
  const gapValid = gapATR >= 1.0 && gapATR <= 2.0;
  const aboveSma50 = openD1 > sma50;
  const passed = gapValid && aboveSma50 && gapAbs > 0;

  let reason = '';
  if (gapAbs <= 0) reason = `Нет gap down (Open ${openD1.toFixed(2)} ≥ Close ${closeT0.toFixed(2)})`;
  else if (gapATR < 1.0) reason = `GapATR ${gapATR.toFixed(2)} < 1.0 — слишком мелкий гэп`;
  else if (gapATR > 2.0) reason = `GapATR ${gapATR.toFixed(2)} > 2.0 — вероятно реальная переоценка, пропустить`;
  else if (!aboveSma50) reason = `Open ${openD1.toFixed(2)} < SMA50 ${sma50.toFixed(2)} — гэп ломает тренд`;
  else reason = `GapATR ${gapATR.toFixed(2)} ✓ · Open > SMA50 ✓`;

  return { gapAbs, gapPct, gapATR, gapValid, aboveSma50, passed, reason };
}

// ─── Entry / Stop / Targets ───
export interface GapEntry {
  buyLimit: number;        // Open_D1 + 25% гэпа (Вариант B)
  stop: number;            // Entry - 1.5×ATR
  stopDistance: number;
  stopPct: number;         // StopDistance / Entry
  stopPctOk: boolean;      // ≤ 7%, иначе СДЕЛКА ОТМЕНЯЕТСЯ
  target1: number;         // min(Close_T0, Entry + ATR)
  target2: number;         // Entry + 2×ATR
  check1700: number;       // Entry × 0.985 (защита через 30 мин)
  shares: number;
  positionValue: number;
  riskAmount: number;
}

export function calcGapEntry(
  closeT0: number,
  openD1: number,
  atr14: number,
  capital: number
): GapEntry {
  const gapAbs = closeT0 - openD1;
  const buyLimit = openD1 + 0.25 * gapAbs;   // Вариант B
  const stopDistance = 1.5 * atr14;
  const stop = buyLimit - stopDistance;
  // ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА: StopDistance / Entry > 7% → СДЕЛКА ОТМЕНЯЕТСЯ
  const stopPct = buyLimit > 0 ? stopDistance / buyLimit : 1;
  const stopPctOk = stopPct <= 0.07;
  // T1 = меньшая из (полное закрытие гэпа = Close_T0) и (Entry + ATR)
  const target1 = Math.min(closeT0, buyLimit + atr14);
  const target2 = buyLimit + 2 * atr14;
  const check1700 = buyLimit * 0.985;        // выход если цена ниже на закрытии проверки
  const shares = stopDistance > 0 && stopPctOk ? Math.floor((capital * 0.01) / stopDistance) : 0;
  const riskAmount = shares * stopDistance;
  const positionValue = shares * buyLimit;

  return { buyLimit, stop, stopDistance, stopPct, stopPctOk, target1, target2, check1700, shares, positionValue, riskAmount };
}

// ─── Проверка 17:00 (через 30 мин после открытия) ───
export function check30min(
  entry: number,
  priceAt1700: number
): { shouldExit: boolean; reason: string; threshold: number } {
  const threshold = entry * 0.985;
  const shouldExit = priceAt1700 < threshold;
  return {
    shouldExit,
    threshold,
    reason: shouldExit
      ? `Цена ${priceAt1700.toFixed(2)} < ${threshold.toFixed(2)} (Entry −1.5%) → выйти, это не reversal а обвал`
      : `Цена ${priceAt1700.toFixed(2)} ≥ ${threshold.toFixed(2)} — проверка пройдена, держим`
  };
}
