// ATR Channel Breakout
// Трендовый пробой канала Close ± 0.75×ATR(5), фильтр EMA200
// T0 = расчёт Buy/Sell Stop ордера (живёт 1 день)
// Вход при срабатывании → ежедневный трейлинг Highest High/Lowest Low ∓ 2×ATR
// Take Profit нет

import type { TradeType } from '$lib/types';

export const ATR_CHANNEL_MULT = 0.75;   // канал
export const ATR_STOP_MULT = 2.0;       // стоп/трейлинг
export const EMA_FLAT_PCT = 0.005;      // ±0.5% зона флэта вокруг EMA200

export function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return isNaN(v) ? NaN : v;
  return parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
}

// ─── T0 Input ───
export interface ATRChD0Data {
  close: number;      // Close T0
  ema200: number;     // EMA200
  atr5: number;       // ATR(5)
  // Контекст пропуска
  rangeT0: number;    // High_T0 - Low_T0 (для проверки аномальной свечи)
  avgVol20: number;   // средний объём 20д
  volT0: number;      // объём T0
}

export interface ATRChD0Metrics {
  direction: TradeType | null;   // LONG / SHORT / null (флэт)
  distEma: number;               // (Close - EMA200) / EMA200
  inFlatZone: boolean;           // в зоне ±0.5%
  buyStop: number;               // Close + 0.75×ATR
  sellStop: number;              // Close - 0.75×ATR
  entry: number | null;          // активный ордер по направлению
  initialStop: number | null;    // Entry ∓ 2×ATR
  riskPerShare: number;          // 2×ATR
  longCandle: boolean;           // свеча > 2.5×ATR (аномальная)
  lowVolume: boolean;            // объём ниже среднего
  shares: number;                // $100 / (2×ATR)
}

export interface ATRChD0Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: { label: string; ok: boolean; value: string }[];
}

export function calcATRChMetrics(d: ATRChD0Data, riskAmount = 100): ATRChD0Metrics {
  const distEma = d.ema200 > 0 ? (d.close - d.ema200) / d.ema200 : 0;
  const inFlatZone = Math.abs(distEma) <= EMA_FLAT_PCT;

  let direction: TradeType | null = null;
  if (!inFlatZone) {
    direction = d.close > d.ema200 ? 'LONG' : 'SHORT';
  }

  const channelOffset = d.atr5 * ATR_CHANNEL_MULT;
  const buyStop  = d.close + channelOffset;
  const sellStop = d.close - channelOffset;

  const entry = direction === 'LONG' ? buyStop : direction === 'SHORT' ? sellStop : null;
  const riskPerShare = ATR_STOP_MULT * d.atr5;
  const initialStop = entry === null ? null
    : direction === 'LONG' ? entry - riskPerShare : entry + riskPerShare;

  const longCandle = d.rangeT0 > 0 && d.atr5 > 0 ? d.rangeT0 > 2.5 * d.atr5 : false;
  const lowVolume = d.avgVol20 > 0 && d.volT0 > 0 ? d.volT0 < d.avgVol20 : false;
  const shares = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;

  return {
    direction, distEma, inFlatZone,
    buyStop, sellStop, entry, initialStop, riskPerShare,
    longCandle, lowVolume, shares
  };
}

export function validateATRChD0(d: ATRChD0Data, m: ATRChD0Metrics): ATRChD0Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: { label: string; ok: boolean; value: string }[] = [];

  if (d.atr5 <= 0)  errors.push('ATR(5) должен быть > 0');
  if (d.ema200 <= 0) errors.push('EMA200 должен быть > 0');
  if (d.close <= 0)  errors.push('Close должен быть > 0');

  // Фильтр тренда / флэт
  checks.push({
    label: 'Не в зоне флэта ±0.5% EMA200',
    ok: !m.inFlatZone,
    value: `${(m.distEma * 100).toFixed(2)}%`
  });
  if (m.inFlatZone) {
    errors.push(`Цена в зоне ±0.5% от EMA200 (${(m.distEma*100).toFixed(2)}%) — сделку пропустить`);
  }

  // Направление
  checks.push({
    label: 'Направление по EMA200',
    ok: m.direction !== null,
    value: m.direction ?? 'флэт'
  });

  // Аномальная свеча
  checks.push({
    label: 'Свеча не аномальная (≤ 2.5×ATR)',
    ok: !m.longCandle,
    value: m.longCandle ? 'длинная > 2.5×ATR' : 'ок'
  });
  if (m.longCandle) {
    warnings.push('Свеча входа аномально длинная (> 2.5×ATR) — рекомендуется пропустить');
  }

  // Объём
  checks.push({
    label: 'Объём ≥ среднего 20D',
    ok: !m.lowVolume,
    value: m.lowVolume ? 'ниже среднего' : 'ок'
  });
  if (m.lowVolume) {
    warnings.push('Объём ниже среднего 20-дневного — рекомендуется пропустить');
  }

  return { valid: m.direction !== null && errors.length === 0, errors, warnings, checks };
}

// ─── Трейлинг-стоп (ежедневный) ───
export function calcTrailingStop(
  direction: TradeType,
  highestHigh: number,    // с момента входа
  lowestLow: number,      // с момента входа
  currentAtr5: number     // текущий ATR(5) — динамический
): number {
  const offset = ATR_STOP_MULT * currentAtr5;
  return direction === 'LONG'
    ? highestHigh - offset
    : lowestLow + offset;
}

// Проверка пробоя трейлинга: Close пробил → выход на Open T+1
export function checkTrailingBreak(
  direction: TradeType,
  close: number,
  trailingStop: number
): { broken: boolean; reason: string } {
  const broken = direction === 'LONG' ? close < trailingStop : close > trailingStop;
  return {
    broken,
    reason: broken
      ? `Close ${close.toFixed(2)} пробил трейлинг ${trailingStop.toFixed(2)} → выход на Open завтра (TRAILING)`
      : `Close ${close.toFixed(2)} держится выше трейлинга ${trailingStop.toFixed(2)}`
  };
}

// Проверка пробоя EMA200 во время удержания: выход на Open T+1
export function checkEmaBreak(
  direction: TradeType,
  close: number,
  ema200: number
): { broken: boolean; reason: string } {
  const broken = direction === 'LONG' ? close < ema200 : close > ema200;
  return {
    broken,
    reason: broken
      ? `Close ${close.toFixed(2)} закрылся по другую сторону EMA200 ${ema200.toFixed(2)} → выход на Open завтра (EMA200)`
      : `Close ${close.toFixed(2)} на правильной стороне EMA200`
  };
}
