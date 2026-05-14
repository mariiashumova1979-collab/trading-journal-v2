<script lang="ts">
  import { parseNum, checkD1Gap, checkD2Adverse } from '$lib/strategies/nr7';
  import { updateCandidate } from '$lib/data/candidates';
  import { updateTrade } from '$lib/data/trades';
  import type { Candidate } from '$lib/types';

  let { candidate, onClose, onUpdated }: {
    candidate: Candidate;
    onClose: () => void;
    onUpdated: () => void;
  } = $props();

  const payload = candidate.payload as any;
  const d0 = payload?.d0;
  const atr14 = payload?.atr14 ?? 0;
  const buyOrSellStop = candidate.entry ?? 0;
  const highT0 = d0?.H ?? 0;
  const lowT0 = d0?.L ?? 0;

  let mode      = $state<'gap' | 'fill' | 'd2'>('gap');
  let openD1    = $state('');
  let fillPrice = $state(buyOrSellStop ? Number(buyOrSellStop).toFixed(2) : '');
  let closeD2   = $state('');
  let d1Date    = $state(new Date().toISOString().split('T')[0]);

  let result    = $state<any>(null);
  let errors    = $state<string[]>([]);
  let saving    = $state(false);

  function calcGap() {
    result = null; errors = [];
    const open = parseNum(openD1);
    if (isNaN(open)) { errors = ['Введи Open D+1']; return; }
    if (!candidate.direction) return;
    const check = checkD1Gap(buyOrSellStop, open, highT0, lowT0, atr14, candidate.direction);
    const note = [
      `D+1 утро (${d1Date}): Open ${open.toFixed(2)}`,
      `Режим: ${check.mode === 'STOP_ORDER' ? 'STOP ORDER (обычный вход)' : check.mode === 'WAIT_PULLBACK' ? 'ОЖИДАНИЕ ОТКАТА' : 'GAP TOO FAR (skip)'}`,
      check.reason
    ].join('\n');
    result = { type: 'gap', check, note };
  }

  async function saveGapNote() {
    if (!result || result.type !== 'gap') return;
    saving = true;
    try {
      const updates: any = { payload: { ...payload, d1_gap_note: result.note, d1_date: d1Date } };
      if (result.check.mode === 'GAP_FAR') updates.status = 'REJECTED';
      await updateCandidate(candidate.id, updates);
      onUpdated(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  function calcFill() {
    result = null; errors = [];
    const fp = parseNum(fillPrice);
    if (isNaN(fp) || fp <= 0) { errors = ['Введи фактическую цену исполнения']; return; }
    if (!candidate.direction) return;

    const direction = candidate.direction;
    const stop = direction === 'LONG' ? lowT0 - 0.10 * atr14 : highT0 + 0.10 * atr14;
    const stopDistance = Math.abs(fp - stop);
    const target1 = direction === 'LONG' ? fp + 1.5 * atr14 : fp - 1.5 * atr14;
    const target2 = direction === 'LONG' ? fp + 3.0 * atr14 : fp - 3.0 * atr14;

    const note = [
      `D+1 (${d1Date}): Заполнен по ${fp.toFixed(2)}`,
      `Stop: ${stop.toFixed(2)} (dist ${stopDistance.toFixed(2)})`,
      `T1 (+1.5×ATR): ${target1.toFixed(2)} · T2 (+3×ATR): ${target2.toFixed(2)}`,
      `После T1: 50% выход, стоп в BE, trailing = MaxHighSinceEntry − 2×ATR`,
      `D+2 check: если Close ≤ Entry → закрыть всё · Time stop D+5`
    ].join('\n');

    result = { type: 'fill', entry: fp, stop, target1, target2, stopDistance, note };
  }

  async function saveFill() {
    if (!result || result.type !== 'fill') return;
    saving = true;
    try {
      await updateCandidate(candidate.id, {
        status: 'READY_ENTRY',
        entry: result.entry,
        stop: result.stop,
        target1: result.target1,
        target2: result.target2,
        payload: { ...payload, d1_fill_note: result.note, d1_date: d1Date }
      });
      onUpdated(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  async function markExpired() {
    saving = true;
    try {
      await updateCandidate(candidate.id, {
        status: 'REJECTED',
        payload: { ...payload, d1_expired: true, d1_date: d1Date, d1_fill_note: `D+1 (${d1Date}): ордер не сработал, отменён в 15:45 EST` }
      });
      onUpdated(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  function calcD2() {
    result = null; errors = [];
    const close = parseNum(closeD2);
    if (isNaN(close)) { errors = ['Введи Close D+2']; return; }
    if (!candidate.entry || !candidate.direction) {
      errors = ['Кандидат без entry/direction']; return;
    }
    const check = checkD2Adverse(Number(candidate.entry), close, candidate.direction);
    const note = [
      `D+2 check: Close ${close.toFixed(2)}`,
      `Entry: ${Number(candidate.entry).toFixed(2)}`,
      check.reason
    ].join('\n');
    result = { type: 'd2', check, note };
  }

  async function saveD2() {
    if (!result || result.type !== 'd2') return;
    saving = true;
    try {
      await updateCandidate(candidate.id, {
        payload: { ...payload, d2_adverse_note: result.note, d2_should_close: result.check.shouldClose }
      });
      if (candidate.trade_id) {
        const { listTrades } = await import('$lib/data/trades');
        const trades = await listTrades();
        const trade = trades.find(t => t.id === candidate.trade_id);
        if (trade) {
          await updateTrade(trade.id, { notes: (trade.notes || '') + '\n' + result.note });
        }
      }
      onUpdated(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>D+1 / D+2 — {candidate.ticker} ({candidate.direction}) · NR7</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="info">
      <div>T0 ({candidate.signal_date}): High <b>${highT0.toFixed(2)}</b> · Low <b>${lowT0.toFixed(2)}</b> · ATR14 <b>{atr14.toFixed(2)}</b></div>
      <div>{candidate.direction === 'LONG' ? 'BuyStop' : 'SellStop'}: <b>${Number(buyOrSellStop).toFixed(2)}</b> · {candidate.direction === 'LONG' ? 'Pullback' : 'Pullback'}: <b>${(candidate.direction === 'LONG' ? highT0 : lowT0).toFixed(2)}</b></div>
    </div>

    <div class="tabs">
      <button class="tab" class:tab-active={mode === 'gap'} onclick={() => { mode = 'gap'; result = null; }}>
        1. Утро · Gap check
      </button>
      <button class="tab" class:tab-active={mode === 'fill'} onclick={() => { mode = 'fill'; result = null; }}>
        2. Итог D+1
      </button>
      <button class="tab" class:tab-active={mode === 'd2'} onclick={() => { mode = 'd2'; result = null; }}>
        3. D+2 Adverse check
      </button>
    </div>

    {#if mode === 'gap'}
      <div class="hint">
        <div><b>LONG:</b> Open &gt; BuyStop → ждать отката к High_T0. Если откат не произошёл — пропустить</div>
        <div><b>SHORT:</b> Open &lt; SellStop → ждать отката к Low_T0</div>
        <div>Stop-ордер действует только D+1, отменить в 15:45 EST</div>
      </div>
      <div class="row-2" style="margin-bottom:10px">
        <div class="fg"><label>Open D+1</label><input bind:value={openD1} oninput={calcGap} inputmode="decimal" /></div>
        <div class="fg"><label>Дата D+1</label><input type="date" bind:value={d1Date} /></div>
      </div>
      {#if result?.type === 'gap'}
        {@const c = result.check}
        <div class="prev" class:prev-warn={c.mode === 'WAIT_PULLBACK'} class:prev-bad={c.mode === 'GAP_FAR'} class:prev-ok={c.mode === 'STOP_ORDER'}>
          <div class="prev-h">
            {c.mode === 'STOP_ORDER' ? '✓ ВЫСТАВИТЬ STOP ОРДЕР' : c.mode === 'WAIT_PULLBACK' ? '⏳ ЖДАТЬ ОТКАТА' : '✗ ПРОПУСТИТЬ'}
          </div>
          <div>{c.reason}</div>
        </div>
      {/if}
      {#if errors.length}<div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>{/if}
      <div class="ar">
        <button onclick={onClose}>Отмена</button>
        {#if !result}<button onclick={calcGap} class="btn-p">Проверить</button>
        {:else}<button onclick={saveGapNote} disabled={saving} class="btn-p">{saving ? '...' : 'Сохранить'}</button>{/if}
      </div>

    {:else if mode === 'fill'}
      <div class="hint">
        <div>Запиши фактическую цену исполнения ордера на D+1 или пометь как expired</div>
      </div>
      <div class="row-2" style="margin-bottom:10px">
        <div class="fg"><label>Цена исполнения</label><input bind:value={fillPrice} oninput={calcFill} inputmode="decimal" /></div>
        <div class="fg"><label>Дата D+1</label><input type="date" bind:value={d1Date} /></div>
      </div>
      {#if result?.type === 'fill'}
        <div class="prev prev-ok">
          <div class="prev-h">✓ ОРДЕР ИСПОЛНЕН</div>
          <div>Entry: <b>${result.entry.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${result.stop.toFixed(2)}</b> (dist ${result.stopDistance.toFixed(2)})</div>
          <div>T1: <b>${result.target1.toFixed(2)}</b> · T2: <b>${result.target2.toFixed(2)}</b></div>
        </div>
      {/if}
      {#if errors.length}<div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>{/if}
      <div class="ar">
        <button onclick={onClose}>Отмена</button>
        <button onclick={markExpired} disabled={saving} class="btn-r">Не сработал (15:45 EST)</button>
        {#if !result}<button onclick={calcFill} class="btn-p">Рассчитать</button>
        {:else}<button onclick={saveFill} disabled={saving} class="btn-p">{saving ? '...' : 'Сохранить и → + Сделка'}</button>{/if}
      </div>

    {:else}
      <div class="hint">
        <div><b>LONG:</b> Close D+2 ≤ Entry → закрыть всё по Close</div>
        <div><b>SHORT:</b> Close D+2 ≥ Entry → закрыть всё по Close</div>
        <div>Entry: <b>${candidate.entry ? Number(candidate.entry).toFixed(2) : '—'}</b></div>
      </div>
      <div class="row-2" style="margin-bottom:10px">
        <div class="fg"><label>Close D+2</label><input bind:value={closeD2} oninput={calcD2} inputmode="decimal" /></div>
        <div class="fg"><label>Дата D+2</label><input type="date" bind:value={d1Date} /></div>
      </div>
      {#if result?.type === 'd2'}
        {@const c = result.check}
        <div class="prev" class:prev-bad={c.shouldClose} class:prev-ok={!c.shouldClose}>
          <div class="prev-h">{c.shouldClose ? '⚠ ЗАКРЫТЬ ПО CLOSE D+2' : '✓ ПОЗИЦИЯ ОСТАЁТСЯ'}</div>
          <div>{c.reason}</div>
        </div>
      {/if}
      {#if errors.length}<div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>{/if}
      <div class="ar">
        <button onclick={onClose}>Отмена</button>
        {#if !result}<button onclick={calcD2} class="btn-p">Проверить</button>
        {:else}<button onclick={saveD2} disabled={saving} class="btn-p">{saving ? '...' : 'Сохранить'}</button>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 620px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .info { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 12px; }
  .info b { color: var(--color-text); }
  .tabs { display: flex; gap: 4px; margin-bottom: 14px; flex-wrap: wrap; }
  .tab { font-family: var(--font-mono); font-size: 10px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--color-line); background: var(--color-bg2); color: var(--color-t2); cursor: pointer; }
  .tab-active { border-color: var(--color-acc); color: var(--color-acc); background: rgba(126,232,162,0.08); }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.8; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; }
  .prev { padding: 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; margin: 12px 0; line-height: 1.8; }
  .prev-ok { background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); }
  .prev-warn { background: rgba(255,200,90,0.08); border: 1px solid var(--color-acc3); color: var(--color-text); }
  .prev-bad { background: rgba(255,107,138,0.08); border: 1px solid var(--color-acc2); color: var(--color-text); }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 6px; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
</style>
