<script lang="ts">
  import { onMount } from 'svelte';
  import { listTrades } from '$lib/data/trades';
  import { listInvestments, calcView } from '$lib/data/investments';
  import { STRATEGIES } from '$lib/types';
  import type { Trade, Strategy } from '$lib/types';
  import type { InvestmentView } from '$lib/data/investments';

  let trades      = $state<Trade[]>([]);
  let investments = $state<InvestmentView[]>([]);
  let loading     = $state(true);
  let error       = $state<string|null>(null);

  // Период
  let fPeriod   = $state<'all'|'year'|'quarter'|'month'|'custom'>('all');
  let fDateFrom = $state('');
  let fDateTo   = $state('');

  async function load() {
    try {
      loading = true;
      const [t, inv] = await Promise.all([
        listTrades({ status: 'CLOSED' }),
        listInvestments()
      ]);
      trades = t;
      investments = inv.map(calcView);
      error = null;
    } catch(e: any) { error = e.message; }
    finally { loading = false; }
  }

  onMount(load);

  // ─── Период cutoff ───
  const range = $derived.by(() => {
    if (fPeriod === 'all')    return { from: '', to: '' };
    if (fPeriod === 'custom') return { from: fDateFrom, to: fDateTo };
    const now = new Date();
    const y = now.getFullYear();
    if (fPeriod === 'year')  return { from: `${y}-01-01`, to: '' };
    if (fPeriod === 'month') return { from: `${y}-${String(now.getMonth()+1).padStart(2,'0')}-01`, to: '' };
    // quarter
    const q = Math.floor(now.getMonth()/3);
    const qStart = String(q*3 + 1).padStart(2,'0');
    return { from: `${y}-${qStart}-01`, to: '' };
  });

  function inRange(date: string | null): boolean {
    if (!date) return false;
    const { from, to } = range;
    if (from && date < from) return false;
    if (to   && date > to)   return false;
    return true;
  }

  // ─── Сделки по стратегиям (USD) ───
  const tradesStats = $derived.by(() => {
    const closed = trades.filter(t => t.status === 'CLOSED' && inRange(t.exit_date));
    const byStrat = new Map<Strategy, { pnl: number; wins: number; losses: number; count: number }>();
    for (const t of closed) {
      if (!byStrat.has(t.strategy)) byStrat.set(t.strategy, { pnl: 0, wins: 0, losses: 0, count: 0 });
      const s = byStrat.get(t.strategy)!;
      const pnl = t.pnl_net ?? 0;
      s.pnl += pnl;
      s.count++;
      if (pnl > 0) s.wins++; else if (pnl < 0) s.losses++;
    }
    const rows = [...byStrat.entries()]
      .map(([strat, s]) => ({
        strategy: strat,
        name: STRATEGIES[strat]?.name ?? strat,
        color: STRATEGIES[strat]?.color ?? '#888',
        ...s,
        winrate: s.count > 0 ? s.wins / s.count * 100 : 0
      }))
      .sort((a, b) => b.pnl - a.pnl);
    const total = rows.reduce((acc, r) => acc + r.pnl, 0);
    const totalCount = rows.reduce((acc, r) => acc + r.count, 0);
    const totalWins = rows.reduce((acc, r) => acc + r.wins, 0);
    return { rows, total, totalCount, totalWins, totalWinrate: totalCount > 0 ? totalWins/totalCount*100 : 0 };
  });

  // ─── Портфель по валютам ───
  const portfolioStats = $derived.by(() => {
    const byCur = new Map<string, { realized: number; dividends: number; count: number }>();
    for (const inv of investments) {
      // Реализованный P&L — только закрытые с exit_date в периоде
      if (inv.is_closed && inRange(inv.exit_date)) {
        if (!byCur.has(inv.currency)) byCur.set(inv.currency, { realized: 0, dividends: 0, count: 0 });
        const s = byCur.get(inv.currency)!;
        s.realized  += inv.pnl_net ?? 0;
        s.dividends += inv.dividends;
        s.count++;
      }
    }
    const rows = [...byCur.entries()]
      .map(([cur, s]) => ({ currency: cur, ...s, total: s.realized + s.dividends }))
      .sort((a, b) => b.total - a.total);
    return rows;
  });

  // USD портфель (для большого итога)
  const usdPortfolio = $derived(portfolioStats.find(r => r.currency === 'USD') ?? null);

  // ─── Общий итог (USD: сделки + портфель USD) ───
  const grandTotalUSD = $derived.by(() => {
    const tradePnl = tradesStats.total;
    const usdPortfolio = portfolioStats.find(r => r.currency === 'USD');
    const portfolioPnl = usdPortfolio ? usdPortfolio.total : 0;
    return tradePnl + portfolioPnl;
  });

  // ─── Helpers ───
  const fmtN = (v: number, dec = 2) => v.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmtSigned = (v: number) => (v >= 0 ? '+' : '') + fmtN(v);
  const pnlColor = (v: number) => v >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)';

  const periodLabel = $derived.by(() => {
    if (fPeriod === 'all')     return 'всё время';
    if (fPeriod === 'custom')  return `${fDateFrom || '…'} — ${fDateTo || '…'}`;
    if (fPeriod === 'year')    return `${new Date().getFullYear()} год`;
    if (fPeriod === 'quarter') return `Q${Math.floor(new Date().getMonth()/3)+1} ${new Date().getFullYear()}`;
    return new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  });
