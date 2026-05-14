<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import { calcIBSEntry } from '$lib/strategies/ibs_mean_reversion';
  import type { Candidate } from '$lib/types';
  import IBSForm from '$lib/components/IBSForm.svelte';
  import IBSD1Form from '$lib/components/IBSD1Form.svelte';
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
      candidates = await listCandidates('ibs_swing');
      error = null;
    } catch (e: any) { error = e.message || String(e); }
    finally { loading = false; }
  }

  onMount(() => { load(); unsubscribe = subscribeCandidates('ibs_swing', load); });
  onDestroy(() => { if (unsubscribe) unsubscribe(); });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try { await deleteCandidate(id); load(); }
    catch (e: any) { alert('Ошибка: ' + e.message); }
  }

  function statusLabel(s: string) {
    const m: Record<string, string> = {
      WAITING_D1: 'Ждём D+1', READY_ENTRY: 'Готов вход',
      GAP_CANCEL: 'Gap Cancel', ENTERED: 'В сделке',
      CLOSED: 'Закрыта', REJECTED: 'Отклонён'
    };
    return m[s] || s;
  }

  function statusColor(s: string) {
    if (s === 'READY_ENTRY') return 'var(--color-acc)';
    if (s === 'ENTERED')     return 'var(--color-acc4)';
    if (s === 'GAP_CANCEL')  return 'var(--color-acc2)';
    if (s === 'CLOSED')      return 'var(--color-t3)';
    if (s === 'REJECTED')    return 'var(--color-acc2)';
    return 'var(--color-acc3)';
  }

  function getPos(c: Candidate) {
    const p = c.payload as any;
    if (!c.direction || !p?.atr14 || !p?.d0?.C || !c.entry) return null;
    return calcIBSEntry(p.d0.C, Number(c.entry), c.direction, p.atr14, 50000);
  }

  // Метрики в таблице
  function meta(c: Candidate) {
    const p = c.payload as any;
    return {
      ibs: p?.metrics?.ibs,
      rsi2: p?.rsi2,
      atr14: p?.atr14,
      sma200: p?.sma200,
      regime: p?.spy_regime ?? '—',
      rangeAtr: p?.metrics?.range_atr_ratio,
      d1adverse: p?.d1_should_close
    };
  }
</script>

