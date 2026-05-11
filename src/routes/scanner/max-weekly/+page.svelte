<script lang="ts">
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

  const BATCH_SIZE = 50;

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
  let scanLog = $state<string[]>([]);

  let sortCol = $state('maxPct');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let filterSignal = $state<'ALL' | 'SHORT' | 'LONG'>('ALL');
  let showTopOnly = $state(false);

  function percentileRank(arr: number[], value: number): number {
    const n = arr.length;
    if (n === 0) return 50;
    const below = arr.filter(v => v < value).length;
    return (below / n) * 100;
  }

  function computeRankings(results: TickerResult[]): TickerResult[] {
    if (results.length === 0) return [];
    const max5dArr = results.map(r => r.max5d);
    const min5dArr = results.map(r => r.min5d);
    const return5dArr = results.map(r => r.return5d);

    return results.map(r => {
      const maxPct = percentileRank(max5dArr, r.max5d);
      const minPct = percentileRank(min5dArr, r.min5d);
      const returnPct = percentileRank(return5dArr, r.return5d);
      const capNum = parseFloat(capital) || 50000;
      const adv20M = r.adv20 / 1_000_000;

      const isShort =
        maxPct >= 90 &&
        returnPct >= 80 &&
        r.volSpike5d >= 1.5 &&
        r.close < r.fiftyTwoWeekHigh * 0.98 &&
        adv20M >= 10 &&
        r.close >= 10;

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
        signal: isShort ? 'SHORT' : isLong ? 'LONG' : null
      };
    });
  }

  // Пересчёт при изменении капитала или данных
  $effect(() => {
    capital;
    if (allResults.length > 0) {
      ranked = computeRankings(allResults);
    }
  });

  async function runScan() {
    scanning = true;
    aborted = false;
    done = false;
    allResults = [];
    ranked = [];
    progress = 0;
    errors = 0;
    scanLog = [];

    let batch = 0;
    while (!aborted) {
      try {
        const url = `/api/max-weekly?batch=${batch}&batchSize=${BATCH_SIZE}`;
        scanLog = [`Батч ${batch + 1}: запрос...`, ...scanLog.slice(0, 4)];

        const res = await fetch(url);
        if (!res.ok) {
          scanLog = [`Батч ${batch + 1}: HTTP ${res.status}`, ...scanLog.slice(0, 4)];
          errors++;
          batch++;
          if (errors > 10) break;
          continue;
        }

        const data = await res.json();
        totalTickers = data.total_tickers;
        totalBatches = data.total_batches;
        currentBatch = batch + 1;
        progress = data.scanned;
        errors += data.errors || 0;

        scanLog = [
          `Батч ${batch + 1}/${data.total_batches}: +${data.results?.length ?? 0} тикеров, ошибок ${data.errors ?? 0}`,
          ...scanLog.slice(0, 4)
        ];

        if (data.results?.length > 0) {
          allResults = [...allResults, ...data.results];
          // Пересчитываем ранги после каждого батча
          ranked = computeRankings(allResults);
        }

        if (data.done || aborted) {
          done = true;
          break;
        }
        batch++;
      } catch (e: any) {
        scanLog = [`Батч ${batch + 1}: ОШИБКА — ${e.message}`, ...scanLog.slice(0, 4)];
        errors++;
        batch++;
        if (errors > 10) break;
      }
    }

    scanning = false;
    done = true;
  }

  function stopScan() { aborted = true; }

  function setSort(col: string) {
    if (sortCol === col) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    else { sortCol = col; sortDir = 'desc'; }
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
      .sort((a, b) => (b.maxPct ?? 0) - (a.maxPct ?? 0))
      .slice(0, 3)
  );

  const topLong = $derived(
    ranked.filter(r => r.signal === 'LONG')
      .sort((a, b) => (a.minPct ?? 100) - (b.minPct ?? 100))
      .slice(0, 3)
  );

  function posSize(r: TickerResult) {
    const cap = parseFloat(capital) || 50000;
    const stopDist = Math.min(2.0 * r.atr14, r.close * 0.10);
    const shares = stopDist > 0 ? Math.min(
      Math.floor((cap * 0.008) / stopDist),
      Math.floor((cap * 0.10) / r.close)
    ) : 0;
    return {
      shares,
      stopPrice: r.signal === 'SHORT' ? r.close + stopDist : r.close - stopDist,
      risk: shares * stopDist
    };
  }

  function fmtPct(v: number) {
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  }

  function colHeader(col: string, label: string) {
    return `${label}${sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}`;
  }
