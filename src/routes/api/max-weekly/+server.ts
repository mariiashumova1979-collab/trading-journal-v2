import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// ─── Yahoo Finance direct HTTP (без sdk) ───
// Используем spark endpoint — принимает до 50 тикеров за один запрос

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

// Получаем cookie + crumb один раз
let _cookie = '';
let _crumb = '';

async function getYahooCreds(): Promise<{ cookie: string; crumb: string }> {
  if (_cookie && _crumb) return { cookie: _cookie, crumb: _crumb };

  try {
    // Step 1: get cookie
    const r1 = await fetch('https://fc.yahoo.com', {
      headers: YF_HEADERS,
      redirect: 'follow'
    });
    const setCookie = r1.headers.get('set-cookie') ?? '';
    _cookie = setCookie.split(';')[0];

    // Step 2: get crumb
    const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...YF_HEADERS, 'Cookie': _cookie }
    });
    if (r2.ok) {
      _crumb = await r2.text();
    }
  } catch {
    // ignore — работаем без crumb, spark часто не требует
  }

  return { cookie: _cookie, crumb: _crumb };
}

// ─── ATR14 ───
function calcATR14(highs: number[], lows: number[], closes: number[]): number {
  const n = closes.length;
  if (n < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  const period = Math.min(14, trs.length);
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── Fetch batch of up to 50 tickers via spark ───
async function fetchBatch(symbols: string[], cookie: string, crumb: string): Promise<Map<string, {
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
}>> {
  const result = new Map();

  // Пробуем spark endpoint (bulk, быстро)
  try {
    const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols.join('%2C')}&range=2mo&interval=1d${crumb ? '&crumb=' + crumb : ''}`;
    const res = await fetch(sparkUrl, {
      headers: { ...YF_HEADERS, ...(cookie ? { 'Cookie': cookie } : {}) },
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const data = await res.json();
      const sparkResult = data?.spark?.result ?? [];

      for (const item of sparkResult) {
        const symbol = item?.symbol;
        const resp = item?.response?.[0];
        if (!symbol || !resp) continue;

        const timestamps: number[] = resp.timestamp ?? [];
        const quotes = resp.indicators?.quote?.[0] ?? {};
        const opens: number[] = quotes.open ?? [];
        const highs: number[] = quotes.high ?? [];
        const lows: number[] = quotes.low ?? [];
        const closes: number[] = quotes.close ?? [];
        const volumes: number[] = quotes.volume ?? [];

        // Фильтруем null значения
        const valid = timestamps.map((_, i) => i).filter(i =>
          closes[i] != null && opens[i] != null && highs[i] != null && lows[i] != null && volumes[i] != null
        );

        if (valid.length < 8) continue;

        const vCloses = valid.map(i => closes[i]);
        const vHighs = valid.map(i => highs[i]);
        const vLows = valid.map(i => lows[i]);
        const vVolumes = valid.map(i => volumes[i]);
        const n = vCloses.length;

        // MAX_5d, MIN_5d — за последние 5 дней
        const dailyRet: number[] = [];
        for (let i = Math.max(1, n - 5); i < n; i++) {
          if (vCloses[i - 1] > 0) dailyRet.push((vCloses[i] - vCloses[i - 1]) / vCloses[i - 1]);
        }
        const max5d = dailyRet.length > 0 ? Math.max(...dailyRet) : 0;
        const min5d = dailyRet.length > 0 ? Math.min(...dailyRet) : 0;

        // Return_5d
        const closeT0 = vCloses[n - 1];
        const closeT5 = vCloses[Math.max(0, n - 6)];
        const return5d = closeT5 > 0 ? (closeT0 - closeT5) / closeT5 : 0;

        // VolSpike_5d
        const vol5 = vVolumes.slice(-5);
        const vol20 = vVolumes.slice(-25, -5);
        const avgVol5 = vol5.reduce((a, b) => a + b, 0) / vol5.length;
        const avgVol20 = vol20.length > 0 ? vol20.reduce((a, b) => a + b, 0) / vol20.length : avgVol5;
        const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

        // ADV20
        const last20 = vCloses.slice(-21, -1).map((c, i2) => c * vVolumes.slice(-21, -1)[i2]);
        const adv20 = last20.length > 0 ? last20.reduce((a, b) => a + b, 0) / last20.length : 0;

        // ATR14
        const atr14 = calcATR14(vHighs.slice(-16), vLows.slice(-16), vCloses.slice(-16));

        // 52wk high/low — из всех доступных данных
        const fiftyTwoWeekHigh = Math.max(...vHighs);
        const fiftyTwoWeekLow = Math.min(...vLows);

        result.set(symbol, {
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
        });
      }
      return result;
    }
  } catch (e) {
    // spark failed — fallthrough to chart
  }

  // Fallback: chart endpoint поштучно (если spark не сработал)
  await Promise.all(
    symbols.slice(0, 10).map(async (symbol) => {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2mo${crumb ? '&crumb=' + crumb : ''}`;
        const res = await fetch(url, {
          headers: { ...YF_HEADERS, ...(cookie ? { 'Cookie': cookie } : {}) },
          signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) return;
        const data = await res.json();
        const r = data?.chart?.result?.[0];
        if (!r) return;

        const meta = r.meta ?? {};
        const timestamps: number[] = r.timestamp ?? [];
        const q = r.indicators?.quote?.[0] ?? {};
        const closes: number[] = q.close ?? [];
        const highs: number[] = q.high ?? [];
        const lows: number[] = q.low ?? [];
        const volumes: number[] = q.volume ?? [];

        const valid = timestamps.map((_, i) => i).filter(i =>
          closes[i] != null && highs[i] != null && lows[i] != null
        );
        if (valid.length < 8) return;

        const vC = valid.map(i => closes[i]);
        const vH = valid.map(i => highs[i]);
        const vL = valid.map(i => lows[i]);
        const vV = valid.map(i => volumes[i] ?? 0);
        const n = vC.length;

        const dailyRet: number[] = [];
        for (let i = Math.max(1, n - 5); i < n; i++) {
          if (vC[i - 1] > 0) dailyRet.push((vC[i] - vC[i - 1]) / vC[i - 1]);
        }
        const max5d = dailyRet.length > 0 ? Math.max(...dailyRet) : 0;
        const min5d = dailyRet.length > 0 ? Math.min(...dailyRet) : 0;
        const closeT0 = vC[n - 1];
        const closeT5 = vC[Math.max(0, n - 6)];
        const return5d = closeT5 > 0 ? (closeT0 - closeT5) / closeT5 : 0;
        const vol5 = vV.slice(-5);
        const vol20 = vV.slice(-25, -5);
        const avgVol5 = vol5.reduce((a, b) => a + b, 0) / vol5.length;
        const avgVol20 = vol20.length > 0 ? vol20.reduce((a, b) => a + b, 0) / vol20.length : avgVol5;
        const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;
        const last20vals = vC.slice(-21, -1).map((c, i2) => c * vV.slice(-21, -1)[i2]);
        const adv20 = last20vals.length > 0 ? last20vals.reduce((a, b) => a + b, 0) / last20vals.length : 0;
        const atr14 = calcATR14(vH.slice(-16), vL.slice(-16), vC.slice(-16));

        result.set(symbol, {
          ticker: symbol,
          close: closeT0,
          max5d, min5d, return5d, volSpike5d, adv20, atr14,
          fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? Math.max(...vH),
          fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? Math.min(...vL)
        });
      } catch { /* skip */ }
    })
  );

  return result;
}

export const GET: RequestHandler = async ({ url }) => {
  const batch = parseInt(url.searchParams.get('batch') ?? '0');
  const batchSize = Math.min(parseInt(url.searchParams.get('batchSize') ?? '50'), 50);

  let universe: string[];
  try {
    const res = await fetch(url.origin + '/universe.json');
    if (!res.ok) throw new Error('fetch failed');
    universe = await res.json();
  } catch (e) {
    throw error(500, 'universe.json: ' + String(e));
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

  const { cookie, crumb } = await getYahooCreds();

  let resultMap: Map<string, any>;
  try {
    resultMap = await fetchBatch(batchTickers, cookie, crumb);
  } catch {
    resultMap = new Map();
  }

  const results = Array.from(resultMap.values());
  const errors = batchTickers.length - results.length;

  return json({
    batch,
    total_batches: Math.ceil(universe.length / batchSize),
    total_tickers: universe.length,
    scanned: end,
    results,
    errors,
    done: end >= universe.length
  });
};
