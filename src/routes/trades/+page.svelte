<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listTrades, deleteTrade, subscribeTrades } from '$lib/data/trades';
  import type { Trade, Strategy, TradeStatus } from '$lib/types';
  import { STRATEGIES } from '$lib/types';

  let trades = $state<Trade[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let fStrategy = $state<Strategy | ''>('');
  let fStatus = $state<TradeStatus | ''>('');

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

  async function handleDelete(id: string) {
    if (!confirm('Удалить сделку?')) return;
    try {
      await deleteTrade(id);
      trades = trades.filter((t) => t.id !== id);
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
  }
</script>

<div class="page">
  <h1>Сделки</h1>

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
      <option value="PARTIAL">Частичный выход</option>
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
            <th>T1</th>
            <th>T2</th>
            <th>Shares</th>
            <th>Status</th>
            <th>P&L %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each trades as t (t.id)}
            {@const sd = STRATEGIES[t.strategy]}
            <tr>
              <td>{t.entry_date ?? '—'}</td>
              <td><b>{t.ticker}</b></td>
              <td><span style="color:{sd?.color || 'inherit'}">{sd?.name || t.strategy}</span></td>
              <td><span style="color:{t.type === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}">{t.type}</span></td>
              <td>{t.entry !== null ? '$' + t.entry.toFixed(2) : '—'}</td>
              <td>{t.stop !== null ? '$' + Number(t.stop).toFixed(2) : '—'}</td>
              <td>{t.target1 !== null ? '$' + Number(t.target1).toFixed(2) : '—'}</td>
              <td>{t.target2 !== null ? '$' + Number(t.target2).toFixed(2) : '—'}</td>
              <td>{t.shares ?? '—'}</td>
              <td>{t.status}</td>
              <td>{t.pnl_pct !== null ? t.pnl_pct + '%' : '—'}</td>
              <td>
                <button class="btn-r" onclick={() => handleDelete(t.id)} style="font-size:9px;padding:4px 8px">×</button>
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
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 16px; }
  .filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
</style>
