<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import { calculatePosition } from '$lib/strategies/impulse';
  import type { Candidate } from '$lib/types';
  import WorkflowGuide from '$lib/components/WorkflowGuide.svelte';
  import ImpulseForm from '$lib/components/ImpulseForm.svelte';
  import D1Form from '$lib/components/D1Form.svelte';
  import TradeForm from '$lib/components/TradeForm.svelte';

  let candidates = $state<Candidate[]>([]);
  let showAddForm = $state(false);
  let editCand = $state<Candidate | null>(null);
  let d1Candidate = $state<Candidate | null>(null);
  let tradeCandidate = $state<Candidate | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      candidates = await listCandidates('impulse');
      error = null;
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    unsubscribe = subscribeCandidates('impulse', () => load());
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try {
      await deleteCandidate(id);
      candidates = candidates.filter((c) => c.id !== id);
    } catch (e: any) {
      alert('Ошибка удаления: ' + e.message);
    }
  }

  function statusLabel(s: string) {
    const map: Record<string, string> = {
      WAITING_D1: 'Ждём D+1',
      READY_ENTRY: 'Готов вход',
      WAITING_OPEN: 'Ждём Open',
      GAP_CANCEL: 'Gap отмена',
      ENTERED: 'В сделке',
      CLOSED: 'Закрыта',
      REJECTED: 'Отклонён'
    };
    return map[s] || s;
  }

  function statusColor(s: string) {
    if (s === 'READY_ENTRY') return 'var(--color-acc)';
    if (s === 'ENTERED') return 'var(--color-acc4)';
    if (s === 'CLOSED') return 'var(--color-t3)';
    if (s === 'REJECTED' || s === 'GAP_CANCEL') return 'var(--color-acc2)';
    return 'var(--color-acc3)';
  }

  function getProjectedPosition(c: Candidate) {
    if (!c.entry || c.stop === null || c.stop === undefined || !c.direction || !c.payload?.atr) return null;
    return calculatePosition(c.entry, Number(c.stop), c.payload.atr, 100, c.direction);
  }

  function isActive(s: string) {
    return s === 'WAITING_D1' || s === 'READY_ENTRY' || s === 'WAITING_OPEN';
  }

  function canOpenTrade(s: string) {
    return s === 'WAITING_D1' || s === 'READY_ENTRY' || s === 'WAITING_OPEN';
  }

  function canEdit(s: string) {
    // Редактирование запрещено только для ENTERED (сделка уже открыта)
    return s !== 'ENTERED';
  }
</script>

