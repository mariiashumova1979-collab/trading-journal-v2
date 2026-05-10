import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// ─── Stooq CSV fetcher ───
// Stooq работает с серверов без API ключей и без блокировок

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchStooq(ticker: string): Promise<Bar[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 60); // 60 дней с запасом

  // Stooq: тикер в нижнем регистре + .us
  // BRK-B → brkb.us, BF-B → bfb.us
  const sym = ticker.toLowerCase().replace(/[-\.]/g, '') + '.us';
  const url = `https://stooq.com/q/d/l/?s=${sym}&i=d&d1=${fmtDate(start)}&d2=${fmtDate(end)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/csv,text/plain,*/*',
      'Referer': 'https://stooq.com/'
    },
    signal: AbortSignal.timeout(6000)
  });

  if (!res.ok) return [];
  const csv = await res.text();
  if (!csv || csv.startsWith('<!') || csv.includes('No data')) return [];

  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const bars: Bar[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const [date, open, high, low, close, volume] = parts;
    const o = parseFloat(open);
    const h = parseFloat(high);
    const l = parseFloat(low);
    const c = parseFloat(close);
    const v = parseFloat(volume ?? '0');
    if (isNaN(c) || isNaN(h) || isNaN(l) || c === 0) continue;
    bars.push({ date: date.trim(), open: o, high: h, low: l, close: c, volume: v || 0 });
  }

  // Stooq возвращает в обратном порядке (новые сначала) — разворачиваем
  return bars.reverse();
}

// ─── Metrics ───
function calcATR14(bars: Bar[]): number {
  const n = bars.length;
  if (n < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    trs.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    ));
  }
  const p = Math.min(14, trs.length);
  return trs.slice(-p).reduce((a, b) => a + b, 0) / p;
}

function calcMetrics(ticker: string, bars: Bar[]) {
  const n = bars.length;
  if (n < 8) return null;

  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);

  // MAX_5d, MIN_5d — максимальный и минимальный однодневный return за 5 дней
  const ret5: number[] = [];
  for (let i = Math.max(1, n - 5); i < n; i++) {
    if (closes[i - 1] > 0) ret5.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const max5d = ret5.length > 0 ? Math.max(...ret5) : 0;
  const min5d = ret5.length > 0 ? Math.min(...ret5) : 0;

  // Return_5d
  const closeT0 = closes[n - 1];
  const closeT5 = closes[Math.max(0, n - 6)];
  const return5d = closeT5 > 0 ? (closeT0 - closeT5) / closeT5 : 0;

  // VolSpike_5d
  const vol5 = volumes.slice(-5);
  const vol20 = volumes.slice(-25, -5);
  const avgVol5 = vol5.reduce((a, b) => a + b, 0) / Math.max(vol5.length, 1);
  const avgVol20 = vol20.length > 0 ? vol20.reduce((a, b) => a + b, 0) / vol20.length : avgVol5;
  const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

  // ADV20 — средний дневной оборот в $
  const last20closes = closes.slice(-21, -1);
  const last20vols = volumes.slice(-21, -1);
  const adv20 = last20closes.length > 0
    ? last20closes.reduce((s, c, i) => s + c * (last20vols[i] || 0), 0) / last20closes.length
    : 0;

  // ATR14
  const atr14 = calcATR14(bars.slice(-16));

  // 52-week approx из доступных данных
  const fiftyTwoWeekHigh = Math.max(...highs);
  const fiftyTwoWeekLow = Math.min(...lows);

  return {
    ticker,
    close: closeT0,
    max5d, min5d, return5d, volSpike5d, adv20, atr14,
    fiftyTwoWeekHigh, fiftyTwoWeekLow
  };
}

// ─── Handler ───
export const GET: RequestHandler = async ({ url }) => {
  const batch = parseInt(url.searchParams.get('batch') ?? '0');
  const batchSize = Math.min(parseInt(url.searchParams.get('batchSize') ?? '20'), 25);

  let universe: string[];
  try {
    const res = await fetch(url.origin + '/universe.json');
    if (!res.ok) throw new Error('status ' + res.status);
    universe = await res.json();
  } catch (e) {
    throw error(500, 'universe.json: ' + String(e));
  }

  const start = batch * batchSize;
  const end = Math.min(start + batchSize, universe.length);
  const tickers = universe.slice(start, end);

  if (tickers.length === 0) {
    return json({
      batch, total_batches: Math.ceil(universe.length / batchSize),
      total_tickers: universe.length, scanned: universe.length,
      results: [], errors: 0, done: true
    });
  }

  // Параллельно по 6 — Stooq не слишком агрессивен с rate limit
  const CONCURRENCY = 6;
  const results: any[] = [];
  let errCount = 0;

  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const chunkRes = await Promise.all(chunk.map(async (t) => {
      try {
        const bars = await fetchStooq(t);
        return calcMetrics(t, bars);
      } catch {
        return null;
      }
    }));
    for (const r of chunkRes) {
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
