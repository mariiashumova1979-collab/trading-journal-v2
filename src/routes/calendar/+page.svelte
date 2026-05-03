<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listTrades, subscribeTrades } from '$lib/data/trades';
  import { getMarketHolidays, isWeekend, dateToString } from '$lib/utils/marketHolidays';
  import type { Trade } from '$lib/types';
  import TradeEditForm from '$lib/components/TradeEditForm.svelte';

  let allTrades = $state<Trade[]>([]);
  let year = $state(new Date().getUTCFullYear());
  let loading = $state(true);
  let editTrade = $state<Trade | null>(null);
  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      allTrades = await listTrades();
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

  // Праздники для текущего отображаемого года
  const holidays = $derived(getMarketHolidays(year));

  // Группируем сделки по дате (entry_date)
  const tradesByDate = $derived.by(() => {
    const map = new Map<string, Trade[]>();
    for (const t of allTrades) {
      if (!t.entry_date) continue;
      const key = t.entry_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  });

  // Месяцы с массивами недель
  const months = $derived.by(() => {
    const result: { name: string; weeks: (Date | null)[][] }[] = [];
    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    for (let m = 0; m < 12; m++) {
      const firstDay = new Date(Date.UTC(year, m, 1));
      const lastDay = new Date(Date.UTC(year, m + 1, 0));
      const weeks: (Date | null)[][] = [];
      let week: (Date | null)[] = [];

      // Неделя начинается с понедельника. JS getUTCDay: 0=Sun..6=Sat
      const firstWeekday = firstDay.getUTCDay();
      const offsetMon = (firstWeekday + 6) % 7; // Mon=0
      for (let i = 0; i < offsetMon; i++) week.push(null);

      for (let d = 1; d <= lastDay.getUTCDate(); d++) {
        week.push(new Date(Date.UTC(year, m, d)));
        if (week.length === 7) {
          weeks.push(week);
          week = [];
        }
      }
      while (week.length > 0 && week.length < 7) week.push(null);
      if (week.some(w => w !== null)) weeks.push(week);

      result.push({ name: monthNames[m], weeks });
    }
    return result;
  });

  // Статистика года
  const stats = $derived.by(() => {
    const yearTrades = allTrades.filter(t => t.entry_date?.startsWith(String(year)));
    const closed = yearTrades.filter(t => t.status === 'CLOSED');
    const wins = closed.filter(t => t.result === 'WIN').length;
    const losses = closed.filter(t => t.result === 'LOSS').length;
    const totalPnl = closed.reduce((s, t) => s + (Number(t.pnl_net) || 0), 0);
    return {
      total: yearTrades.length,
      closed: closed.length,
      open: yearTrades.length - closed.length,
      wins,
      losses,
      winRate: closed.length > 0 ? (wins / closed.length * 100) : 0,
      pnl: totalPnl
    };
  });

  function dayCellClass(d: Date | null): string {
    if (!d) return 'empty';
    const ds = dateToString(d);
    const tradesToday = tradesByDate.get(ds);
    if (holidays.has(ds)) return 'holiday';
    if (isWeekend(d)) return 'weekend';
    if (!tradesToday || tradesToday.length === 0) return 'empty-day';
    
    // Цвет по результату: если хоть одна открытая → серый; если все закрыты — по сумме PnL
    const allClosed = tradesToday.every(t => t.status === 'CLOSED');
    if (!allClosed) return 'open';
    const totalPnl = tradesToday.reduce((s, t) => s + (Number(t.pnl_net) || 0), 0);
    if (totalPnl > 0) return 'win';
    if (totalPnl < 0) return 'loss';
    return 'neutral';
  }

  function dayTooltip(d: Date | null): string {
    if (!d) return '';
    const ds = dateToString(d);
    if (holidays.has(ds)) return ds + ' — Праздник биржи';
    if (isWeekend(d)) return ds + ' — Выходной';
    const tradesToday = tradesByDate.get(ds);
    if (!tradesToday) return ds;
    const lines = [ds, ''];
    for (const t of tradesToday) {
      const pnl = t.pnl_net != null ? ` ${Number(t.pnl_net) >= 0 ? '+' : ''}$${Number(t.pnl_net).toFixed(2)}` : ' (open)';
      lines.push(`${t.ticker} ${t.type}${pnl}`);
    }
    return lines.join('\n');
  }

  function dayTradeCount(d: Date | null): number {
    if (!d) return 0;
    const ds = dateToString(d);
    return tradesByDate.get(ds)?.length ?? 0;
  }

  function dayClick(d: Date | null) {
    if (!d) return;
    const ds = dateToString(d);
    const tradesToday = tradesByDate.get(ds);
    if (tradesToday && tradesToday.length === 1) {
      editTrade = tradesToday[0];
    }
  }
</script>

<div class="page">
  <div class="head">
    <h1>Календарь сделок</h1>
    <div class="year-nav">
      <button onclick={() => (year -= 1)}>‹</button>
      <span class="year-label">{year}</span>
      <button onclick={() => (year += 1)}>›</button>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-v">{stats.total}</div><div class="stat-l">Сделок</div></div>
    <div class="stat"><div class="stat-v">{stats.closed}</div><div class="stat-l">Закрыто</div></div>
    <div class="stat"><div class="stat-v">{stats.open}</div><div class="stat-l">Открыто</div></div>
    <div class="stat"><div class="stat-v" style="color:var(--color-acc)">{stats.wins}</div><div class="stat-l">WIN</div></div>
    <div class="stat"><div class="stat-v" style="color:var(--color-acc2)">{stats.losses}</div><div class="stat-l">LOSS</div></div>
    <div class="stat"><div class="stat-v">{stats.winRate.toFixed(0)}%</div><div class="stat-l">Win rate</div></div>
    <div class="stat"><div class="stat-v" style="color:{stats.pnl >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)'}">${stats.pnl.toFixed(0)}</div><div class="stat-l">P&L net</div></div>
  </div>

  <div class="legend">
    <span><i class="leg-cell win"></i>WIN</span>
    <span><i class="leg-cell loss"></i>LOSS</span>
    <span><i class="leg-cell open"></i>OPEN</span>
    <span><i class="leg-cell empty-day"></i>Нет сделок</span>
    <span><i class="leg-cell weekend"></i>Выходной</span>
    <span><i class="leg-cell holiday"></i>Праздник</span>
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else}
    <div class="months">
      {#each months as month}
        <div class="month">
          <div class="month-name">{month.name}</div>
          <div class="grid">
            <div class="dh">Пн</div>
            <div class="dh">Вт</div>
            <div class="dh">Ср</div>
            <div class="dh">Чт</div>
            <div class="dh">Пт</div>
            <div class="dh">Сб</div>
            <div class="dh">Вс</div>
            {#each month.weeks as week}
              {#each week as day}
                {@const cls = dayCellClass(day)}
                {@const cnt = dayTradeCount(day)}
                <div
                  class="cell {cls}"
                  title={dayTooltip(day)}
                  onclick={() => dayClick(day)}
                  role={day && cnt > 0 ? 'button' : 'presentation'}
                  tabindex={day && cnt > 0 ? 0 : -1}
                >
                  {#if day}{day.getUTCDate()}{/if}
                  {#if cnt > 1}<span class="cnt">{cnt}</span>{/if}
                </div>
              {/each}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if editTrade}
  <TradeEditForm trade={editTrade} onClose={() => (editTrade = null)} onSaved={load} />
{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0; }
  .year-nav { display: flex; align-items: center; gap: 12px; }
  .year-nav button { font-size: 14px; padding: 4px 12px; }
  .year-label { font-family: var(--font-mono); font-size: 16px; font-weight: 700; min-width: 50px; text-align: center; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 16px; }
  .stat { padding: 10px 12px; border: 1px solid var(--color-line); border-radius: 8px; background: var(--color-bg2); text-align: center; }
  .stat-v { font-family: var(--font-mono); font-size: 18px; font-weight: 700; }
  .stat-l { font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .legend { display: flex; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); }
  .legend span { display: flex; align-items: center; gap: 6px; }
  .leg-cell { display: inline-block; width: 14px; height: 14px; border-radius: 2px; border: 1px solid var(--color-line); }
  .months { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .month { padding: 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .month-name { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--color-text); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; text-align: center; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .dh { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); text-align: center; padding: 4px 0; }
  .cell {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 10px;
    border-radius: 4px;
    border: 1px solid transparent;
    position: relative;
    cursor: default;
  }
  .empty { background: transparent; }
  .empty-day { background: var(--color-bg3); color: var(--color-t2); }
  .weekend { background: var(--color-bg); color: var(--color-t3); }
  .holiday { background: rgba(255, 200, 90, 0.15); color: var(--color-acc3); border-color: rgba(255, 200, 90, 0.3); }
  .open { background: rgba(106, 183, 255, 0.18); color: var(--color-text); border-color: var(--color-acc4); cursor: pointer; }
  .win { background: rgba(126, 232, 162, 0.25); color: var(--color-text); border-color: var(--color-acc); cursor: pointer; }
  .loss { background: rgba(255, 107, 138, 0.25); color: var(--color-text); border-color: var(--color-acc2); cursor: pointer; }
  .neutral { background: var(--color-bg3); color: var(--color-text); cursor: pointer; }
  .cell:hover { transform: scale(1.05); transition: transform 0.1s; z-index: 2; }
  .cnt { position: absolute; top: 1px; right: 2px; font-size: 7px; font-weight: 700; background: var(--color-acc4); color: var(--color-bg); border-radius: 6px; padding: 0 3px; line-height: 1.4; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
</style>
