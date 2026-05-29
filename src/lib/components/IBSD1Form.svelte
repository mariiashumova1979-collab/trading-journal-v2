<script lang="ts">
  import { onMount } from 'svelte';
  import { parseNum, calcIBSEntry, checkD1Adverse } from '$lib/strategies/ibs_mean_reversion';
  import { updateCandidate } from '$lib/data/candidates';
  import { updateTrade } from '$lib/data/trades';
  import { saveDraft, loadDraft, clearDraft, saveCapital, loadCapital } from '$lib/utils/draftStorage';
  import type { Candidate } from '$lib/types';

  let { candidate, onClose, onUpdated }: {
    candidate: Candidate;
    onClose: () => void;
    onUpdated: () => void;
  } = $props();

  const payload = candidate.payload as any;
  const d0 = payload?.d0;
  const atr14 = payload?.atr14 ?? 0;
  const closeT0 = d0?.C ?? 0;

  function _readCap_ibsswing() {
    if (typeof window === 'undefined') return '50000';
    const v = localStorage.getItem('tj_capital_ibs_swing');
    return v && parseFloat(v) > 0 ? v : '50000';
  }
  let capital  = $state(_readCap_ibsswing());
  let openD1    = $state('');
  let highD1    = $state('');
  let lowD1     = $state('');
  let closeD1   = $state('');
  let d1Date    = $state(new Date().toISOString().split('T')[0]);
  let mode      = $state<'gap_check' | 'd1_check'>('gap_check');

  const draftKey = `ibs_d1_${candidate.id}`;
  onMount(() => {
    // Восстанавливаем размер позиции как начальное значение (черновик может перезаписать ниже)
    if (capital === '50000') capital = String(loadCapital('ibs_swing', 50000));
    const d = loadDraft<any>(draftKey);
    if (d) {
      if (d.capital) capital = d.capital;
      if (d.openD1)  openD1  = d.openD1;
      if (d.highD1)  highD1  = d.highD1;
      if (d.lowD1)   lowD1   = d.lowD1;
      if (d.closeD1) closeD1 = d.closeD1;
      if (d.d1Date)  d1Date  = d.d1Date;
      if (d.mode)    mode    = d.mode;
    }
  });
  $effect(() => {
    saveDraft(draftKey, { capital, openD1, highD1, lowD1, closeD1, d1Date, mode });

    // Сохраняем размер позиции (работает и при редактировании)
    const _cap = parseFloat(capital.replace(',','.'));
    if (!isNaN(_cap) && _cap > 0) saveCapital('ibs_swing', _cap);
  });

  let result    = $state<any>(null);
  let errors    = $state<string[]>([]);
  let saving    = $state(false);

  function calcGap() {
    result = null; errors = [];
    const open = parseNum(openD1);
    if (isNaN(open) || open <= 0) { errors = ['Введи Open D+1']; return; }
    if (!candidate.direction) return;

    const cap = parseNum(capital) || 50000;
    const pos = calcIBSEntry(closeT0, open, candidate.direction, atr14, cap);

    const note = pos.gapCancelled
      ? `D+1 GAP CANCEL (${d1Date}): ${pos.gapCancelReason}`
      : [
          `D+1 Entry (${d1Date}): Open = $${open.toFixed(2)}`,
          `Stop: $${pos.stop.toFixed(2)} (dist: $${pos.stopDistance.toFixed(2)})`,
          `Shares: ${pos.shares} · Position: $${pos.positionValue.toFixed(0)} · Risk: $${pos.riskAmount.toFixed(0)}`,
          `T1 (+1×ATR): $${pos.target1.toFixed(2)} · T2 (+2×ATR): $${pos.target2.toFixed(2)}`,
          `Trailing после T1: Close ± 1×ATR`
        ].join('\n');

    result = { pos, note, type: 'gap' };
  }

  function calcD1Check() {
    result = null; errors = [];
    const high = parseNum(highD1);
    const low  = parseNum(lowD1);
    const cl   = parseNum(closeD1);
    const missing: string[] = [];
    if (isNaN(high)) missing.push('High');
    if (isNaN(low))  missing.push('Low');
    if (isNaN(cl))   missing.push('Close');
    if (missing.length) { errors = ['Заполни: ' + missing.join(', ')]; return; }
    if (!candidate.entry || !candidate.direction) { errors = ['Кандидат без entry или direction']; return; }

    const check = checkD1Adverse(
      Number(candidate.entry), high, low, atr14, candidate.direction
    );

    const note = [
      `D+1 Check (${d1Date}): ${check.shouldClose ? '⚠ ЗАКРЫТЬ ПОЗИЦИЮ' : '✓ Позиция остаётся'}`,
      check.reason
    ].join('\n');

    result = { check, note, type: 'd1check', highD1: high, lowD1: low, closeD1: cl };
  }

  async function saveGap() {
    if (!result || result.type !== 'gap') return;
    saving = true;
    try {
      const pos = result.pos;
      if (pos.gapCancelled) {
        await updateCandidate(candidate.id, {
          status: 'GAP_CANCEL',
          payload: { ...payload, d1_note: result.note }
        });
      } else {
        await updateCandidate(candidate.id, {
          status: 'READY_ENTRY',
          entry: pos.entry,
          stop: pos.stop,
          target1: pos.target1,
          target2: pos.target2,
          payload: { ...payload, d1_date: d1Date, d1_note: result.note }
        });
      }
      clearDraft(draftKey);
      onUpdated(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  async function saveD1Check() {
    if (!result || result.type !== 'd1check') return;
    saving = true;
    try {
      const note = result.note;
      await updateCandidate(candidate.id, {
        payload: { ...payload, d1_adverse_note: note, d1_should_close: result.check.shouldClose }
      });
      if (candidate.trade_id) {
        const { listTrades } = await import('$lib/data/trades');
        const trades = await listTrades();
        const trade = trades.find(t => t.id === candidate.trade_id);
        if (trade) {
          await updateTrade(trade.id, { notes: (trade.notes || '') + '\n' + note });
        }
      }
      clearDraft(draftKey);
      onUpdated(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>D+1 — {candidate.ticker} ({candidate.direction}) · IBS</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="info">
      <div>T0 ({candidate.signal_date}): Close <b>${closeT0.toFixed(2)}</b> · ATR14 <b>{atr14.toFixed(2)}</b></div>
      <div>IBS <b>{(payload?.metrics?.ibs ?? 0).toFixed(3)}</b> · RSI(2) <b>{payload?.rsi2 ?? '—'}</b> · SMA200 <b>{payload?.sma200?.toFixed(2) ?? '—'}</b></div>
    </div>

    <div class="tabs">
      <button class="tab" class:tab-active={mode === 'gap_check'} onclick={() => { mode = 'gap_check'; result = null; }}>
        Утро D+1 · Gap check + Entry
      </button>
      <button class="tab" class:tab-active={mode === 'd1_check'} onclick={() => { mode = 'd1_check'; result = null; }}>
        Вечер D+1 · Adverse check
      </button>
    </div>

    {#if mode === 'gap_check'}
      <div class="hint">
        <div>LONG: отмена если Open ≥ ${(closeT0 * 1.02).toFixed(2)} (Close × 1.02)</div>
        <div>SHORT: отмена если Open ≤ ${(closeT0 * 0.98).toFixed(2)} (Close × 0.98)</div>
        <div>Stop = min(1.5×ATR, 6%×Entry) · Risk = 1% капитала</div>
      </div>
      <div class="row-2" style="margin-bottom:10px">
        <div class="fg"><label>Open D+1</label><input bind:value={openD1} oninput={calcGap} inputmode="decimal" /></div>
        <div class="fg"><label>Капитал $</label><input bind:value={capital} oninput={calcGap} inputmode="numeric" /></div>
      </div>
      <div class="fg" style="margin-bottom:8px"><label>Дата D+1</label><input type="date" bind:value={d1Date} /></div>

      {#if result?.type === 'gap'}
        {@const pos = result.pos}
        <div class="prev" class:prev-cancel={pos.gapCancelled} class:prev-ok={!pos.gapCancelled}>
          {#if pos.gapCancelled}
            <div class="prev-h">⚠ GAP CANCEL</div>
            <div style="color:var(--color-acc2)">{pos.gapCancelReason}</div>
          {:else}
            <div class="prev-h">✓ GAP OK · ВХОДИМ</div>
            <div>Entry: <b style="color:var(--color-acc)">${pos.entry.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${pos.stop.toFixed(2)}</b> (dist: ${pos.stopDistance.toFixed(2)})</div>
            <div>Shares: <b>{pos.shares}</b> · Position: <b>${pos.positionValue.toFixed(0)}</b> · Risk: <b>${pos.riskAmount.toFixed(0)}</b></div>
            <div>T1 (+1×ATR): <b>${pos.target1.toFixed(2)}</b> · T2 (+2×ATR): <b>${pos.target2.toFixed(2)}</b></div>
            <div style="color:var(--color-t3);font-size:9px;margin-top:6px">После T1: стоп в BE · Trailing: Close ± 1×ATR · Time stop: D+5</div>
          {/if}
        </div>
        <div class="ar">
          <button onclick={onClose}>Отмена</button>
          <button onclick={saveGap} disabled={saving} class={pos.gapCancelled ? 'btn-r' : 'btn-p'}>
            {saving ? '...' : pos.gapCancelled ? 'Пометить Gap Cancel' : 'Сохранить и открыть сделку'}
          </button>
        </div>
      {:else}
        {#if errors.length}<div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>{/if}
        <div class="ar">
          <button onclick={onClose}>Отмена</button>
          <button onclick={calcGap} class="btn-p">Проверить</button>
        </div>
      {/if}

    {:else}
      <div class="hint">
        <div>LONG: если High D+1 − Entry &lt; 0.5×ATR → закрыть всё по Close D+1</div>
        <div>SHORT: если Entry − Low D+1 &lt; 0.5×ATR → закрыть всё по Close D+1</div>
        <div>Entry: <b>${candidate.entry ? Number(candidate.entry).toFixed(2) : '—'}</b> · 0.5×ATR = <b>${(0.5 * atr14).toFixed(2)}</b></div>
      </div>
      <div class="row-4" style="margin-bottom:10px">
        <div class="fg"><label>High D+1</label><input bind:value={highD1} oninput={calcD1Check} inputmode="decimal" /></div>
        <div class="fg"><label>Low D+1</label><input bind:value={lowD1} oninput={calcD1Check} inputmode="decimal" /></div>
        <div class="fg"><label>Close D+1</label><input bind:value={closeD1} inputmode="decimal" /></div>
        <div class="fg"><label>Дата</label><input type="date" bind:value={d1Date} /></div>
      </div>

      {#if result?.type === 'd1check'}
        {@const c = result.check}
        <div class="prev" class:prev-cancel={c.shouldClose} class:prev-ok={!c.shouldClose}>
          <div class="prev-h">{c.shouldClose ? '⚠ ЗАКРЫТЬ ПО CLOSE D+1' : '✓ ПОЗИЦИЯ ОСТАЁТСЯ'}</div>
          <div>{c.reason}</div>
        </div>
      {/if}

      {#if errors.length}<div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>{/if}
      <div class="ar">
        <button onclick={onClose}>Отмена</button>
        {#if !result}
          <button onclick={calcD1Check} class="btn-p">Проверить</button>
        {:else}
          <button onclick={saveD1Check} disabled={saving} class="btn-p">{saving ? '...' : 'Сохранить'}</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 600px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .info { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 12px; }
  .info b { color: var(--color-text); }
  .tabs { display: flex; gap: 4px; margin-bottom: 14px; }
  .tab { font-family: var(--font-mono); font-size: 10px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--color-line); background: var(--color-bg2); color: var(--color-t2); cursor: pointer; }
  .tab-active { border-color: var(--color-acc); color: var(--color-acc); background: rgba(126,232,162,0.08); }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.8; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; }
  .prev { padding: 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; margin: 12px 0; line-height: 1.8; }
  .prev-ok { background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); }
  .prev-cancel { background: rgba(255,107,138,0.08); border: 1px solid var(--color-acc2); color: var(--color-text); }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 6px; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
