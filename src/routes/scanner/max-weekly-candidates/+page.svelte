<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates, updateCandidate } from '$lib/data/candidates';
  import type { Candidate, MaxWeeklyPayload } from '$lib/types';
  import TradeForm from '$lib/components/TradeForm.svelte';

  let candidates = $state<Candidate[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let tradeCandidate = $state<Candidate | null>(null);
  let filterStatus = $state<'ALL' | 'WAITING_OPEN' | 'ENTERED' | 'CLOSED' | 'GAP_CANCEL'>('ALL');

  let unsubscribe: (() => void) | null = null;

  async function load() {
    try {
      loading = true;
      candidates = await listCandidates('max_weekly');
      error = null;
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    unsubscribe = subscribeCandidates('max_weekly', () => load());
  });

  onDestroy(() => { if (unsubscribe) unsubscribe(); });

  async function handleDelete(id: string) {
    if (!confirm('Удалить кандидата?')) return;
    try {
      await deleteCandidate(id);
      candidates = candidates.filter(c => c.id !== id);
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
  }

  async function markGapCancel(c: Candidate) {
    try {
      await updateCandidate(c.id, { status: 'GAP_CANCEL' });
      load();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
  }

  const filtered = $derived.by(() => {
    if (filterStatus === 'ALL') return candidates;
    return candidates.filter(c => c.status === filterStatus);
  });

  function statusLabel(s: string) {
    const map: Record<string, string> = {
      WAITING_OPEN: 'Ждём понедельника',
      GAP_CANCEL:   'Gap отмена',
      ENTERED:      'В сделке',
      CLOSED:       'Закрыта',
      REJECTED:     'Отклонён'
    };
    return map[s] || s;
  }

  function statusColor(s: string) {
    if (s === 'WAITING_OPEN') return 'var(--color-acc3)';
    if (s === 'ENTERED')      return 'var(--color-acc4)';
    if (s === 'CLOSED')       return 'var(--color-t3)';
    if (s === 'GAP_CANCEL')   return 'var(--color-acc2)';
    return 'var(--color-t2)';
  }

  function mw(c: Candidate): MaxWeeklyPayload | null {
    return c.payload as MaxWeeklyPayload | null;
  }

  function fmtPct(v: number) {
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  }

  // Статистика
  const stats = $derived.by(() => {
    const all = candidates;
    return {
      total: all.length,
      waiting: all.filter(c => c.status === 'WAITING_OPEN').length,
      entered: all.filter(c => c.status === 'ENTERED').length,
      gapCancel: all.filter(c => c.status === 'GAP_CANCEL').length,
      short: all.filter(c => c.direction === 'SHORT').length,
      long: all.filter(c => c.direction === 'LONG').length,
    };
  });
</script>

<svelte:head>
  <title>MAX Weekly Кандидаты · Trading Journal</title>
</svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>MAX Weekly — Кандидаты</h1>
      <p class="sub">Сигналы сохранённые после еженедельного скана</p>
    </div>
    <a href="/scanner/max-weekly" class="link-btn">← Вернуться к скану</a>
  </div>

  <!-- Stats -->
  <div class="stats">
    <div class="stat"><div class="sv">{stats.total}</div><div class="sl">Всего</div></div>
    <div class="stat"><div class="sv" style="color:var(--color-acc3)">{stats.waiting}</div><div class="sl">Ждут пн</div></div>
    <div class="stat"><div class="sv" style="color:var(--color-acc4)">{stats.entered}</div><div class="sl">В сделке</div></div>
    <div class="stat"><div class="sv" style="color:var(--color-acc2)">{stats.gapCancel}</div><div class="sl">Gap Cancel</div></div>
    <div class="stat"><div class="sv" style="color:var(--color-acc2)">{stats.short}</div><div class="sl">SHORT</div></div>
    <div class="stat"><div class="sv" style="color:var(--color-acc)">{stats.long}</div><div class="sl">LONG</div></div>
  </div>

  <!-- Filters -->
  <div class="filters">
    {#each ['ALL', 'WAITING_OPEN', 'ENTERED', 'GAP_CANCEL', 'CLOSED'] as s}
      <button
        class="ftab"
        class:ftab-active={filterStatus === s}
        onclick={() => filterStatus = s as any}
      >
        {s === 'ALL' ? 'Все' : statusLabel(s)}
        {#if s === 'ALL'}({candidates.length}){:else}({candidates.filter(c=>c.status===s).length}){/if}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if filtered.length === 0}
    <div class="state">
      {candidates.length === 0
        ? 'Нет сохранённых кандидатов. Запусти скан в пятницу и нажми «💾 Сохранить».'
        : 'Нет кандидатов с выбранным статусом.'}
    </div>
  {:else}
    <div class="cards">
      {#each filtered as c (c.id)}
        {@const p = mw(c)}
        <div class="card" class:card-short={c.direction==='SHORT'} class:card-long={c.direction==='LONG'}
             class:card-gap={c.status==='GAP_CANCEL'} class:card-entered={c.status==='ENTERED'}>
          <div class="card-top">
            <div class="card-ticker">{c.ticker}</div>
            <div class="card-dir" style="color:{c.direction==='SHORT'?'var(--color-acc2)':'var(--color-acc)'}">{c.direction}</div>
            <div class="card-status" style="color:{statusColor(c.status)}">{statusLabel(c.status)}</div>
            <div class="card-date">{c.signal_date ?? '—'}</div>
          </div>

          {#if p}
            <div class="card-metrics">
              <span>Close <b>${p.close_t0.toFixed(2)}</b></span>
              <span>MAX_5d <b>{fmtPct(p.max5d)}</b></span>
              <span>MAX_pct <b>{p.maxPct.toFixed(0)}</b></span>
              <span>Vol×<b>{p.volSpike5d.toFixed(1)}</b></span>
              <span>ATR <b>{p.atr14.toFixed(2)}</b></span>
              <span>ADV <b>${(p.adv20/1_000_000).toFixed(1)}M</b></span>
            </div>
            <div class="card-levels">
              <span>Stop <b style="color:var(--color-acc2)">${c.stop != null ? Number(c.stop).toFixed(2) : '—'}</b></span>
              <span>T1 <b>${c.target1 != null ? Number(c.target1).toFixed(2) : '—'}</b></span>
              <span>T2 <b>${c.target2 != null ? Number(c.target2).toFixed(2) : '—'}</b></span>
              <span>Gap cancel <b style="color:var(--color-acc3)">{c.direction==='SHORT' ? '≥' : '≤'} ${p.gap_cancel_threshold.toFixed(2)}</b></span>
            </div>
            {#if c.status === 'WAITING_OPEN'}
              <div class="card-checklist">
                <span>□ Проверить шорт в Freedom24</span>
                <span>□ Earnings ±5 дней</span>
                <span>□ Понедельник: Open {c.direction==='SHORT'?'<':'>'} ${p.gap_cancel_threshold.toFixed(2)}</span>
              </div>
            {/if}
          {/if}

          <div class="card-actions">
            {#if c.status === 'WAITING_OPEN'}
              <button class="btn-p" onclick={() => (tradeCandidate = c)} style="font-size:10px">
                + Открыть сделку
              </button>
              <button onclick={() => markGapCancel(c)} class="btn-r" style="font-size:10px">
                Gap Cancel
              </button>
            {:else if c.status === 'ENTERED'}
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-acc4)">
                Сделка открыта
              </span>
            {:else if c.status === 'GAP_CANCEL'}
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-acc2)">
                Пропущена (гэп на открытии)
              </span>
            {/if}
            <button onclick={() => handleDelete(c.id)} class="btn-del" style="font-size:9px;padding:4px 8px;margin-left:auto">×</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

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
  .link-btn { font-family: var(--font-mono); font-size: 11px; padding: 8px 14px; border: 1px solid var(--color-line); border-radius: 6px; text-decoration: none; color: var(--color-text); background: var(--color-bg2); }
  .link-btn:hover { background: var(--color-bg3); }

  .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 14px; }
  @media (max-width: 600px) { .stats { grid-template-columns: repeat(3, 1fr); } }
  .stat { padding: 10px; border: 1px solid var(--color-line); border-radius: 8px; background: var(--color-bg2); text-align: center; }
  .sv { font-family: var(--font-mono); font-size: 20px; font-weight: 700; }
  .sl { font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); text-transform: uppercase; letter-spacing: 1px; margin-top: 3px; }

  .filters { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .ftab { font-family: var(--font-mono); font-size: 10px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--color-line); background: var(--color-bg2); color: var(--color-t2); cursor: pointer; }
  .ftab-active { border-color: #a78bfa; color: #a78bfa; background: rgba(167,139,250,0.1); }

  .state { padding: 40px; text-align: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; line-height: 1.8; }
  .err { color: var(--color-acc2); }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .card { padding: 14px; border-radius: 10px; border: 1px solid var(--color-line); background: var(--color-bg2); }
  .card-short { border-left: 3px solid rgba(255,107,138,0.5); }
  .card-long  { border-left: 3px solid rgba(126,232,162,0.5); }
  .card-gap   { opacity: 0.6; }
  .card-entered { border-left: 3px solid rgba(106,183,255,0.5); }

  .card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .card-ticker { font-size: 16px; font-weight: 700; }
  .card-dir { font-family: var(--font-mono); font-size: 11px; font-weight: 700; }
  .card-status { font-family: var(--font-mono); font-size: 10px; margin-left: auto; }
  .card-date { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); }

  .card-metrics { display: flex; gap: 10px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); margin-bottom: 6px; }
  .card-metrics b { color: var(--color-text); }
  .card-levels { display: flex; gap: 10px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); margin-bottom: 8px; }
  .card-levels b { color: var(--color-text); }
  .card-checklist { font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-top: 1px solid var(--color-line); margin-bottom: 8px; }
  .card-actions { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--color-line); flex-wrap: wrap; }
  .btn-del { background: transparent; border: 1px solid var(--color-line); color: var(--color-t2); border-radius: 4px; cursor: pointer; }
  .btn-del:hover { border-color: var(--color-acc2); color: var(--color-acc2); }
</style>