<svelte:head>
  <title>Impulse Scanner · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>Impulse Scanner</h1>
      <p class="sub">Импульсное движение D0 + подтверждение паттерна на D+1</p>
    </div>
    <button class="btn-p" onclick={() => (showAddForm = true)}>+ Добавить кандидата</button>
  </div>

  <div class="hint">
    <div><b>D0 LONG:</b> Move +5..+12%, CLV &gt; 0.70, Body &gt; 0.50, RelVol &gt;= 1.5</div>
    <div><b>D0 SHORT:</b> Move -5..-12%, CLV &lt; 0.30, Body &gt; 0.50, RelVol &gt;= 1.5</div>
    <div><b>D+1 (один из паттернов):</b><br>
      <span style="margin-left:12px">• <b>Inside Day:</b> H1 ≤ H_D0 AND L1 ≥ L_D0</span><br>
      <span style="margin-left:12px">• <b>Weak Pullback (LONG):</b> L1 &gt; Mid_D0 AND retracement &lt; 50% AND C1 &gt; Mid_D0 (для SHORT зеркально)</span><br>
      <span style="margin-left:12px">• <b>Compression:</b> Range1/Range_D0 &lt; 0.5 AND |C1−C_D0| &lt; 0.3·Range_D0</span>
    </div>
    <div><b>Entry D+2 (после D+1):</b> {`{High_D+1}`} (LONG) или {`{Low_D+1}`} (SHORT) · <b>Trail stop:</b> max/min(Stop_D0, Low/High_D+1)</div>
    <div><b>Stop D0 (LONG):</b> Low_D0 − 0.2×ATR · <b>SHORT:</b> High_D0 + 0.2×ATR</div>
  </div>

  <WorkflowGuide
    strategyId="impulse"
    sections={[
      {
        title: 'Вечером D0 — Поиск кандидатов',
        steps: [
          'Открой scanner (Finviz / TradingView) с фильтрами: **Move +5..+12% (LONG) или -5..-12% (SHORT)**',
          'Дополнительно: **RelVol ≥ 1.5 · Close ≥ $10 · ADV20 ≥ $10M**',
          'На каждом кандидате проверь:',
          '  • **CLV > 0.70** для LONG (close в верхних 30%) · **CLV < 0.30** для SHORT',
          '  • **Body > 0.50** (тело свечи > 50% диапазона)',
          'Нажми **+ Добавить D0**, введи: D-1 Close · OHLCV D0 · ATR14 · AvgVol20'
        ]
      },
      {
        title: 'D0 валидация (автоматически)',
        steps: [
          'Система рассчитает: **Move %, CLV, Body, RangeATR, RelVol**',
          'Покажет цветные ✓/✗ для каждого условия и определит направление',
          '🟢 Все условия пройдены → статус **WAITING_D1**',
          '🔴 Хоть одно условие не пройдено → "НЕТ СИГНАЛА" (не сохраняется)'
        ]
      },
      {
        title: 'Вечером D+1 — Pattern check',
        steps: [
          'Нажми **+ D1** на кандидате со статусом "Ждём D1"',
          'Введи **OHLCV D+1**',
          'Система определит один из трёх паттернов:',
          '  • **Inside Day**: H1 ≤ H_D0 AND L1 ≥ L_D0',
          '  • **Weak Pullback (LONG)**: L1 > Mid_D0, retracement < 50%, C1 > Mid_D0',
          '  • **Compression**: Range1/Range_D0 < 0.5, |C1−C_D0| < 0.3×Range_D0',
          '🟢 Один из паттернов найден → статус **READY_ENTRY** · Entry/Stop рассчитаны',
          '🔴 Ни один паттерн не подошёл → статус **REJECTED**'
        ]
      },
      {
        title: 'Параметры сделки (D+2)',
        steps: [
          '**Entry**: High_D+1 (LONG) или Low_D+1 (SHORT) · Buy Stop / Sell Stop ордер',
          '**Stop D0**: Low_D0 − 0.2×ATR (LONG) или High_D0 + 0.2×ATR (SHORT)',
          '**Trail stop**: max(Stop_D0, Low_D+1) для LONG · min(Stop_D0, High_D+1) для SHORT',
          '**T1**: +1R (50%) · **T2**: +2R · **Time stop**: D+5'
        ]
      },
      {
        title: 'Утром D+2 — Вход',
        steps: [
          'Нажми **+ Сделка** на READY_ENTRY кандидате',
          'Поставь stop-ордер в Freedom24 на цене Entry',
          'Если ордер не сработал к концу D+2 — сетап истёк, отмени',
          'После исполнения — Stop Loss на цене Trail stop'
        ]
      },
      {
        title: 'Управление D+2..D+5',
        steps: [
          'При **+1R**: закрой 50%, стоп в breakeven',
          'При **+2R**: закрой остаток',
          'На закрытии **D+5** — Time stop, закрыть позицию MOC'
        ]
      }
    ]}
  />

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if candidates.length === 0}
    <div class="state">Нет кандидатов. Нажми «+ Добавить кандидата».</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>D0 Date</th>
            <th>Dir</th>
            <th>Imp%</th>
            <th>CLV</th>
            <th>Body</th>
            <th>RelVol</th>
            <th>Pattern</th>
            <th>Entry</th>
            <th>Stop</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const m = c.payload?.metrics}
            {@const dirColor = c.direction === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}
            {@const proj = getProjectedPosition(c)}
            <tr>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td><span style="color:{dirColor};font-weight:700">{c.direction ?? '—'}</span></td>
              <td>{m?.impulse !== undefined ? (m.impulse >= 0 ? '+' : '') + (m.impulse * 100).toFixed(1) + '%' : '—'}</td>
              <td>{m?.clv !== undefined ? m.clv.toFixed(2) : '—'}</td>
              <td>{m?.body !== undefined ? m.body.toFixed(2) : '—'}</td>
              <td>{m?.vol_ratio !== undefined ? m.vol_ratio.toFixed(1) + 'x' : '—'}</td>
              <td>{c.payload?.pattern ?? '—'}</td>
              <td>{c.entry !== null ? '$' + c.entry.toFixed(2) : '—'}</td>
              <td>{c.stop !== null && c.stop !== undefined ? '$' + Number(c.stop).toFixed(2) : '—'}</td>
              <td><span style="color:{statusColor(c.status)}">{statusLabel(c.status)}</span></td>
              <td class="acts">
                {#if canEdit(c.status)}
                  <button onclick={() => (editCand = c)} title="Редактировать" style="font-size:9px;padding:4px 8px">✎</button>
                {/if}
                {#if c.status === 'WAITING_D1'}
                  <button onclick={() => (d1Candidate = c)} style="font-size:9px;padding:4px 8px">+ D+1</button>
                {/if}
                {#if canOpenTrade(c.status)}
                  <button class="btn-p" onclick={() => (tradeCandidate = c)} style="font-size:9px;padding:4px 8px">+ Сделка</button>
                {/if}
                <button class="btn-r" onclick={() => handleDelete(c.id)} style="font-size:9px;padding:4px 8px">×</button>
              </td>
            </tr>
            {#if proj && isActive(c.status)}
              <tr class="proj-row">
                <td colspan="12">
                  <span class="proj-label">Прогноз позиции (риск $100):</span>
                  Stop ${proj.stop.toFixed(2)} · Risk/share ${proj.risk_per_share.toFixed(2)} · Risk/ATR {proj.risk_atr_ratio.toFixed(2)}{proj.risk_warning ? ' ⚠' : ''} · Shares <b>{proj.shares}</b> · Size ${proj.position_value.toFixed(0)} · T1 ${proj.target1.toFixed(2)} · T2 ${proj.target2.toFixed(2)}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showAddForm}
  <ImpulseForm onClose={() => (showAddForm = false)} onAdded={load} />
{/if}

{#if editCand}
  <ImpulseForm
    editCandidate={editCand}
    onClose={() => (editCand = null)}
    onAdded={load}
  />
{/if}

{#if d1Candidate}
  <D1Form
    candidate={d1Candidate}
    onClose={() => (d1Candidate = null)}
    onUpdated={load}
  />
{/if}

{#if tradeCandidate}
  <TradeForm
    candidate={tradeCandidate}
    onClose={() => (tradeCandidate = null)}
    onSaved={load}
  />
{/if}

<style>
  .page { padding: 20px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 10px 14px; background: var(--color-bg3); border-radius: 8px; line-height: 1.8; margin-bottom: 16px; }
  .hint b { color: var(--color-text); }
  .state { padding: 30px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; }
  .err { color: var(--color-acc2); }
  .tw { overflow-x: auto; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; }
  .proj-row td { background: rgba(126, 232, 162, 0.04); border-bottom: 1px solid var(--color-line); font-size: 10px; color: var(--color-t2); padding: 6px 10px; }
  .proj-label { color: var(--color-acc); font-weight: 600; margin-right: 8px; }
</style>