</script>

<svelte:head>
  <title>MAX Weekly Reversal · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>MAX Weekly Reversal</h1>
      <p class="sub">Еженедельный скан · Запускать в пятницу после 23:00 EET</p>
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

  <!-- RULES -->
  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">SHORT</div>
      <div>MAX_pct ≥ 90 · Return_pct ≥ 80</div>
      <div>VolSpike ≥ 1.5× · ADV20 ≥ $10M</div>
      <div>Close ≥ $10 · Close &lt; 52wkH × 0.98</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">LONG (зеркально)</div>
      <div>MIN_pct ≤ 10 · Return_pct ≤ 20</div>
      <div>VolSpike ≥ 1.5× · ADV20 ≥ $10M</div>
      <div>Close ≥ $10 · Close &gt; 52wkL × 1.02</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">Вход / Стоп / Выход</div>
      <div>Entry: Open понедельника</div>
      <div>Stop: ±2×ATR14 (max 10%)</div>
      <div>T1 (60%): ∓1×ATR · T2 (40%): ∓2×ATR · Time: пятница D+5</div>
    </div>
  </div>

  <!-- PROGRESS -->
  {#if scanning || allResults.length > 0}
    <div class="scan-status">
      <div class="scan-top">
        {#if scanning}
          <span class="scan-info">Батч {currentBatch}/{totalBatches} · {progress}/{totalTickers} тикеров · Загружено: <b>{allResults.length}</b></span>
        {:else}
          <span class="scan-info">✓ Завершено · {allResults.length} тикеров загружено · SHORT: <b>{topShort.length}</b> · LONG: <b>{topLong.length}</b></span>
        {/if}
        {#if errors > 0}<span class="err-badge">{errors} ошибок</span>{/if}
      </div>
      {#if scanning}
        <div class="progress-track">
          <div class="progress-fill" style="width:{totalTickers > 0 ? (progress/totalTickers*100) : 0}%"></div>
        </div>
        <div class="scan-log">
          {#each scanLog as line}<div>{line}</div>{/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- TOP SIGNALS -->
  {#if topShort.length > 0 || topLong.length > 0}
    <div class="top-signals">
      <div class="top-group">
        <div class="top-h" style="color:var(--color-acc2)">⬇ TOP-3 SHORT</div>
        {#each topShort as r}
          {@const pos = posSize(r)}
          <div class="signal-card short">
            <div class="card-ticker">{r.ticker}</div>
            <div class="card-meta">Close <b>${r.close.toFixed(2)}</b> · MAX_5d <b>{fmtPct(r.max5d)}</b> · MAX_pct <b>{r.maxPct?.toFixed(0)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b></div>
            <div class="card-meta">ATR <b>{r.atr14.toFixed(2)}</b> · Stop <b>${pos.stopPrice.toFixed(2)}</b> · Shares <b>{pos.shares}</b> · Risk <b>${pos.risk.toFixed(0)}</b></div>
            <div class="card-meta">T1 <b>${(r.close - r.atr14).toFixed(2)}</b> · T2 <b>${(r.close - 2*r.atr14).toFixed(2)}</b></div>
            <div class="checklist">
              <span>□ Проверить шорт в Freedom24</span>
              <span>□ Earnings ±5 дней</span>
              <span>□ Отмена Open ≥ ${(r.close*1.04).toFixed(2)}</span>
            </div>
          </div>
        {/each}
      </div>
      <div class="top-group">
        <div class="top-h" style="color:var(--color-acc)">⬆ TOP-3 LONG</div>
        {#each topLong as r}
          {@const pos = posSize(r)}
          <div class="signal-card long">
            <div class="card-ticker">{r.ticker}</div>
            <div class="card-meta">Close <b>${r.close.toFixed(2)}</b> · MIN_5d <b>{fmtPct(r.min5d)}</b> · MIN_pct <b>{r.minPct?.toFixed(0)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b></div>
            <div class="card-meta">ATR <b>{r.atr14.toFixed(2)}</b> · Stop <b>${pos.stopPrice.toFixed(2)}</b> · Shares <b>{pos.shares}</b> · Risk <b>${pos.risk.toFixed(0)}</b></div>
            <div class="card-meta">T1 <b>${(r.close + r.atr14).toFixed(2)}</b> · T2 <b>${(r.close + 2*r.atr14).toFixed(2)}</b></div>
            <div class="checklist">
              <span>□ Earnings ±5 дней</span>
              <span>□ Отмена Open ≤ ${(r.close*0.96).toFixed(2)}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- TABLE — показываем как только есть хоть что-то -->
  {#if ranked.length > 0}
    <div class="table-controls">
      <div class="tbl-filters">
        <select bind:value={filterSignal}>
          <option value="ALL">Все ({ranked.length})</option>
          <option value="SHORT">SHORT ({ranked.filter(r=>r.signal==='SHORT').length})</option>
          <option value="LONG">LONG ({ranked.filter(r=>r.signal==='LONG').length})</option>
        </select>
        <label class="chk"><input type="checkbox" bind:checked={showTopOnly} /> Только сигналы</label>
      </div>
      <div class="tbl-meta">{sortedRanked.length} строк{scanning ? ' (обновляется...)' : ''}</div>
    </div>

    <div class="tw">
      <table>
        <thead>
          <tr>
            <th onclick={() => setSort('ticker')} class="s">{colHeader('ticker','Ticker')}</th>
            <th onclick={() => setSort('close')} class="s">{colHeader('close','Close')}</th>
            <th onclick={() => setSort('max5d')} class="s">{colHeader('max5d','MAX_5d')}</th>
            <th onclick={() => setSort('maxPct')} class="s">{colHeader('maxPct','MAX_pct')}</th>
            <th onclick={() => setSort('min5d')} class="s">{colHeader('min5d','MIN_5d')}</th>
            <th onclick={() => setSort('minPct')} class="s">{colHeader('minPct','MIN_pct')}</th>
            <th onclick={() => setSort('return5d')} class="s">{colHeader('return5d','Ret_5d')}</th>
            <th onclick={() => setSort('returnPct')} class="s">{colHeader('returnPct','Ret_pct')}</th>
            <th onclick={() => setSort('volSpike5d')} class="s">{colHeader('volSpike5d','VolSpike')}</th>
            <th onclick={() => setSort('adv20')} class="s">{colHeader('adv20','ADV20M')}</th>
            <th onclick={() => setSort('atr14')} class="s">{colHeader('atr14','ATR14')}</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedRanked as r (r.ticker)}
            <tr class:row-short={r.signal==='SHORT'} class:row-long={r.signal==='LONG'}>
              <td><b>{r.ticker}</b></td>
              <td>${r.close.toFixed(2)}</td>
              <td style="color:{r.max5d>=0.05?'var(--color-acc2)':'inherit'}">{fmtPct(r.max5d)}</td>
              <td style="color:{(r.maxPct??0)>=90?'var(--color-acc2)':'inherit'};font-weight:{(r.maxPct??0)>=90?700:400}">{r.maxPct?.toFixed(0) ?? '—'}</td>
              <td style="color:{r.min5d<=-0.05?'var(--color-acc)':'inherit'}">{fmtPct(r.min5d)}</td>
              <td style="color:{(r.minPct??100)<=10?'var(--color-acc)':'inherit'};font-weight:{(r.minPct??100)<=10?700:400}">{r.minPct?.toFixed(0) ?? '—'}</td>
              <td style="color:{r.return5d>=0?'var(--color-acc)':'var(--color-acc2)'}">{fmtPct(r.return5d)}</td>
              <td style="color:{(r.returnPct??50)>=80?'var(--color-acc2)':(r.returnPct??50)<=20?'var(--color-acc)':'inherit'}">{r.returnPct?.toFixed(0) ?? '—'}</td>
              <td style="color:{r.volSpike5d>=1.5?'var(--color-acc3)':'inherit'}">{r.volSpike5d.toFixed(2)}×</td>
              <td style="color:{r.adv20<10_000_000?'var(--color-acc2)':'inherit'}">${(r.adv20/1_000_000).toFixed(1)}M</td>
              <td>{r.atr14.toFixed(2)}</td>
              <td>
                {#if r.signal}
                  <span style="color:{r.signal==='SHORT'?'var(--color-acc2)':'var(--color-acc)'};font-weight:700">{r.signal}</span>
                {:else}
                  <span style="color:var(--color-t3)">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if scanning}
    <div class="state">Ждём данных... первые тикеры появятся через несколько секунд</div>
  {:else if !scanning && allResults.length === 0 && done}
    <div class="state err">Yahoo Finance не вернул данных. Проверь интернет-соединение или попробуй снова через минуту.</div>
  {/if}
</div>

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .head-controls { display: flex; align-items: flex-end; gap: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; }

  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin-bottom: 16px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }

  .scan-status { margin-bottom: 14px; padding: 10px 14px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .scan-top { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .scan-info { font-family: var(--font-mono); font-size: 11px; color: var(--color-t2); }
  .scan-info b { color: var(--color-text); }
  .err-badge { font-family: var(--font-mono); font-size: 9px; background: rgba(255,107,138,0.2); color: var(--color-acc2); padding: 2px 6px; border-radius: 4px; }
  .progress-track { height: 4px; background: var(--color-bg3); border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
  .progress-fill { height: 100%; background: var(--color-acc); transition: width 0.3s; border-radius: 2px; }
  .scan-log { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); line-height: 1.6; }

  .top-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
  @media (max-width: 800px) { .top-signals { grid-template-columns: 1fr; } }
  .top-h { font-family: var(--font-mono); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
  .signal-card { padding: 12px; border-radius: 8px; margin-bottom: 8px; font-family: var(--font-mono); font-size: 10px; line-height: 1.7; }
  .signal-card.short { background: rgba(255,107,138,0.08); border: 1px solid rgba(255,107,138,0.3); }
  .signal-card.long { background: rgba(126,232,162,0.08); border: 1px solid rgba(126,232,162,0.3); }
  .card-ticker { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .signal-card.short .card-ticker { color: var(--color-acc2); }
  .signal-card.long .card-ticker { color: var(--color-acc); }
  .card-meta { color: var(--color-t2); }
  .card-meta b { color: var(--color-text); }
  .checklist { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-line); color: var(--color-t3); font-size: 9px; display: flex; flex-direction: column; gap: 2px; }

  .table-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; flex-wrap: wrap; }
  .tbl-filters { display: flex; gap: 10px; align-items: center; }
  .chk { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); cursor: pointer; }
  .tbl-meta { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); }

  .tw { overflow-x: auto; }
  .s { cursor: pointer; user-select: none; }
  .s:hover { color: var(--color-text); }
  .row-short { background: rgba(255,107,138,0.04); }
  .row-long { background: rgba(126,232,162,0.04); }
  .state { padding: 40px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
</style>