</script>

<svelte:head>
  <title>Сводка P&L · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>Сводка прибыли</h1>
      <p class="sub">Сделки по стратегиям + портфель · период: {periodLabel}</p>
    </div>
  </div>

  <!-- Период -->
  <div class="period-bar">
    <div class="ptabs">
      {#each [['all','Всё время'],['year','Год'],['quarter','Квартал'],['month','Месяц'],['custom','Период']] as [v, l]}
        <button class="ptab" class:ptab-active={fPeriod===v} onclick={() => fPeriod = v as any}>{l}</button>
      {/each}
    </div>
    {#if fPeriod === 'custom'}
      <div class="date-range">
        <input type="date" bind:value={fDateFrom} />
        <span>—</span>
        <input type="date" bind:value={fDateTo} />
      </div>
    {/if}
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else}

    <!-- Большой итог -->
    <div class="grand">
      <div class="grand-block">
        <div class="grand-label">Сделки (USD)</div>
        <div class="grand-val" style="color:{pnlColor(tradesStats.total)}">{fmtSigned(tradesStats.total)}</div>
        <div class="grand-sub">{tradesStats.totalCount} закрытых · WR {tradesStats.totalWinrate.toFixed(0)}%</div>
      </div>
      <div class="grand-op">+</div>
      <div class="grand-block">
        <div class="grand-label">Портфель (USD)</div>
        <div class="grand-val" style="color:{pnlColor(usdPortfolio?.total ?? 0)}">{fmtSigned(usdPortfolio?.total ?? 0)}</div>
        <div class="grand-sub">{usdPortfolio ? usdPortfolio.count + ' закрытых' : 'нет данных'}</div>
      </div>
      <div class="grand-op">=</div>
      <div class="grand-block grand-total">
        <div class="grand-label">Итого USD</div>
        <div class="grand-val grand-val-big" style="color:{pnlColor(grandTotalUSD)}">{fmtSigned(grandTotalUSD)}</div>
        <div class="grand-sub">за {periodLabel}</div>
      </div>
    </div>

    <!-- Сделки по стратегиям -->
    <div class="section-h">📊 Сделки по стратегиям</div>
    {#if tradesStats.rows.length === 0}
      <div class="empty-sec">Нет закрытых сделок за период</div>
    {:else}
      <div class="tw">
        <table>
          <thead><tr>
            <th>Стратегия</th>
            <th>Сделок</th>
            <th>Win / Loss</th>
            <th>Win rate</th>
            <th>P&L (USD)</th>
            <th>Доля</th>
          </tr></thead>
          <tbody>
            {#each tradesStats.rows as r (r.strategy)}
              <tr>
                <td><span class="strat-badge" style="background:{r.color}22;color:{r.color};border-color:{r.color}44">{r.name}</span></td>
                <td class="mono">{r.count}</td>
                <td class="mono"><span style="color:var(--color-acc)">{r.wins}</span> / <span style="color:var(--color-acc2)">{r.losses}</span></td>
                <td class="mono">{r.winrate.toFixed(0)}%</td>
                <td class="mono bold" style="color:{pnlColor(r.pnl)}">{fmtSigned(r.pnl)}</td>
                <td class="mono dim">{tradesStats.total !== 0 ? (r.pnl / tradesStats.total * 100).toFixed(0) + '%' : '—'}</td>
              </tr>
            {/each}
            <tr class="total-row">
              <td><b>Итого</b></td>
              <td class="mono"><b>{tradesStats.totalCount}</b></td>
              <td class="mono">{tradesStats.totalWins} / {tradesStats.totalCount - tradesStats.totalWins}</td>
              <td class="mono">{tradesStats.totalWinrate.toFixed(0)}%</td>
              <td class="mono bold" style="color:{pnlColor(tradesStats.total)}">{fmtSigned(tradesStats.total)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Портфель по валютам -->
    <div class="section-h">💼 Портфель (реализованный P&L)</div>
    {#if portfolioStats.length === 0}
      <div class="empty-sec">Нет закрытых позиций за период</div>
    {:else}
      <div class="tw">
        <table>
          <thead><tr>
            <th>Валюта</th>
            <th>Закрытых</th>
            <th>Реализ. P&L</th>
            <th>Дивиденды</th>
            <th>Итого</th>
          </tr></thead>
          <tbody>
            {#each portfolioStats as r (r.currency)}
              <tr>
                <td><span class="cur-badge">{r.currency}</span></td>
                <td class="mono">{r.count}</td>
                <td class="mono" style="color:{pnlColor(r.realized)}">{fmtSigned(r.realized)}</td>
                <td class="mono" style="color:{r.dividends>0?'var(--color-acc)':'inherit'}">{r.dividends>0 ? '+'+fmtN(r.dividends) : '—'}</td>
                <td class="mono bold" style="color:{pnlColor(r.total)}">{fmtSigned(r.total)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="note">Учитываются только закрытые позиции (по дате выхода). Разные валюты не суммируются между собой.</div>
    {/if}

  {/if}
</div>

<style>
  .page { padding: 20px 0; }
  .head { margin-bottom: 16px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }

  .period-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .ptabs { display: flex; gap: 4px; }
  .ptab { font-family: var(--font-mono); font-size: 11px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--color-line); background: var(--color-bg2); color: var(--color-t2); cursor: pointer; }
  .ptab-active { border-color: var(--color-acc); color: var(--color-acc); background: rgba(126,232,162,0.08); }
  .date-range { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--color-t2); }
  .date-range input { width: 140px; }

  .grand { display: flex; align-items: stretch; gap: 10px; margin-bottom: 28px; flex-wrap: wrap; }
  .grand-block { flex: 1; min-width: 150px; padding: 16px 18px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; }
  .grand-total { border-color: var(--color-acc); background: rgba(126,232,162,0.04); }
  .grand-op { display: flex; align-items: center; font-family: var(--font-mono); font-size: 22px; color: var(--color-t3); }
  .grand-label { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .grand-val { font-family: var(--font-mono); font-size: 24px; font-weight: 700; }
  .grand-val-big { font-size: 30px; }
  .grand-sub { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); margin-top: 6px; }

  .section-h { font-family: var(--font-mono); font-size: 12px; font-weight: 700; letter-spacing: 1px; color: var(--color-text); margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--color-line); }
  .empty-sec { padding: 20px; text-align: center; color: var(--color-t3); font-family: var(--font-mono); font-size: 11px; }
  .state { padding: 40px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); }
  .err { color: var(--color-acc2); }

  .tw { overflow-x: auto; }
  .mono { font-family: var(--font-mono); font-size: 11px; }
  .bold { font-weight: 700; }
  .dim { color: var(--color-t2); }
  .strat-badge { font-family: var(--font-mono); font-size: 10px; padding: 3px 9px; border-radius: 12px; border: 1px solid; }
  .cur-badge { font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; background: rgba(126,232,162,0.1); color: var(--color-acc); }
  .total-row { border-top: 2px solid var(--color-line); }
  .total-row td { padding-top: 10px; }
  .note { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); margin-top: 8px; padding: 0 4px; }
</style>
