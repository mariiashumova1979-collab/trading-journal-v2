<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import type { Candidate } from '$lib/types';
  import WorkflowGuide from '$lib/components/WorkflowGuide.svelte';
  import GapForm from '$lib/components/GapForm.svelte';
  import GapD1Form from '$lib/components/GapD1Form.svelte';
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
      candidates = await listCandidates('gap_reversal');
      error = null;
    } catch (e: any) { error = e.message || String(e); }
    finally { loading = false; }
  }

  onMount(() => { load(); unsubscribe = subscribeCandidates('gap_reversal', load); });
  onDestroy(() => { if (unsubscribe) unsubscribe(); });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try { await deleteCandidate(id); load(); }
    catch (e: any) { alert('Ошибка: ' + e.message); }
  }

  function statusLabel(s: string) {
    const m: Record<string, string> = {
      WAITING_D1: 'Ждём D+1', READY_ENTRY: 'Готов вход',
      ENTERED: 'В сделке', CLOSED: 'Закрыта', REJECTED: 'Отклонён'
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
    const atrPct = p?.atr14 && p?.close_t0 ? p.atr14 / p.close_t0 * 100 : undefined;
    return {
      vix: p?.vix, regime: p?.market_regime ?? '—',
      atr14: p?.atr14, closeT0: p?.close_t0, sma50: p?.sma50,
      atrPct,
      check1700: p?.check_1700_exit
    };
  }
</script>

<svelte:head>
  <title>Gap Reversal 1 · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>Gap Reversal 1</h1>
      <p class="sub">Только LONG · восходящий тренд + gap down · вход на D+1 · time stop D+5</p>
    </div>
    <button class="btn-p" onclick={() => (showAdd = true)}>+ Добавить T0</button>
  </div>

  <div class="rules">
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc)">Watchlist T0</div>
      <div>Close &gt; SMA100</div>
      <div>SMA100 растёт (vs 20D)</div>
      <div>Price &gt; $20 · Cap &gt; $10B</div>
      <div>Vol &gt; 3M · Нет earnings 5дн</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc3)">Рынок</div>
      <div>SPY &gt; SMA200</div>
      <div>VIX &lt; 30</div>
      <div>Иначе LONG не торгуем</div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc4)">Gap D+1</div>
      <div>GapATR 1.0–2.0 (gap down)</div>
      <div>Open &gt; SMA50</div>
      <div>Entry = Open + 25% гэпа</div>
      <div>Stop = Entry − 1.5×ATR · Risk 1%</div>
      <div style="color:var(--color-acc2)"><b>StopDist/Entry &gt; 7% → ОТМЕНА</b></div>
    </div>
    <div class="rule-col">
      <div class="rule-h" style="color:var(--color-acc2)">Выход</div>
      <div>17:00 check: &lt; Entry −1.5% → выход</div>
      <div>T1: min(Close_T0, Entry+ATR), 50%</div>
      <div>T2: Entry + 2×ATR · стоп в BE</div>
      <div>Time stop D+5</div>
    </div>
  </div>

  <WorkflowGuide
    strategyId="gap_reversal"
    sections={[
      {
        title: 'Вечером T0 — Watchlist (15-20 мин)',
        steps: [
          'Скринер: US Stocks · Price > $20 · Cap > $10B · AvgVol > 3M',
          'Добавь SMA100 → оставь: **Close > SMA100** и **SMA100 сегодня > SMA100 20 дней назад**',
          'Проверь рынок: **SPY > SMA200** и **VIX < 30** (иначе завтра LONG не торгуем)',
          'Открой earnings calendar → удали акции с **earnings в ближайшие 5 дней**',
          'Останется ~10-50 акций · Нажми **+ Добавить T0** на каждой: SPY/VIX · Close T0 · SMA100 (сегодня + 20D назад) · SMA50 · ATR14',
          'Ничего не покупаем — ждём открытие завтра'
        ]
      },
      {
        title: 'Утром D+1 (16:00-16:25 EET)',
        steps: [
          'Для каждого кандидата нажми **D+1** → введи Open',
          '**GapATR** = (Close_T0 − Open) / ATR14 · нужен **1.0–2.0**',
          'Гэпы > 2 ATR = вероятно реальная переоценка, пропускаем',
          'Второе условие: **Open > SMA50** (гэп не ломает тренд)',
          '**ОБЯЗАТЕЛЬНО**: StopDistance / Entry **> 7% → СДЕЛКА ОТМЕНЯЕТСЯ** (отдельная строка чек-листа, система проверяет автоматически)',
          '🟢 Все 3 чека прошли → Buy Limit, Stop, T1/T2 рассчитаны · 🔴 Любой не прошёл → REJECTED',
          'Обычно остаётся 1-5 акций'
        ]
      },
      {
        title: 'Открытие (16:30 EET) — Вход',
        steps: [
          '**Вариант B**: Buy Limit = Open + 25% величины гэпа',
          'Часто в 16:30-17:00 идёт ещё один пролив — лимитка ловит лучшую цену',
          'Нажми **+ Сделка** → выставь Buy Limit ордер в Freedom24',
          'Если за первые 30 минут цену не дали → сделка отменяется'
        ]
      },
      {
        title: 'Проверка 17:00 (через 30 мин) — КЛЮЧЕВОЕ',
        steps: [
          'Нажми **D+1 → вкладка "Проверка 17:00"** → введи текущую цену',
          '🔴 Если цена **< Entry × 0.985** (падение > 1.5%) → **выйти сразу**',
          'Это защита: не gap reversal, а начало обвала',
          '🟢 Если проверка пройдена → держим дальше'
        ]
      },
      {
        title: 'Удержание D+2..D+5',
        steps: [
          'Проверяем только стоп и цели (5 мин вечером)',
          '**T1** = min(полное закрытие гэпа = Close_T0, Entry + ATR) → закрой 50%, стоп в BE',
          '**T2** = Entry + 2×ATR → закрой остаток',
          '**Time stop**: на закрытии D+5 закрыть всё'
        ]
      }
    ]}
  />

  <div class="regime-note">
    <b>Журнал edge:</b> записывай GapATR · размер гэпа % · сектор · VIX · % гэпа закрытого за 5 дней — через 30-50 сделок станет виден реальный edge
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">{error}</div>
  {:else if candidates.length === 0}
    <div class="state">Нет кандидатов. Вечером после закрытия добавь watchlist через «+ Добавить T0».</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>T0 Date</th>
            <th>SPY/VIX</th>
            <th>Close T0</th>
            <th>SMA50</th>
            <th>ATR14</th>
            <th>ATRp</th>
            <th>Entry</th>
            <th>Stop</th>
            <th>T1</th>
            <th>T2</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const m = meta(c)}
            <tr class:row-adverse={m.check1700}>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td style="color:{m.regime === 'OK' ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.regime}{m.vix !== undefined ? ` · VIX ${Number(m.vix).toFixed(0)}` : ''}</td>
              <td>{m.closeT0 !== undefined ? '$' + Number(m.closeT0).toFixed(2) : '—'}</td>
              <td>{m.sma50 !== undefined ? Number(m.sma50).toFixed(2) : '—'}</td>
              <td>{m.atr14 !== undefined ? Number(m.atr14).toFixed(2) : '—'}</td>
              <td style="color:var(--color-t2)">{m.atrPct !== undefined ? m.atrPct.toFixed(1) + '%' : '—'}</td>
              <td style="color:var(--color-acc)">{c.entry != null ? '$' + Number(c.entry).toFixed(2) : '—'}</td>
              <td style="color:var(--color-acc2)">{c.stop != null ? '$' + Number(c.stop).toFixed(2) : '—'}</td>
              <td>{c.target1 != null ? '$' + Number(c.target1).toFixed(2) : '—'}</td>
              <td>{c.target2 != null ? '$' + Number(c.target2).toFixed(2) : '—'}</td>
              <td>
                <span style="color:{statusColor(c.status)}">{statusLabel(c.status)}</span>
                {#if m.check1700}<span style="color:var(--color-acc2);font-size:9px;display:block">⚠ 17:00 exit</span>{/if}
              </td>
              <td class="acts">
                {#if c.status !== 'ENTERED' && c.status !== 'CLOSED' && c.status !== 'REJECTED'}
                  <button onclick={() => (editCand = c)} style="font-size:9px;padding:4px 8px">✎</button>
                {/if}
                {#if c.status === 'WAITING_D1'}
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">D+1</button>
                {/if}
                {#if c.status === 'READY_ENTRY'}
                  <button class="btn-p" onclick={() => (tradeCand = c)} style="font-size:9px;padding:4px 8px">+ Сделка</button>
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">17:00</button>
                {/if}
                {#if c.status === 'ENTERED'}
                  <button onclick={() => (d1Cand = c)} style="font-size:9px;padding:4px 8px">17:00</button>
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

{#if showAdd}<GapForm onClose={() => (showAdd = false)} onAdded={load} />{/if}
{#if editCand}<GapForm editCandidate={editCand} onClose={() => (editCand = null)} onAdded={load} />{/if}
{#if d1Cand}<GapD1Form candidate={d1Cand} onClose={() => (d1Cand = null)} onUpdated={load} />{/if}
{#if tradeCand}<TradeForm candidate={tradeCand} onClose={() => (tradeCand = null)} onSaved={load} />{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); line-height: 1.8; }
  .rule-col { padding: 10px 12px; background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 8px; }
  .rule-h { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .regime-note { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); padding: 8px 12px; border: 1px solid rgba(126,232,162,0.2); background: rgba(126,232,162,0.05); border-radius: 6px; margin-bottom: 16px; }
  .regime-note b { color: var(--color-acc); }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; min-width: 160px; }
  .row-adverse { background: rgba(255,107,138,0.06); }
</style>
