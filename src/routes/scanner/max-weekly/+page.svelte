<script lang="ts">
  interface TickerResult {
    ticker: string; close: number;
    max5d: number; min5d: number; return5d: number;
    volSpike5d: number; adv20: number; atr14: number;
    fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number;
    maxPct?: number; minPct?: number; returnPct?: number;
    signal?: 'SHORT' | 'LONG' | null;
  }

  const BATCH_SIZE = 20;

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

  let sortCol = $state('maxPct');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let filterSignal = $state<'ALL' | 'SHORT' | 'LONG'>('ALL');
  let showTopOnly = $state(false);

  function pctRank(arr: number[], v: number): number {
    return arr.length === 0 ? 50 : arr.filter(x => x < v).length / arr.length * 100;
  }

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

  async function runScan() {
    scanning = true; aborted = false; done = false;
    allResults = []; ranked = []; progress = 0; errors = 0; scanLog = [];

    let batch = 0;
    while (!aborted) {
      try {
        const url = `/api/max-weekly?batch=${batch}&batchSize=${BATCH_SIZE}`;
        scanLog = [`Батч ${batch + 1}: запрос к Stooq...`, ...scanLog.slice(0, 6)];

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        total = data.total_tickers;
        totalBatches = data.total_batches;
        currentBatch = batch + 1;
        progress = data.scanned;
        errors += data.errors ?? 0;

        scanLog = [
          `Батч ${batch + 1}/${data.total_batches}: +${data.results?.length ?? 0} тикеров, ${data.errors ?? 0} ошибок`,
          ...scanLog.slice(0, 6)
        ];

        if (data.results?.length > 0) {
          allResults = [...allResults, ...data.results];
          ranked = computeRankings(allResults);
        }

        if (data.done || aborted) { done = true; break; }
        batch++;

        // 200ms пауза чтобы не нагружать Stooq
        await new Promise(r => setTimeout(r, 200));
      } catch (e: any) {
        scanLog = [`Батч ${batch + 1}: ОШИБКА — ${e.message}`, ...scanLog.slice(0, 6)];
        errors += BATCH_SIZE;
        batch++;
        if (batch > (totalBatches || 60)) { done = true; break; }
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
      <p class="sub">Russell 1000 · Stooq data · Запускать пятница после 23:00 EET</p>
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
        {#if errors > 0}<span class="err-b">{errors} ошибок (тикер недоступен на Stooq)</span>{/if}
      </div>
      {#if scanning}
        <div class="ptrack"><div class="pfill" style="width:{total > 0 ? (progress/total*100) : 0}%"></div></div>
      {/if}
      <div class="slog">{#each scanLog as l}<div>{l}</div>{/each}</div>
    </div>
  {/if}

  {#if topShort.length > 0 || topLong.length > 0}
    <div class="top-signals">
      <div>
        <div class="top-h" style="color:var(--color-acc2)">⬇ TOP-3 SHORT</div>
        {#each topShort as r}
          {@const p = posSize(r)}
          <div class="scard short">
            <div class="sticker">{r.ticker}</div>
            <div class="smeta">Close <b>${r.close.toFixed(2)}</b> · MAX_5d <b>{fmtPct(r.max5d)}</b> · MAX_pct <b>{r.maxPct?.toFixed(0)}</b> · Vol×<b>{r.volSpike5d.toFixed(1)}</b></div>
            <div class="smeta">Stop <b>${p.stop.toFixed(2)}</b> · Shares <b>{p.shares}</b> · Risk <b>${p.risk.toFixed(0)}</b></div>
            <div class="smeta">T1 <b>${(r.close - r.atr14).toFixed(2)}</b> · T2 <b>${(r.close - 2*r.atr14).toFixed(2)}</b></div>
            <div class="scl">□ Проверить шорт в Freedom24 · □ Earnings ±5 дней · □ Отмена Open ≥ ${(r.close*1.04).toFixed(2)}</div>
          </div>
        {/each}
        {#if topShort.length === 0 && done}<div class="no-sig">Нет сигналов SHORT</div>{/if}
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
          </div>
        {/each}
        {#if topLong.length === 0 && done}<div class="no-sig">Нет сигналов LONG</div>{/if}
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
              <td>{#if r.signal}<span style="color:{r.signal==='SHORT'?'var(--color-acc2)':'var(--color-acc)'};font-weight:700">{r.signal}</span>{:else}<span style="color:var(--color-t3)">—</span>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if done && allResults.length === 0}
    <div class="state err">Нет данных. Возможно Stooq временно недоступен. Попробуй через минуту.</div>
  {:else if !scanning && !done}
    <div class="state">Нажми «Запустить скан» · Источник данных: Stooq · ~3-5 минут на 1002 тикера</div>
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
  .no-sig { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 20px; text-align: center; border: 1px dashed var(--color-line); border-radius: 8px; }
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
</style>
