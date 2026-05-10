import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import yahooFinance from 'yahoo-finance2';

// ─── ATR14 calculation ───
function calcATR14(candles: { high: number; low: number; close: number }[]): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const period = Math.min(14, trs.length);
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── Process one ticker ───
async function processTicker(symbol: string): Promise<{
  ticker: string;
  close: number;
  max5d: number;           // max однодневный прыжок за 5 дней
  min5d: number;           // min однодневный прыжок за 5 дней (для LONG)
  return5d: number;        // недельная доходность
  volSpike5d: number;      // объёмный спайк
  adv20: number;           // средний дневной оборот $
  atr14: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  error?: string;
} | null> {
  try {
    // 1. Исторические данные — 35 дней (с запасом под ATR14 + 5 торговых дней)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 50);

    const [hist, quote] = await Promise.all([
      yahooFinance.historical(symbol, {
        period1: start,
        period2: end,
        interval: '1d'
      }),
      yahooFinance.quote(symbol, {
        fields: ['fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'regularMarketPrice']
      }).catch(() => null)
    ]);

    if (!hist || hist.length < 10) return null;

    const candles = hist
      .filter(c => c.open && c.high && c.low && c.close && c.volume)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (candles.length < 10) return null;

    const n = candles.length;
    const last5 = candles.slice(-5);
    const last20 = candles.slice(-21, -1); // 20 дней до T0

    // MAX_5d и MIN_5d — максимальный/минимальный однодневный return за последние 5 дней
    const dailyReturns5: number[] = [];
    const idxStart = Math.max(0, n - 6);
    for (let i = idxStart + 1; i < n; i++) {
      const r = candles[i - 1].close > 0
        ? (candles[i].close - candles[i - 1].close) / candles[i - 1].close
        : 0;
      dailyReturns5.push(r);
    }
    const max5d = dailyReturns5.length > 0 ? Math.max(...dailyReturns5) : 0;
    const min5d = dailyReturns5.length > 0 ? Math.min(...dailyReturns5) : 0;

    // Return_5d — недельная доходность
    const closeT0 = candles[n - 1].close;
    const closeT5 = candles[Math.max(0, n - 6)].close;
    const return5d = closeT5 > 0 ? (closeT0 - closeT5) / closeT5 : 0;

    // VolSpike_5d
    const avgVol5 = last5.reduce((s, c) => s + c.volume, 0) / last5.length;
    const avgVol20 = last20.length > 0
      ? last20.reduce((s, c) => s + c.volume, 0) / last20.length
      : avgVol5;
    const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

    // ADV20 — средний дневной оборот в долларах
    const adv20 = last20.length > 0
      ? last20.reduce((s, c) => s + c.close * c.volume, 0) / last20.length
      : 0;

    // ATR14
    const atr14 = calcATR14(candles.slice(-16).map(c => ({
      high: c.high,
      low: c.low,
      close: c.close
    })));

    return {
      ticker: symbol,
      close: closeT0,
      max5d,
      min5d,
      return5d,
      volSpike5d,
      adv20,
      atr14,
      fiftyTwoWeekHigh: (quote as any)?.fiftyTwoWeekHigh ?? closeT0 * 1.5,
      fiftyTwoWeekLow: (quote as any)?.fiftyTwoWeekLow ?? closeT0 * 0.5
    };
  } catch (e: any) {
    return null;
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const batch = parseInt(url.searchParams.get('batch') ?? '0');
  const batchSize = Math.min(parseInt(url.searchParams.get('batchSize') ?? '40'), 60);

  // Загружаем universe
  let universe: string[];
  try {
    const res = await fetch(url.origin + '/universe.json');
    universe = await res.json();
  } catch {
    throw error(500, 'Не удалось загрузить universe.json');
  }

  const start = batch * batchSize;
  const end = Math.min(start + batchSize, universe.length);
  const batchTickers = universe.slice(start, end);

  if (batchTickers.length === 0) {
    return json({
      batch,
      total_batches: Math.ceil(universe.length / batchSize),
      total_tickers: universe.length,
      scanned: 0,
      results: [],
      done: true
    });
  }

  // Параллельно, но не более 8 одновременно (rate limiting Yahoo Finance)
  const CONCURRENCY = 8;
  const results: any[] = [];

  for (let i = 0; i < batchTickers.length; i += CONCURRENCY) {
    const chunk = batchTickers.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(t => processTicker(t)));
    results.push(...chunkResults.filter(Boolean));
  }

  return json({
    batch,
    total_batches: Math.ceil(universe.length / batchSize),
    total_tickers: universe.length,
    scanned: end,
    results,
    done: end >= universe.length
  });
};
