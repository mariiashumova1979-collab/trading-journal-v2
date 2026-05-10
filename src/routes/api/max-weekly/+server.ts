import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import yahooFinance from 'yahoo-finance2';

// Suppress yahoo-finance2 notices

// ─── ATR14 ───
function calcATR14(candles: { high: number; low: number; close: number }[]): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const pc = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)));
  }
  const period = Math.min(14, trs.length);
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── Process one ticker with timeout ───
async function processTicker(symbol: string): Promise<{
  ticker: string;
  close: number;
  max5d: number;
  min5d: number;
  return5d: number;
  volSpike5d: number;
  adv20: number;
  atr14: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
} | null> {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 50);

    // Race against 7-second timeout
    const hist = await Promise.race([
      yahooFinance.historical(symbol, { period1: start, period2: end, interval: '1d' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 7000))
    ]);

    if (!hist || hist.length < 8) return null;

    const candles = (hist as any[])
      .filter((c: any) => c.open && c.high && c.low && c.close && c.volume)
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (candles.length < 8) return null;

    const n = candles.length;

    // MAX_5d и MIN_5d
    const dailyReturns: number[] = [];
    for (let i = Math.max(1, n - 5); i < n; i++) {
      const prev = candles[i - 1].close;
      if (prev > 0) dailyReturns.push((candles[i].close - prev) / prev);
    }
    const max5d = dailyReturns.length > 0 ? Math.max(...dailyReturns) : 0;
    const min5d = dailyReturns.length > 0 ? Math.min(...dailyReturns) : 0;

    // Return_5d
    const closeT0 = candles[n - 1].close;
    const closeT5 = candles[Math.max(0, n - 6)].close;
    const return5d = closeT5 > 0 ? (closeT0 - closeT5) / closeT5 : 0;

    // VolSpike_5d
    const last5vols = candles.slice(-5).map((c: any) => c.volume);
    const prev20vols = candles.slice(-25, -5).map((c: any) => c.volume);
    const avgVol5 = last5vols.reduce((a: number, b: number) => a + b, 0) / last5vols.length;
    const avgVol20 = prev20vols.length > 0
      ? prev20vols.reduce((a: number, b: number) => a + b, 0) / prev20vols.length
      : avgVol5;
    const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

    // ADV20
    const last20 = candles.slice(-21, -1);
    const adv20 = last20.length > 0
      ? last20.reduce((s: number, c: any) => s + c.close * c.volume, 0) / last20.length
      : 0;

    // ATR14
    const atr14 = calcATR14(candles.slice(-16).map((c: any) => ({
      high: c.high, low: c.low, close: c.close
    })));

    // 52-week high/low — аппроксимация по имеющимся данным
    const allCloses = candles.map((c: any) => c.close);
    const allHighs = candles.map((c: any) => c.high);
    const allLows = candles.map((c: any) => c.low);
    const fiftyTwoWeekHigh = Math.max(...allHighs) * 1.2; // консервативная оценка
    const fiftyTwoWeekLow = Math.min(...allLows) * 0.8;

    return {
      ticker: symbol,
      close: closeT0,
      max5d,
      min5d,
      return5d,
      volSpike5d,
      adv20,
      atr14,
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow
    };
  } catch {
    return null;
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const batch = parseInt(url.searchParams.get('batch') ?? '0');
  const batchSize = Math.min(parseInt(url.searchParams.get('batchSize') ?? '20'), 25);

  // Загружаем universe
  let universe: string[];
  try {
    const res = await fetch(url.origin + '/universe.json');
    if (!res.ok) throw new Error('fetch failed');
    universe = await res.json();
  } catch (e) {
    throw error(500, 'Не удалось загрузить universe.json: ' + String(e));
  }

  const start = batch * batchSize;
  const end = Math.min(start + batchSize, universe.length);
  const batchTickers = universe.slice(start, end);

  if (batchTickers.length === 0) {
    return json({
      batch,
      total_batches: Math.ceil(universe.length / batchSize),
      total_tickers: universe.length,
      scanned: universe.length,
      results: [],
      errors: 0,
      done: true
    });
  }

  // Параллельно по 5 (осторожнее с rate limit)
  const CONCURRENCY = 5;
  const results: any[] = [];
  let errCount = 0;

  for (let i = 0; i < batchTickers.length; i += CONCURRENCY) {
    const chunk = batchTickers.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(t => processTicker(t)));
    for (const r of chunkResults) {
      if (r) results.push(r);
      else errCount++;
    }
  }

  return json({
    batch,
    total_batches: Math.ceil(universe.length / batchSize),
    total_tickers: universe.length,
    scanned: end,
    results,
    errors: errCount,
    done: end >= universe.length
  });
};
