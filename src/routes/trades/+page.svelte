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
  let fPeriod = $state<'all' | 'year' | 'month' | '30d'>('all');
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

  // Применение период-фильтра локально (сервер не фильтрует по периоду)
  const filteredTrades = $derived.by(() => {
    if (fPeriod === 'all') return trades;
    const now = new Date();
    let cutoff: Date;
    if (fPeriod === 'year') {
      cutoff = new Date(now.getFullYear(), 0, 1);
    } else if (fPeriod === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);
    }
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return trades.filter(t => t.entry_date && t.entry_date >= cutoffStr);
  });

  // Статистика по отфильтрованным сделкам
  const stats = $derived.by(() => {
    const list = filteredTrades;
    const closed = list.filter(t => t.status === 'CLOSED');
    const open = list.filter(t => t.status !== 'CLOSED');
    const wins = closed.filter(t => t.result === 'WIN');
    const losses = closed.filter(t => t.result === 'LOSS');
    const totalPnlNet = closed.reduce((s, t) => s + (Number(t.pnl_net) || 0), 0);
    const totalPnlPct = closed.reduce((s, t) => s + (Number(t.pnl_pct) || 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length * 100) : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (Number(t.pnl_net) || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (Number(t.pnl_net) || 0), 0) / losses.length : 0;
    const profitFactor = avgLoss !== 0 ? Math.abs((wins.reduce((s, t) => s + (Number(t.pnl_net) || 0), 0)) / (losses.reduce((s, t) => s + (Number(t.pnl_net) || 0), 0))) : 0;
    const bestTrade = closed.reduce<Trade | null>((b, t) => (b === null || (Number(t.pnl_net) || 0) > (Number(b.pnl_net) || 0)) ? t : b, null);
    const worstTrade = closed.reduce<Trade | null>((w, t) => (w === null || (Number(t.pnl_net) || 0) < (Number(w.pnl_net) || 0)) ? t : w, null);

    return {
      total: list.length,
      closed: closed.length,
      open: open.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnlNet,
      totalPnlPct,
      avgWin,
      avgLoss,
      profitFactor,
      bestTrade,
      worstTrade
    };
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

<svelte:head>
  <title>Сделки · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <h1>Сделки</h1>
    <a href="/calendar" class="cal-link">📅 Календарь</a>
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

    <select bind:value={fPeriod}>
      <option value="all">Всё время</option>
      <option value="year">Этот год</option>
      <option value="month">Этот месяц</option>
      <option value="30d">Последние 30 дней</option>
    </select>
  </div>

  <!-- СТАТИСТИКА -->
  <div class="stats">
    <div class="stat">
      <div class="stat-l">Всего</div>
      <div class="stat-v">{stats.total}</div>
      <div class="stat-sub">{stats.closed} закрыто · {stats.open} открыто</div>
    </div>
    <div class="stat">
      <div class="stat-l">Win rate</div>
      <div class="stat-v">{stats.winRate.toFixed(1)}<span style="font-size:14px">%</span></div>
      <div class="stat-sub"><span style="color:var(--color-acc)">{stats.wins} W</span> · <span style="color:var(--color-acc2)">{stats.losses} L</span></div>
    </div>
    <div class="stat" style="background: {stats.totalPnlNet >= 0 ? 'rgba(126,232,162,0.05)' : 'rgba(255,107,138,0.05)'}; border-color: {stats.totalPnlNet >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)'}">
      <div class="stat-l">P&L net</div>
      <div class="stat-v" style="color:{stats.totalPnlNet >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)'}">${stats.totalPnlNet >= 0 ? '+' : ''}{stats.totalPnlNet.toFixed(2)}</div>
      <div class="stat-sub">сумма {stats.totalPnlPct >= 0 ? '+' : ''}{stats.totalPnlPct.toFixed(1)}%</div>
    </div>
    <div class="stat">
      <div class="stat-l">Avg Win / Loss</div>
      <div class="stat-v" style="font-size:13px;line-height:1.3">
        <span style="color:var(--color-acc)">+${stats.avgWin.toFixed(0)}</span> / <span style="color:var(--color-acc2)">${stats.avgLoss.toFixed(0)}</span>
      </div>
      <div class="stat-sub">PF: {stats.profitFactor > 0 ? stats.profitFactor.toFixed(2) : '—'}</div>
    </div>
    <div class="stat">
      <div class="stat-l">Best</div>
      <div class="stat-v" style="font-size:14px;color:var(--color-acc)">{stats.bestTrade?.ticker ?? '—'}</div>
      <div class="stat-sub">{stats.bestTrade?.pnl_net != null ? '+$' + Number(stats.bestTrade.pnl_net).toFixed(2) : ''}</div>
    </div>
    <div class="stat">
      <div class="stat-l">Worst</div>
      <div class="stat-v" style="font-size:14px;color:var(--color-acc2)">{stats.worstTrade?.ticker ?? '—'}</div>
      <div class="stat-sub">{stats.worstTrade?.pnl_net != null ? '$' + Number(stats.worstTrade.pnl_net).toFixed(2) : ''}</div>
    </div>
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if filteredTrades.length === 0}
    <div class="state">Нет сделок по выбранным фильтрам.</div>
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
          {#each filteredTrades as t (t.id)}
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
  .filters { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }
  .stat {
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    background: var(--color-bg2);
  }
  .stat-l { font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .stat-v { font-family: var(--font-mono); font-size: 18px; font-weight: 700; line-height: 1.2; }
  .stat-sub { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); margin-top: 4px; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .row { cursor: pointer; }
  .row:hover { background: var(--color-bg3); }
</style>
