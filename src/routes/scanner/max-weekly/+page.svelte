<script lang="ts">
  import { onMount } from 'svelte';

  // ─── Types ───
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
    // Computed after all batches:
    maxPct?: number;
    minPct?: number;
    returnPct?: number;
    signal?: 'SHORT' | 'LONG' | null;
    stopDist?: number;
  }

  // ─── State ───
  const BATCH_SIZE = 40;
  let allResults = $state<TickerResult[]>([]);
  let ranked = $state<TickerResult[]>([]);
  let scanning = $state(false);
  let aborted = $state(false);
  let progress = $state(0);
  let totalTickers = $state(0);
  let totalBatches = $state(0);
  let currentBatch = $state(0);
  let errors = $state(0);
  let done = $state(false);
  let capital = $state('50000');

  // Filters
  let sortCol = $state<string>('maxPct');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let filterSignal = $state<'ALL' | 'SHORT' | 'LONG'>('ALL');
  let showTopOnly = $state(false);

  // ─── Percentile rank ───
  function percentileRank(arr: number[], value: number): number {
    const below = arr.filter(v => v < value).length;
    return (below / arr.length) * 100;
  }

  // ─── Compute ranks and signals ───
  function computeRankings(results: TickerResult[]): TickerResult[] {
    const max5dArr = results.map(r => r.max5d);
    const min5dArr = results.map(r => r.min5d);
    const return5dArr = results.map(r => r.return5d);

    return results.map(r => {
      const maxPct = percentileRank(max5dArr, r.max5d);
      const minPct = percentileRank(min5dArr, r.min5d); // LOW = low percentile
      const returnPct = percentileRank(return5dArr, r.return5d);
      const stopDist = 2.0 * r.atr14;
      const capNum = parseFloat(capital) || 50000;
      const adv20M = r.adv20 / 1_000_000;

      // SHORT signal
      const isShort =
        maxPct >= 90 &&
        returnPct >= 80 &&
        r.volSpike5d >= 1.5 &&
        r.close < r.fiftyTwoWeekHigh * 0.98 &&
        adv20M >= 10 &&
        r.close >= 10;

      // LONG signal
      const isLong =
        minPct <= 10 &&
        returnPct <= 20 &&
        r.volSpike5d >= 1.5 &&
        r.close > r.fiftyTwoWeekLow * 1.02 &&
        adv20M >= 10 &&
        r.close >= 10;

      return {
        ...r,
        maxPct,
        minPct,
        returnPct,
        stopDist,
        signal: isShort ? 'SHORT' : isLong ? 'LONG' : null
      };
    });
  }

  // ─── Scanner ───
  async function runScan() {
    scanning = true;
    aborted = false;
    done = false;
    allResults = [];
    ranked = [];
    progress = 0;
    errors = 0;

    let batch = 0;
    while (!aborted) {
      try {
        const res = await fetch(`/api/max-weekly?batch=${batch}&batchSize=${BATCH_SIZE}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        totalTickers = data.total_tickers;
        totalBatches = data.total_batches;
        currentBatch = batch + 1;
        progress = data.scanned;
        allResults = [...allResults, ...data.results];

        if (data.done) {
          ranked = computeRankings(allResults);
          done = true;
          break;
        }
        batch++;
      } catch (e: any) {
        errors++;
        if (errors > 5) break;
        batch++;
        continue;
      }
    }

    scanning = false;
  }

  function stopScan() {
    aborted = true;
  }

  // Пересчёт при изменении капитала
  $effect(() => {
    capital;
    if (done && allResults.length > 0) {
      ranked = computeRankings(allResults);
    }
  });

  // ─── Sorting ───
  function setSort(col: string) {
    if (sortCol === col) {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      sortCol = col;
      sortDir = 'desc';
    }
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
    ranked
      .filter(r => r.signal === 'SHORT')
      .sort((a, b) => (b.maxPct ?? 0) - (a.maxPct ?? 0))
      .slice(0, 3)
  );

  const topLong = $derived(
    ranked
      .filter(r => r.signal === 'LONG')
      .sort((a, b) => (a.minPct ?? 100) - (b.minPct ?? 100))
      .slice(0, 3)
  );

  // ─── Position sizing ───
  function posSize(r: TickerResult, cap: number): { shares: number; stopPrice: number; maxShares: number } {
    const stopDist = r.stopDist ?? (2 * r.atr14);
    const maxStopDist = r.close * 0.10;
    const effectiveStop = Math.min(stopDist, maxStopDist);
    let shares = effectiveStop > 0 ? Math.floor((cap * 0.008) / effectiveStop) : 0;
    const maxShares = Math.floor((cap * 0.10) / r.close);
    shares = Math.min(shares, maxShares);
    const stopPrice = r.signal === 'SHORT'
      ? r.close + effectiveStop
      : r.close - effectiveStop;
    return { shares, stopPrice, maxShares };
  }

  function fmtPct(v: number) {
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  }

  function fmtPctRank(v?: number) {
    if (v == null) return '—';
    return v.toFixed(0);
  }

  function signalColor(s?: string | null) {
    if (s === 'SHORT') return 'var(--color-acc2)';
    if (s === 'LONG') return 'var(--color-acc)';
    return 'var(--color-t3)';
  }

  let capNum = $derived(parseFloat(capital) || 50000);
</script>

<svelte:head>
  <title>MAX Weekly Reversal · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>MAX Weekly Reversal</h1>
      <p class="sub">Еженедельный скан · Запускать пятница после 23:00 EET (после закрытия NYSE)</p>
    </div>
    <div class="head-controls">
      <div class="fg">
        <label>Капитал $</label>
        <input type="text" inputmode="numeric" bind:value={capital} style="width:110px" />
      </div>
      {#if !scanning}
        <button class="btn-p" onclick={runScan}>🔍 Запустить скан</button>
      {:else}
        <button class="btn-r" onclick={stopScan}>⏹ Остановить</button>
      {/if}
    </div>
  </div>

  <!-- STRATEGY RULES -->
  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">SHORT сигнал</div>
      <div>MAX_pct ≥ 90 (топ-10% по дневному прыжку)</div>
      <div>Return_pct ≥ 80 (топ-20% по недельной доходности)</div>
      <div>VolSpike ≥ 1.5×</div>
      <div>Close &lt; 52wk High × 0.98</div>
      <div>ADV20 ≥ $10M · Close ≥ $10</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">LONG сигнал (зеркально)</div>
      <div>MIN_pct ≤ 10 (топ-10% по дневному падению)</div>
      <div>Return_pct ≤ 20 (низ-20% по недельной доходности)</div>
      <div>VolSpike ≥ 1.5×</div>
      <div>Close &gt; 52wk Low × 1.02</div>
      <div>ADV20 ≥ $10M · Close ≥ $10</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">Вход · Стоп · Выход</div>
      <div>Entry: Open D+1 (понедельник)</div>
      <div>Отмена если Open ≥ Close×1.04 (SHORT) / ≤ 0.96 (LONG)</div>
      <div>Stop: Entry ± 2.0×ATR14 (max 10%)</div>
      <div>T1 (60%): Entry ∓ 1.0×ATR · T2 (40%): Entry ∓ 2.0×ATR</div>
      <div>Time stop: пятница D+5</div>
    </div>
  </div>

  <!-- PROGRESS -->
  {#if scanning || done}
    <div class="scan-status">
      {#if scanning}
        <div class="scan-info">Батч {currentBatch}/{totalBatches} · Проверено {progress}/{totalTickers} тикеров · Найдено сигналов: {allResults.filter(r => r.signal !== undefined).length}</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:{totalTickers > 0 ? (progress/totalTickers*100) : 0}%"></div>
        </div>
      {:else if done}
        <div class="scan-info">✓ Скан завершён · {totalTickers} тикеров · Сигналов SHORT: {topShort.length} · LONG: {topLong.length}{#if errors > 0} · Ошибок: {errors}{/if}</div>
      {/if}
    </div>
  {/if}

  <!-- TOP SIGNALS -->
  {#if (topShort.length > 0 || topLong.length > 0)}
    <div class="top-signals">
      <!-- TOP-3 SHORT -->
      <div class="top-group">
        <div class="top-h" style="color:var(--color-acc2)">⬇ TOP-3 SHORT</div>
        {#each topShort as r}
          {@const pos = posSize(r, capNum)}
          <div class="signal-card short">
            <div class="card-ticker">{r.ticker}</div>
            <div class="card-meta">
              Close <b>${r.close.toFixed(2)}</b> · MAX_5d <b>{fmtPct(r.max5d)}</b> · MAX_pct <b>{fmtPctRank(r.maxPct)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b>
            </div>
            <div class="card-meta">
              ATR <b>{r.atr14.toFixed(2)}</b> · Stop <b>${pos.stopPrice.toFixed(2)}</b> · Shares <b>{pos.shares}</b> · Risk <b>${(pos.shares * r.atr14 * 2).toFixed(0)}</b>
            </div>
            <div class="card-meta">
              T1 <b>${(r.close - r.atr14).toFixed(2)}</b> · T2 <b>${(r.close - 2*r.atr14).toFixed(2)}</b>
            </div>
            <div class="checklist">
              <span>□ Проверить доступность шорта в Freedom24</span>
              <span>□ Проверить earnings в окне T0±5 дней</span>
              <span>□ Отмена если Open Mon ≥ ${(r.close * 1.04).toFixed(2)}</span>
            </div>
          </div>
        {/each}
        {#if topShort.length === 0}
          <div class="no-signal">Нет сигналов</div>
        {/if}
      </div>

      <!-- TOP-3 LONG -->
      <div class="top-group">
        <div class="top-h" style="color:var(--color-acc)">⬆ TOP-3 LONG</div>
        {#each topLong as r}
          {@const pos = posSize(r, capNum)}
          <div class="signal-card long">
            <div class="card-ticker">{r.ticker}</div>
            <div class="card-meta">
              Close <b>${r.close.toFixed(2)}</b> · MIN_5d <b>{fmtPct(r.min5d)}</b> · MIN_pct <b>{fmtPctRank(r.minPct)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b>
            </div>
            <div class="card-meta">
              ATR <b>{r.atr14.toFixed(2)}</b> · Stop <b>${pos.stopPrice.toFixed(2)}</b> · Shares <b>{pos.shares}</b> · Risk <b>${(pos.shares * r.atr14 * 2).toFixed(0)}</b>
            </div>
            <div class="card-meta">
              T1 <b>${(r.close + r.atr14).toFixed(2)}</b> · T2 <b>${(r.close + 2*r.atr14).toFixed(2)}</b>
            </div>
            <div class="checklist">
              <span>□ Проверить earnings в окне T0±5 дней</span>
              <span>□ Отмена если Open Mon ≤ ${(r.close * 0.96).toFixed(2)}</span>
            </div>
          </div>
        {/each}
        {#if topLong.length === 0}
          <div class="no-signal">Нет сигналов</div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- FULL TABLE -->
  {#if ranked.length > 0}
    <div class="table-controls">
      <div class="tbl-filters">
        <select bind:value={filterSignal}>
          <option value="ALL">Все ({ranked.length})</option>
          <option value="SHORT">SHORT ({ranked.filter(r=>r.signal==='SHORT').length})</option>
          <option value="LONG">LONG ({ranked.filter(r=>r.signal==='LONG').length})</option>
        </select>
        <label class="chk">
          <input type="checkbox" bind:checked={showTopOnly} />
          Только сигналы
        </label>
      </div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--color-t2)">
        {sortedRanked.length} строк · Клик по заголовку = сортировка
      </div>
    </div>

    <div class="tw">
      <table>
        <thead>
          <tr>
            <th onclick={() => setSort('ticker')} class="sortable">Ticker {sortCol==='ticker' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('close')} class="sortable">Close {sortCol==='close' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('max5d')} class="sortable">MAX_5d {sortCol==='max5d' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('maxPct')} class="sortable">MAX_pct {sortCol==='maxPct' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('min5d')} class="sortable">MIN_5d {sortCol==='min5d' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('minPct')} class="sortable">MIN_pct {sortCol==='minPct' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('return5d')} class="sortable">Return_5d {sortCol==='return5d' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('returnPct')} class="sortable">Ret_pct {sortCol==='returnPct' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('volSpike5d')} class="sortable">VolSpike {sortCol==='volSpike5d' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('adv20')} class="sortable">ADV20M {sortCol==='adv20' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th onclick={() => setSort('atr14')} class="sortable">ATR14 {sortCol==='atr14' ? (sortDir==='desc'?'↓':'↑') : ''}</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedRanked as r (r.ticker)}
            <tr class:row-short={r.signal==='SHORT'} class:row-long={r.signal==='LONG'}>
              <td><b>{r.ticker}</b></td>
              <td>${r.close.toFixed(2)}</td>
              <td style="color:{r.max5d >= 0.05 ? 'var(--color-acc2)' : 'inherit'}">{fmtPct(r.max5d)}</td>
              <td style="color:{(r.maxPct??0) >= 90 ? 'var(--color-acc2)' : 'inherit'};font-weight:{(r.maxPct??0)>=90?700:400}">{fmtPctRank(r.maxPct)}</td>
              <td style="color:{r.min5d <= -0.05 ? 'var(--color-acc)' : 'inherit'}">{fmtPct(r.min5d)}</td>
              <td style="color:{(r.minPct??100) <= 10 ? 'var(--color-acc)' : 'inherit'};font-weight:{(r.minPct??100)<=10?700:400}">{fmtPctRank(r.minPct)}</td>
              <td style="color:{r.return5d >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)'}">{fmtPct(r.return5d)}</td>
              <td style="color:{(r.returnPct??50) >= 80 ? 'var(--color-acc2)' : (r.returnPct??50) <= 20 ? 'var(--color-acc)' : 'inherit'}">{fmtPctRank(r.returnPct)}</td>
              <td style="color:{r.volSpike5d >= 1.5 ? 'var(--color-acc3)' : 'inherit'}">{r.volSpike5d.toFixed(2)}×</td>
              <td style="color:{r.adv20 < 10_000_000 ? 'var(--color-acc2)' : 'inherit'}">${(r.adv20/1_000_000).toFixed(1)}M</td>
              <td>{r.atr14.toFixed(2)}</td>
              <td>
                {#if r.signal}
                  <span style="color:{signalColor(r.signal)};font-weight:700">{r.signal}</span>
                {:else}
                  <span style="color:var(--color-t3)">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .head-controls { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; }

  .rules {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-t2);
    line-height: 1.8;
  }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }

  .scan-status { margin-bottom: 14px; }
  .scan-info { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); margin-bottom: 6px; }
  .progress-track { height: 4px; background: var(--color-bg3); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--color-acc); transition: width 0.3s; border-radius: 2px; }

  .top-signals {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 20px;
  }
  @media (max-width: 800px) { .top-signals { grid-template-columns: 1fr; } }
  .top-group {}
  .top-h { font-family: var(--font-mono); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
  .signal-card {
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.7;
  }
  .signal-card.short { background: rgba(255,107,138,0.08); border: 1px solid rgba(255,107,138,0.3); }
  .signal-card.long { background: rgba(126,232,162,0.08); border: 1px solid rgba(126,232,162,0.3); }
  .card-ticker { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .signal-card.short .card-ticker { color: var(--color-acc2); }
  .signal-card.long .card-ticker { color: var(--color-acc); }
  .card-meta { color: var(--color-t2); }
  .card-meta b { color: var(--color-text); }
  .checklist { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-line); color: var(--color-t3); font-size: 9px; display: flex; flex-direction: column; gap: 2px; }
  .no-signal { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 20px; text-align: center; border: 1px dashed var(--color-line); border-radius: 8px; }

  .table-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; flex-wrap: wrap; }
  .tbl-filters { display: flex; gap: 10px; align-items: center; }
  .chk { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); cursor: pointer; }
  .chk input { cursor: pointer; }

  .tw { overflow-x: auto; }
  .sortable { cursor: pointer; user-select: none; }
  .sortable:hover { color: var(--color-text); }
  .row-short { background: rgba(255,107,138,0.04); }
  .row-long { background: rgba(126,232,162,0.04); }
</style>
