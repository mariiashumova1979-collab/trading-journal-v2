import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number; }

async function fetchStooq(ticker: string): Promise<{ bars: Bar[]; debug?: string }> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 60);

  // Stooq формат: ЗАГЛАВНЫЕ + .US, дефисы убираем
  const sym = ticker.toUpperCase().replace(/[-\.]/g, '') + '.US';
  const url = `https://stooq.com/q/d/l/?s=${sym}&i=d&d1=${fmtDate(start)}&d2=${fmtDate(end)}`;

  let raw = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://stooq.com/q/?s=' + sym,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) return { bars: [], debug: `HTTP ${res.status}` };
    raw = await res.text();
  } catch (e: any) {
    return { bars: [], debug: `fetch error: ${e.message}` };
  }

  // Диагностика: что вернул Stooq
  if (!raw || raw.length < 20) return { bars: [], debug: 'empty response' };
  if (raw.startsWith('<!') || raw.startsWith('<html')) return { bars: [], debug: 'html response (blocked?)' };
  if (raw.includes('No data') || raw.includes('Brak danych')) return { bars: [], debug: 'no data' };

  const lines = raw.trim().split('\n');
  if (lines.length < 2) return { bars: [], debug: `too few lines: ${lines.length}` };

  const bars: Bar[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(',');
    if (parts.length < 5) continue;
    const [date, open, high, low, close, volume] = parts;
    const c = parseFloat(close);
    const h = parseFloat(high);
    const l = parseFloat(low);
    if (isNaN(c) || isNaN(h) || isNaN(l) || c === 0) continue;
    bars.push({ date: date.trim(), open: parseFloat(open), high: h, low: l, close: c, volume: parseFloat(volume || '0') || 0 });
  }

  return { bars: bars.reverse() }; // Stooq: новые сначала → разворачиваем
}

function calcATR14(bars: Bar[]): number {
  const n = bars.length;
  if (n < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i-1].close), Math.abs(bars[i].low - bars[i-1].close)));
  }
  const p = Math.min(14, trs.length);
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}

function calcMetrics(ticker: string, bars: Bar[]) {
  const n = bars.length;
  if (n < 8) return null;
  const C = bars.map(b=>b.close), H = bars.map(b=>b.high), L = bars.map(b=>b.low), V = bars.map(b=>b.volume);
  const ret5: number[] = [];
  for (let i = Math.max(1,n-5); i<n; i++) if (C[i-1]>0) ret5.push((C[i]-C[i-1])/C[i-1]);
  const max5d = ret5.length ? Math.max(...ret5) : 0;
  const min5d = ret5.length ? Math.min(...ret5) : 0;
  const return5d = C[Math.max(0,n-6)]>0 ? (C[n-1]-C[Math.max(0,n-6)])/C[Math.max(0,n-6)] : 0;
  const avgVol5 = V.slice(-5).reduce((a,b)=>a+b,0)/5;
  const vol20 = V.slice(-25,-5);
  const avgVol20 = vol20.length ? vol20.reduce((a,b)=>a+b,0)/vol20.length : avgVol5;
  const last20 = C.slice(-21,-1);
  const last20v = V.slice(-21,-1);
  const adv20 = last20.length ? last20.reduce((s,c,i)=>s+c*(last20v[i]||0),0)/last20.length : 0;
  return { ticker, close: C[n-1], max5d, min5d, return5d, volSpike5d: avgVol20>0?avgVol5/avgVol20:1, adv20, atr14: calcATR14(bars.slice(-16)), fiftyTwoWeekHigh: Math.max(...H), fiftyTwoWeekLow: Math.min(...L) };
}

export const GET: RequestHandler = async ({ url }) => {
  // Диагностический режим: ?test=AAPL
  const testTicker = url.searchParams.get('test');
  if (testTicker) {
    const { bars, debug } = await fetchStooq(testTicker);
    return json({ ticker: testTicker, bars_count: bars.length, first_bar: bars[0], last_bar: bars[bars.length-1], debug });
  }

  const batch = parseInt(url.searchParams.get('batch') ?? '0');
  const batchSize = Math.min(parseInt(url.searchParams.get('batchSize') ?? '20'), 25);

  let universe: string[];
  try {
    const res = await fetch(url.origin + '/universe.json');
    if (!res.ok) throw new Error('status ' + res.status);
    universe = await res.json();
  } catch (e) { throw error(500, 'universe.json: ' + String(e)); }

  const start = batch * batchSize;
  const end = Math.min(start + batchSize, universe.length);
  const tickers = universe.slice(start, end);
  if (!tickers.length) return json({ batch, total_batches: Math.ceil(universe.length/batchSize), total_tickers: universe.length, scanned: universe.length, results: [], errors: 0, done: true });

  const CONCURRENCY = 5;
  const results: any[] = [];
  let errCount = 0;
  const debugSamples: string[] = [];

  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i+CONCURRENCY);
    const chunkRes = await Promise.all(chunk.map(async t => {
      const { bars, debug } = await fetchStooq(t);
      if (debug && debugSamples.length < 3) debugSamples.push(`${t}: ${debug}`);
      return calcMetrics(t, bars);
    }));
    for (const r of chunkRes) { if (r) results.push(r); else errCount++; }
  }

  return json({ batch, total_batches: Math.ceil(universe.length/batchSize), total_tickers: universe.length, scanned: end, results, errors: errCount, done: end>=universe.length, debug: debugSamples });
};
