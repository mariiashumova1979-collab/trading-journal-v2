<script lang="ts">
  import { onMount } from 'svelte';
  import { parseNum, checkGapD1, calcGapEntry, check30min } from '$lib/strategies/gap_reversal';
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
  const closeT0 = payload?.close_t0 ?? 0;
  const sma50   = payload?.sma50 ?? 0;
  const atr14   = payload?.atr14 ?? 0;

  function _readCap() {
    if (typeof window === 'undefined') return '20000';
    const v = localStorage.getItem('tj_capital_gap_reversal');
    return v && parseFloat(v) > 0 ? v : '20000';
  }

  let mode      = $state<'gap' | 'check30'>('gap');
  let openD1    = $state('');
  let capital   = $state(_readCap());
  let price1700 = $state('');
  let d1Date    = $state(new Date().toISOString().split('T')[0]);

  let result    = $state<any>(null);
  let errors    = $state<string[]>([]);
  let saving    = $state(false);

  const draftKey = `gap_d1_${candidate.id}`;
  onMount(() => {
    const d = loadDraft<any>(draftKey);
    if (d) {
      if (d.mode)      mode      = d.mode;
      if (d.openD1)    openD1    = d.openD1;
      if (d.capital)   capital   = d.capital;
      if (d.price1700) price1700 = d.price1700;
      if (d.d1Date)    d1Date    = d.d1Date;
    }
  });

  $effect(() => {
    saveDraft(draftKey, { mode, openD1, capital, price1700, d1Date });
    const _cap = parseFloat(capital.replace(',','.'));
    if (!isNaN(_cap) && _cap > 0) saveCapital('gap_reversal', _cap);
  });

  function calcGap() {
    result = null; errors = [];
    const open = parseNum(openD1);
    if (isNaN(open) || open <= 0) { errors = ['Введи Open D+1']; return; }

    const gapCheck = checkGapD1(closeT0, open, sma50, atr14);
    const cap = parseNum(capital) || 20000;
    const pos = calcGapEntry(closeT0, open, atr14, cap);

    const note = gapCheck.passed
      ? [
          `Gap Reversal D+1 (${d1Date}): Open ${open.toFixed(2)} · ${gapCheck.reason}`,
          `Buy Limit (Open + 25% гэпа): ${pos.buyLimit.toFixed(2)}`,
          `Stop (−1.5×ATR): ${pos.stop.toFixed(2)} · Shares: ${pos.shares} · Risk: $${pos.riskAmount.toFixed(0)}`,
          `T1: ${pos.target1.toFixed(2)} (мин из Close_T0 и Entry+ATR) · T2: ${pos.target2.toFixed(2)}`,
          `⚠ Проверка 17:00 EET: выйти если цена < ${pos.check1700.toFixed(2)} (Entry −1.5%)`
        ].join('\n')
      : `Gap Reversal D+1 (${d1Date}): ОТМЕНА — ${gapCheck.reason}`;

    result = { type: 'gap', gapCheck, pos, note };
  }

  async function saveGap() {
    if (!result || result.type !== 'gap') return;
    saving = true;
    try {
      const { gapCheck, pos } = result;
      if (!gapCheck.passed) {
        await updateCandidate(candidate.id, {
          status: 'REJECTED',
          payload: { ...payload, d1_note: result.note, d1_date: d1Date }
        });
      } else {
        await updateCandidate(candidate.id, {
          status: 'READY_ENTRY',
          entry: pos.buyLimit,
          stop: pos.stop,
          target1: pos.target1,
          target2: pos.target2,
          payload: { ...payload, d1_note: result.note, d1_date: d1Date, check_1700: pos.check1700, open_d1: parseNum(openD1) }
        });
      }
      clearDraft(draftKey);
      onUpdated(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  function calc30() {
    result = null; errors = [];
    const p = parseNum(price1700);
    if (isNaN(p) || p <= 0) { errors = ['Введи цену на 17:00']; return; }
    if (!candidate.entry) { errors = ['Кандидат без entry']; return; }
    const check = check30min(Number(candidate.entry), p);
    const note = [
      `Проверка 17:00 (${d1Date}): цена ${p.toFixed(2)}`,
      check.reason
    ].join('\n');
    result = { type: 'check30', check, note };
  }

  async function save30() {
    if (!result || result.type !== 'check30') return;
    saving = true;
    try {
      const note = result.note;
      await updateCandidate(candidate.id, {
        payload: { ...payload, check_1700_note: note, check_1700_exit: result.check.shouldExit }
      });
      if (candidate.trade_id) {
        const { listTrades } = await import('$lib/data/trades');
        const trades = await listTrades();
        const trade = trades.find(t => t.id === candidate.trade_id);
        if (trade) await updateTrade(trade.id, { notes: (trade.notes || '') + '\n' + note });
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
      <div>D+1 — {candidate.ticker} (LONG) · Gap Reversal</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="info">
      <div>T0 ({candidate.signal_date}): Close <b>${closeT0.toFixed(2)}</b> · SMA50 <b>{sma50.toFixed(2)}</b> · ATR14 <b>{atr14.toFixed(2)}</b></div>
    </div>

    <div class="tabs">
      <button class="tab" class:tab-active={mode === 'gap'} onclick={() => { mode = 'gap'; result = null; }}>
        1. Утро · Gap check + Entry
      </button>
      <button class="tab" class:tab-active={mode === 'check30'} onclick={() => { mode = 'check30'; result = null; }}>
        2. Проверка 17:00
      </button>
    </div>

    {#if mode === 'gap'}
      <div class="hint">
        <div>GapATR = (Close_T0 − Open_D1) / ATR14 · нужен <b>1.0–2.0</b></div>
        <div>Open_D1 должен быть &gt; SMA50 ({sma50.toFixed(2)})</div>
        <div>Entry = Buy Limit = Open + 25% гэпа (вариант B) · Stop = Entry − 1.5×ATR · Risk 1%</div>
      </div>
      <div class="row-2" style="margin-bottom:10px">
        <div class="fg"><label>Open D+1</label><input bind:value={openD1} oninput={calcGap} inputmode="decimal" /></div>
        <div class="fg"><label>Капитал $</label><input bind:value={capital} oninput={calcGap} inputmode="numeric" /></div>
      </div>
      <div class="fg" style="margin-bottom:8px"><label>Дата D+1</label><input type="date" bind:value={d1Date} /></div>

      {#if result?.type === 'gap'}
        {@const gc = result.gapCheck}
        {@const pos = result.pos}
        <div class="prev" class:prev-bad={!gc.passed} class:prev-ok={gc.passed}>
          {#if gc.passed}
            <div class="prev-h">✓ GAP ВАЛИДЕН · ВХОДИМ</div>
            <div>GapATR: <b>{gc.gapATR.toFixed(2)}</b> · Gap: <b>{gc.gapPct.toFixed(1)}%</b> ({gc.gapAbs.toFixed(2)})</div>
            <div>Buy Limit: <b style="color:var(--color-acc)">${pos.buyLimit.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${pos.stop.toFixed(2)}</b></div>
            <div>Shares: <b>{pos.shares}</b> · Position: <b>${pos.positionValue.toFixed(0)}</b> · Risk: <b>${pos.riskAmount.toFixed(0)}</b></div>
            <div>T1: <b>${pos.target1.toFixed(2)}</b> · T2: <b>${pos.target2.toFixed(2)}</b></div>
            <div style="color:var(--color-acc3);margin-top:6px">⚠ Buy Limit действует первые 30 мин · 17:00 проверка: выход если &lt; ${pos.check1700.toFixed(2)}</div>
          {:else}
            <div class="prev-h">✗ ОТМЕНА</div>
            <div>{gc.reason}</div>
          {/if}
        </div>
        <div class="ar">
          <button onclick={onClose}>Отмена</button>
          <button onclick={saveGap} disabled={saving} class={gc.passed ? 'btn-p' : 'btn-r'}>
            {saving ? '...' : gc.passed ? 'Сохранить → + Сделка' : 'Пометить REJECTED'}
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
        <div>Через 30 мин после открытия (17:00 EET) проверь цену</div>
        <div>Если цена &lt; Entry × 0.985 (−1.5%) → <b>выйти сразу</b>, это обвал а не reversal</div>
        <div>Entry: <b>${candidate.entry ? Number(candidate.entry).toFixed(2) : '—'}</b> · Порог: <b>${candidate.entry ? (Number(candidate.entry)*0.985).toFixed(2) : '—'}</b></div>
      </div>
      <div class="row-2" style="margin-bottom:10px">
        <div class="fg"><label>Цена на 17:00</label><input bind:value={price1700} oninput={calc30} inputmode="decimal" /></div>
        <div class="fg"><label>Дата</label><input type="date" bind:value={d1Date} /></div>
      </div>

      {#if result?.type === 'check30'}
        {@const c = result.check}
        <div class="prev" class:prev-bad={c.shouldExit} class:prev-ok={!c.shouldExit}>
          <div class="prev-h">{c.shouldExit ? '⚠ ВЫЙТИ СЕЙЧАС' : '✓ ПРОВЕРКА ПРОЙДЕНА'}</div>
          <div>{c.reason}</div>
        </div>
      {/if}
      {#if errors.length}<div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>{/if}
      <div class="ar">
        <button onclick={onClose}>Отмена</button>
        {#if !result}<button onclick={calc30} class="btn-p">Проверить</button>
        {:else}<button onclick={save30} disabled={saving} class="btn-p">{saving ? '...' : 'Сохранить'}</button>{/if}
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
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; }
  .prev { padding: 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; margin: 12px 0; line-height: 1.8; }
  .prev-ok { background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); }
  .prev-bad { background: rgba(255,107,138,0.08); border: 1px solid var(--color-acc2); color: var(--color-text); }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 6px; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
