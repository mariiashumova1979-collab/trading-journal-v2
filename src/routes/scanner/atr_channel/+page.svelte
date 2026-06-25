<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import { listUniverse, deleteUniverse } from '$lib/data/atrUniverse';
  import type { ATRUniverseItem } from '$lib/data/atrUniverse';
  import type { Candidate } from '$lib/types';
  import WorkflowGuide from '$lib/components/WorkflowGuide.svelte';
  import ATRChForm from '$lib/components/ATRChForm.svelte';
  import TradeForm from '$lib/components/TradeForm.svelte';
  import UniverseForm from '$lib/components/UniverseForm.svelte';
  import ManualTradeForm from '$lib/components/ManualTradeForm.svelte';

  let tab = $state<'candidates' | 'universe'>('candidates');

  let candidates = $state<Candidate[]>([]);
  let universe   = $state<ATRUniverseItem[]>([]);
  let loading    = $state(true);
  let error      = $state<string | null>(null);
  let showAdd    = $state(false);
  let editCand   = $state<Candidate | null>(null);
  let tradeCand  = $state<Candidate | null>(null);
  // Universe
  let showUniAdd  = $state(false);
  let editUni     = $state<ATRUniverseItem | null>(null);
  let manualPrefill = $state<{ ticker?: string; ema200?: number | null; atr5?: number | null } | null>(null);
  let showManual  = $state(false);
  let t0Prefill   = $state<ATRUniverseItem | null>(null);
  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      const [c, u] = await Promise.all([
        listCandidates('atr_channel'),
        listUniverse()
      ]);
      candidates = c;
      universe = u;
      error = null;
    } catch (e: any) { error = e.message || String(e); }
    finally { loading = false; }
  }

  async function handleDeleteUni(id: string) {
    if (!confirm('Удалить инструмент из Universe?')) return;
    try { await deleteUniverse(id); load(); }
    catch (e: any) { alert('Ошибка: ' + e.message); }
  }

  function openT0FromUni(item: ATRUniverseItem) {
    t0Prefill = item;
    showAdd = true;
  }
  function openManualFromUni(item: ATRUniverseItem) {
    manualPrefill = { ticker: item.ticker, ema200: item.ema200, atr5: item.atr5 };
    showManual = true;
  }

  onMount(() => { load(); unsubscribe = subscribeCandidates('atr_channel', load); });
  onDestroy(() => { if (unsubscribe) unsubscribe(); });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try { await deleteCandidate(id); load(); }
    catch (e: any) { alert('Ошибка: ' + e.message); }
  }

  function statusLabel(s: string) {
    const m: Record<string, string> = {
      WAITING_D1: 'Ордер выставлен', READY_ENTRY: 'Ордер активен', ENTERED: 'В сделке',
      CLOSED: 'Закрыта', REJECTED: 'Отменён'
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
  function meta(c: Candidate) {
    const p = c.payload as any;
    return {
      dir: c.direction, close: p?.close, ema200: p?.ema200, atr5: p?.atr5,
      buyStop: p?.buy_stop, sellStop: p?.sell_stop
    };
  }
  const dirColor = (d: string | null) => d === 'LONG' ? 'var(--color-acc)' : d === 'SHORT' ? 'var(--color-acc2)' : 'var(--color-t3)';
</script>

<svelte:head>
  <title>ATR Channel Breakout · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>ATR Channel Breakout</h1>
      <p class="sub">Трендовый пробой канала ±0.75×ATR(5) · фильтр EMA200 · Long + Short · трейлинг без TP</p>
    </div>
    {#if tab === 'candidates'}
      <button class="btn-p" onclick={() => { t0Prefill = null; showAdd = true; }}>+ Добавить T0</button>
    {:else}
      <button class="btn-p" onclick={() => { editUni = null; showUniAdd = true; }}>+ Инструмент</button>
    {/if}
  </div>

  <div class="tabs-bar">
    <button class="tab-btn" class:tab-active={tab === 'candidates'} onclick={() => tab = 'candidates'}>
      Кандидаты ({candidates.length})
    </button>
    <button class="tab-btn" class:tab-active={tab === 'universe'} onclick={() => tab = 'universe'}>
      Universe ({universe.length})
    </button>
  </div>

  {#if tab === 'candidates'}
  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">Фильтр тренда</div>
      <div>Close &gt; EMA200 → только LONG</div>
      <div>Close &lt; EMA200 → только SHORT</div>
      <div>±0.5% от EMA200 → пропуск</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc3)">Вход (ордер 1 день)</div>
      <div>LONG: Buy Stop = Close + 0.75×ATR</div>
      <div>SHORT: Sell Stop = Close − 0.75×ATR</div>
      <div>Не сработал → пересчёт по новому Close</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">Стоп / Трейлинг</div>
      <div>Нач. стоп: Entry ∓ 2×ATR(5)</div>
      <div>Трейл: HH/LL ∓ 2×ATR (динамич.)</div>
      <div>Close пробил трейл → выход Open T+1</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">Выход / Пропуск</div>
      <div>EMA200 пробита → выход Open завтра</div>
      <div>TP нет · риск $100</div>
      <div>Пропуск: свеча &gt;2.5×ATR · earnings ≤2дн · флэт</div>
    </div>
  </div>

  <WorkflowGuide
    strategyId="atr_channel"
    sections={[
      {
        title: 'После закрытия рынка (после 23:00 EET)',
        steps: [
          'Обнови данные по каждой бумаге вотчлиста',
          'Проверь **Close vs EMA200** → определи разрешённое направление (LONG если выше, SHORT если ниже)',
          'Если цена в зоне **±0.5% от EMA200** — пропусти (флэт)',
          'Рассчитай ATR(5) → нажми **+ Добавить T0**: Close, EMA200, ATR(5) · опционально Range/Vol для проверки пропуска',
          'Система выдаст Buy Stop / Sell Stop + начальный стоп + размер позиции'
        ]
      },
      {
        title: 'Выставление ордера',
        steps: [
          '**LONG**: Buy Stop = Close + 0.75×ATR(5)',
          '**SHORT**: Sell Stop = Close − 0.75×ATR(5)',
          'Ордер действует **1 торговый день**',
          'Срабатывает если на следующей свече цена достигает уровня → нажми **+ Сделка**',
          'Не сработал → удали кандидата, пересчитай по новому Close завтра'
        ]
      },
      {
        title: 'Пропуск сделки — не брать если',
        steps: [
          'Свеча входа аномально длинная (&gt; 2.5×ATR)',
          'До earnings ≤ 2 торговых дня',
          'Гэп на открытии &gt; 2% ATR',
          'Цена в зоне ±0.5% от EMA200',
          'Объём ниже среднего 20-дневного',
          'Спред &gt; 0.1% от цены'
        ]
      },
      {
        title: 'Ежедневное управление позицией',
        steps: [
          'После закрытия: проверь **пересекла ли цена EMA200** → если да, выход на Open завтра (exit: `EMA200`)',
          'Обнови **Highest High / Lowest Low** с момента входа',
          'Пересчитай трейлинг: LONG = HH − 2×ATR · SHORT = LL + 2×ATR (ATR текущего дня, динамический)',
          'Если **Close пробил трейлинг** → выход на Open завтра (exit: `TRAILING`)',
          'Обнови стоп-ордер у брокера · TP не ставим — держим до пробоя трейлинга'
        ]
      }
    ]}
  />

  <div class="regime-note">
    <b>Метки выхода:</b> TRAILING (трейл пробит) · EMA200 (закрытие по другую сторону) · STOP (резкое движение) · MANUAL · <b>Записывай:</b> ATR at entry, EMA200 at entry, Trailing High/Low, текущий трейл-стоп
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">{error}</div>
  {:else if candidates.length === 0}
    <div class="state">Нет кандидатов. После закрытия рынка добавь сигналы через «+ Добавить T0».</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>T0 Date</th>
            <th>Dir</th>
            <th>Close</th>
            <th>EMA200</th>
            <th>ATR(5)</th>
            <th>Entry (Stop ордер)</th>
            <th>Нач. стоп</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const m = meta(c)}
            <tr>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td style="color:{dirColor(m.dir)};font-weight:700">{m.dir ?? '—'}</td>
              <td>{m.close !== undefined ? '$' + Number(m.close).toFixed(2) : '—'}</td>
              <td>{m.ema200 !== undefined ? Number(m.ema200).toFixed(2) : '—'}</td>
              <td>{m.atr5 !== undefined ? Number(m.atr5).toFixed(2) : '—'}</td>
              <td style="color:{dirColor(m.dir)}">{c.entry != null ? '$' + Number(c.entry).toFixed(2) : '—'}</td>
              <td style="color:var(--color-acc2)">{c.stop != null ? '$' + Number(c.stop).toFixed(2) : '—'}</td>
              <td><span style="color:{statusColor(c.status)}">{statusLabel(c.status)}</span></td>
              <td class="acts">
                {#if c.status !== 'ENTERED' && c.status !== 'CLOSED'}
                  <button onclick={() => (editCand = c)} style="font-size:9px;padding:4px 8px">✎</button>
                {/if}
                {#if c.status === 'READY_ENTRY' || c.status === 'WAITING_D1'}
                  <button class="btn-p" onclick={() => (tradeCand = c)} style="font-size:9px;padding:4px 8px">+ Сделка</button>
                {/if}
                <button class="btn-r" onclick={() => handleDelete(c.id)} style="font-size:9px;padding:4px 6px">×</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {:else}
    <!-- ── Universe ── -->
    <div class="uni-note">
      Список инструментов для отслеживания. Из строки можно завести <b>T0-сигнал</b> (расчёт по правилам) или <b>произвольную сделку</b> (ручной вход вне сигнала).
    </div>
    {#if loading}
      <div class="state">Загрузка...</div>
    {:else if universe.length === 0}
      <div class="state">Universe пуст. Нажми «+ Инструмент».</div>
    {:else}
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Название</th>
              <th>Сектор</th>
              <th>EMA200</th>
              <th>ATR(5)</th>
              <th>Заметки</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each universe as u (u.id)}
              <tr>
                <td><b>{u.ticker}</b></td>
                <td style="color:var(--color-t2)">{u.name ?? '—'}</td>
                <td>{#if u.sector}<span class="sector-badge">{u.sector}</span>{:else}—{/if}</td>
                <td>{u.ema200 != null ? Number(u.ema200).toFixed(2) : '—'}</td>
                <td>{u.atr5 != null ? Number(u.atr5).toFixed(2) : '—'}</td>
                <td style="color:var(--color-t3);font-size:9px;max-width:160px">{u.notes ?? ''}</td>
                <td class="acts">
                  <button class="btn-p" onclick={() => openT0FromUni(u)} style="font-size:9px;padding:4px 8px">+ T0</button>
                  <button onclick={() => openManualFromUni(u)} style="font-size:9px;padding:4px 8px">+ Сделка</button>
                  <button onclick={() => { editUni = u; showUniAdd = true; }} style="font-size:9px;padding:4px 8px">✎</button>
                  <button class="btn-r" onclick={() => handleDeleteUni(u.id)} style="font-size:9px;padding:4px 6px">×</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

{#if showAdd}<ATRChForm prefill={t0Prefill ? { ticker: t0Prefill.ticker, ema200: t0Prefill.ema200, atr5: t0Prefill.atr5 } : null} onClose={() => { showAdd = false; t0Prefill = null; }} onAdded={load} />{/if}
{#if showUniAdd}<UniverseForm editItem={editUni} onClose={() => { showUniAdd = false; editUni = null; }} onSaved={load} />{/if}
{#if showManual}<ManualTradeForm prefill={manualPrefill} onClose={() => { showManual = false; manualPrefill = null; }} onSaved={load} />{/if}
{#if editCand}<ATRChForm editCandidate={editCand} onClose={() => (editCand = null)} onAdded={load} />{/if}
{#if tradeCand}<TradeForm candidate={tradeCand} onClose={() => (tradeCand = null)} onSaved={load} />{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .regime-note { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 8px 12px; border: 1px solid rgba(155,89,182,0.3); background: rgba(155,89,182,0.05); border-radius: 6px; margin-bottom: 16px; }
  .regime-note b { color: #9b59b6; }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; min-width: 140px; }
  .tabs-bar { display: flex; gap: 6px; margin-bottom: 14px; }
  .tab-btn { font-family: var(--font-mono); font-size: 11px; padding: 7px 16px; border-radius: 6px; border: 1px solid var(--color-line); background: var(--color-bg2); color: var(--color-t2); cursor: pointer; }
  .tab-active { border-color: #9b59b6; color: #9b59b6; background: rgba(155,89,182,0.08); }
  .uni-note { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 14px; }
  .uni-note b { color: var(--color-text); }
  .sector-badge { font-family: var(--font-mono); font-size: 9px; padding: 2px 7px; border-radius: 4px; background: rgba(155,89,182,0.1); color: #9b59b6; }
</style>
