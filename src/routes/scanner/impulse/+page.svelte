<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listCandidates, deleteCandidate, subscribeCandidates } from '$lib/data/candidates';
  import type { Candidate } from '$lib/types';
  import ImpulseForm from '$lib/components/ImpulseForm.svelte';

  let candidates = $state<Candidate[]>([]);
  let showForm = $state(false);
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
    unsubscribe = subscribeCandidates('impulse', () => {
      load();
    });
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
</script>

<div class="page">
  <div class="head">
    <div>
      <h1>Impulse Scanner</h1>
      <p class="sub">Импульсное движение D0 + подтверждение паттерна на D+1</p>
    </div>
    <button class="btn-p" onclick={() => (showForm = true)}>+ Добавить кандидата</button>
  </div>

  <div class="hint">
    <div><b>D0 LONG:</b> Move +5..+12%, CLV &gt; 0.70, Body &gt; 0.50, RelVol &gt;= 1.5</div>
    <div><b>D0 SHORT:</b> Move -5..-12%, CLV &lt; 0.30, Body &gt; 0.50, RelVol &gt;= 1.5</div>
    <div><b>D+1:</b> Inside Day OR Weak Pullback OR Compression</div>
    <div><b>Entry D+2 (LONG):</b> High_D0 + 0.1*ATR · <b>Stop:</b> Low_D0 - 0.2*ATR</div>
    <div><b>Entry D+2 (SHORT):</b> Low_D0 - 0.1*ATR · <b>Stop:</b> High_D0 + 0.2*ATR</div>
  </div>

  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if error}
    <div class="state err">Ошибка: {error}</div>
  {:else if candidates.length === 0}
    <div class="state">Нет кандидатов. Нажми «+ Добавить кандидата», чтобы внести первого.</div>
  {:else}
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>D0 Date</th>
            <th>Dir</th>
            <th>Impulse%</th>
            <th>CLV</th>
            <th>Body</th>
            <th>RelVol</th>
            <th>Entry</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            {@const m = c.payload?.metrics}
            {@const dirColor = c.direction === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}
            <tr>
              <td><b>{c.ticker}</b></td>
              <td>{c.signal_date ?? '—'}</td>
              <td><span style="color:{dirColor};font-weight:700">{c.direction ?? '—'}</span></td>
              <td>{m?.impulse !== undefined ? (m.impulse >= 0 ? '+' : '') + (m.impulse * 100).toFixed(1) + '%' : '—'}</td>
              <td>{m?.clv !== undefined ? m.clv.toFixed(2) : '—'}</td>
              <td>{m?.body !== undefined ? m.body.toFixed(2) : '—'}</td>
              <td>{m?.vol_ratio !== undefined ? m.vol_ratio.toFixed(1) + 'x' : '—'}</td>
              <td>{c.entry !== null ? '$' + c.entry.toFixed(2) : '—'}</td>
              <td>{statusLabel(c.status)}</td>
              <td>
                <button class="btn-r" onclick={() => handleDelete(c.id)} style="font-size: 9px; padding: 4px 8px;">Удалить</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showForm}
  <ImpulseForm onClose={() => (showForm = false)} onAdded={load} />
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
</style>
