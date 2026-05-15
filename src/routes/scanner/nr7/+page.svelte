<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import type { Candidate } from '$lib/types';
  import WorkflowGuide from '$lib/components/WorkflowGuide.svelte';
  import NR7Form from '$lib/components/NR7Form.svelte';
  import NR7D1Form from '$lib/components/NR7D1Form.svelte';
  import TradeForm from '$lib/components/TradeForm.svelte';

  let candidates = $state<Candidate[]>([]);
  let loading    = $state(true);
  let error      = $state<string | null>(null);
  let showAdd    = $state(false);
  let editCand   = $state<Candidate | null>(null);
  let d1Cand     = $state<Candidate | null>(null);
  let tradeCand  = $state<Candidate | null>(null);
  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      candidates = await listCandidates('nr7');
      error = null;
    } catch (e: any) { error = e.message || String(e); }
    finally { loading = false; }
  }

  onMount(() => { load(); unsubscribe = subscribeCandidates('nr7', load); });
  onDestroy(() => { if (unsubscribe) unsubscribe(); });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try { await deleteCandidate(id); load(); }
    catch (e: any) { alert('Ошибка: ' + e.message); }
  }

  function statusLabel(s: string) {
    const m: Record<string, string> = {
      WAITING_D1: 'Ждём D+1', READY_ENTRY: 'Ордер сработал',
      GAP_CANCEL: 'Gap Cancel', ENTERED: 'В сделке',
      CLOSED: 'Закрыта', REJECTED: 'Не сработал/отменён'
    };
    return m[s] || s;
  }

  function statusColor(s: string) {
    if (s === 'READY_ENTRY') return 'var(--color-acc)';
    if (s === 'ENTERED')     return 'var(--color-acc4)';
    if (s === 'GAP_CANCEL')  return 'var(--color-acc2)';
    if (s === 'CLOSED')      return 'var(--color-t3)';
    if (s === 'REJECTED')    return 'var(--color-t3)';
    return 'var(--color-acc3)';
  }

  function meta(c: Candidate) {
    const p = c.payload as any;
    return {
      vix: p?.vix,
      regime: p?.spy_regime ?? '—',
      atr14: p?.atr14,
      rangeAtr: p?.metrics?.range_atr_ratio,
      isNr7: p?.metrics?.is_nr7,
      mid7: p?.metrics?.mid7,
      d2adverse: p?.d2_should_close
    };
  }
</script>

