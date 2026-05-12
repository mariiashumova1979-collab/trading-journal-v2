<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import { calcEventPosition } from '$lib/strategies/event_continuation';
  import type { Candidate } from '$lib/types';
  import EventForm from '$lib/components/EventForm.svelte';
  import EventD1Form from '$lib/components/EventD1Form.svelte';
  import TradeForm from '$lib/components/TradeForm.svelte';

  let candidates = $state<Candidate[]>([]);
  let loading    = $state(true);
  let error      = $state<string | null>(null);

  let showAdd   = $state(false);
  let editCand  = $state<Candidate | null>(null);
  let d1Cand    = $state<Candidate | null>(null);
  let tradeCand = $state<Candidate | null>(null);

  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      candidates = await listCandidates('event_continuation');
      error = null;
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => { load(); unsubscribe = subscribeCandidates('event_continuation', load); });
  onDestroy(() => { if (unsubscribe) unsubscribe(); });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try { await deleteCandidate(id); load(); }
    catch (e: any) { alert('Ошибка: ' + e.message); }
  }

  function statusLabel(s: string) {
    const m: Record<string, string> = {
      WAITING_D1:   'Ждём D1',
      READY_ENTRY:  'Готов вход D2',
      WAITING_OPEN: 'Ждём открытия',
      ENTERED:      'В сделке',
      CLOSED:       'Закрыта',
      REJECTED:     'Compression fail'
    };
    return m[s] || s;
  }

  function statusColor(s: string) {
    if (s === 'READY_ENTRY') return 'var(--color-acc)';
    if (s === 'ENTERED')     return 'var(--color-acc4)';
    if (s === 'CLOSED')      return 'var(--color-t3)';
    if (s === 'REJECTED')    return 'var(--color-acc2)';
    return 'var(--color-acc3)';
  }

  function getPreview(c: Candidate) {
    const p = c.payload as any;
    if (!p?.d1 || !c.direction || !p?.atr14) return null;
    return calcEventPosition({ atr14: p.atr14 }, { high: p.d1.H, low: p.d1.L, close: p.d1.C, volume: p.d1.V }, c.direction, 100);
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
</script>

<svelte:head>
  <title>Event Continuation · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>Event Continuation</h1>
      <p class="sub">Event impulse D0 → Compression D1 → Entry D2 · Макс. 5 позиций</p>
    </div>
    <button class="btn-p" onclick={() => (showAdd = true)}>+ Добавить D0</button>
  </div>

  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">D0 LONG</div>
      <div>Gap ≥ +4% · Range ≥ 1.5×ATR</div>
      <div>Volume ≥ 2.5× · ClosePos ≥ 0.75</div>
      <div>Close > High(10D)</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">D0 SHORT</div>
      <div>Gap ≤ −4% · Range ≥ 1.5×ATR</div>
      <div>Volume ≥ 2.5× · ClosePos ≤ 0.25</div>
      <div>Close &lt; Low(10D)</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc3)">D1 Compression</div>
      <div>Vol D1 ≤ 0.7×Vol D0</div>
      <div>Low D1 > Mid D0 (LONG)</div>
      <div>Close D1 > Mid D0 (LONG)</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">D2 Entry · Stop · Exit</div>
      <div>Entry: High D1 ±0.1×ATR</div>
      <div>Stop: Low D1 ∓0.2×ATR · Risk/ATR ≤ 1.2</div>
      <div>T1 (+1R, 50%) · T2 (+3R) · Time: D+5</div>
    </div>
  </div>

  <div class="invalidation">
    <b>Invalidation (отмена входа D2):</b>
    Risk/ATR &gt; 1.2 · Overnight gap &gt; 2×ATR ·
    SPY падает &gt; −1% · D2 close ниже entry (LONG) → закрыть на аукционе
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if candidates.length === 0}
    <div class="state">Нет кандидатов. После D0 event-дня нажми «+ Добавить D0».</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>D0 Date</th>
            <th>Dir</th>
            <th>Gap%</th>
            <th>R/ATR</th>
            <th>VolR</th>
            <th>ClosePos</th>
            <th>ATR14</th>
            <th>Entry D2</th>
            <th>Stop</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const p = c.payload as any}
            {@const m = p?.metrics}
            {@const dirColor = c.direction === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}
            {@const pos = getPreview(c)}
            <tr>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td><span style="color:{dirColor};font-weight:700">{c.direction ?? '—'}</span></td>
              <td style="color:{m?.gap_pct >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)'}">
                {m?.gap_pct !== undefined ? fmtPct(m.gap_pct) : '—'}
              </td>
              <td>{m?.range_atr_ratio !== undefined ? m.range_atr_ratio.toFixed(2) : '—'}</td>
              <td>{m?.vol_ratio !== undefined ? m.vol_ratio.toFixed(1) + '×' : '—'}</td>
              <td>{m?.close_position !== undefined ? m.close_position.toFixed(2) : '—'}</td>
              <td>{p?.atr14 !== undefined ? p.atr14.toFixed(2) : '—'}</td>
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
            {#if pos && (c.status === 'READY_ENTRY' || c.status === 'WAITING_D1') && !pos.invalidated}
              <tr class="proj-row">
                <td colspan="12">
                  <span class="proj-lbl">Прогноз (риск $100):</span>
                  Entry ${pos.entry.toFixed(2)} · Stop ${pos.stop.toFixed(2)} · Risk/share ${pos.riskPerShare.toFixed(2)} · Risk/ATR {pos.riskAtrRatio.toFixed(2)}{pos.riskAtrRatio > 1.2 ? ' ⚠ >1.2' : ''} · Shares <b>{pos.shares}</b> · T1 ${pos.target1.toFixed(2)} · T2 ${pos.target2.toFixed(2)}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showAdd}
  <EventForm onClose={() => (showAdd = false)} onAdded={load} />
{/if}
{#if editCand}
  <EventForm editCandidate={editCand} onClose={() => (editCand = null)} onAdded={load} />
{/if}
{#if d1Cand}
  <EventD1Form candidate={d1Cand} onClose={() => (d1Cand = null)} onUpdated={load} />
{/if}
{#if tradeCand}
  <TradeForm candidate={tradeCand} onClose={() => (tradeCand = null)} onSaved={load} />
{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .invalidation { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 8px 12px; border: 1px solid rgba(255,200,90,0.2); background: rgba(255,200,90,0.05); border-radius: 6px; margin-bottom: 16px; }
  .invalidation b { color: var(--color-acc3); }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; }
  .proj-row td { background: rgba(126,232,162,0.04); font-size: 10px; color: var(--color-t2); padding: 5px 10px; border-bottom: 1px solid var(--color-line); }
  .proj-lbl { color: var(--color-acc); font-weight: 600; margin-right: 8px; }
</style>
