<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, subscribeCandidates, deleteCandidate } from '$lib/data/candidates';
  import { listTrades } from '$lib/data/trades';
  import { getMarketHolidays, isWeekend } from '$lib/utils/marketHolidays';
  import type { Candidate, Trade, Strategy } from '$lib/types';
  import { STRATEGIES } from '$lib/types';

  // Forms
  import TradeForm        from '$lib/components/TradeForm.svelte';
  import TradeEditForm    from '$lib/components/TradeEditForm.svelte';
  import D1Form           from '$lib/components/D1Form.svelte';
  import IBSD1Form        from '$lib/components/IBSD1Form.svelte';
  import NR7D1Form        from '$lib/components/NR7D1Form.svelte';
  import EventD1Form      from '$lib/components/EventD1Form.svelte';
  import PostEventGapD1Form from '$lib/components/PostEventGapD1Form.svelte';
  import GapD1Form from '$lib/components/GapD1Form.svelte';

  // ─── State ───
  let loading   = $state(true);
  let error     = $state<string|null>(null);
  let candidates = $state<Candidate[]>([]);
  let trades    = $state<Trade[]>([]);

  // Active forms
  let tradeCand    = $state<Candidate|null>(null);
  let editTrade    = $state<Trade|null>(null);
  let d1Cand       = $state<Candidate|null>(null);
  let d1FormType   = $state<Strategy|null>(null);

  let unsubs: (() => void)[] = [];

  // ─── NYSE trading days util ───
  function tradingDaysBetween(from: string, to: string): number {
    if (!from || !to) return 0;
    const start = new Date(from + 'T12:00:00Z');
    const end   = new Date(to   + 'T12:00:00Z');
    if (end <= start) return 0;

    const years = new Set([start.getUTCFullYear(), end.getUTCFullYear()]);
    const holidays = new Set<string>();
    for (const y of years) getMarketHolidays(y).forEach(h => holidays.add(h));

    let count = 0;
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + 1);
    while (d <= end) {
      const s = d.toISOString().split('T')[0];
      if (!isWeekend(d) && !holidays.has(s)) count++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return count;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // ─── Load ───
  async function load() {
    try {
      const strategies: Strategy[] = ['impulse','max_weekly','ibs_swing','event_continuation','pead','nr7','gap_reversal'];
      const candArrays = await Promise.all(strategies.map(s => listCandidates(s)));
      candidates = candArrays.flat().filter(c =>
        ['WAITING_OPEN','WAITING_D1','READY_ENTRY','ENTERED'].includes(c.status)
      );
      trades = (await listTrades({ status: 'OPEN' }));
      error = null;
    } catch(e: any) { error = e.message; }
    finally { loading = false; }
  }

  onMount(() => {
    load();
    const strategies: Strategy[] = ['impulse','max_weekly','ibs_swing','event_continuation','pead','nr7','gap_reversal'];
    strategies.forEach(s => {
      unsubs.push(subscribeCandidates(s, load));
    });
  });
  onDestroy(() => unsubs.forEach(u => u()));

  // ─── Action classification ───
  interface TodayItem {
    kind:   'candidate' | 'trade';
    when:   'morning' | 'evening' | 'watch';
    urgent: boolean;
    candidate?: Candidate;
    trade?: Trade;
    strategy: Strategy;
    ticker: string;
    direction: string;
    dayN: number;           // день в цикле (1 = D+1, 2 = D+2, ...)
    daysLeft: number;       // дней до time stop
    trigger?: string;       // цена триггера
    action: string;         // что делать
    hint: string;           // детали
    timeLabel?: string;     // "15:45 EST", "22:45 EET" и т.д.
  }

  function buildItems(cands: Candidate[], trds: Trade[]): TodayItem[] {
    const items: TodayItem[] = [];

    // ─── Кандидаты ───
    for (const c of cands) {
      const p = c.payload as any;
      const atr = p?.atr14 || p?.atr || 0;
      const dayN = c.signal_date ? tradingDaysBetween(c.signal_date, todayStr) : 0;
      const dir = c.direction ?? '—';
      const entry = c.entry != null ? Number(c.entry) : null;
      const stop  = c.stop  != null ? Number(c.stop)  : null;

      let when: 'morning'|'evening'|'watch' = 'watch';
      let action = '', hint = '', trigger: string|undefined, urgent = false, timeLabel: string|undefined;
      const timeStop = c.strategy === 'max_weekly' && dir === 'LONG' ? 3
                     : c.strategy === 'max_weekly' && dir === 'SHORT' ? 5
                     : c.strategy === 'ibs_swing' ? 5
                     : 5;
      const daysLeft = timeStop - dayN;

      if (c.strategy === 'max_weekly') {
        if (c.status === 'WAITING_OPEN') {
          const mwp = p as any;
          const cancelThresh = mwp?.gap_cancel_threshold;
          when = 'morning';
          urgent = true;
          action = dir === 'LONG' ? 'Market-at-Open LONG' : 'Market-at-Open SHORT';
          trigger = entry != null ? `Entry ~$${entry.toFixed(2)}` : 'Открой + введи Open';
          hint = cancelThresh
            ? `Gap cancel: ${dir === 'SHORT' ? 'Open ≥' : 'Open ≤'} $${Number(cancelThresh).toFixed(2)}`
            : 'Проверь gap перед входом';
          timeLabel = 'На открытии';
        } else if (c.status === 'ENTERED' && dayN === 1) {
          when = 'evening';
          urgent = true;
          timeLabel = '22:45 EET';
          if (dir === 'LONG') {
            action = 'D+1 EOD exit check (LONG)';
            hint = `Если Close ≤ Entry или красная свеча → закрыть позицию`;
          } else {
            action = 'D+1 EOD trail stop (SHORT)';
            hint = `Если Close ≥ Entry → стоп = Close × 1.01`;
          }
        }
      }

      else if (c.strategy === 'impulse') {
        if (c.status === 'WAITING_D1') {
          when = 'evening';
          action = 'Ввести D+1 данные';
          hint = 'OHLCV D+1 → проверка паттерна (Inside Day / Weak Pullback / Compression)';
          timeLabel = 'После закрытия';
        } else if (c.status === 'READY_ENTRY') {
          when = 'morning';
          urgent = true;
          const entryStr = entry != null ? `$${entry.toFixed(2)}` : '—';
          const stopStr  = stop  != null ? `$${stop.toFixed(2)}`  : '—';
          action = dir === 'LONG' ? `Buy Stop ${entryStr}` : `Sell Stop ${entryStr}`;
          trigger = entryStr;
          hint = `Stop: ${stopStr} · T1: +1R · T2: +2R · Time stop D+5`;
          timeLabel = 'На открытии';
        }
      }

      else if (c.strategy === 'ibs_swing') {
        if (c.status === 'WAITING_D1') {
          when = 'morning';
          urgent = true;
          const closeT0 = p?.d0?.C;
          const cancelPrice = closeT0
            ? `$${(closeT0 * (dir === 'LONG' ? 1.02 : 0.98)).toFixed(2)}`
            : '—';
          action = 'Gap check + Market-at-Open';
          trigger = closeT0 ? `Entry ~$${closeT0.toFixed(2)} (Open)` : 'Open D+1';
          hint = `Gap cancel: ${dir === 'LONG' ? `Open ≥ ${cancelPrice}` : `Open ≤ ${cancelPrice}`} · Иначе → Market at Open`;
          timeLabel = 'На открытии';
        } else if (c.status === 'READY_ENTRY') {
          when = 'morning';
          urgent = true;
          const entryStr = entry != null ? `$${entry.toFixed(2)}` : '—';
          action = `Market-at-Open ${entryStr}`;
          trigger = entryStr;
          hint = `Stop: ${stop != null ? '$'+stop.toFixed(2) : '—'} · Risk 1% · T1: +1×ATR · T2: +2×ATR`;
          timeLabel = 'На открытии';
        } else if (c.status === 'ENTERED' && dayN <= 2) {
          when = 'evening';
          action = 'D+1 Adverse check';
          hint = `Если High−Entry < 0.5×ATR (${atr > 0 ? '$'+(0.5*atr).toFixed(2) : '—'}) → закрыть по Close`;
          timeLabel = 'После закрытия';
        }
      }

      else if (c.strategy === 'nr7') {
        if (c.status === 'WAITING_D1') {
          when = 'morning';
          urgent = true;
          const entryStr = entry != null ? `$${entry.toFixed(2)}` : '—';
          action = dir === 'LONG' ? `Buy Stop ${entryStr}` : `Sell Stop ${entryStr}`;
          trigger = entryStr;
          hint = `Ордер действует только сегодня · Отмена в 15:45 EST если не сработал`;
          timeLabel = '15:45 EST (отмена)';
        } else if (c.status === 'ENTERED' && dayN <= 3) {
          when = 'evening';
          action = 'D+2 Adverse check';
          hint = `${dir === 'LONG' ? 'Close ≤ Entry' : 'Close ≥ Entry'} → закрыть позицию по Close`;
          timeLabel = 'После закрытия';
        }
      }

      else if (c.strategy === 'event_continuation') {
        if (c.status === 'WAITING_D1') {
          when = 'evening';
          action = 'Ввести D+1 Compression данные';
          hint = `Vol ≤ 0.7×D0 · Low D1 > Mid D0 · Close D1 > Mid D0 · Midpoint: $${p?.d0 ? ((p.d0.H+p.d0.L)/2).toFixed(2) : '—'}`;
          timeLabel = 'После закрытия';
        } else if (c.status === 'READY_ENTRY') {
          when = 'morning';
          urgent = true;
          const entryStr = entry != null ? `$${entry.toFixed(2)}` : '—';
          action = dir === 'LONG' ? `Buy Stop ${entryStr}` : `Sell Stop ${entryStr}`;
          trigger = entryStr;
          hint = `Stop: ${stop != null ? '$'+stop.toFixed(2) : '—'} · Risk/ATR ≤ 1.2 · T1: +1R · T2: +3R`;
          timeLabel = 'На открытии';
        }
      }

      else if (c.strategy === 'pead') {
        if (c.status === 'WAITING_D1') {
          when = 'evening';
          action = 'Ввести D+1 Compression данные';
          hint = `Vol ≤ 0.70× · Range ≤ 0.75× · Retrace ≤ 35% · Score ≥ 2`;
          timeLabel = 'После закрытия';
        } else if (c.status === 'READY_ENTRY') {
          when = 'morning';
          urgent = true;
          const entryStr = entry != null ? `$${entry.toFixed(2)}` : '—';
          action = dir === 'LONG' ? `Buy Stop ${entryStr}` : `Sell Stop ${entryStr}`;
          trigger = entryStr;
          hint = `Stop: ${stop != null ? '$'+stop.toFixed(2) : '—'} · T1: +1.5R (50%) · T2: +2.2R`;
          timeLabel = 'На открытии';
        }
      }

      else if (c.strategy === 'gap_reversal') {
        if (c.status === 'WAITING_D1') {
          when = 'morning';
          urgent = true;
          const closeT0v = p?.close_t0;
          action = 'Gap check + Buy Limit';
          trigger = closeT0v ? `Close_T0 $${Number(closeT0v).toFixed(2)}` : 'Введи Open D+1';
          hint = `GapATR 1.0–2.0 · Open > SMA50 (${p?.sma50 ? Number(p.sma50).toFixed(2) : '—'}) · Buy Limit = Open + 25% гэпа`;
          timeLabel = '16:00-16:25 EET';
        } else if (c.status === 'READY_ENTRY') {
          when = 'morning';
          urgent = true;
          const entryStr = entry != null ? `$${entry.toFixed(2)}` : '—';
          action = `Buy Limit ${entryStr}`;
          trigger = entryStr;
          hint = `Stop: ${stop != null ? '$'+stop.toFixed(2) : '—'} · ⚠ 17:00 check: выход если < Entry −1.5% · Лимитка 30 мин`;
          timeLabel = 'Открытие 16:30';
        } else if (c.status === 'ENTERED' && dayN === 0) {
          when = 'morning';
          urgent = true;
          action = '⚠ Проверка 17:00 (30 мин)';
          hint = `Если цена < Entry × 0.985 → выйти (обвал, не reversal)`;
          timeLabel = '17:00 EET';
        }
      }

      if (when === 'watch' && !action) {
        if (c.status === 'WAITING_D1') {
          when = 'evening'; action = 'Ввести D+1 данные'; hint = 'Данные закрытия дня';
        } else if (c.status === 'READY_ENTRY') {
          when = 'morning'; urgent = true; action = 'Войти в рынок';
          trigger = entry != null ? `$${entry.toFixed(2)}` : '—';
          hint = `Stop: ${stop != null ? '$'+stop.toFixed(2) : '—'}`;
        }
      }

      items.push({
        kind: 'candidate', when, urgent,
        candidate: c, strategy: c.strategy,
        ticker: c.ticker, direction: dir,
        dayN, daysLeft, trigger, action, hint, timeLabel
      });
    }

    // ─── Открытые сделки ───
    for (const t of trds) {
      const dayN = t.entry_date ? tradingDaysBetween(t.entry_date, todayStr) : 0;
      const s = t.strategy;
      const dir = t.type;
      const entry = t.entry != null ? Number(t.entry) : 0;
      const atr   = t.atr_abs != null ? Number(t.atr_abs) : 0;

      const timeStop = s === 'max_weekly' && dir === 'LONG' ? 3
                     : s === 'max_weekly' && dir === 'SHORT' ? 5
                     : 5;
      const daysLeft = timeStop - dayN;

      let when: 'morning'|'evening'|'watch' = 'watch';
      let action = '', hint = '', trigger: string|undefined, urgent = false, timeLabel: string|undefined;

      if (daysLeft <= 0) {
        when = 'morning'; urgent = true;
        action = '⏰ TIME STOP — закрыть сейчас';
        hint = `D+${timeStop} истёк · Закрыть по рынку MOC`;
        timeLabel = 'MOC';
      } else if (daysLeft === 1) {
        when = 'morning'; urgent = true;
        action = `⏰ Завтра Time stop (D+${timeStop})`;
        hint = `Последний торговый день · Закрыть по MOC`;
      } else if (s === 'max_weekly' && dayN === 1 && dir === 'LONG') {
        when = 'evening'; urgent = true;
        timeLabel = '22:45 EET';
        action = 'D+1 EOD exit check (LONG)';
        hint = `Если Close ≤ $${entry.toFixed(2)} или красная свеча → закрыть всё`;
      } else if (s === 'max_weekly' && dayN === 1 && dir === 'SHORT') {
        when = 'evening'; urgent = true;
        timeLabel = '22:45 EET';
        action = 'D+1 EOD trail stop (SHORT)';
        hint = `Если Close ≥ $${entry.toFixed(2)} → стоп = Close × 1.01`;
      } else if (s === 'ibs_swing' && dayN <= 1 && atr > 0) {
        when = 'evening';
        action = 'D+1 Adverse check';
        hint = `High−Entry < 0.5×ATR ($${(0.5*atr).toFixed(2)}) → закрыть по Close`;
        timeLabel = 'После закрытия';
      } else if (s === 'nr7' && dayN === 2) {
        when = 'evening';
        action = 'D+2 Adverse check';
        hint = `${dir === 'LONG' ? 'Close ≤' : 'Close ≥'} Entry $${entry.toFixed(2)} → закрыть`;
        timeLabel = 'После закрытия';
      } else {
        when = 'watch';
        const t1 = t.target1 != null ? `$${Number(t.target1).toFixed(2)}` : '—';
        const stop = t.stop != null ? `$${Number(t.stop).toFixed(2)}` : '—';
        action = `D+${dayN} · ${daysLeft} дн. до time stop`;
        hint = `Entry $${entry.toFixed(2)} · Stop ${stop} · T1 ${t1}`;
        if (t.partial_exit) hint += ' · T1 hit, стоп в BE';
      }

      items.push({
        kind: 'trade', when, urgent,
        trade: t, strategy: t.strategy,
        ticker: t.ticker, direction: dir,
        dayN, daysLeft, trigger, action, hint, timeLabel
      });
    }

    return items;
  }

  const allItems = $derived(buildItems(candidates, trades));
  const morningItems = $derived(allItems.filter(i => i.when === 'morning').sort((a,b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)));
  const eveningItems = $derived(allItems.filter(i => i.when === 'evening').sort((a,b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)));
  const watchItems   = $derived(allItems.filter(i => i.when === 'watch'));

  // ─── Helpers ───
  function stratColor(s: Strategy) { return STRATEGIES[s]?.color ?? '#888'; }
  function stratName(s: Strategy)  { return STRATEGIES[s]?.name  ?? s; }
  function dirColor(d: string)     { return d === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'; }

  function openD1Form(c: Candidate) {
    d1Cand = c;
    d1FormType = c.strategy;
  }
</script>

<svelte:head>
  <title>Сегодня · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>📅 Сегодня</h1>
      <p class="sub">{new Date().toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</p>
    </div>
    <div class="stats-row">
      {#if morningItems.length > 0}
        <span class="badge badge-morning">{morningItems.length} утром</span>
      {/if}
      {#if eveningItems.length > 0}
        <span class="badge badge-evening">{eveningItems.length} вечером</span>
      {/if}
      {#if watchItems.length > 0}
        <span class="badge badge-watch">{watchItems.length} наблюдать</span>
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if allItems.length === 0}
    <div class="empty">
      <div class="empty-icon">✓</div>
      <div>Нет активных кандидатов и открытых сделок</div>
      <div class="empty-sub">Добавь кандидатов через страницы стратегий</div>
    </div>
  {:else}

    <!-- ── УТРОМ ── -->
    {#if morningItems.length > 0}
      <div class="section-h">🌅 Утром · действия на открытии рынка</div>
      <div class="cards">
        {#each morningItems as item (item.kind + (item.candidate?.id ?? item.trade?.id))}
          <div class="card" class:card-urgent={item.urgent}>
            <div class="card-top">
              <span class="ticker">{item.ticker}</span>
              <span class="dir" style="color:{dirColor(item.direction)}">{item.direction}</span>
              <span class="strat-badge" style="background:{stratColor(item.strategy)}22;color:{stratColor(item.strategy)};border-color:{stratColor(item.strategy)}44">{stratName(item.strategy)}</span>
              <span class="dayn">D+{item.dayN}</span>
              {#if item.daysLeft <= 1 && item.kind === 'trade'}
                <span class="time-warn">⏰ Time stop!</span>
              {/if}
              <span class="ml-auto"></span>
              {#if item.timeLabel}
                <span class="time-label">{item.timeLabel}</span>
              {/if}
            </div>

            <div class="action">{item.action}</div>

            {#if item.trigger}
              <div class="trigger">
                <span class="trigger-label">Цена входа</span>
                <span class="trigger-val">{item.trigger}</span>
              </div>
            {/if}

            <div class="hint">{item.hint}</div>

            <div class="card-acts">
              {#if item.kind === 'candidate' && item.candidate}
                {#if item.candidate.status === 'READY_ENTRY' || item.candidate.status === 'WAITING_OPEN'}
                  <button class="btn-p" onclick={() => tradeCand = item.candidate!} style="font-size:10px">
                    + Открыть сделку
                  </button>
                {:else if item.candidate.status === 'WAITING_D1'}
                  <button onclick={() => openD1Form(item.candidate!)} style="font-size:10px">
                    + D+1 данные
                  </button>
                {/if}
              {:else if item.kind === 'trade' && item.trade}
                <button onclick={() => editTrade = item.trade!} style="font-size:10px">
                  Управление
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- ── ВЕЧЕРОМ ── -->
    {#if eveningItems.length > 0}
      <div class="section-h">🌆 Вечером · после закрытия рынка</div>
      <div class="cards">
        {#each eveningItems as item (item.kind + (item.candidate?.id ?? item.trade?.id))}
          <div class="card" class:card-urgent={item.urgent}>
            <div class="card-top">
              <span class="ticker">{item.ticker}</span>
              <span class="dir" style="color:{dirColor(item.direction)}">{item.direction}</span>
              <span class="strat-badge" style="background:{stratColor(item.strategy)}22;color:{stratColor(item.strategy)};border-color:{stratColor(item.strategy)}44">{stratName(item.strategy)}</span>
              <span class="dayn">D+{item.dayN}</span>
              <span class="ml-auto"></span>
              {#if item.timeLabel}
                <span class="time-label time-label-eve">{item.timeLabel}</span>
              {/if}
            </div>

            <div class="action">{item.action}</div>
            <div class="hint">{item.hint}</div>

            <div class="card-acts">
              {#if item.kind === 'candidate' && item.candidate}
                {#if item.candidate.status === 'WAITING_D1'}
                  <button class="btn-p" onclick={() => openD1Form(item.candidate!)} style="font-size:10px">
                    Ввести D+1
                  </button>
                {/if}
              {:else if item.kind === 'trade' && item.trade}
                <button onclick={() => editTrade = item.trade!} style="font-size:10px">
                  Управление
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- ── НАБЛЮДАТЬ ── -->
    {#if watchItems.length > 0}
      <div class="section-h">👀 Наблюдать · открытые позиции</div>
      <div class="watch-list">
        {#each watchItems as item (item.kind + (item.candidate?.id ?? item.trade?.id))}
          <div class="watch-row">
            <span class="ticker">{item.ticker}</span>
            <span class="dir" style="color:{dirColor(item.direction)}">{item.direction}</span>
            <span class="strat-badge" style="background:{stratColor(item.strategy)}22;color:{stratColor(item.strategy)};border-color:{stratColor(item.strategy)}44">{stratName(item.strategy)}</span>
            <span class="dayn">D+{item.dayN}</span>
            <span class="watch-hint">{item.hint}</span>
            <span class="ml-auto"></span>
            {#if item.kind === 'trade' && item.trade}
              <button onclick={() => editTrade = item.trade!} style="font-size:9px;padding:3px 8px">
                Управление
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

  {/if}
</div>

<!-- Модальные формы -->
{#if tradeCand}
  <TradeForm candidate={tradeCand} onClose={() => tradeCand = null} onSaved={load} />
{/if}
{#if editTrade}
  <TradeEditForm trade={editTrade} onClose={() => editTrade = null} onSaved={load} />
{/if}

{#if d1Cand && d1FormType === 'impulse'}
  <D1Form candidate={d1Cand} onClose={() => { d1Cand = null; d1FormType = null; }} onUpdated={load} />
{:else if d1Cand && d1FormType === 'ibs_swing'}
  <IBSD1Form candidate={d1Cand} onClose={() => { d1Cand = null; d1FormType = null; }} onUpdated={load} />
{:else if d1Cand && d1FormType === 'nr7'}
  <NR7D1Form candidate={d1Cand} onClose={() => { d1Cand = null; d1FormType = null; }} onUpdated={load} />
{:else if d1Cand && d1FormType === 'event_continuation'}
  <EventD1Form candidate={d1Cand} onClose={() => { d1Cand = null; d1FormType = null; }} onUpdated={load} />
{:else if d1Cand && (d1FormType === 'pead')}
  <PostEventGapD1Form candidate={d1Cand} onClose={() => { d1Cand = null; d1FormType = null; }} onUpdated={load} />
{:else if d1Cand && d1FormType === 'gap_reversal'}
  <GapD1Form candidate={d1Cand} onClose={() => { d1Cand = null; d1FormType = null; }} onUpdated={load} />
{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  h1 { font-size: 24px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .stats-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .badge { font-family: var(--font-mono); font-size: 10px; padding: 4px 10px; border-radius: 20px; font-weight: 700; }
  .badge-morning { background: rgba(255,200,90,0.15); color: var(--color-acc3); border: 1px solid rgba(255,200,90,0.3); }
  .badge-evening { background: rgba(106,183,255,0.15); color: var(--color-acc4); border: 1px solid rgba(106,183,255,0.3); }
  .badge-watch   { background: rgba(126,232,162,0.1); color: var(--color-t2); border: 1px solid var(--color-line); }

  .state { padding: 40px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); }
  .err { color: var(--color-acc2); }
  .empty { padding: 60px 20px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 13px; }
  .empty-icon { font-size: 48px; margin-bottom: 12px; color: var(--color-acc); }
  .empty-sub { font-size: 11px; color: var(--color-t3); margin-top: 6px; }

  .section-h { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--color-t2); padding: 10px 0 8px; margin-top: 8px; border-bottom: 1px solid var(--color-line); margin-bottom: 12px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; margin-bottom: 24px; }

  .card { padding: 14px; border: 1px solid var(--color-line); border-radius: 10px; background: var(--color-bg2); }
  .card-urgent { border-color: rgba(255,200,90,0.4); background: rgba(255,200,90,0.04); }

  .card-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .ticker { font-size: 16px; font-weight: 700; }
  .dir { font-family: var(--font-mono); font-size: 11px; font-weight: 700; }
  .strat-badge { font-family: var(--font-mono); font-size: 9px; padding: 2px 7px; border-radius: 10px; border: 1px solid; }
  .dayn { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); background: var(--color-bg3); padding: 2px 6px; border-radius: 4px; }
  .time-warn { font-family: var(--font-mono); font-size: 9px; color: var(--color-acc2); font-weight: 700; }
  .time-label { font-family: var(--font-mono); font-size: 9px; color: var(--color-acc3); background: rgba(255,200,90,0.1); padding: 2px 7px; border-radius: 4px; }
  .time-label-eve { color: var(--color-acc4); background: rgba(106,183,255,0.1); }
  .ml-auto { margin-left: auto; }

  .action { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--color-text); margin-bottom: 6px; }
  .trigger { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .trigger-label { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); text-transform: uppercase; }
  .trigger-val { font-family: var(--font-mono); font-size: 16px; font-weight: 700; color: var(--color-acc); }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.6; margin-bottom: 10px; }

  .card-acts { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--color-line); }

  /* Watch list */
  .watch-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 24px; }
  .watch-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; flex-wrap: wrap; }
  .watch-hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); flex: 1; }

  @media (max-width: 600px) { .cards { grid-template-columns: 1fr; } }
</style>