<svelte:head>
  <title>NR7 Breakout · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>NR7 Volatility Expansion Breakout</h1>
      <p class="sub">S&P 500 + NDX · NR7 + тренд · Stop-ордер на D+1 · Time stop D+5</p>
    </div>
    <button class="btn-p" onclick={() => (showAdd = true)}>+ Добавить T0</button>
  </div>

  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">LONG T0</div>
      <div>VIX &lt; 35 · SPY &gt; EMA50</div>
      <div>Close &gt; EMA21 · EMA21 &gt; EMA50</div>
      <div>NR7 · Close ≥ Mid7</div>
      <div>Range/ATR &lt; 0.75</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">SHORT T0</div>
      <div>VIX &lt; 35 · SPY &lt; EMA50</div>
      <div>Close &lt; EMA21 · EMA21 &lt; EMA50</div>
      <div>NR7 · Close ≤ Mid7</div>
      <div>Range/ATR &lt; 0.75</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc3)">Entry D+1</div>
      <div>BuyStop = High_T0 + 0.10×ATR</div>
      <div>SellStop = Low_T0 − 0.10×ATR</div>
      <div>Stop = ±(L/H_T0 − 0.10×ATR)</div>
      <div>StopDistance ≤ 2×ATR (иначе skip)</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">Exit</div>
      <div>T1 (+1.5×ATR, 50%) → стоп в BE</div>
      <div>Trail: MaxHigh − 2×ATR</div>
      <div>T2 (+3.0×ATR)</div>
      <div>D+2: Close ≤ Entry → exit</div>
      <div>Time stop D+5</div>
    </div>
  </div>

  <div class="regime-note">
    <b>Universe:</b> S&P 500 + NDX · Close ≥ $10 · ADV20 ≥ $20M · ATR14/Close ≥ 1.5% ·
    <b>Risk:</b> 1% капитала ·
    <b>D+1 при gap:</b> Open за пределами триггера → ждать отката · gap &gt; 1×ATR → skip
  </div>

  <WorkflowGuide
    strategyId="nr7"
    sections={[
      {
        title: 'Вечером (T0) — 20-30 мин',
        steps: [
          'Открой TradingView с **SPY** → определи режим (Close vs EMA50)',
          'Открой **VIX** → если ≥ 35, **пропусти всю сессию**',
          'На каждом тикере S&P 500 / NDX проверь:',
          '  • **NR7**: текущий день — наименьший range из последних 7',
          '  • **Тренд**: Close > EMA21 > EMA50 (LONG) или Close < EMA21 < EMA50 (SHORT)',
          '  • **Close vs Mid7**: ≥ Mid7 (LONG) или ≤ Mid7 (SHORT)',
          '  • **Range/ATR < 0.75** (сжатие)',
          'Нажми **+ Добавить T0**, введи: SPY/VIX · OHLC T0 (только H/L/C) · EMA21, EMA50, ATR14 · High7, Low7, min Range[-6..-1]',
          'Система рассчитает BuyStop/SellStop, Stop, T1, T2, Shares и **исключит сетап если StopDistance > 2×ATR**'
        ]
      },
      {
        title: 'Утром D+1 — 5-10 мин',
        steps: [
          'Нажми **D+1** → вкладка `1. Утро · Gap check` → введи Open D+1',
          '🟢 **STOP_ORDER**: Open ≤ BuyStop — выставь Buy Stop ордер в Freedom24 на цене триггера',
          '🟡 **WAIT_PULLBACK**: Open > BuyStop — не входи на open, жди отката к High_T0',
          '🔴 **GAP_FAR**: Open >> BuyStop (gap > 1×ATR) — **пропустить сетап**',
          'После выставления ордера нажми "Сохранить" чтобы запомнить заметку'
        ]
      },
      {
        title: 'В течение дня D+1',
        steps: [
          'Если до **15:45 EST** stop-ордер не сработал → **D+1 → "Итог D+1" → "Не сработал (15:45 EST)"**',
          'Кандидат пометится как **REJECTED**'
        ]
      },
      {
        title: 'Вечером D+1 (если ордер сработал)',
        steps: [
          'Открой **D+1 → "2. Итог D+1"** → введи фактическую цену исполнения',
          '"Сохранить и → + Сделка"',
          'Затем **+ Сделка** в таблице — TradeForm всё заполнится автоматически'
        ]
      },
      {
        title: 'Вечером D+2 (Adverse check)',
        steps: [
          'Нажми **D+2 ✓** → вкладка `3. D+2 Adverse check` → введи Close D+2',
          '🔴 Close ≤ Entry (LONG) или Close ≥ Entry (SHORT) → **⚠ ЗАКРЫТЬ ПО CLOSE D+2**',
          '🟢 Close на правильной стороне Entry → позиция остаётся',
          'Результат пишется в notes сделки · таблица подсветит красным строки где D+2 adverse сработал'
        ]
      },
      {
        title: 'D+5 — Time stop',
        steps: [
          'Закрыть позицию по рынку независимо от состояния'
        ]
      }
    ]}
  />

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">{error}</div>
  {:else if candidates.length === 0}
    <div class="state">Нет кандидатов. После закрытия рынка нажми «+ Добавить T0».</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>T0 Date</th>
            <th>Dir</th>
            <th>SPY</th>
            <th>VIX</th>
            <th>NR7</th>
            <th>R/ATR</th>
            <th>ATR14</th>
            <th>Entry trigger</th>
            <th>Stop</th>
            <th>T1</th>
            <th>T2</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const m = meta(c)}
            {@const dirColor = c.direction === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}
            <tr class:row-adverse={m.d2adverse}>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td><span style="color:{dirColor};font-weight:700">{c.direction ?? '—'}</span></td>
              <td style="color:{m.regime === 'NEUTRAL' ? 'var(--color-acc2)' : 'var(--color-t2)'}">{m.regime}</td>
              <td style="color:{m.vix !== undefined && m.vix < 35 ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.vix !== undefined ? Number(m.vix).toFixed(1) : '—'}</td>
              <td style="color:{m.isNr7 ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.isNr7 ? '✓' : '✗'}</td>
              <td style="color:{m.rangeAtr !== undefined && m.rangeAtr < 0.75 ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.rangeAtr !== undefined ? Number(m.rangeAtr).toFixed(2) : '—'}</td>
              <td>{m.atr14 !== undefined ? Number(m.atr14).toFixed(2) : '—'}</td>
              <td style="color:var(--color-acc)">{c.entry != null ? '$' + Number(c.entry).toFixed(2) : '—'}</td>
              <td style="color:var(--color-acc2)">{c.stop != null ? '$' + Number(c.stop).toFixed(2) : '—'}</td>
              <td>{c.target1 != null ? '$' + Number(c.target1).toFixed(2) : '—'}</td>
              <td>{c.target2 != null ? '$' + Number(c.target2).toFixed(2) : '—'}</td>
              <td>
                <span style="color:{statusColor(c.status)}">{statusLabel(c.status)}</span>
                {#if m.d2adverse}<span style="color:var(--color-acc2);font-size:9px;display:block">⚠ D+2 adverse</span>{/if}
              </td>
              <td class="acts">
                {#if c.status !== 'ENTERED' && c.status !== 'CLOSED' && c.status !== 'REJECTED' && c.status !== 'GAP_CANCEL'}
                  <button onclick={() => (editCand = c)} style="font-size:9px;padding:4px 8px">✎</button>
                {/if}
                {#if c.status === 'WAITING_D1'}
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">D+1</button>
                {/if}
                {#if c.status === 'READY_ENTRY'}
                  <button class="btn-p" onclick={() => (tradeCand = c)} style="font-size:9px;padding:4px 8px">+ Сделка</button>
                {/if}
                {#if c.status === 'ENTERED' || c.status === 'READY_ENTRY'}
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">D+2 ✓</button>
                {/if}
                <button class="btn-r" onclick={() => handleDelete(c.id)} style="font-size:9px;padding:4px 6px">×</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showAdd}<NR7Form onClose={() => (showAdd = false)} onAdded={load} />{/if}
{#if editCand}<NR7Form editCandidate={editCand} onClose={() => (editCand = null)} onAdded={load} />{/if}
{#if d1Cand}<NR7D1Form candidate={d1Cand} onClose={() => (d1Cand = null)} onUpdated={load} />{/if}
{#if tradeCand}<TradeForm candidate={tradeCand} onClose={() => (tradeCand = null)} onSaved={load} />{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .regime-note { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 8px 12px; border: 1px solid rgba(241,196,15,0.2); background: rgba(241,196,15,0.05); border-radius: 6px; margin-bottom: 16px; }
  .regime-note b { color: #f1c40f; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; min-width: 180px; }
  .row-adverse { background: rgba(255,107,138,0.06); }
</style>
