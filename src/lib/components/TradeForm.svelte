<script lang="ts">
  import { calculatePosition, parseNum } from '$lib/strategies/impulse';
  import { insertTrade } from '$lib/data/trades';
  import { updateCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  import type { Candidate } from '$lib/types';

  let { candidate, onClose, onSaved }: {
    candidate: Candidate;
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  let entryDate = $state(new Date().toISOString().split('T')[0]);
  let entryActual = $state((candidate.entry || 0).toFixed(2));
  let riskAmt = $state('100');
  let commission = $state('0');

  let errors = $state<string[]>([]);
  let preview = $state<any>(null);
  let saving = $state(false);

  function calc() {
    const entry = parseNum(entryActual);
    const risk = parseNum(riskAmt);
    if (isNaN(entry) || entry <= 0) {
      errors = ['Введи Entry'];
      preview = null;
      return;
    }
    if (isNaN(risk) || risk <= 0) {
      errors = ['Введи риск'];
      preview = null;
      return;
    }
    if (!candidate.direction || candidate.stop === null || candidate.stop === undefined) {
      errors = ['Кандидат без direction/stop — обработай D+1'];
      preview = null;
      return;
    }

    const atr = candidate.payload?.atr || 0;
    const stop = Number(candidate.stop);
    const pos = calculatePosition(entry, stop, atr, risk, candidate.direction);

    if (pos.shares < 1) {
      errors = ['Слишком мало акций (' + pos.shares + ') — увеличь риск'];
      return;
    }

    errors = pos.risk_warning ? ['⚠ Risk/ATR = ' + pos.risk_atr_ratio.toFixed(2) + ' > 1.5 — стоп слишком широкий'] : [];
    preview = pos;
  }

  async function save() {
    calc();
    if (!preview) return;
    if (!$user) return;

    saving = true;
    try {
      const trade = await insertTrade({
        user_id: $user.id,
        ticker: candidate.ticker,
        type: candidate.direction!,
        strategy: 'impulse',
        entry_date: entryDate,
        entry: preview.entry,
        shares: preview.shares,
        stop: preview.stop,
        target1: preview.target1,
        target2: preview.target2,
        status: 'OPEN',
        commission: parseNum(commission) || 0,
        notes: 'D0: ' + candidate.signal_date + ' | Pattern: ' + (candidate.payload?.pattern || 'N/A') + ' | ATR: ' + (candidate.payload?.atr?.toFixed(2) || 'N/A'),
        atr_pct: candidate.payload?.atr ? (candidate.payload.atr / preview.entry * 100) : null,
        atr_abs: candidate.payload?.atr || null,
        impulse_anchor: candidate.direction === 'LONG' ? candidate.payload?.d0?.L ?? null : candidate.payload?.d0?.H ?? null,
        setup: {
          d0: candidate.payload?.d0,
          d1: candidate.payload?.d1,
          atr: candidate.payload?.atr,
          rel_vol: candidate.payload?.rel_vol,
          pattern: candidate.payload?.pattern,
          d0_date: candidate.signal_date,
          metrics: candidate.payload?.metrics
        }
      });

      await updateCandidate(candidate.id, {
        status: 'ENTERED',
        trade_id: trade.id
      });

      onSaved();
      onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>Открыть сделку — {candidate.ticker} ({candidate.direction})</div>
      <button onclick={onClose} class="cls" aria-label="Close">×</button>
    </div>

    <div class="info">
      <div>Pattern D+1: <b>{candidate.payload?.pattern || 'не подтверждён'}</b></div>
      <div>Calculated entry: ${candidate.entry?.toFixed(2)} · Stop: ${candidate.stop !== null ? Number(candidate.stop).toFixed(2) : '—'}</div>
      <div>ATR: {candidate.payload?.atr?.toFixed(2)} · 0.2×ATR: {candidate.payload?.atr ? (0.2 * candidate.payload.atr).toFixed(2) : '—'}</div>
    </div>

    <div class="row">
      <div class="fg">
        <label for="tf-date">Дата входа</label>
        <input id="tf-date" type="date" bind:value={entryDate} />
      </div>
      <div class="fg">
        <label for="tf-entry">Фактический Entry</label>
        <input id="tf-entry" bind:value={entryActual} inputmode="decimal" />
      </div>
    </div>

    <div class="row">
      <div class="fg">
        <label for="tf-risk">Риск $</label>
        <input id="tf-risk" bind:value={riskAmt} inputmode="numeric" />
      </div>
      <div class="fg">
        <label for="tf-comm">Комиссия $</label>
        <input id="tf-comm" bind:value={commission} inputmode="decimal" />
      </div>
    </div>

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    {#if preview}
      <div class="prev">
        <div class="prev-h">POSITION</div>
        <div>Entry: <b>${preview.entry.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${preview.stop.toFixed(2)}</b></div>
        <div>Risk/share: <b>${preview.risk_per_share.toFixed(2)}</b> · Risk/ATR: <b>{preview.risk_atr_ratio.toFixed(2)}</b></div>
        <div>Shares: <b>{preview.shares}</b> · Position: <b>${preview.position_value.toFixed(0)}</b> · Real risk: <b>${preview.risk_amount.toFixed(2)}</b></div>
        <div>T1: <b>${preview.target1.toFixed(2)}</b> (+1R) · T2: <b>${preview.target2.toFixed(2)}</b> (+2R)</div>
      </div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      <button onclick={calc}>Рассчитать</button>
      <button onclick={save} disabled={!preview || saving} class="btn-p">
        {saving ? 'Сохранение...' : 'Открыть сделку'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 540px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .info { font-family: var(--font-mono); font-size: 11px; color: var(--color-text); padding: 10px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.9; margin-bottom: 14px; }
  .info b { color: var(--color-acc); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .err { padding: 10px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.9; }
  .prev-h { font-weight: 700; color: var(--color-acc); letter-spacing: 1px; margin-bottom: 6px; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
