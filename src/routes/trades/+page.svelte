<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listTrades, deleteTrade, subscribeTrades } from '$lib/data/trades';
  import { unbindCandidateFromTrade } from '$lib/data/sync';
  import type { Trade, Strategy, TradeStatus } from '$lib/types';
  import { STRATEGIES } from '$lib/types';
  import TradeEditForm from '$lib/components/TradeEditForm.svelte';

  let trades = $state<Trade[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let fStrategy = $state<Strategy | ''>('');
  let fStatus = $state<TradeStatus | ''>('');
  let editTrade = $state<Trade | null>(null);

  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      trades = await listTrades({
        strategy: fStrategy || undefined,
        status: fStatus || undefined
      });
      error = null;
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    unsubscribe = subscribeTrades(() => load());
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  $effect(() => {
    fStrategy;
    fStatus;
    load();
  });

  async function handleDelete(e: Event, id: string) {
    e.stopPropagation();
    if (!confirm('Удалить сделку? Кандидат вернётся в "Готов вход".')) return;
    try {
      await unbindCandidateFromTrade(id);
      await deleteTrade(id);
      trades = trades.filter((t) => t.id !== id);
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  }

  function statusColor(s: string) {
    if (s === 'OPEN') return 'var(--color-acc4)';
    if (s === 'CLOSED') return 'var(--color-t3)';
    return 'var(--color-acc3)';
  }

  function pnlColor(t: Trade) {
    if (t.pnl_pct == null) return 'var(--color-t2)';
    return t.pnl_pct >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)';
  }
</script>

<div class="page">
  <div class="head">
    <h1>Сделки</h1>
    <a href="/calendar" class="cal-link">Календарь →</a>
  </div>

  <div class="filters">
    <select bind:value={fStrategy}>
      <option value="">Все стратегии</option>
      {#each Object.values(STRATEGIES) as s}
        <option value={s.id}>{s.name}</option>
      {/each}
    </select>

    <select bind:value={fStatus}>
      <option value="">Все статусы</option>
      <option value="OPEN">Открытые</option>
      <option value="PARTIAL">Частичный</option>
      <option value="CLOSED">Закрытые</option>
    </select>
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if trades.length === 0}
    <div class="state">Нет сделок.</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Ticker</th>
            <th>Strategy</th>
            <th>Type</th>
            <th>Entry</th>
            <th>Stop</th>
            <th>Exit</th>
            <th>Reason</th>
            <th>Shares</th>
            <th>Status</th>
            <th>P&L %</th>
            <th>P&L $</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each trades as t (t.id)}
            {@const sd = STRATEGIES[t.strategy]}
            <tr class="row" onclick={() => (editTrade = t)}>
              <td>{t.entry_date ?? '—'}</td>
              <td><b>{t.ticker}</b></td>
              <td><span style="color:{sd?.color || 'inherit'}">{sd?.name || t.strategy}</span></td>
              <td><span style="color:{t.type === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}">{t.type}</span></td>
              <td>{t.entry !== null ? '$' + t.entry.toFixed(2) : '—'}</td>
              <td>{t.stop !== null ? '$' + Number(t.stop).toFixed(2) : '—'}</td>
              <td>{t.exit_price ? '$' + Number(t.exit_price).toFixed(2) : '—'}</td>
              <td style="font-size:10px;color:var(--color-t2)">{t.exit_reason ?? '—'}</td>
              <td>{t.shares ?? '—'}</td>
              <td><span style="color:{statusColor(t.status)}">{t.status}</span></td>
              <td><span style="color:{pnlColor(t)};font-weight:600">{t.pnl_pct !== null ? (t.pnl_pct >= 0 ? '+' : '') + Number(t.pnl_pct).toFixed(2) + '%' : '—'}</span></td>
              <td><span style="color:{pnlColor(t)}">{t.pnl_net !== null ? '$' + Number(t.pnl_net).toFixed(2) : '—'}</span></td>
              <td>
                <button class="btn-r" onclick={(e) => handleDelete(e, t.id)} style="font-size:9px;padding:4px 8px">×</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if editTrade}
  <TradeEditForm trade={editTrade} onClose={() => (editTrade = null)} onSaved={load} />
{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 16px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0; }
  .cal-link { font-family: var(--font-mono); font-size: 11px; padding: 8px 14px; border: 1px solid var(--color-line); border-radius: 6px; text-decoration: none; color: var(--color-text); background: var(--color-bg2); }
  .cal-link:hover { background: var(--color-bg3); }
  .filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .row { cursor: pointer; }
  .row:hover { background: var(--color-bg3); }
</style>
