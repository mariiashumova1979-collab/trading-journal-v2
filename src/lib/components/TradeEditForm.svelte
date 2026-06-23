<script lang="ts">
  import { updateTrade } from '$lib/data/trades';
  import { syncCandidateOnTradeUpdate } from '$lib/data/sync';
  import { parseNum } from '$lib/strategies/impulse';
  import type { Trade, TradeSetup } from '$lib/types';
  import SetupAnalysis from './SetupAnalysis.svelte';

  let { trade, onClose, onSaved }: {
    trade: Trade;
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  // ─── Trail stop section ───
  let trailDayHigh = $state('');
  let trailDayLow = $state('');
  let trailPreview = $state<{ newStop: number; canTrail: boolean; reason: string } | null>(null);

  function recalcTrail() {
    trailPreview = null;
    if (trade.type === 'LONG') {
      const lowYesterday = parseNum(trailDayLow);
      if (isNaN(lowYesterday)) return;
      const currentStop = trade.stop != null ? Number(trade.stop) : null;
      const anchor = trade.impulse_anchor;
      // For LONG: новый_стоп = max(текущий_стоп, Low_вчера)
      let newStop = lowYesterday;
      let reason = 'Подтянуть до Low вчера';
      let canTrail = true;
      if (currentStop != null && newStop <= currentStop) {
        canTrail = false;
        reason = 'Low вчера ниже текущего стопа — не подтягиваем';
        newStop = currentStop;
      }
      if (anchor != null && newStop < anchor) {
        canTrail = false;
        reason = 'Low вчера ниже якоря — стоп остаётся на якоре';
        newStop = anchor;
      }
      trailPreview = { newStop, canTrail, reason };
    } else {
      const highYesterday = parseNum(trailDayHigh);
      if (isNaN(highYesterday)) return;
      const currentStop = trade.stop != null ? Number(trade.stop) : null;
      const anchor = trade.impulse_anchor;
      let newStop = highYesterday;
      let reason = 'Подтянуть до High вчера';
      let canTrail = true;
      if (currentStop != null && newStop >= currentStop) {
        canTrail = false;
        reason = 'High вчера выше текущего стопа — не подтягиваем';
        newStop = currentStop;
      }
      if (anchor != null && newStop > anchor) {
        canTrail = false;
        reason = 'High вчера выше якоря — стоп остаётся на якоре';
        newStop = anchor;
      }
      trailPreview = { newStop, canTrail, reason };
    }
  }

  async function applyTrail() {
    if (!trailPreview || !trailPreview.canTrail) return;
    saving = true;
    try {
      await updateTrade(trade.id, { stop: trailPreview.newStop });
      trade.stop = trailPreview.newStop;
      trailPreview = null;
      trailDayHigh = '';
      trailDayLow = '';
      onSaved();
    } catch (e: any) {
      errors = ['Ошибка трейлинга: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }

  // ─── Close trade section ───
  let exitPrice = $state(trade.exit_price?.toString() ?? '');
  // Миграция старых кодов на новые
  const _reasonMap: Record<string,string> = { TARGET1:'target1', TARGET2:'target2', STOP:'stop', TIME_STOP:'time_stop', MANUAL:'manual' };
  const _initReason = trade.exit_reason ? (_reasonMap[trade.exit_reason] ?? trade.exit_reason) : 'target1';
  let exitReason = $state<string>(_initReason);
  let exitDate = $state(trade.exit_date ?? new Date().toISOString().split('T')[0]);
  let extraCommission = $state('0');

  // ─── Setup analysis ───
  let setup = $state<TradeSetup | null>(trade.setup ? { ...trade.setup } : null);

  // ─── Notes ───
  let notes = $state(trade.notes ?? '');

  // ─── Common ───
  let saving = $state(false);
  let errors = $state<string[]>([]);

  function calculateClose() {
    const exit = parseNum(exitPrice);
    const extra = parseNum(extraCommission) || 0;
    if (isNaN(exit) || !trade.entry || !trade.shares) return null;
    const totalComm = (trade.commission || 0) + extra;
    let pnl_net: number;
    if (trade.type === 'LONG') {
      pnl_net = (exit - trade.entry) * trade.shares - totalComm;
    } else {
      pnl_net = (trade.entry - exit) * trade.shares - totalComm;
    }
    const pnl_pct = (pnl_net / (trade.entry * trade.shares)) * 100;
    const result = pnl_net >= 0 ? 'WIN' : 'LOSS';
    return { exit, pnl_net, pnl_pct, result, totalComm };
  }

  async function closeTrade() {
    const calc = calculateClose();
    if (!calc) {
      errors = ['Введи Exit price'];
      return;
    }
    if (!exitDate) {
      errors = ['Введи Exit date'];
      return;
    }
    saving = true;
    try {
      const updated = await updateTrade(trade.id, {
        status: 'CLOSED',
        exit_price: calc.exit,
        exit_date: exitDate,
        exit_reason: exitReason,
        commission: calc.totalComm,
        pnl_net: calc.pnl_net,
        pnl_pct: calc.pnl_pct,
        result: calc.result as 'WIN' | 'LOSS',
        notes,
        setup
      });
      await syncCandidateOnTradeUpdate(updated);
      onSaved();
      onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }

  async function saveAll() {
    saving = true;
    errors = [];
    try {
      await updateTrade(trade.id, { notes, setup });
      onSaved();
      onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }

  const closeCalc = $derived(calculateClose());
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{trade.ticker} · {trade.type} · {trade.status}</div>
      <button onclick={onClose} class="cls" aria-label="Close">×</button>
    </div>

    <div class="info">
      <div>Entry <b>${trade.entry?.toFixed(2)}</b> · Stop <b style="color:var(--color-acc2)">${trade.stop != null ? Number(trade.stop).toFixed(2) : '—'}</b> · Shares <b>{trade.shares}</b> · Date {trade.entry_date ?? '—'}</div>
      {#if trade.target1 != null}<div>T1 ${Number(trade.target1).toFixed(2)} · T2 ${trade.target2 != null ? Number(trade.target2).toFixed(2) : '—'}</div>{/if}
      {#if trade.atr_abs}<div>ATR <b>{trade.atr_abs.toFixed(2)}</b>{#if trade.impulse_anchor != null} · Anchor <b>${trade.impulse_anchor.toFixed(2)}</b>{/if}</div>{/if}
    </div>

    <!-- TRAIL STOP (только для OPEN) -->
    {#if trade.status === 'OPEN'}
      <div class="section">
        <div class="sect-title">📈 Трейлинг стопа</div>
        <div class="hint">
          {#if trade.type === 'LONG'}
            Введи <b>Low вчерашнего дня</b>. Если он выше текущего стопа и якоря — стоп подтянется. Иначе остаётся.
          {:else}
            Введи <b>High вчерашнего дня</b>. Если он ниже текущего стопа и якоря — стоп подтянется. Иначе остаётся.
          {/if}
        </div>
        <div class="row">
          {#if trade.type === 'LONG'}
            <div class="fg"><label>Low вчера</label><input bind:value={trailDayLow} oninput={recalcTrail} inputmode="decimal" /></div>
          {:else}
            <div class="fg"><label>High вчера</label><input bind:value={trailDayHigh} oninput={recalcTrail} inputmode="decimal" /></div>
          {/if}
          {#if trailPreview}
            <div class="trail-preview" class:trail-ok={trailPreview.canTrail} class:trail-no={!trailPreview.canTrail}>
              {trailPreview.canTrail ? '✓' : '✕'} Новый стоп: <b>${trailPreview.newStop.toFixed(2)}</b><br><span style="font-size:9px">{trailPreview.reason}</span>
            </div>
          {/if}
        </div>
        {#if trailPreview?.canTrail}
          <div class="ar"><button class="btn-p" onclick={applyTrail} disabled={saving}>Подтянуть стоп</button></div>
        {/if}
      </div>
    {/if}

    <!-- CLOSE TRADE -->
    {#if trade.status === 'OPEN' || trade.status === 'PARTIAL'}
      <div class="section">
        <div class="sect-title">🔒 Закрыть сделку</div>
        <div class="row row-3">
          <div class="fg"><label>Exit price</label><input bind:value={exitPrice} inputmode="decimal" /></div>
          <div class="fg"><label>Exit date</label><input type="date" bind:value={exitDate} /></div>
          <div class="fg">
            <label>Exit reason</label>
            <select bind:value={exitReason}>
              <option value="target1">target1 — цель 1</option>
              <option value="target2">target2 — цель 2</option>
              <option value="stop">stop — стоп-лосс</option>
              <option value="trail">trail — трейлинг стоп</option>
              <option value="ema200">ema200 — закрытие по другую сторону EMA200</option>
              <option value="intraday_check">intraday_check — внутридневная проверка (17:00 и т.п.)</option>
              <option value="d1_close_check">d1_close_check — no-progress / D+1 EOD check</option>
              <option value="time_stop">time_stop — тайм-стоп (D+3/D+5)</option>
              <option value="manual">manual — ручной выход</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="fg"><label>Доп. комиссия</label><input bind:value={extraCommission} inputmode="decimal" /></div>
          <div></div>
        </div>
        {#if closeCalc}
          <div class="prev" class:prev-loss={closeCalc.result === 'LOSS'} class:prev-win={closeCalc.result === 'WIN'}>
            <div class="prev-h">PNL CALC</div>
            <div>P&L net: <b>${closeCalc.pnl_net.toFixed(2)}</b> ({closeCalc.pnl_pct >= 0 ? '+' : ''}{closeCalc.pnl_pct.toFixed(2)}%)</div>
            <div>Result: <b>{closeCalc.result}</b> · Total commission: ${closeCalc.totalComm.toFixed(2)}</div>
          </div>
        {/if}
        <div class="ar">
          <button class="btn-p" onclick={closeTrade} disabled={saving || !exitPrice}>Закрыть сделку</button>
        </div>
      </div>
    {/if}

    <!-- SETUP ANALYSIS -->
    <div class="section">
      <SetupAnalysis bind:setup direction={trade.type} />
    </div>

    <!-- NOTES -->
    <div class="section">
      <div class="sect-title">Заметки</div>
      <textarea bind:value={notes} rows="3" style="width:100%;padding:8px"></textarea>
    </div>

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      <button class="btn-p" onclick={saveAll} disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; overflow-y: auto; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 720px; max-width: 100%; max-height: 95vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 16px; margin-bottom: 14px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .info { font-family: var(--font-mono); font-size: 11px; color: var(--color-t2); padding: 10px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.9; margin-bottom: 14px; }
  .info b { color: var(--color-text); }
  .section { margin: 16px 0; padding: 12px; border: 1px solid var(--color-line); border-radius: 8px; background: var(--color-bg2); }
  .sect-title { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--color-acc4); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); margin-bottom: 10px; line-height: 1.7; }
  .hint b { color: var(--color-text); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; align-items: end; }
  .row-3 { grid-template-columns: 1fr 1fr 1fr; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input, .fg select { width: 100%; }
  .trail-preview { padding: 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 11px; line-height: 1.6; }
  .trail-ok { background: rgba(126, 232, 162, 0.1); border: 1px solid var(--color-acc); color: var(--color-text); }
  .trail-no { background: rgba(255, 107, 138, 0.1); border: 1px solid var(--color-acc2); color: var(--color-text); }
  .prev { padding: 10px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 11px; line-height: 1.9; margin: 10px 0; }
  .prev-win { background: rgba(126, 232, 162, 0.1); border: 1px solid var(--color-acc); }
  .prev-loss { background: rgba(255, 107, 138, 0.1); border: 1px solid var(--color-acc2); }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; color: var(--color-acc4); }
  .err { padding: 10px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.7; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
</style>
