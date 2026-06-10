<script lang="ts">
  // ─── MAX Weekly Reversal · Polygon.io ───
  // Источник: Polygon.io Grouped Daily endpoint
  // 1 запрос = OHLCV всех ~10000 US акций за один день
  // 25 торговых дней = 25 запросов = ~5 минут (free tier 5/min)

  import { insertCandidate } from '$lib/data/candidates';
  import { findCachedDates, loadBarsForDates, saveBarsForDate, cleanupOldBars } from '$lib/data/polygonCache';
  import { user } from '$lib/stores/auth';
  import WorkflowGuide from '$lib/components/WorkflowGuide.svelte';

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

  interface DailyBar {
    o: number; h: number; l: number; c: number; v: number;
  }

  const DAYS_HISTORY = 25;           // торговых дней для расчёта (нужно 20 + 5)
  const REQ_INTERVAL_MS = 13000;     // 5 req/min → 12.5 сек минимум

  let allResults = $state<TickerResult[]>([]);
  let ranked = $state<TickerResult[]>([]);
  let scanning = $state(false);
  let aborted = $state(false);
  let progress = $state(0);
  let total = $state(0);
  let errors = $state(0);
  let done = $state(false);
  let capital = $state('50000');
  let scanLog = $state<string[]>([]);

  let savedTickers = $state<Set<string>>(new Set());
  let savingAll = $state(false);
  let saveError = $state<string | null>(null);

  let sortCol = $state('maxPct');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let filterSignal = $state<'ALL' | 'SHORT' | 'LONG'>('ALL');
  let showTopOnly = $state(false);

  // ─── Helpers ───
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

  // Получить N последних рабочих дней (без выходных, с буфером для праздников)
  function getTradingDays(n: number): string[] {
    const days: string[] = [];
    const today = new Date();
    // Возвращаем больше дней с запасом на праздники (1.5x)
    const target = Math.ceil(n * 1.4);
    for (let i = 1; days.length < target; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        days.push(d.toISOString().split('T')[0]);
      }
      if (i > 90) break; // safety
    }
    return days.reverse(); // от старых к новым
  }

  // Расчёт метрик из массива дневных баров (отсортированы по возрастанию даты)
  function calcMetrics(ticker: string, bars: DailyBar[]): TickerResult | null {
    const n = bars.length;
    if (n < 8) return null;

    const H = bars.map(b => b.h);
    const L = bars.map(b => b.l);
    const C = bars.map(b => b.c);
    const V = bars.map(b => b.v);

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

    // VolSpike
    const vol5 = V.slice(-5);
    const vol20 = V.slice(-25, -5);
    const avgVol5 = vol5.length > 0 ? vol5.reduce((a, b) => a + b, 0) / vol5.length : 0;
    const avgVol20 = vol20.length > 0 ? vol20.reduce((a, b) => a + b, 0) / vol20.length : avgVol5;
    const volSpike5d = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

    // ADV20
    const last20c = C.slice(-21, -1);
    const last20v = V.slice(-21, -1);
    const adv20 = last20c.length > 0
      ? last20c.reduce((s, c, i) => s + c * (last20v[i] || 0), 0) / last20c.length
      : 0;

    return {
      ticker,
      close: closeT0,
      max5d, min5d, return5d, volSpike5d, adv20,
      atr14: atr14(H.slice(-16), L.slice(-16), C.slice(-16)),
      fiftyTwoWeekHigh: Math.max(...H),
      fiftyTwoWeekLow: Math.min(...L)
    };
  }

  // Загрузка universe
  async function loadUniverse(): Promise<Set<string>> {
    const res = await fetch('/universe.json');
    const list: string[] = await res.json();
    return new Set(list.map(t => t.toUpperCase()));
  }

  // ─── Главный цикл с кэшем ───
  // Логика:
  // 1. Считаем какие дни нужны (последние 25 торговых дней, исключая сегодня)
  // 2. Спрашиваем Supabase какие из них уже есть
  // 3. Качаем с Polygon только недостающие
  // 4. Загружаем все дни из кэша
  // 5. Считаем метрики локально
  async function runScan() {
    scanning = true; aborted = false; done = false;
    allResults = []; ranked = []; progress = 0; errors = 0; scanLog = [];

    let universe: Set<string>;
    try {
      universe = await loadUniverse();
    } catch (e: any) {
      scanLog = ['Ошибка universe.json: ' + e.message];
      scanning = false; return;
    }

    // Чистка старых баров (TTL 90 дней)
    scanLog = ['🧹 Очистка кэша старше 90 дней...'];
    try {
      const deleted = await cleanupOldBars();
      if (deleted > 0) scanLog = [`🧹 Удалено ${deleted} устаревших баров`, ...scanLog.slice(0, 7)];
    } catch (e) { /* ignore */ }

    // Получаем список дней
    const days = getTradingDays(DAYS_HISTORY);
    total = days.length;

    // Проверяем какие дни уже есть в кэше
    scanLog = [`🔍 Проверяю кэш для ${days.length} дней...`, ...scanLog.slice(0, 7)];
    let cachedDates: Set<string>;
    try {
      cachedDates = await findCachedDates(days);
    } catch (e: any) {
      cachedDates = new Set();
      scanLog = ['⚠ Ошибка проверки кэша: ' + e.message, ...scanLog.slice(0, 7)];
    }

    const missingDates = days.filter(d => !cachedDates.has(d));
    scanLog = [
      `📦 В кэше: ${cachedDates.size}/${days.length} дней · Качаю: ${missingDates.length}`,
      ...scanLog.slice(0, 7)
    ];

    // Качаем только недостающие дни
    for (let i = 0; i < missingDates.length && !aborted; i++) {
      const date = missingDates[i];
      progress = cachedDates.size + i + 1;
      scanLog = [`📡 Polygon ${i + 1}/${missingDates.length} (${date})...`, ...scanLog.slice(0, 7)];

      try {
        const res = await fetch(`/api/polygon-scan?date=${date}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.rate_limited) {
          scanLog = [`⏳ Rate limit на ${date}, жду 60 сек...`, ...scanLog.slice(0, 7)];
          await new Promise(r => setTimeout(r, 60000));
          i--; continue;
        }
        if (data.error) {
          scanLog = [`✗ ${date}: ${data.error}`, ...scanLog.slice(0, 7)];
          errors++;
          continue;
        }

        const results: any[] = data.results ?? [];
        // Сохраняем в кэш (все ~10000 тикеров)
        if (results.length > 0) {
          const bars = results.map(r => ({
            ticker: (r.T as string).toUpperCase(),
            o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Math.round(Number(r.v))
          })).filter(b => !isNaN(b.c) && b.c > 0);
          const saved = await saveBarsForDate(date, bars);
          scanLog = [
            `Polygon ${i + 1}/${missingDates.length} (${date}): ${results.length} акций · сохранено ${saved}`,
            ...scanLog.slice(0, 7)
          ];
        }

        if (i < missingDates.length - 1 && !aborted) {
          await new Promise(r => setTimeout(r, REQ_INTERVAL_MS));
        }
      } catch (e: any) {
        scanLog = [`✗ ${date}: ${e.message}`, ...scanLog.slice(0, 7)];
        errors++;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Загружаем все дни из кэша
    scanLog = [`📥 Чтение ${days.length} дней из кэша...`, ...scanLog.slice(0, 7)];
    let tickerBars: Map<string, any[]>;
    try {
      tickerBars = await loadBarsForDates(days);
    } catch (e: any) {
      scanLog = ['⚠ Ошибка чтения кэша: ' + e.message, ...scanLog.slice(0, 7)];
      scanning = false; done = true; return;
    }

    // Фильтрация по universe и расчёт метрик
    scanLog = [`🧮 Расчёт метрик для ${universe.size} тикеров Russell 1000...`, ...scanLog.slice(0, 7)];
    const results: TickerResult[] = [];
    for (const [ticker, bars] of tickerBars) {
      if (!universe.has(ticker)) continue;
      const m = calcMetrics(ticker, bars);
      if (m) results.push(m);
    }
    allResults = results;
    ranked = computeRankings(results);

    progress = total;
    scanLog = [`✓ Скан завершён: ${results.length} тикеров (${cachedDates.size} дней из кэша)`, ...scanLog.slice(0, 7)];
    scanning = false; done = true;
  }

  function stopScan() { aborted = true; }

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

  // ─── Сохранение кандидатов ───
  function todayStr(): string { return new Date().toISOString().split('T')[0]; }

  async function saveCandidate(r: TickerResult) {
    if (!$user || !r.signal || r.maxPct === undefined) return;
    const id = r.ticker + '_' + todayStr();
    const atr = r.atr14;
    const sd = Math.min(2 * atr, r.close * 0.10);
    const stop = r.signal === 'SHORT' ? r.close + sd : r.close - sd;
    // T1 = 1.5×ATR (Докрутка 2A), T2 = 2×ATR
    const target1 = r.signal === 'SHORT' ? r.close - 1.5 * atr : r.close + 1.5 * atr;
    const target2 = r.signal === 'SHORT' ? r.close - 2 * atr : r.close + 2 * atr;
    const gapThreshold = r.signal === 'SHORT' ? r.close * 1.04 : r.close * 0.96;

    try {
      await insertCandidate({
        id, user_id: $user.id, strategy: 'max_weekly',
        ticker: r.ticker, signal_date: todayStr(),
        direction: r.signal, status: 'WAITING_OPEN',
        entry: null, stop, target1, target2,
        payload: {
          close_t0: r.close, atr14: r.atr14, adv20: r.adv20,
          fiftyTwoWeekHigh: r.fiftyTwoWeekHigh, fiftyTwoWeekLow: r.fiftyTwoWeekLow,
          max5d: r.max5d, min5d: r.min5d, return5d: r.return5d,
          volSpike5d: r.volSpike5d,
          maxPct: r.maxPct ?? 0, minPct: r.minPct ?? 100, returnPct: r.returnPct ?? 50,
          gap_cancel_threshold: gapThreshold
        }
      });
      savedTickers = new Set([...savedTickers, r.ticker]);
      saveError = null;
    } catch (e: any) {
      saveError = 'Ошибка ' + r.ticker + ': ' + (e.message || String(e));
    }
  }

  async function saveTopAll() {
    savingAll = true; saveError = null;
    const all = [...topShort, ...topLong];
    for (const r of all) {
      if (!savedTickers.has(r.ticker)) await saveCandidate(r);
    }
    savingAll = false;
  }

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

  const eta = $derived.by(() => {
    if (!scanning || progress === 0) return '';
    const remaining = total - progress;
    const sec = remaining * (REQ_INTERVAL_MS / 1000);
    const mm = Math.floor(sec / 60);
    const ss = Math.floor(sec % 60);
    return `~${mm}:${String(ss).padStart(2, '0')} осталось`;
  });
</script>

<svelte:head>
  <title>MAX Weekly · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>MAX Weekly Reversal</h1>
      <p class="sub">Russell 1000 · Polygon.io · 25 торговых дней · ~5 минут</p>
    </div>
    <div class="head-right">
      <div class="fg">
        <label>Капитал $</label>
        <input type="text" inputmode="numeric" bind:value={capital} style="width:110px" />
      </div>
      {#if !scanning}
        <button class="btn-p" onclick={runScan}>🔍 Запустить скан</button>
      {:else}
        <button class="btn-r" onclick={stopScan}>⏹ Стоп</button>
      {/if}
    </div>
  </div>

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
      <div class="rule-h" style="color:var(--color-acc4)">Вход / Стоп / Цели</div>
      <div>Entry: Open пн · Stop: ±2×ATR14 (max 10%)</div>
      <div>Размер: 0.8% капитала · max 10%</div>
      <div>T1 (60%): ∓1.5×ATR · T2 (40%): ∓2×ATR</div>
    </div>
    <div class="rule-col" style="border-color: rgba(126,232,162,0.3)">
      <div class="rule-h" style="color:var(--color-acc)">LONG докрутка</div>
      <div>Time stop: <b>D+3</b> (среда)</div>
      <div>D+1 EOD exit: если Close ≤ Entry или Close &lt; Open</div>
      <div><b>Ежедневно до T1:</b> Close ≤ Entry → выход</div>
      <div>После T1: stop = max(текущий, Low вчер. дня)</div>
    </div>
    <div class="rule-col" style="border-color: rgba(255,107,138,0.3)">
      <div class="rule-h" style="color:var(--color-acc2)">SHORT докрутка</div>
      <div>Time stop: <b>D+5</b> (пятница)</div>
      <div>После T1: стоп в безубыток</div>
      <div>D+1 EOD: Close ≥ Entry → стоп = Close × 1.01</div>
      <div><b>Ежедневно до T1:</b> Close ≥ Entry → выход</div>
    </div>
  </div>

  <WorkflowGuide
    strategyId="max_weekly"
    sections={[
      {
        title: 'Пятница вечером — Запуск скана',
        steps: [
          'После закрытия US рынка (23:00 EET / 16:00 EST) открой страницу **MAX Weekly**',
          'Введи **Капитал $** (для расчёта размера позиций)',
          'Нажми **🔍 Запустить скан** · Polygon.io скачает 25 торговых дней (~5 минут)',
          'Дождись завершения · увидишь **TOP-3 SHORT** и **TOP-3 LONG** кандидатов',
          'Нажми **💾 Сохранить топ-N** (или 💾 на каждой карточке) — кандидаты пойдут в Supabase'
        ]
      },
      {
        title: 'Логика сигнала',
        steps: [
          '**SHORT (down-lottery)**: MAX_pct ≥ 90 · Return_pct ≥ 80 · VolSpike ≥ 1.5× · Close < 52wkH × 0.98',
          '**LONG (зеркально)**: MIN_pct ≤ 10 · Return_pct ≤ 20 · VolSpike ≥ 1.5× · Close > 52wkL × 1.02',
          'Общие фильтры: **ADV20 ≥ $10M · Close ≥ $10**'
        ]
      },
      {
        title: 'Понедельник утром — Вход',
        steps: [
          'Открой **MW Кандидаты** (вкладка 📋 в шапке)',
          'Для каждого WAITING_OPEN кандидата нажми **+ Открыть сделку**',
          'Введи **Open price** понедельника',
          '🟢 **Gap OK** → Entry/Stop/T1/T2 пересчитаны от Open',
          '🔴 **GAP CANCEL**: SHORT Open ≥ Close×1.04, LONG Open ≤ Close×0.96 → кнопка "Пометить GAP CANCEL"',
          'Размер позиции: 0.8% капитала / стоп · max 10% капитала'
        ]
      },
      {
        title: 'Параметры сделки (автоматически)',
        steps: [
          '**Stop** = Entry ± min(2×ATR14, 10%)',
          '**T1** = Entry ± 1.5×ATR (60% позиции)',
          '**T2** = Entry ± 2×ATR (40%)',
          '**Time stop**:',
          '  • **LONG**: D+3 (среда)',
          '  • **SHORT**: D+5 (пятница)'
        ]
      },
      {
        title: 'Управление LONG позицией (докрутка)',
        steps: [
          '**D+1 EOD exit**: если Close D+1 ≤ Entry **ИЛИ** Close D+1 < Open D+1 (красная свеча) → закрыть всю позицию MOC',
          '**Ежедневный no-progress check (до T1)**: на закрытии КАЖДОГО дня — Close ≤ Entry → выход по Close (exit reason: `d1_close_check`)',
          'Иначе позиция остаётся, обычные правила',
          'После **T1 (1.5×ATR)**: trailing stop = MAX(текущий stop, Low вчерашнего дня)',
          '**Time stop D+3**: закрыть в среду MOC'
        ]
      },
      {
        title: 'Управление SHORT позицией',
        steps: [
          '**D+1 EOD check (22:45 EET):**',
          '  • Close D+1 **< Entry** → стоп не меняем (остаётся Entry + 2×ATR)',
          '  • Close D+1 **≥ Entry** → стоп → Close × 1.01 (риск сужается)',
          '**Ежедневный no-progress check (до T1)**: на закрытии КАЖДОГО дня — Close ≥ Entry → выход по Close (exit reason: `d1_close_check`)',
          'Пример: Entry $100, ATR $5, стоп $110',
          '  • Close $98 → стоп $110 (без изменений)',
          '  • Close $100.50 → стоп $101.51',
          '  • Close $103 → стоп $104.03',
          'После **T1 (1.5×ATR)**: стоп в **breakeven** (Entry)',
          '**T2 (2×ATR)**: закрыть остаток',
          '**Time stop D+5**: закрыть в пятницу MOC'
        ]
      },
      {
        title: 'Перед каждой сделкой проверь',
        steps: [
          '**Earnings ±5 дней** — нет ли отчёта в окне удержания',
          '**Для SHORT**: акция доступна в шорт в Freedom24',
          '**Pre-market gap** не превышает порог отмены'
        ]
      }
    ]}
  />

  {#if scanning || allResults.length > 0}
    <div class="scan-status">
      <div class="scan-top">
        {#if scanning}
          <span class="si">День {progress}/{total} · Загружено тикеров: <b>{allResults.length}</b> · SHORT: <b>{topShort.length}</b> · LONG: <b>{topLong.length}</b></span>
          {#if eta}<span class="eta">{eta}</span>{/if}
        {:else if done}
          <span class="si">✓ Скан завершён · <b>{allResults.length}</b> тикеров · SHORT: <b>{topShort.length}</b> · LONG: <b>{topLong.length}</b></span>
        {/if}
        {#if errors > 0}<span class="err-b">{errors} дней с ошибками</span>{/if}
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
        <button class="btn-p" onclick={saveTopAll}
          disabled={savingAll || (topShort.length + topLong.length === savedTickers.size)}
          style="font-size:10px;padding:6px 14px">
          {savingAll ? 'Сохранение...' : `💾 Сохранить топ-${topShort.length + topLong.length}`}
        </button>
      {/if}
    </div>

    <div class="top-signals">
      <div>
        <div class="top-h" style="color:var(--color-acc2)">⬇ TOP-3 SHORT</div>
        {#each topShort as r}
          {@const p = posSize(r)}
          <div class="scard short">
            <div class="sticker">{r.ticker}</div>
            <div class="smeta">Close <b>${r.close.toFixed(2)}</b> · MAX_5d <b>{fmtPct(r.max5d)}</b> · MAX_pct <b>{r.maxPct?.toFixed(0)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b></div>
            <div class="smeta">Stop <b>${p.stop.toFixed(2)}</b> · Shares <b>{p.shares}</b> · Risk <b>${p.risk.toFixed(0)}</b></div>
            <div class="smeta">T1 <b>${(r.close - 1.5 * r.atr14).toFixed(2)}</b> (1.5×ATR) · T2 <b>${(r.close - 2*r.atr14).toFixed(2)}</b></div>
            <div class="scl">□ Шорт в Freedom24 · □ Earnings ±5 дней · □ Отмена Open ≥ ${(r.close*1.04).toFixed(2)}</div>
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
            <div class="smeta">T1 <b>${(r.close + 1.5 * r.atr14).toFixed(2)}</b> (1.5×ATR) · T2 <b>${(r.close + 2*r.atr14).toFixed(2)}</b></div>
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
      <span class="tbl-m">{sortedRanked.length} строк</span>
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
    <div class="state err">Нет данных. Проверь POLYGON_API_KEY в Vercel Environment Variables.</div>
  {:else if !scanning && !done}
    <div class="state">
      Нажми «Запустить скан» · Polygon Free tier: 5 req/min · ~5 минут на 25 дней
    </div>
  {/if}
</div>

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .head-right { display: flex; align-items: flex-end; gap: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 16px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .scan-status { padding: 10px 14px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; margin-bottom: 14px; }
  .scan-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
  .si { font-family: var(--font-mono); font-size: 11px; color: var(--color-t2); }
  .si b { color: var(--color-text); }
  .eta { font-family: var(--font-mono); font-size: 10px; color: var(--color-acc3); background: rgba(255,200,90,0.1); padding: 2px 8px; border-radius: 4px; }
  .err-b { font-family: var(--font-mono); font-size: 9px; background: rgba(255,107,138,0.15); color: var(--color-acc2); padding: 2px 8px; border-radius: 4px; }
  .ptrack { height: 4px; background: var(--color-bg3); border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
  .pfill { height: 100%; background: var(--color-acc); transition: width 0.4s; border-radius: 2px; }
  .slog { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); line-height: 1.6; }
  .save-err { padding: 8px 14px; background: rgba(255,107,138,0.1); border: 1px solid var(--color-acc2); border-radius: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-acc2); margin-bottom: 10px; }
  .save-all-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--color-bg2); border: 1px solid rgba(167,139,250,0.3); border-radius: 8px; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
  .sa-info { font-family: var(--font-mono); font-size: 11px; color: var(--color-t2); }
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
  .state { padding: 40px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; line-height: 1.8; }
  .err { color: var(--color-acc2); }
</style>
