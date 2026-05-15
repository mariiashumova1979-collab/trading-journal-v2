<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import { calcPEGPosition } from '$lib/strategies/post_event_gap';
  import type { Candidate } from '$lib/types';
  import WorkflowGuide from '$lib/components/WorkflowGuide.svelte';
  import PostEventGapForm from '$lib/components/PostEventGapForm.svelte';
  import PostEventGapD1Form from '$lib/components/PostEventGapD1Form.svelte';
  import TradeForm from '$lib/components/TradeForm.svelte';

  let candidates = $state<Candidate[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showAdd = $state(false);
  let editCand = $state<Candidate | null>(null);
  let d1Cand = $state<Candidate | null>(null);
  let tradeCand = $state<Candidate | null>(null);
  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      candidates = await listCandidates('pead');
      error = null;
    } catch (e: any) { error = e.message || String(e); }
    finally { loading = false; }
  }

  onMount(() => { load(); unsubscribe = subscribeCandidates('pead', load); });
  onDestroy(() => { if (unsubscribe) unsubscribe(); });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try { await deleteCandidate(id); load(); }
    catch (e: any) { alert('Ошибка: ' + e.message); }
  }

  function statusLabel(s: string) {
    const m: Record<string, string> = {
      WAITING_D1: 'Ждём D1', READY_ENTRY: 'Готов вход D2',
      ENTERED: 'В сделке', CLOSED: 'Закрыта', REJECTED: 'Compression fail'
    };
    return m[s] || s;
  }

  function statusColor(s: string) {
    if (s === 'READY_ENTRY') return 'var(--color-acc)';
    if (s === 'ENTERED') return 'var(--color-acc4)';
    if (s === 'REJECTED') return 'var(--color-acc2)';
    if (s === 'CLOSED') return 'var(--color-t3)';
    return 'var(--color-acc3)';
  }

  function preview(c: Candidate) {
    const p = c.payload as any;
    if (!p?.d1 || !c.direction || !p?.atr14) return null;
    return calcPEGPosition({ atr14: p.atr14 }, { high: p.d1.H, low: p.d1.L, close: p.d1.C, volume: p.d1.V }, c.direction, 100);
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
</script>

<svelte:head>
  <title>Post-Event Gap · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>Post-Event Gap (B2)</h1>
      <p class="sub">D0 score ≥ 3 · D1 compression score ≥ 2 · T1 +1.5R · T2 +2.2R · Time stop D+5</p>
    </div>
    <button class="btn-p" onclick={() => (showAdd = true)}>+ Добавить D0</button>
  </div>

  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">D0 LONG core</div>
      <div>GapUp ≥ +4% · RVOL ≥ 3.0</div>
      <div>Range ≥ 1.5×ATR · CP ≥ 0.70</div>
      <div>Close &gt; Open · Close &gt; HighClose(10)</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">D0 SHORT core</div>
      <div>GapDown ≤ -4% · RVOL ≥ 3.0</div>
      <div>Range ≥ 1.5×ATR · CP ≤ 0.30</div>
      <div>Close &lt; Open · Close &lt; LowClose(10)</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc3)">D0 Score (≥3/6)</div>
      <div>Gap ≥±6% · RVOL ≥ 5</div>
      <div>Range ≥ 2×ATR · CP ≥0.85/≤0.15</div>
      <div>Close break 20D · Sector ETF</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">D1 Compression</div>
      <div>Vol ≤ 0.70× · Range ≤ 0.75×</div>
      <div>Retrace ≤ 35% · Score ≥2/6</div>
      <div>Inside / Vol≤0.50 / Range≤0.60</div>
    </div>
  </div>

  <div class="market-note">
    <b>Market filter:</b> LONG → SPY/QQQ &gt; EMA20 + VIX &lt; 25 · SHORT → SPY/QQQ &lt; EMA20 ·
    <b>Position:</b> 0.5% риск, max 2% open risk, max 4 позиций ·
    <b>D2 validation:</b> Close D2 на правильной стороне Entry, иначе exit MOC
  </div>

  <WorkflowGuide
    strategyId="pead"
    sections={[
      {
        title: 'Вечером D0 — Сканер',
        steps: [
          'Universe: US common stocks · Price $20-300 · MarketCap > $10B · AvgVol20 > 3M · ATR/Close 2-8% · Spread < 0.20%',
          'Исключить: Biotech · Chinese ADR · Meme · Low float < 50M · Dividend gaps · Earnings tomorrow',
          'Сканер: **Gap > 4% · RVOL > 3 · Range > 1.5×ATR · Close near high/low**',
          'Оставь **максимум 10 тикеров** для дальнейшего анализа'
        ]
      },
      {
        title: 'Вечером D0 — Добавление',
        steps: [
          'Проверь **Market filter**:',
          '  • LONG: SPY > EMA20 · QQQ > EMA20 · VIX < 25',
          '  • SHORT: SPY < EMA20 · QQQ < EMA20',
          'Нажми **+ Добавить D0**, введи: Close D-1 · OHLCV D0 · ATR14 · AvgVol20',
          'Также: HighClose 10D / LowClose 10D · HighClose 20D / LowClose 20D',
          'Market regime: чекбоксы SPY/QQQ/Sector vs EMA20 · значение VIX',
          'Система рассчитает **D0 Quality Score (0..6)** — нужен **≥ 3**'
        ]
      },
      {
        title: 'D0 Score components (+1 за каждое)',
        steps: [
          'Gap ≥ ±6% (вместо +4%)',
          'RVOL ≥ 5 (вместо 3)',
          'Range ≥ 2×ATR (вместо 1.5)',
          'ClosePosition ≥ 0.85 / ≤ 0.15 (вместо 0.70/0.30)',
          'Close break **20D** (вместо 10D)',
          'Sector ETF на правильной стороне EMA20'
        ]
      },
      {
        title: 'Вечером D+1 — Compression check',
        steps: [
          'Из 10 кандидатов нажми **+ D1** и введи H/L/C/V D1',
          'Core D1 (все должны пройти): Vol ≤ 0.70×D0 · Range ≤ 0.75×D0 · Retrace ≤ 35% · Low D1 > Low D0 (LONG) · Close D1 > Mid D0',
          'Система посчитает **Compression Score (0..6)** — нужен **≥ 2**',
          '🟢 Compression OK → статус READY_ENTRY · Entry/Stop сохранены',
          '🔴 Compression FAIL → REJECTED',
          'Оставь **максимум 3 сделки** на завтра'
        ]
      },
      {
        title: 'Compression Score (+1 за каждое)',
        steps: [
          'Inside day (D1 внутри D0)',
          'Volume D1 ≤ 0.50×D0',
          'Range D1 ≤ 0.60×D0',
          'Retracement ≤ 25%',
          'Close D1 в верхней 1/3 range (LONG) или нижней 1/3 (SHORT)',
          'Inside day + Retracement ≤ 20% (дополнительный бонус)'
        ]
      },
      {
        title: 'Утро D+2 — Вход',
        steps: [
          'Перед открытием проверь SPY/QQQ · premarket · news headline · earnings calendar',
          'Нажми **+ Сделка** на READY_ENTRY кандидате',
          '**Entry** = High D1 + 0.10×ATR (LONG) или Low D1 − 0.10×ATR (SHORT)',
          '**Stop** = Low D1 − 0.20×ATR (LONG) или High D1 + 0.20×ATR (SHORT)',
          'Поставь stop-ордер в Freedom24 на цене Entry',
          '**Risk** = 0.5% капитала на сделку · Max open risk 2% · Max 4 позиций'
        ]
      },
      {
        title: 'Вечер D+2 — Validation',
        steps: [
          '🔴 LONG: Close D2 ≤ Entry → **закрыть всю позицию MOC**',
          '🔴 SHORT: Close D2 ≥ Entry → **закрыть всю позицию MOC**',
          '🟢 Иначе — позиция остаётся'
        ]
      },
      {
        title: 'Управление D+3..D+5',
        steps: [
          'При **+1.5R** → закрой 50%, перенеси стоп остатка в **breakeven**',
          'Финальный выход (первое событие):',
          '  • **+2.2R** → закрыть остаток',
          '  • **Close D+5** → закрыть всё',
          '  • Structural: Close < Low предыдущего дня (LONG)'
        ]
      }
    ]}
  />

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">{error}</div>
  {:else if candidates.length === 0}
    <div class="state">Нет кандидатов. Нажми «+ Добавить D0».</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>D0 Date</th>
            <th>Dir</th>
            <th>Gap%</th>
            <th>RVOL</th>
            <th>R/ATR</th>
            <th>CP</th>
            <th>D0 Score</th>
            <th>Comp Score</th>
            <th>Entry D2</th>
            <th>Stop</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const p = c.payload as any}
            {@const m = p?.metrics}
            {@const dirColor = c.direction === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}
            {@const pos = preview(c)}
            <tr>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td><span style="color:{dirColor};font-weight:700">{c.direction ?? '—'}</span></td>
              <td style="color:{m?.gap_pct >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)'}">
                {m?.gap_pct !== undefined ? fmtPct(m.gap_pct) : '—'}
              </td>
              <td>{m?.vol_ratio !== undefined ? m.vol_ratio.toFixed(1) + '×' : '—'}</td>
              <td>{m?.range_atr_ratio !== undefined ? m.range_atr_ratio.toFixed(2) : '—'}</td>
              <td>{m?.close_position !== undefined ? m.close_position.toFixed(2) : '—'}</td>
              <td style="color:{(m?.d0_score ?? 0) >= 3 ? 'var(--color-acc)' : 'var(--color-acc2)'};font-weight:700">
                {m?.d0_score ?? '—'}/6
              </td>
              <td style="color:{(p?.compression_score ?? 0) >= 2 ? 'var(--color-acc)' : 'var(--color-t3)'};font-weight:700">
                {p?.compression_score !== undefined ? p.compression_score + '/6' : '—'}
              </td>
              <td style="color:var(--color-acc)">
                {pos ? '$' + pos.entry.toFixed(2) : (c.entry ? '$' + c.entry.toFixed(2) : '—')}
              </td>
              <td style="color:var(--color-acc2)">
                {pos ? '$' + pos.stop.toFixed(2) : (c.stop != null ? '$' + Number(c.stop).toFixed(2) : '—')}
              </td>
              <td><span style="color:{statusColor(c.status)}">{statusLabel(c.status)}</span></td>
              <td class="acts">
                {#if c.status !== 'ENTERED' && c.status !== 'CLOSED'}
                  <button onclick={() => (editCand = c)} style="font-size:9px;padding:4px 8px">✎</button>
                {/if}
                {#if c.status === 'WAITING_D1'}
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">+ D1</button>
                {/if}
                {#if c.status === 'READY_ENTRY' || c.status === 'WAITING_D1'}
                  <button class="btn-p" onclick={() => (tradeCand = c)} style="font-size:9px;padding:4px 8px">+ Сделка</button>
                {/if}
                <button class="btn-r" onclick={() => handleDelete(c.id)} style="font-size:9px;padding:4px 8px">×</button>
              </td>
            </tr>
            {#if pos && c.status === 'READY_ENTRY'}
              <tr class="proj-row">
                <td colspan="13">
                  <span class="proj-lbl">Прогноз (риск $100):</span>
                  Entry ${pos.entry.toFixed(2)} · Stop ${pos.stop.toFixed(2)} · Risk/share ${pos.riskPerShare.toFixed(2)} · Shares <b>{pos.shares}</b> · T1 (+1.5R) ${pos.target1.toFixed(2)} · T2 (+2.2R) ${pos.target2.toFixed(2)}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showAdd}<PostEventGapForm onClose={() => (showAdd = false)} onAdded={load} />{/if}
{#if editCand}<PostEventGapForm editCandidate={editCand} onClose={() => (editCand = null)} onAdded={load} />{/if}
{#if d1Cand}<PostEventGapD1Form candidate={d1Cand} onClose={() => (d1Cand = null)} onUpdated={load} />{/if}
{#if tradeCand}<TradeForm candidate={tradeCand} onClose={() => (tradeCand = null)} onSaved={load} />{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .market-note { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 8px 12px; border: 1px solid rgba(167,139,250,0.2); background: rgba(167,139,250,0.05); border-radius: 6px; margin-bottom: 16px; line-height: 1.8; }
  .market-note b { color: #a78bfa; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; }
  .proj-row td { background: rgba(155,89,182,0.04); font-size: 10px; color: var(--color-t2); padding: 5px 10px; border-bottom: 1px solid var(--color-line); }
  .proj-lbl { color: #9b59b6; font-weight: 600; margin-right: 8px; }
</style>
