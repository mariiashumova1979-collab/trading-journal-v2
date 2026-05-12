<script lang="ts">
  // ─── MAX Weekly Reversal Scanner ───
  // Источник данных: Freedom24 API (tradernet.com/api/getHloc)
  import { insertCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  // Источник данных: Freedom24 API (tradernet.com/api/getHloc)
  // ВАЖНО: HLOC массив возвращается в порядке [High, Low, Open, Close]

  interface TickerResult {
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
    maxPct?: number;
    minPct?: number;
    returnPct?: number;
    signal?: 'SHORT' | 'LONG' | null;
  }

  const BATCH = 30;

  let savedTickers = $state<Set<string>>(new Set());
  let savingAll = $state(false);
  let saveError = $state<string | null>(null); // тикеров на один запрос

  let allResults = $state<TickerResult[]>([]);
  let ranked = $state<TickerResult[]>([]);
  let scanning = $state(false);
  let aborted = $state(false);
  let progress = $state(0);
  let total = $state(0);
  let totalBatches = $state(0);
  let currentBatch = $state(0);
  let errors = $state(0);
  let done = $state(false);
  let capital = $state('50000');
  let scanLog = $state<string[]>([]);
  let testResult = $state<any>(null);

  let sortCol = $state('maxPct');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let filterSignal = $state<'ALL' | 'SHORT' | 'LONG'>('ALL');
  let showTopOnly = $state(false);

  // ─── Helpers ───
  function fmtFreedomDate(d: Date): string {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${d.getFullYear()} 00:00`;
  }

  function pctRank(arr: number[], v: number): number {
    return arr.length === 0 ? 50 : arr.filter(x => x < v).length / arr.length * 100;
  }

  function atr14(highs: number[], lows: number[], closes: number[]): number {
    const n = closes.length;
    if (n < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < n; i++) {
      trs.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
    }
    const p = Math.min(14, trs.length);
    return trs.slice(-p).reduce((a, b) => a + b, 0) / p;
  }

  // ─── Загрузка батча из Freedom24 ───
  async function fetchFreedomBatch(tickers: string[]): Promise<TickerResult[]> {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 60); // 60 дней с запасом

    // Freedom24 принимает несколько тикеров через запятую
    // Универсальный формат: BRKB → BRK.B (но универс уже без точек)
    // Пока используем как есть + .US
    const ids = tickers.map(t => t + '.US').join(',');

    const params = {
      cmd: 'getHloc',
      params: {
        id: ids,
        count: -1,
        timeframe: 1440,
        date_from: fmtFreedomDate(start),
        date_to: fmtFreedomDate(end),
        intervalMode: 'ClosedRay'
      }
    };

    const url = `https://tradernet.com/api/?q=${encodeURIComponent(JSON.stringify(params))}`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // Если ошибка авторизации
    if (data?.code === 7 || data?.errMsg) {
      throw new Error(`Freedom24: ${data.error || data.errMsg} (code ${data.code})`);
    }

    const hlocMap: Record<string, number[][]> = data?.hloc ?? {};
    const vlMap: Record<string, number[]> = data?.vl ?? {};

    const results: TickerResult[] = [];
    for (const fullId of Object.keys(hlocMap)) {
      try {
        // Убираем .US суффикс для отображения
        const baseTicker = fullId.replace(/\.US$/, '');
        const hloc = hlocMap[fullId];
        const vols = vlMap[fullId] ?? [];

        if (!Array.isArray(hloc) || hloc.length < 8) continue;

        // Порядок: [High, Low, Open, Close]
        const H = hloc.map(c => c[0]);
        const L = hloc.map(c => c[1]);
        // Open не используется в метриках
        const C = hloc.map(c => c[3]);
        const V = vols;
        const n = C.length;

        // MAX_5d, MIN_5d — однодневные returns за последние 5 дней
        const ret5: number[] = [];
        for (let i = Math.max(1, n - 5); i < n; i++) {
          if (C[i - 1] > 0) ret5.push((C[i] - C[i - 1]) / C[i - 1]);
        }
        const max5d = ret5.length > 0 ? Math.max(...ret5) : 0;
        const min5d = ret5.length > 0 ? Math.min(...ret5) : 0;

        // Return_5d
        const closeT0 = C[n - 1];
        const closeT5 = C[Math.max(0, n - 6)];
        const return5d = closeT5 > 0 ? (closeT0 - closeT5) / closeT5 : 0;

        // VolSpike_5d
        const vol5 = V.slice(-5);
        const vol20 = V.slice(-25, -5);
        const avgVol5 = vol5.length > 0 ? vol5.reduce((a, b) => a + b, 0) / vol5.length : 0;
        const avgVol20 = vol20.length > 0 ? vol20.reduce((a, b) => a + b, 0) / vol20.length : avgVol5;
        const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

        // ADV20
        const last20 = C.slice(-21, -1);
        const last20v = V.slice(-21, -1);
        const adv20 = last20.length > 0
          ? last20.reduce((s, c, i) => s + c * (last20v[i] || 0), 0) / last20.length
          : 0;

        results.push({
          ticker: baseTicker,
          close: closeT0,
          max5d, min5d, return5d, volSpike5d, adv20,
          atr14: atr14(H.slice(-16), L.slice(-16), C.slice(-16)),
          fiftyTwoWeekHigh: Math.max(...H),
          fiftyTwoWeekLow: Math.min(...L)
        });
      } catch { /* skip bad ticker */ }
    }
    return results;
  }

  // ─── Yahoo Finance fallback для тикеров не найденных во Freedom24 ───
  async function fetchYahooBatch(tickers: string[]): Promise<TickerResult[]> {
    if (tickers.length === 0) return [];

    const symbols = tickers.join('%2C');
    const yhUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols}&range=2mo&interval=1d`;

    let res: Response | null = null;

    let debugInfo: string[] = [];

    // Попытка 1: прямой запрос из браузера (без прокси)
    try {
      res = await fetch(yhUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' }
      });
      debugInfo.push(`Direct: HTTP ${res.status}`);
    } catch (e: any) {
      debugInfo.push(`Direct: EXCEPTION ${e.message}`);
      res = null;
    }

    // Попытка 2: через allorigins.win (если прямой запрос упал из-за CORS)
    if (!res || !res.ok) {
      try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(yhUrl)}`;
        res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
        debugInfo.push(`allorigins: HTTP ${res.status}`);
      } catch (e: any) {
        debugInfo.push(`allorigins: EXCEPTION ${e.message}`);
        return [];
      }
    }

    if (!res || !res.ok) {
      console.warn('[Yahoo fallback]', debugInfo.join(' | '));
      return [];
    }

    let data: any;
    let rawText = '';
    try {
      rawText = await res.text();
      data = JSON.parse(rawText);
    } catch (e: any) {
      console.warn('[Yahoo fallback] JSON parse error:', rawText.substring(0, 200));
      return [];
    }

    // Диагностика в лог
    const sparkCount = data?.spark?.result?.length ?? 0;
    console.log(`[Yahoo fallback] ${debugInfo.join(' | ')} | spark.result: ${sparkCount} items | symbols: ${symbols.substring(0, 100)}`);
    if (sparkCount === 0) {
      console.warn('[Yahoo fallback] Empty spark result. Raw:', rawText.substring(0, 300));
    }

    const sparkItems: any[] = data?.spark?.result ?? [];
    const results: TickerResult[] = [];

    for (const item of sparkItems) {
      try {
        const symbol: string = item?.symbol;
        const resp = item?.response?.[0];
        if (!symbol || !resp) continue;

        const q = resp.indicators?.quote?.[0] ?? {};
        const rawH: (number|null)[] = q.high ?? [];
        const rawL: (number|null)[] = q.low ?? [];
        const rawC: (number|null)[] = q.close ?? [];
        const rawV: (number|null)[] = q.volume ?? [];

        const idx = rawC.map((_: any, i: number) => i)
          .filter((i: number) => rawC[i] != null && rawH[i] != null && rawL[i] != null);
        if (idx.length < 8) continue;

        const C = idx.map((i: number) => rawC[i] as number);
        const H = idx.map((i: number) => rawH[i] as number);
        const L = idx.map((i: number) => rawL[i] as number);
        const V = idx.map((i: number) => (rawV[i] ?? 0) as number);
        const n = C.length;

        const ret5: number[] = [];
        for (let i = Math.max(1, n - 5); i < n; i++) {
          if (C[i-1] > 0) ret5.push((C[i] - C[i-1]) / C[i-1]);
        }
        const max5d = ret5.length > 0 ? Math.max(...ret5) : 0;
        const min5d = ret5.length > 0 ? Math.min(...ret5) : 0;
        const closeT0 = C[n-1];
        const closeT5 = C[Math.max(0, n-6)];
        const return5d = closeT5 > 0 ? (closeT0 - closeT5) / closeT5 : 0;

        const avgVol5 = V.slice(-5).reduce((a: number, b: number) => a+b, 0) / 5;
        const vol20 = V.slice(-25, -5);
        const avgVol20 = vol20.length > 0 ? vol20.reduce((a: number,b: number) => a+b,0)/vol20.length : avgVol5;
        const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

        const last20c = C.slice(-21,-1), last20v = V.slice(-21,-1);
        const adv20 = last20c.length > 0
          ? last20c.reduce((s: number,c: number,i: number) => s + c*(last20v[i]||0), 0) / last20c.length
          : 0;

        // ATR14
        const atr14 = (() => {
          const bars = H.slice(-16).map((_: number, i: number) => ({
            h: H.slice(-16)[i], l: L.slice(-16)[i], c: C.slice(-16)[i]
          }));
          if (bars.length < 2) return 0;
          const trs: number[] = [];
          for (let i = 1; i < bars.length; i++) {
            trs.push(Math.max(
              bars[i].h - bars[i].l,
              Math.abs(bars[i].h - bars[i-1].c),
              Math.abs(bars[i].l - bars[i-1].c)
            ));
          }
          const p = Math.min(14, trs.length);
          return trs.slice(-p).reduce((a: number,b: number) => a+b, 0) / p;
        })();

        // Убираем суффикс Yahoo (BRK-B → BRK-B, оставляем как есть)
        const displayTicker = symbol.replace(/-/g, '.');

        results.push({
          ticker: displayTicker,
          close: closeT0,
          max5d, min5d, return5d, volSpike5d, adv20, atr14,
          fiftyTwoWeekHigh: Math.max(...H),
          fiftyTwoWeekLow: Math.min(...L)
        });
      } catch { /* skip */ }
    }
    return results;
  }

  // ─── Диагностический одиночный запрос ───
  async function testFreedomConnection() {
    testResult = null;
    const testTicker = prompt('Тикер для теста (AAPL, COLD, и т.д.):', 'COLD');
    if (!testTicker) return;

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 14);

    const params = {
      cmd: 'getHloc',
      params: {
        id: testTicker.toUpperCase() + '.US',
        count: -1,
        timeframe: 1440,
        date_from: fmtFreedomDate(start),
        date_to: fmtFreedomDate(end),
        intervalMode: 'ClosedRay'
      }
    };

    const url = `https://tradernet.com/api/?q=${encodeURIComponent(JSON.stringify(params))}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();

      const fullId = testTicker.toUpperCase() + '.US';
      const hloc = data?.hloc?.[fullId] ?? [];
      const vols = data?.vl?.[fullId] ?? [];
      const xSer = data?.xSeries?.[fullId] ?? [];

      // Сформируем читаемый массив свечей
      const bars = hloc.map((c: number[], i: number) => {
        const ts = xSer[i] ?? 0;
        const d = new Date(ts * 1000);
        return {
          date: d.toISOString().split('T')[0],
          high: c[0],
          low: c[1],
          open: c[2],
          close: c[3],
          volume: vols[i] ?? 0
        };
      });

      testResult = {
        success: hloc.length > 0,
        ticker: testTicker.toUpperCase(),
        request_url: url.substring(0, 200) + '...',
        bars_count: hloc.length,
        last_5_bars: bars.slice(-5),
        info: data?.info?.[fullId]
      };
    } catch (e: any) {
      testResult = { success: false, error: e.message };
    }
  }

  // ─── Ранжирование ───
  function computeRankings(data: TickerResult[]): TickerResult[] {
    if (!data.length) return [];
    const max5ds = data.map(r => r.max5d);
    const min5ds = data.map(r => r.min5d);
    const ret5ds = data.map(r => r.return5d);

    return data.map(r => {
      const maxPct = pctRank(max5ds, r.max5d);
      const minPct = pctRank(min5ds, r.min5d);
      const returnPct = pctRank(ret5ds, r.return5d);
      const adv20M = r.adv20 / 1_000_000;

      const isShort = maxPct >= 90 && returnPct >= 80 && r.volSpike5d >= 1.5 &&
        r.close < r.fiftyTwoWeekHigh * 0.98 && adv20M >= 10 && r.close >= 10;
      const isLong = minPct <= 10 && returnPct <= 20 && r.volSpike5d >= 1.5 &&
        r.close > r.fiftyTwoWeekLow * 1.02 && adv20M >= 10 && r.close >= 10;

      return { ...r, maxPct, minPct, returnPct,
        signal: isShort ? 'SHORT' : isLong ? 'LONG' : null };
    });
  }

  $effect(() => {
    capital;
    if (allResults.length > 0) ranked = computeRankings(allResults);
  });

  // ─── Сохранение кандидата в Supabase ───
  function todayStr(): string {
    return new Date().toISOString().split('T')[0];
  }

  async function saveCandidate(r: TickerResult) {
    if (!$user || !r.signal || r.maxPct === undefined) return;
    const id = r.ticker + '_' + todayStr();
    const atr = r.atr14;
    const sd = Math.min(2 * atr, r.close * 0.10);
    const stop = r.signal === 'SHORT' ? r.close + sd : r.close - sd;
    const target1 = r.signal === 'SHORT' ? r.close - atr : r.close + atr;
    const target2 = r.signal === 'SHORT' ? r.close - 2 * atr : r.close + 2 * atr;
    const gapThreshold = r.signal === 'SHORT' ? r.close * 1.04 : r.close * 0.96;

    try {
      await insertCandidate({
        id,
        user_id: $user.id,
        strategy: 'max_weekly',
        ticker: r.ticker,
        signal_date: todayStr(),
        direction: r.signal,
        status: 'WAITING_OPEN',
        entry: null,
        stop,
        target1,
        target2,
        payload: {
          close_t0: r.close,
          atr14: r.atr14,
          adv20: r.adv20,
          fiftyTwoWeekHigh: r.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: r.fiftyTwoWeekLow,
          max5d: r.max5d,
          min5d: r.min5d,
          return5d: r.return5d,
          volSpike5d: r.volSpike5d,
          maxPct: r.maxPct ?? 0,
          minPct: r.minPct ?? 100,
          returnPct: r.returnPct ?? 50,
          gap_cancel_threshold: gapThreshold
        }
      });
      savedTickers = new Set([...savedTickers, r.ticker]);
      saveError = null;
    } catch (e: any) {
      saveError = 'Ошибка сохранения ' + r.ticker + ': ' + (e.message || String(e));
    }
  }

  async function saveTopAll() {
    savingAll = true;
    saveError = null;
    const all = [...topShort, ...topLong];
    for (const r of all) {
      if (!savedTickers.has(r.ticker)) {
        await saveCandidate(r);
      }
    }
    savingAll = false;
  }

  // ─── Загрузка universe из static ───
  async function loadUniverse(): Promise<string[]> {
    const res = await fetch('/universe.json');
    return res.json();
  }

  // ─── Главный цикл ───
  async function runScan() {
    scanning = true; aborted = false; done = false;
    allResults = []; ranked = []; progress = 0; errors = 0; scanLog = [];

    let universe: string[];
    try {
      universe = await loadUniverse();
      total = universe.length;
    } catch (e: any) {
      scanLog = ['Ошибка загрузки universe.json: ' + e.message];
      scanning = false; return;
    }

    totalBatches = Math.ceil(universe.length / BATCH);

    for (let b = 0; b < totalBatches && !aborted; b++) {
      const slice = universe.slice(b * BATCH, (b + 1) * BATCH);
      currentBatch = b + 1;
      scanLog = [`Батч ${b + 1}/${totalBatches}: запрос ${slice.length} тикеров...`, ...scanLog.slice(0, 6)];

      let attempts = 0;
      let batchResults: TickerResult[] = [];
      let batchError: string | null = null;

      while (attempts < 3 && !aborted) {
        try {
          batchResults = await fetchFreedomBatch(slice);
          batchError = null;
          break;
        } catch (e: any) {
          attempts++;
          batchError = e.message;
          if (attempts < 3) {
            scanLog = [`Батч ${b + 1}: retry ${attempts}/3 — ${e.message}`, ...scanLog.slice(0, 6)];
            await new Promise(r => setTimeout(r, 1500 * attempts));
          }
        }
      }

      const batchErrCount = slice.length - batchResults.length;
      errors += batchErrCount;
      progress += slice.length;

      if (batchResults.length > 0) {
        allResults = [...allResults, ...batchResults];
        ranked = computeRankings(allResults);
      }

      scanLog = [
        `Батч ${b + 1}/${totalBatches}: +${batchResults.length} тикеров${batchError ? ' · ОШИБКА: ' + batchError : ''}`,
        ...scanLog.slice(0, 6)
      ];

      // Пауза 300ms между батчами
      if (!aborted && b < totalBatches - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ─── ФАЗА 2: Yahoo Finance fallback для недостающих тикеров ───
    if (!aborted && allResults.length > 0) {
      const foundTickers = new Set(allResults.map(r => r.ticker));
      const missingTickers = universe.filter(t => !foundTickers.has(t));

      if (missingTickers.length > 0) {
        scanLog = [
          `📡 Yahoo fallback: ${missingTickers.length} недостающих тикеров...`,
          ...scanLog.slice(0, 6)
        ];

        const YF_BATCH = 50; // Yahoo spark принимает до 50 за раз
        let yf_added = 0;
        let yf_errors = 0;

        for (let i = 0; i < missingTickers.length && !aborted; i += YF_BATCH) {
          const slice = missingTickers.slice(i, i + YF_BATCH);
          try {
            const yf = await fetchYahooBatch(slice);
            if (yf.length > 0) {
              allResults = [...allResults, ...yf];
              ranked = computeRankings(allResults);
              yf_added += yf.length;
            }
            yf_errors += slice.length - yf.length;
            scanLog = [
              `Yahoo батч ${Math.floor(i/YF_BATCH)+1}: +${yf.length} тикеров`,
              ...scanLog.slice(0, 6)
            ];
          } catch {
            yf_errors += slice.length;
          }
          // Небольшая пауза
          await new Promise(r => setTimeout(r, 200));
        }

        errors = errors - missingTickers.length + yf_errors;
        scanLog = [
          `✓ Yahoo fallback завершён: +${yf_added} тикеров, ${yf_errors} ошибок`,
          ...scanLog.slice(0, 6)
        ];
      }
    }

    scanning = false; done = true;
  }

  function stopScan() { aborted = true; }

  function setSort(col: string) {
    sortDir = sortCol === col ? (sortDir === 'desc' ? 'asc' : 'desc') : 'desc';
    sortCol = col;
  }

  const sortedRanked = $derived.by(() => {
    let list = [...ranked];
    if (filterSignal !== 'ALL') list = list.filter(r => r.signal === filterSignal);
    if (showTopOnly) list = list.filter(r => r.signal !== null);
    list.sort((a, b) => {
      const va = (a as any)[sortCol] ?? 0;
      const vb = (b as any)[sortCol] ?? 0;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return list;
  });

  const topShort = $derived(
    ranked.filter(r => r.signal === 'SHORT')
      .sort((a, b) => (b.maxPct ?? 0) - (a.maxPct ?? 0)).slice(0, 3)
  );
  const topLong = $derived(
    ranked.filter(r => r.signal === 'LONG')
      .sort((a, b) => (a.minPct ?? 100) - (b.minPct ?? 100)).slice(0, 3)
  );

  function posSize(r: TickerResult) {
    const cap = parseFloat(capital) || 50000;
    const sd = Math.min(2.0 * r.atr14, r.close * 0.10);
    const shares = sd > 0 ? Math.min(
      Math.floor((cap * 0.008) / sd),
      Math.floor((cap * 0.10) / r.close)
    ) : 0;
    return { shares, stop: r.signal === 'SHORT' ? r.close + sd : r.close - sd, risk: shares * sd };
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const col = (c: string, l: string) => l + (sortCol === c ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');
</script>

<svelte:head>
  <title>MAX Weekly Reversal · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>MAX Weekly Reversal</h1>
      <p class="sub">Russell 1000 · Freedom24 API · Запускать пятница после 23:00 EET</p>
    </div>
    <div class="head-right">
      <div class="fg">
        <label>Капитал $</label>
        <input type="text" inputmode="numeric" bind:value={capital} style="width:110px" />
      </div>
      {#if !scanning}
        <button onclick={testFreedomConnection} style="font-size:10px">🔍 Тест API</button>
        <button class="btn-p" onclick={runScan}>Запустить скан</button>
      {:else}
        <button class="btn-r" onclick={stopScan}>⏹ Стоп</button>
      {/if}
    </div>
  </div>

  {#if testResult}
    <div class="test-result" class:tr-ok={testResult.success} class:tr-err={!testResult.success}>
      {#if testResult.success}
        <div><b>{testResult.ticker}</b> · {testResult.bars_count} свечей загружено</div>
        {#if testResult.info}
          <div style="font-size:10px;color:var(--color-t2);margin:4px 0">{testResult.info.short_name} · {testResult.info.currency} · {testResult.info.code_nm}</div>
        {/if}
        <div style="font-family:var(--font-mono);font-size:10px;margin-top:8px">Последние 5 свечей (формат: дата | O/H/L/C | Volume):</div>
        <pre style="font-family:var(--font-mono);font-size:10px;margin:4px 0;background:rgba(0,0,0,0.2);padding:6px;border-radius:4px">{#each testResult.last_5_bars as b}{b.date}  O={b.open.toFixed(2)}  H={b.high.toFixed(2)}  L={b.low.toFixed(2)}  C={b.close.toFixed(2)}  V={b.volume.toLocaleString()}
{/each}</pre>
      {:else}
        ✗ Ошибка: {testResult.error}
      {/if}
    </div>
  {/if}

  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">SHORT</div>
      <div>MAX_pct ≥ 90 · Return_pct ≥ 80</div>
      <div>VolSpike ≥ 1.5× · ADV20 ≥ $10M · Close ≥ $10</div>
      <div>Close &lt; 52wkH × 0.98</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">LONG (зеркально)</div>
      <div>MIN_pct ≤ 10 · Return_pct ≤ 20</div>
      <div>VolSpike ≥ 1.5× · ADV20 ≥ $10M · Close ≥ $10</div>
      <div>Close &gt; 52wkL × 1.02</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">Вход / Стоп / Выход</div>
      <div>Entry: Open понедельника · Stop: ±2×ATR14 (max 10%)</div>
      <div>Размер: 0.8% капитала / стоп (max 10% капитала)</div>
      <div>T1 (60%): ∓1×ATR · T2 (40%): ∓2×ATR · Time: пятница D+5</div>
    </div>
  </div>

  {#if scanning || allResults.length > 0}
    <div class="scan-status">
      <div class="scan-top">
        {#if scanning}
          <span class="si">Батч {currentBatch}/{totalBatches} · Загружено: <b>{allResults.length}</b> · SHORT: <b>{topShort.length}</b> · LONG: <b>{topLong.length}</b></span>
        {:else if done}
          <span class="si">✓ Скан завершён · <b>{allResults.length}</b> тикеров · SHORT: <b>{topShort.length}</b> · LONG: <b>{topLong.length}</b></span>
        {/if}
        {#if errors > 0}<span class="err-b">{errors} ошибок (тикер недоступен)</span>{/if}
      </div>
      {#if scanning}
        <div class="ptrack"><div class="pfill" style="width:{total > 0 ? (progress/total*100) : 0}%"></div></div>
      {/if}
      <div class="slog">{#each scanLog as l}<div>{l}</div>{/each}</div>
    </div>
  {/if}

  {#if saveError}
    <div class="save-err">⚠ {saveError}</div>
  {/if}

  {#if topShort.length > 0 || topLong.length > 0}
    <div class="save-all-bar">
      <span class="sa-info">Топ сигналы: {topShort.length} SHORT + {topLong.length} LONG</span>
      {#if $user}
        <button class="btn-p" onclick={saveTopAll} disabled={savingAll || (topShort.length + topLong.length === savedTickers.size)} style="font-size:10px;padding:6px 14px">
          {savingAll ? 'Сохранение...' : `💾 Сохранить топ-${topShort.length + topLong.length} как кандидатов`}
        </button>
      {/if}
    </div>
    <div class="top-signals">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="top-h" style="color:var(--color-acc2);margin-bottom:0">⬇ TOP-3 SHORT</div>
      </div>
        {#each topShort as r}
          {@const p = posSize(r)}
          <div class="scard short">
            <div class="sticker">{r.ticker}</div>
            <div class="smeta">Close <b>${r.close.toFixed(2)}</b> · MAX_5d <b>{fmtPct(r.max5d)}</b> · MAX_pct <b>{r.maxPct?.toFixed(0)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b></div>
            <div class="smeta">Stop <b>${p.stop.toFixed(2)}</b> · Shares <b>{p.shares}</b> · Risk <b>${p.risk.toFixed(0)}</b></div>
            <div class="smeta">T1 <b>${(r.close - r.atr14).toFixed(2)}</b> · T2 <b>${(r.close - 2*r.atr14).toFixed(2)}</b></div>
            <div class="scl">□ Проверить шорт в Freedom24 · □ Earnings ±5 дней · □ Отмена Open ≥ ${(r.close*1.04).toFixed(2)}</div>
            <div style="margin-top:8px">
              {#if savedTickers.has(r.ticker)}
                <span style="font-family:var(--font-mono);font-size:9px;color:var(--color-acc)">✓ Сохранён</span>
              {:else if $user}
                <button onclick={() => saveCandidate(r)} style="font-size:9px;padding:4px 10px">💾 Сохранить</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <div>
        <div class="top-h" style="color:var(--color-acc)">⬆ TOP-3 LONG</div>
        {#each topLong as r}
          {@const p = posSize(r)}
          <div class="scard long">
            <div class="sticker">{r.ticker}</div>
            <div class="smeta">Close <b>${r.close.toFixed(2)}</b> · MIN_5d <b>{fmtPct(r.min5d)}</b> · MIN_pct <b>{r.minPct?.toFixed(0)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b></div>
            <div class="smeta">Stop <b>${p.stop.toFixed(2)}</b> · Shares <b>{p.shares}</b> · Risk <b>${p.risk.toFixed(0)}</b></div>
            <div class="smeta">T1 <b>${(r.close + r.atr14).toFixed(2)}</b> · T2 <b>${(r.close + 2*r.atr14).toFixed(2)}</b></div>
            <div class="scl">□ Earnings ±5 дней · □ Отмена Open ≤ ${(r.close*0.96).toFixed(2)}</div>
            <div style="margin-top:8px">
              {#if savedTickers.has(r.ticker)}
                <span style="font-family:var(--font-mono);font-size:9px;color:var(--color-acc)">✓ Сохранён</span>
              {:else if $user}
                <button onclick={() => saveCandidate(r)} style="font-size:9px;padding:4px 10px">💾 Сохранить</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if ranked.length > 0}
    <div class="tbl-ctrl">
      <div class="tbl-f">
        <select bind:value={filterSignal}>
          <option value="ALL">Все ({ranked.length})</option>
          <option value="SHORT">SHORT ({ranked.filter(r=>r.signal==='SHORT').length})</option>
          <option value="LONG">LONG ({ranked.filter(r=>r.signal==='LONG').length})</option>
        </select>
        <label class="chk"><input type="checkbox" bind:checked={showTopOnly} /> Только сигналы</label>
      </div>
      <span class="tbl-m">{sortedRanked.length} строк{scanning ? ' · обновляется...' : ''}</span>
    </div>
    <div class="tw">
      <table>
        <thead><tr>
          <th onclick={() => setSort('ticker')} class="s">{col('ticker','Ticker')}</th>
          <th onclick={() => setSort('close')} class="s">{col('close','Close')}</th>
          <th onclick={() => setSort('max5d')} class="s">{col('max5d','MAX_5d')}</th>
          <th onclick={() => setSort('maxPct')} class="s">{col('maxPct','MAX_pct')}</th>
          <th onclick={() => setSort('min5d')} class="s">{col('min5d','MIN_5d')}</th>
          <th onclick={() => setSort('minPct')} class="s">{col('minPct','MIN_pct')}</th>
          <th onclick={() => setSort('return5d')} class="s">{col('return5d','Ret_5d')}</th>
          <th onclick={() => setSort('returnPct')} class="s">{col('returnPct','Ret_pct')}</th>
          <th onclick={() => setSort('volSpike5d')} class="s">{col('volSpike5d','VolSpike')}</th>
          <th onclick={() => setSort('adv20')} class="s">{col('adv20','ADV20M')}</th>
          <th onclick={() => setSort('atr14')} class="s">{col('atr14','ATR14')}</th>
          <th>Signal</th>
        </tr></thead>
        <tbody>
          {#each sortedRanked as r (r.ticker)}
            <tr class:row-short={r.signal==='SHORT'} class:row-long={r.signal==='LONG'}>
              <td><b>{r.ticker}</b></td>
              <td>${r.close.toFixed(2)}</td>
              <td style="color:{r.max5d>=0.05?'var(--color-acc2)':'inherit'}">{fmtPct(r.max5d)}</td>
              <td style="color:{(r.maxPct??0)>=90?'var(--color-acc2)':'inherit'};font-weight:{(r.maxPct??0)>=90?700:400}">{r.maxPct?.toFixed(0)??'—'}</td>
              <td style="color:{r.min5d<=-0.05?'var(--color-acc)':'inherit'}">{fmtPct(r.min5d)}</td>
              <td style="color:{(r.minPct??100)<=10?'var(--color-acc)':'inherit'};font-weight:{(r.minPct??100)<=10?700:400}">{r.minPct?.toFixed(0)??'—'}</td>
              <td style="color:{r.return5d>=0?'var(--color-acc)':'var(--color-acc2)'}">{fmtPct(r.return5d)}</td>
              <td style="color:{(r.returnPct??50)>=80?'var(--color-acc2)':(r.returnPct??50)<=20?'var(--color-acc)':'inherit'}">{r.returnPct?.toFixed(0)??'—'}</td>
              <td style="color:{r.volSpike5d>=1.5?'var(--color-acc3)':'inherit'}">{r.volSpike5d.toFixed(2)}×</td>
              <td style="color:{r.adv20<10_000_000?'var(--color-acc2)':'inherit'}">${(r.adv20/1_000_000).toFixed(1)}M</td>
              <td>{r.atr14.toFixed(2)}</td>
              <td>
                {#if r.signal}
                  <span style="color:{r.signal==='SHORT'?'var(--color-acc2)':'var(--color-acc)'};font-weight:700">{r.signal}</span>
                  {#if $user}
                    {#if savedTickers.has(r.ticker)}
                      <span style="font-family:var(--font-mono);font-size:9px;color:var(--color-acc);margin-left:6px">✓</span>
                    {:else}
                      <button onclick={() => saveCandidate(r)} style="font-size:9px;padding:2px 6px;margin-left:4px">💾</button>
                    {/if}
                  {/if}
                {:else}
                  <span style="color:var(--color-t3)">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if done && allResults.length === 0}
    <div class="state err">Нет данных от Freedom24. Нажми "🔍 Тест API" для диагностики.</div>
  {:else if !scanning && !done}
    <div class="state">Нажми «Тест API» для проверки соединения, затем «Запустить скан»</div>
  {/if}
</div>

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .head-right { display: flex; align-items: flex-end; gap: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; }
  .test-result { padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-family: var(--font-mono); font-size: 11px; }
  .tr-ok { background: rgba(126,232,162,0.08); border: 1px solid var(--color-acc); color: var(--color-text); }
  .tr-err { background: rgba(255,107,138,0.08); border: 1px solid var(--color-acc2); color: var(--color-text); }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 16px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .scan-status { padding: 10px 14px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; margin-bottom: 14px; }
  .scan-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
  .si { font-family: var(--font-mono); font-size: 11px; color: var(--color-t2); }
  .si b { color: var(--color-text); }
  .err-b { font-family: var(--font-mono); font-size: 9px; background: rgba(255,107,138,0.15); color: var(--color-acc2); padding: 2px 8px; border-radius: 4px; }
  .ptrack { height: 4px; background: var(--color-bg3); border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
  .pfill { height: 100%; background: var(--color-acc); transition: width 0.4s; border-radius: 2px; }
  .slog { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); line-height: 1.6; }
  .top-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
  @media (max-width: 800px) { .top-signals { grid-template-columns: 1fr; } }
  .top-h { font-family: var(--font-mono); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
  .scard { padding: 12px; border-radius: 8px; margin-bottom: 8px; font-family: var(--font-mono); font-size: 10px; line-height: 1.7; }
  .scard.short { background: rgba(255,107,138,0.08); border: 1px solid rgba(255,107,138,0.3); }
  .scard.long { background: rgba(126,232,162,0.08); border: 1px solid rgba(126,232,162,0.3); }
  .sticker { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .scard.short .sticker { color: var(--color-acc2); }
  .scard.long .sticker { color: var(--color-acc); }
  .smeta { color: var(--color-t2); }
  .smeta b { color: var(--color-text); }
  .scl { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-line); color: var(--color-t3); font-size: 9px; }
  .tbl-ctrl { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; flex-wrap: wrap; }
  .tbl-f { display: flex; gap: 10px; align-items: center; }
  .chk { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); cursor: pointer; }
  .tbl-m { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); }
  .tw { overflow-x: auto; }
  .s { cursor: pointer; user-select: none; }
  .s:hover { color: var(--color-text); }
  .row-short { background: rgba(255,107,138,0.04); }
  .row-long { background: rgba(126,232,162,0.04); }
  .state { padding: 40px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .save-err { padding: 8px 14px; background: rgba(255,107,138,0.1); border: 1px solid var(--color-acc2); border-radius: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-acc2); margin-bottom: 10px; }
  .save-all-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--color-bg2); border: 1px solid rgba(167,139,250,0.3); border-radius: 8px; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
  .sa-info { font-family: var(--font-mono); font-size: 11px; color: var(--color-t2); }
</style>
