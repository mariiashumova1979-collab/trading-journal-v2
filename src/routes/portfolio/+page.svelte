<script lang="ts">
  import { onMount } from 'svelte';
  import { listInvestments, deleteInvestment, calcView } from '$lib/data/investments';
  import type { Investment, InvestmentView } from '$lib/data/investments';
  import InvestmentForm from '$lib/components/InvestmentForm.svelte';

  let investments = $state<InvestmentView[]>([]);
  let loading     = $state(true);
  let error       = $state<string|null>(null);
  let showAdd     = $state(false);
  let editInv     = $state<Investment|null>(null);
  let groupEditTicker = $state<string|null>(null);
  let groupEditCur    = $state<string|null>(null);
  let filterStatus = $state<'ALL'|'OPEN'|'CLOSED'>('ALL');
  let filterType   = $state('ALL');
  let filterCur    = $state('ALL');
  let groupMode    = $state(false);
  let fPeriod   = $state<'all'|'year'|'month'|'custom'>('all');
  let fDateFrom = $state('');
  let fDateTo   = $state('');
  let sortCol   = $state('entry_date');
  let sortDir      = $state<'asc'|'desc'>('desc');

  const ASSET_LABELS: Record<string,string> = {
    stock:'Акции', etf:'ETF', crypto:'Крипта',
    bond:'Облигации', reit:'REIT', other:'Другое'
  };

  async function load() {
    try {
      loading = true;
      const raw = await listInvestments();
      investments = raw.map(calcView);
      error = null;
    } catch(e: any) { error = e.message; }
    finally { loading = false; }
  }

  onMount(load);

  async function handleDelete(id: string) {
    if (!confirm('Удалить позицию?')) return;
    try { await deleteInvestment(id); load(); }
    catch(e: any) { alert('Ошибка: ' + (e as any).message); }
  }

  // ─── Grouped view ───
  interface GroupedInv {
    ticker: string;
    currency: string;
    asset_type: string;
    name: string | null;
    ids: string[];
    total_shares: number;
    avg_entry_price: number;
    cost_basis: number;
    current_price: number | null;   // из последней записи по entry_date
    current_value: number | null;
    open_count: number;
    closed_count: number;
    realized_pnl: number;
    unrealized_pnl: number | null;
    dividends: number;
    total_pnl: number | null;
    total_pnl_pct: number | null;
  }

  function groupInvestments(list: InvestmentView[]): GroupedInv[] {
    const map = new Map<string, InvestmentView[]>();
    for (const inv of list) {
      const key = inv.ticker + '__' + inv.currency;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    }
    const result: GroupedInv[] = [];
    for (const [, rows] of map) {
      const open   = rows.filter(r => !r.is_closed);
      const closed = rows.filter(r =>  r.is_closed);

      // Средняя цена входа (взвешенная по объёму, только открытые)
      const openCost   = open.reduce((s, r) => s + r.cost_basis, 0);
      const openShares = open.reduce((s, r) => s + r.shares, 0);
      const avgEntry   = openShares > 0 ? openCost / openShares : 0;

      // Текущая цена — из самой свежей открытой записи с current_price
      const withCur = open.filter(r => r.current_price != null)
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
      const curPrice = withCur.length > 0 ? withCur[0].current_price : null;
      const curValue = curPrice != null ? curPrice * openShares : null;

      const realizedPnl  = closed.reduce((s, r) => s + (r.pnl_net ?? 0), 0);
      const unrealizedPnl = curValue != null ? curValue - openCost : null;
      const dividends    = rows.reduce((s, r) => s + r.dividends, 0);

      const totalPnl = unrealizedPnl != null
        ? unrealizedPnl + realizedPnl + dividends
        : (realizedPnl + dividends || null);
      const totalCost = rows.reduce((s, r) => s + r.cost_basis, 0);
      const totalPnlPct = totalPnl != null && totalCost > 0 ? totalPnl / totalCost * 100 : null;

      result.push({
        ticker:        rows[0].ticker,
        currency:      rows[0].currency,
        asset_type:    rows[0].asset_type,
        name:          rows[0].name,
        ids:           rows.map(r => r.id),
        total_shares:  openShares,
        avg_entry_price: avgEntry,
        cost_basis:    openCost,
        current_price: curPrice,
        current_value: curValue,
        open_count:    open.length,
        closed_count:  closed.length,
        realized_pnl:  realizedPnl,
        unrealized_pnl: unrealizedPnl,
        dividends,
        total_pnl:     totalPnl,
        total_pnl_pct: totalPnlPct,
      });
    }
    return result.sort((a, b) => b.cost_basis - a.cost_basis);
  }

  const grouped = $derived(groupInvestments(investments.filter(i => {
    if (filterType !== 'ALL' && i.asset_type !== filterType) return false;
    if (filterCur  !== 'ALL' && i.currency   !== filterCur)  return false;
    return true;
  })));

  // ─── Derived ───
  const allTypes  = $derived([...new Set(investments.map(i => i.asset_type))]);
  const allCurs   = $derived([...new Set(investments.map(i => i.currency))]);

  // Вычисляем cutoff для периода
  const periodCutoff = $derived.by(() => {
    if (fPeriod === 'all') return '';
    if (fPeriod === 'custom') return fDateFrom;
    const now = new Date();
    if (fPeriod === 'year')  return `${now.getFullYear()}-01-01`;
    if (fPeriod === 'month') return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    return '';
  });

  const filtered = $derived.by(() => {
    let list = [...investments];
    if (filterStatus === 'OPEN')   list = list.filter(i => !i.is_closed);
    if (filterStatus === 'CLOSED') list = list.filter(i =>  i.is_closed);
    if (filterType !== 'ALL')      list = list.filter(i => i.asset_type === filterType);
    if (filterCur  !== 'ALL')      list = list.filter(i => i.currency === filterCur);

    // Фильтр по периоду: для закрытых по exit_date, для открытых по entry_date
    if (fPeriod !== 'all') {
      const from = fPeriod === 'custom' ? fDateFrom : periodCutoff;
      const to   = fPeriod === 'custom' ? fDateTo   : '';
      if (from) list = list.filter(i => {
        const d = i.exit_date ?? i.entry_date;
        return d && d >= from;
      });
      if (to)   list = list.filter(i => {
        const d = i.exit_date ?? i.entry_date;
        return d && d <= to;
      });
    }

    list.sort((a, b) => {
      const va = (a as any)[sortCol] ?? 0;
      const vb = (b as any)[sortCol] ?? 0;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return list;
  });

  // ─── Stats по валютам ───
  const statsByCur = $derived.by(() => {
    const map = new Map<string, { cost: number; current: number; realized: number; unrealized: number; dividends: number; open: number; closed: number }>();
    for (const inv of investments) {
      if (!map.has(inv.currency)) map.set(inv.currency, { cost:0, current:0, realized:0, unrealized:0, dividends:0, open:0, closed:0 });
      const s = map.get(inv.currency)!;
      s.cost += inv.cost_basis;
      s.dividends += inv.dividends;
      if (inv.is_closed) {
        s.closed++;
        if (inv.pnl_net != null) s.realized += inv.pnl_net;
      } else {
        s.open++;
        if (inv.current_value != null) s.current += inv.current_value;
        else s.current += inv.cost_basis;
        if (inv.pnl_net != null) s.unrealized += inv.pnl_net;
      }
    }
    return [...map.entries()].sort((a,b) => b[1].cost - a[1].cost);
  });

  function setSort(col: string) {
    sortDir = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    sortCol = col;
  }

  function groupPositions(ticker: string, cur: string): InvestmentView[] {
    return investments.filter(i => i.ticker === ticker && i.currency === cur)
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  }

  const fmtN = (v: number | null, dec = 2) =>
    v == null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmtPct = (v: number | null) =>
    v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const pnlColor = (v: number | null) =>
    v == null ? 'inherit' : v >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)';
  const col = (c: string, l: string) =>
    l + (sortCol === c ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');
</script>

<svelte:head>
  <title>Портфель · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>Портфель</h1>
      <p class="sub">Долгосрочные инвестиции · {investments.filter(i=>!i.is_closed).length} открытых · {investments.filter(i=>i.is_closed).length} закрытых</p>
    </div>
    <button class="btn-p" onclick={() => showAdd = true}>+ Добавить позицию</button>
  </div>

  <!-- Stats by currency -->
  {#if statsByCur.length > 0}
    <div class="stats-grid">
      {#each statsByCur as [cur, s]}
        <div class="stat-card">
          <div class="stat-cur">{cur}</div>
          <div class="stat-rows">
            <div class="stat-row"><span>Cost basis</span><b>{fmtN(s.cost)}</b></div>
            {#if s.open > 0}
              <div class="stat-row"><span>Текущая стоимость</span><b>{fmtN(s.current)}</b></div>
              <div class="stat-row">
                <span>Нереализованный P/L</span>
                <b style="color:{pnlColor(s.unrealized)}">{s.unrealized >= 0 ? '+' : ''}{fmtN(s.unrealized)} ({s.cost > 0 ? fmtPct(s.unrealized/s.cost*100) : '—'})</b>
              </div>
            {/if}
            {#if s.realized !== 0}
              <div class="stat-row">
                <span>Реализованный P/L</span>
                <b style="color:{pnlColor(s.realized)}">{s.realized >= 0 ? '+' : ''}{fmtN(s.realized)}</b>
              </div>
            {/if}
            {#if s.dividends > 0}
              <div class="stat-row"><span>Дивиденды</span><b style="color:var(--color-acc)">+{fmtN(s.dividends)}</b></div>
            {/if}
          </div>
          <div class="stat-foot">{s.open} открытых · {s.closed} закрытых</div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Period stats -->
  {#if periodStats && periodStats.length > 0}
    <div class="period-stats">
      <div class="period-stats-title">
        📊 Результат за период:
        {#if fPeriod === 'custom'}
          {fDateFrom || '…'} — {fDateTo || '…'}
        {:else if fPeriod === 'year'}
          {new Date().getFullYear()} год
        {:else if fPeriod === 'month'}
          {new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
        {/if}
      </div>
      {#each periodStats as [cur, s]}
        <div class="period-stat-item">
          <span class="cur-badge">{cur}</span>
          <span style="color:{s.realized>=0?'var(--color-acc)':'var(--color-acc2)'};font-weight:700">
            {s.realized>=0?'+':''}{fmtN(s.realized)}
          </span>
          {#if s.dividends > 0}
            <span style="color:var(--color-acc);font-size:10px"> +дивид. {fmtN(s.dividends)}</span>
          {/if}
          <span style="color:var(--color-t3);font-size:10px">· {s.count} закрытых</span>
          <span style="color:{(s.realized+s.dividends)>=0?'var(--color-acc)':'var(--color-acc2)'};font-size:10px;margin-left:6px">
            итого: {(s.realized+s.dividends)>=0?'+':''}{fmtN(s.realized+s.dividends)}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Filters -->
  <div class="filters">
    <div class="filter-group">
      {#each ['ALL','OPEN','CLOSED'] as s}
        <button class="ftab" class:ftab-active={filterStatus===s} onclick={() => filterStatus = s as any}>
          {s === 'ALL' ? 'Все' : s === 'OPEN' ? 'Открытые' : 'Закрытые'}
          ({s === 'ALL' ? investments.length : s === 'OPEN' ? investments.filter(i=>!i.is_closed).length : investments.filter(i=>i.is_closed).length})
        </button>
      {/each}
    </div>
    <div class="filter-group">
      <select bind:value={filterType}>
        <option value="ALL">Все типы</option>
        {#each allTypes as t}<option value={t}>{ASSET_LABELS[t]??t}</option>{/each}
      </select>
      <select bind:value={filterCur}>
        <option value="ALL">Все валюты</option>
        {#each allCurs as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>
    <div class="filter-group">
      <select bind:value={fPeriod}>
        <option value="all">Всё время</option>
        <option value="year">Этот год</option>
        <option value="month">Этот месяц</option>
        <option value="custom">Произвольный</option>
      </select>
      {#if fPeriod === 'custom'}
        <input type="date" bind:value={fDateFrom} style="width:130px" />
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-t2)">—</span>
        <input type="date" bind:value={fDateTo}   style="width:130px" />
      {/if}
    </div>
    <label class="chk-group">
      <input type="checkbox" bind:checked={groupMode} />
      Группировать по тикеру
    </label>
    <span class="filter-count">{groupMode ? grouped.length + ' тикеров' : filtered.length + ' позиций'}</span>
  </div>

  <!-- Table -->
  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if groupMode && grouped.length === 0}
    <div class="state">Нет позиций.</div>
  {:else if !groupMode && filtered.length === 0}
    <div class="state">Нет позиций. Нажми «+ Добавить позицию».</div>
  {:else}
    {#if groupMode}
      <div class="tw">
        <table>
          <thead><tr>
            <th>Тикер</th><th>Тип</th><th>Валюта</th><th>Позиций</th>
            <th>Ср. цена входа</th><th>Кол-во (откр.)</th><th>Cost basis</th>
            <th>Тек. цена</th><th>Тек. стоимость</th>
            <th>Нереализ. P/L</th><th>Реализ. P/L</th><th>Дивид.</th>
            <th>Итого P/L</th><th>Доход-ть</th>
          </tr></thead>
          <tbody>
            {#each grouped as g (g.ticker + g.currency)}
              <tr>
                <td><b>{g.ticker}</b><div class="sub2">{g.name ?? ''}</div></td>
                <td><span class="type-badge">{ASSET_LABELS[g.asset_type] ?? g.asset_type}</span></td>
                <td><span class="cur-badge">{g.currency}</span></td>
                <td class="mono-sm">
                  <span style="color:var(--color-acc)">{g.open_count > 0 ? g.open_count + ' откр.' : ''}</span>
                  <span style="color:var(--color-t3);margin-left:4px">{g.closed_count > 0 ? g.closed_count + ' закр.' : ''}</span>
                </td>
                <td class="mono">{g.avg_entry_price > 0 ? fmtN(g.avg_entry_price, g.asset_type==='crypto'?6:2) : '—'}</td>
                <td class="mono">{g.total_shares > 0 ? fmtN(g.total_shares, g.asset_type==='crypto'?6:4) : '—'}</td>
                <td class="mono"><b>{fmtN(g.cost_basis)}</b></td>
                <td class="mono dim">{g.current_price ? fmtN(g.current_price, g.asset_type==='crypto'?6:2) : '—'}</td>
                <td class="mono">{g.current_value ? fmtN(g.current_value) : '—'}</td>
                <td class="mono bold" style="color:{pnlColor(g.unrealized_pnl)}">
                  {g.unrealized_pnl != null ? (g.unrealized_pnl>=0?'+':'')+fmtN(g.unrealized_pnl) : '—'}
                </td>
                <td class="mono" style="color:{pnlColor(g.realized_pnl)}">
                  {g.realized_pnl !== 0 ? (g.realized_pnl>=0?'+':'')+fmtN(g.realized_pnl) : '—'}
                </td>
                <td class="mono" style="color:{g.dividends>0?'var(--color-acc)':'inherit'}">
                  {g.dividends > 0 ? '+'+fmtN(g.dividends) : '—'}
                </td>
                <td class="mono bold" style="color:{pnlColor(g.total_pnl)}">
                  {g.total_pnl != null ? (g.total_pnl>=0?'+':'')+fmtN(g.total_pnl) : '—'}
                </td>
                <td class="mono" style="color:{pnlColor(g.total_pnl_pct)}">
                  {fmtPct(g.total_pnl_pct)}{g.current_price == null && g.open_count > 0 ? ' *' : ''}
                </td>
                <td class="acts">
                  <button onclick={() => { groupEditTicker = g.ticker; groupEditCur = g.currency; }} style="font-size:9px;padding:4px 8px">✎</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="tw">
        <table>
          <thead><tr>
            <th onclick={() => setSort('ticker')} class="s">{col('ticker','Тикер')}</th>
            <th>Тип</th>
            <th onclick={() => setSort('currency')} class="s">{col('currency','Валюта')}</th>
            <th onclick={() => setSort('entry_date')} class="s">{col('entry_date','Дата входа')}</th>
            <th onclick={() => setSort('entry_price')} class="s">{col('entry_price','Цена входа')}</th>
            <th onclick={() => setSort('shares')} class="s">{col('shares','Кол-во')}</th>
            <th onclick={() => setSort('cost_basis')} class="s">{col('cost_basis','Объём')}</th>
            <th onclick={() => setSort('current_price')} class="s">{col('current_price','Тек. цена')}</th>
            <th onclick={() => setSort('exit_date')} class="s">{col('exit_date','Дата выхода')}</th>
            <th onclick={() => setSort('exit_price')} class="s">{col('exit_price','Цена выхода')}</th>
            <th onclick={() => setSort('exit_date')} class="s">{col('exit_date','Дата выхода')}</th>
            <th onclick={() => setSort('pnl_net')} class="s">{col('pnl_net','P/L')}</th>
            <th onclick={() => setSort('pnl_pct')} class="s">{col('pnl_pct','Доход-ть')}</th>
            <th onclick={() => setSort('dividends')} class="s">{col('dividends','Дивид.')}</th>
            <th onclick={() => setSort('total_return')} class="s">{col('total_return','Итого')}</th>
            <th>Статус</th>
            <th></th>
          </tr></thead>
          <tbody>
            {#each filtered as inv (inv.id)}
              <tr class:row-closed={inv.is_closed}>
                <td>
                  <b>{inv.ticker}</b>
                  <div class="sub2">{inv.name ?? ''}</div>
                </td>
                <td><span class="type-badge">{ASSET_LABELS[inv.asset_type] ?? inv.asset_type}</span></td>
                <td><span class="cur-badge">{inv.currency}</span></td>
                <td class="mono">{inv.entry_date}</td>
                <td class="mono">{fmtN(inv.entry_price, inv.asset_type==='crypto'?6:2)}</td>
                <td class="mono">{fmtN(inv.shares, inv.asset_type==='crypto'?6:4)}</td>
                <td class="mono"><b>{fmtN(inv.cost_basis)}</b></td>
                <td class="mono dim">{inv.current_price ? fmtN(inv.current_price, inv.asset_type==='crypto'?6:2) : '—'}</td>
                <td class="mono" style="color:var(--color-t2)">{inv.exit_date ?? '—'}</td>
                <td class="mono">{inv.exit_price ? fmtN(inv.exit_price, inv.asset_type==='crypto'?6:2) : '—'}</td>
                <td class="mono">{inv.exit_date ?? '—'}</td>
                <td class="mono bold" style="color:{pnlColor(inv.pnl_net)}">
                  {inv.pnl_net != null ? (inv.pnl_net>=0?'+':'')+fmtN(inv.pnl_net) : '—'}
                </td>
                <td class="mono" style="color:{pnlColor(inv.pnl_pct)}">
                  {fmtPct(inv.pnl_pct)}
                  {#if !inv.is_closed && inv.current_price == null}<span class="sub2"> *</span>{/if}
                </td>
                <td class="mono" style="color:{inv.dividends>0?'var(--color-acc)':'inherit'}">
                  {inv.dividends > 0 ? '+'+fmtN(inv.dividends) : '—'}
                </td>
                <td class="mono bold" style="color:{pnlColor(inv.total_return)}">
                  {inv.total_return != null ? (inv.total_return>=0?'+':'')+fmtN(inv.total_return) : '—'}
                  {#if inv.total_return_pct != null}<div class="sub2">{fmtPct(inv.total_return_pct)}</div>{/if}
                </td>
                <td>
                  {#if inv.is_closed}
                    <span class="badge-closed">Закрыта</span>
                  {:else if inv.current_price != null}
                    <span class="badge-open">Открыта ✓</span>
                  {:else}
                    <span class="badge-open-nc">Открыта</span>
                  {/if}
                </td>
                <td class="acts">
                  <button onclick={() => editInv = inv} style="font-size:9px;padding:4px 8px">✎</button>
                  <button onclick={() => handleDelete(inv.id)} class="btn-r" style="font-size:9px;padding:4px 6px">×</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

{#if showAdd}
  <InvestmentForm onClose={() => showAdd = false} onSaved={load} />
{/if}
{#if editInv}
  <InvestmentForm editInvestment={editInv} onClose={() => editInv = null} onSaved={load} />
{/if}

{#if groupEditTicker}
  {@const positions = groupPositions(groupEditTicker, groupEditCur!)}
  <div class="mo-bg" onclick={() => groupEditTicker = null} role="presentation">
    <div class="mo-group" onclick={(e) => e.stopPropagation()} role="dialog">
      <div class="mo-head">
        <div>
          <b>{groupEditTicker}</b>
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--color-t2);margin-left:8px">{groupEditCur} · {positions.length} позиций</span>
        </div>
        <button onclick={() => groupEditTicker = null} class="cls">×</button>
      </div>
      <div class="mo-positions">
        {#each positions as inv (inv.id)}
          <div class="mo-pos-row" class:mo-pos-closed={inv.is_closed}>
            <div class="mo-pos-info">
              <span class="mono">{inv.entry_date}</span>
              <span class="mono" style="margin-left:12px">{fmtN(inv.shares, inv.asset_type==='crypto'?6:4)} шт. × {fmtN(inv.entry_price, inv.asset_type==='crypto'?6:2)}</span>
              <span class="mono" style="margin-left:12px;color:var(--color-t2)">= {fmtN(inv.cost_basis)}</span>
              {#if inv.is_closed}
                <span class="mono" style="margin-left:12px;color:var(--color-t3)">→ {fmtN(inv.exit_price ?? 0, inv.asset_type==='crypto'?6:2)} ({inv.exit_date})</span>
                <span class="mono" style="margin-left:8px;color:{pnlColor(inv.pnl_net)};font-weight:700">
                  {inv.pnl_net != null ? (inv.pnl_net>=0?'+':'')+fmtN(inv.pnl_net) : ''} ({fmtPct(inv.pnl_pct)})
                </span>
              {:else}
                <span class="badge-open" style="margin-left:12px;font-family:var(--font-mono);font-size:9px">Открыта</span>
                {#if inv.current_price}
                  <span class="mono" style="margin-left:8px;color:{pnlColor(inv.pnl_net)};font-weight:700">
                    {inv.pnl_net != null ? (inv.pnl_net>=0?'+':'')+fmtN(inv.pnl_net) : ''} ({fmtPct(inv.pnl_pct)})
                  </span>
                {/if}
              {/if}
            </div>
            <div class="mo-pos-acts">
              <button onclick={() => { groupEditTicker = null; editInv = inv; }} style="font-size:9px;padding:4px 10px">
                {inv.is_closed ? '✎ Редактировать' : '✎ Редактировать / Закрыть'}
              </button>
            </div>
          </div>
        {/each}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button onclick={() => { groupEditTicker = null; showAdd = true; }} class="btn-p" style="font-size:10px">+ Добавить покупку</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }

  /* Stats */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .stat-card { padding: 12px 14px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 10px; }
  .stat-cur { font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--color-acc); margin-bottom: 8px; letter-spacing: 1px; }
  .stat-rows { display: flex; flex-direction: column; gap: 4px; }
  .stat-row { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); }
  .stat-row b { color: var(--color-text); }
  .stat-foot { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--color-line); }

  /* Filters */
  .filters { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .filter-group { display: flex; gap: 6px; align-items: center; }
  .ftab { font-family: var(--font-mono); font-size: 10px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--color-line); background: var(--color-bg2); color: var(--color-t2); cursor: pointer; }
  .ftab-active { border-color: var(--color-acc); color: var(--color-acc); background: rgba(126,232,162,0.08); }
  .filter-count { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); margin-left: auto; }

  /* Table */
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .s { cursor: pointer; user-select: none; }
  .s:hover { color: var(--color-text); }
  .row-closed { opacity: 0.65; }
  .type-badge { font-family: var(--font-mono); font-size: 9px; padding: 2px 6px; border-radius: 4px; background: var(--color-bg3); color: var(--color-t2); }
  .cur-badge { font-family: var(--font-mono); font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: rgba(126,232,162,0.1); color: var(--color-acc); }
  .badge-closed    { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); }
  .badge-open      { font-family: var(--font-mono); font-size: 9px; color: var(--color-acc); }
  .badge-open-nc   { font-family: var(--font-mono); font-size: 9px; color: var(--color-acc3); }
  .acts { display: flex; gap: 4px; }
  .mono { font-family: var(--font-mono); font-size: 11px; }
  .mono-sm { font-family: var(--font-mono); font-size: 10px; }
  .bold { font-weight: 700; }
  .dim { color: var(--color-t2); }
  .sub2 { font-size: 9px; color: var(--color-t3); }
  .chk-group { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); cursor: pointer; padding: 5px 10px; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-bg2); }
  .chk-group input { width: auto; cursor: pointer; }
  .period-stats { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 14px; background: var(--color-bg2); border: 1px solid var(--color-acc); border-radius: 8px; margin-bottom: 12px; }
  .period-stats-title { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); width: 100%; margin-bottom: 2px; }
  .period-stat-item { display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; padding: 4px 10px; background: var(--color-bg3); border-radius: 6px; }
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo-group { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 700px; max-width: 100%; max-height: 80vh; overflow-y: auto; }
  .mo-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; font-size: 15px; font-weight: 700; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .mo-positions { display: flex; flex-direction: column; gap: 6px; }
  .mo-pos-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; background: var(--color-bg3); border: 1px solid var(--color-line); border-radius: 8px; flex-wrap: wrap; }
  .mo-pos-closed { opacity: 0.65; }
  .mo-pos-info { display: flex; align-items: center; flex-wrap: wrap; gap: 0; font-size: 11px; }
  .mo-pos-acts { flex-shrink: 0; }
</style>