<svelte:head>
  <title>IBS Mean Reversion · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>IBS Mean Reversion</h1>
      <p class="sub">S&P 500 + Nasdaq-100 · SPY режим · T0 вечер → D+1 вход → D+5 time stop</p>
    </div>
    <button class="btn-p" onclick={() => (showAdd = true)}>+ Добавить T0</button>
  </div>

  <!-- Правила -->
  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">LONG T0</div>
      <div>SPY &gt; SMA200 · Close &gt; SMA200</div>
      <div>SMA200 растёт (vs 20D назад)</div>
      <div>IBS &lt; 0.20 · RSI(2) &lt; 10</div>
      <div>Range &lt; 2×ATR14</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">SHORT T0</div>
      <div>SPY &lt; SMA200 · Close &lt; SMA200</div>
      <div>SMA200 падает (vs 20D назад)</div>
      <div>IBS &gt; 0.80 · RSI(2) &gt; 90</div>
      <div>Range &lt; 2×ATR14</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc3)">Вход D+1</div>
      <div>Отмена: Open ≥ Close×1.02 (L)</div>
      <div>Entry = Open D+1 (Market)</div>
      <div>Stop = min(1.5×ATR, 6%) от Entry</div>
      <div>Risk = 1% капитала</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">Цели / Выход</div>
      <div>T1 (+1×ATR, 50%) → стоп в BE</div>
      <div>Trailing: Close ± 1×ATR</div>
      <div>T2 (+2×ATR) · Time stop D+5</div>
      <div>D+1 check: если move &lt; 0.5×ATR → закрыть</div>
    </div>
  </div>

  <div class="regime-note">
    <b>Режим рынка:</b> |SPY − SMA200| ≤ 0.1% → новые сделки запрещены ·
    <b>Universe:</b> S&P 500 + Nasdaq-100 · Close ≥ $10 · ADV20 ≥ $20M · History ≥ 250 дней
  </div>

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
            <th>IBS</th>
            <th>RSI(2)</th>
            <th>R/ATR</th>
            <th>ATR14</th>
            <th>Entry</th>
            <th>Stop</th>
            <th>T1</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const m = meta(c)}
            {@const dirColor = c.direction === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}
            {@const pos = getPos(c)}
            <tr class:row-adverse={m.d1adverse}>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td><span style="color:{dirColor};font-weight:700">{c.direction ?? '—'}</span></td>
              <td style="color:{m.regime === 'NEUTRAL' ? 'var(--color-acc2)' : 'var(--color-t2)'}">
                {m.regime}
              </td>
              <td style="color:{m.ibs !== undefined ? (c.direction === 'LONG' ? m.ibs < 0.20 ? 'var(--color-acc)' : 'var(--color-acc2)' : m.ibs > 0.80 ? 'var(--color-acc)' : 'var(--color-acc2)') : 'inherit'}">
                {m.ibs !== undefined ? m.ibs.toFixed(3) : '—'}
              </td>
              <td style="color:{m.rsi2 !== undefined ? (c.direction === 'LONG' ? m.rsi2 < 10 ? 'var(--color-acc)' : 'var(--color-acc2)' : m.rsi2 > 90 ? 'var(--color-acc)' : 'var(--color-acc2)') : 'inherit'}">
                {m.rsi2 !== undefined ? Number(m.rsi2).toFixed(1) : '—'}
              </td>
              <td style="color:{m.rangeAtr !== undefined && m.rangeAtr < 2 ? 'var(--color-acc)' : 'var(--color-acc2)'}">
                {m.rangeAtr !== undefined ? Number(m.rangeAtr).toFixed(2) : '—'}
              </td>
              <td>{m.atr14 !== undefined ? Number(m.atr14).toFixed(2) : '—'}</td>
              <td style="color:var(--color-acc)">
                {c.entry != null ? '$' + Number(c.entry).toFixed(2) : '—'}
              </td>
              <td style="color:var(--color-acc2)">
                {c.stop != null ? '$' + Number(c.stop).toFixed(2) : '—'}
              </td>
              <td>
                {c.target1 != null ? '$' + Number(c.target1).toFixed(2) : '—'}
              </td>
              <td>
                <span style="color:{statusColor(c.status)}">{statusLabel(c.status)}</span>
                {#if m.d1adverse}
                  <span style="color:var(--color-acc2);font-size:9px;display:block">⚠ D+1 adverse</span>
                {/if}
              </td>
              <td class="acts">
                {#if c.status !== 'ENTERED' && c.status !== 'CLOSED' && c.status !== 'GAP_CANCEL'}
                  <button onclick={() => (editCand = c)} style="font-size:9px;padding:4px 8px">✎</button>
                {/if}
                {#if c.status === 'WAITING_D1'}
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">D+1</button>
                {/if}
                {#if c.status === 'READY_ENTRY'}
                  <button class="btn-p" onclick={() => (tradeCand = c)} style="font-size:9px;padding:4px 8px">+ Сделка</button>
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">D+1 ✓</button>
                {/if}
                {#if c.status === 'ENTERED'}
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">D+1 check</button>
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

{#if showAdd}
  <IBSForm onClose={() => (showAdd = false)} onAdded={load} />
{/if}
{#if editCand}
  <IBSForm editCandidate={editCand} onClose={() => (editCand = null)} onAdded={load} />
{/if}
{#if d1Cand}
  <IBSD1Form candidate={d1Cand} onClose={() => (d1Cand = null)} onUpdated={load} />
{/if}
{#if tradeCand}
  <TradeForm candidate={tradeCand} onClose={() => (tradeCand = null)} onSaved={load} />
{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .regime-note { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 8px 12px; border: 1px solid rgba(52,152,219,0.2); background: rgba(52,152,219,0.05); border-radius: 6px; margin-bottom: 16px; }
  .regime-note b { color: #3498db; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; min-width: 160px; }
  .row-adverse { background: rgba(255,107,138,0.06); }
</style>
