<script lang="ts">
  import { onMount } from 'svelte';
  import { parseNum, calcNR7D0Metrics, validateNR7D0, calcNR7Entry } from '$lib/strategies/nr7';
  import { insertCandidate, updateCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  import { saveDraft, loadDraft, clearDraft, saveCapital, loadCapital, saveMarketData, loadMarketData } from '$lib/utils/draftStorage';
  import type { Candidate } from '$lib/types';

  let { onClose, onAdded, editCandidate = null }: {
    onClose: () => void;
    onAdded: () => void;
    editCandidate?: Candidate | null;
  } = $props();

  const isEdit = !!editCandidate;
  const ep = (editCandidate?.payload as any);

  let ticker        = $state(editCandidate?.ticker ?? '');
  let t0Date        = $state(editCandidate?.signal_date ?? new Date().toISOString().split('T')[0]);
  // SPY / VIX
  let spyClose      = $state(ep?.spy_close?.toString() ?? '');
  let spyEma50      = $state(ep?.spy_ema50?.toString() ?? '');
  let vix           = $state(ep?.vix?.toString() ?? '');
  // Stock T0
  let d0H           = $state(ep?.d0?.H?.toString() ?? '');
  let d0L           = $state(ep?.d0?.L?.toString() ?? '');
  let d0C           = $state(ep?.d0?.C?.toString() ?? '');
  let ema21         = $state(ep?.ema21?.toString() ?? '');
  let ema50         = $state(ep?.ema50?.toString() ?? '');
  let atr14         = $state(ep?.atr14?.toString() ?? '');
  let minRangePrev6 = $state(ep?.min_range_prev6?.toString() ?? '');
  let high7         = $state(ep?.high7?.toString() ?? '');
  let low7          = $state(ep?.low7?.toString() ?? '');
  // Инициализируем из localStorage сразу (работает для edit и new)
  let capital  = $state(
    typeof window !== 'undefined'
      ? (() => { const v = localStorage.getItem(`tj_capital_nr7`); return v && parseFloat(v) > 0 ? v : '50000'; })()
      : '50000'
  );

  let preview  = $state<any>(null);
  let errors   = $state<string[]>([]);
  let warnings = $state<string[]>([]);
  let saving   = $state(false);

  function onTickerInput(e: Event) {
    ticker = (e.target as HTMLInputElement).value.toUpperCase();
  }

  function calc() {
    preview = null; errors = []; warnings = [];

    const d = {
      spyClose: parseNum(spyClose),
      spyEma50: parseNum(spyEma50),
      vix:      parseNum(vix),
      open:     parseNum(d0H),  // open не используется в логике, ставим заглушку
      high:     parseNum(d0H),
      low:      parseNum(d0L),
      close:    parseNum(d0C),
      ema21:    parseNum(ema21),
      ema50:    parseNum(ema50),
      atr14:    parseNum(atr14),
      minRangePrev6: parseNum(minRangePrev6),
      high7:    parseNum(high7),
      low7:     parseNum(low7)
    };

    const missing: string[] = [];
    if (!ticker.trim()) missing.push('Ticker');
    for (const [k, v] of [
      ['SPY Close', d.spyClose], ['SPY EMA50', d.spyEma50], ['VIX', d.vix],
      ['T0 High', d.high], ['T0 Low', d.low], ['T0 Close', d.close],
      ['EMA21', d.ema21], ['EMA50', d.ema50], ['ATR14', d.atr14],
      ['min Range[-6..-1]', d.minRangePrev6], ['High7', d.high7], ['Low7', d.low7]
    ] as [string, number][]) {
      if (isNaN(v)) missing.push(k);
    }
    if (missing.length) { errors = ['Заполни: ' + missing.join(', ')]; return; }

    const m = calcNR7D0Metrics(d);
    const v = validateNR7D0(d, m);
    errors = v.errors; warnings = v.warnings;

    let entry = null;
    if (m.direction) {
      entry = calcNR7Entry(d.high, d.low, d.atr14, m.direction, parseNum(capital) || 50000);
    }

    preview = { d, m, v, entry };
  }

  async function save() {
    calc();
    if (!preview?.v?.valid || preview?.entry?.excluded) return;
    if (!$user) return;
    saving = true;
    const { d, m, entry } = preview;
    try {
      const t = ticker.trim().toUpperCase();
      const id = `${t}_NR7_${t0Date}`;
      const payload = {
        spy_close: d.spyClose, spy_ema50: d.spyEma50, vix: d.vix,
        spy_regime: m.spyRegime,
        d0: { H: d.high, L: d.low, C: d.close },
        ema21: d.ema21, ema50: d.ema50, atr14: d.atr14,
        min_range_prev6: d.minRangePrev6, high7: d.high7, low7: d.low7,
        metrics: {
          range: m.range,
          range_atr_ratio: m.rangeAtrRatio,
          is_nr7: m.isNR7,
          mid7: m.mid7
        }
      };
      if (isEdit && editCandidate) {
        await updateCandidate(editCandidate.id, {
          ticker: t, signal_date: t0Date,
          direction: m.direction,
          entry: entry.entry, stop: entry.stop,
          target1: entry.target1, target2: entry.target2,
          payload
        });
      } else {
        await insertCandidate({
          id, user_id: $user.id, strategy: 'nr7',
          ticker: t, signal_date: t0Date,
          direction: m.direction, status: 'WAITING_D1',
          entry: entry.entry, stop: entry.stop,
          target1: entry.target1, target2: entry.target2,
          payload
        });
      }
      // Очищаем черновик и сохраняем маркет-данные
      clearDraft(draftKey);
      const spyC = parseNum(spyClose), spyE = parseNum(spyEma50), v = parseNum(vix);
      if (!isNaN(spyC) || !isNaN(spyE) || !isNaN(v)) {
        saveMarketData(t0Date, {
          ...(isNaN(spyC) ? {} : { spyClose: spyC }),
          ...(isNaN(spyE) ? {} : { spyEma50: spyE }),
          ...(isNaN(v)    ? {} : { vix: v })
        });
      }
      onAdded(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  $effect(() => { if (isEdit && !preview) calc(); });

  // ─── Draft + Market data ───
  const draftKey = isEdit ? `nr7_edit_${editCandidate?.id}` : 'nr7_new';

  onMount(() => {
    // 1. Восстанавливаем черновик (только в режиме "new")
    if (!isEdit) {
      const d = loadDraft<any>(draftKey);
      if (d) {
        if (d.ticker)        ticker        = d.ticker;
        if (d.t0Date)        t0Date        = d.t0Date;
        if (d.spyClose)      spyClose      = d.spyClose;
        if (d.spyEma50)      spyEma50      = d.spyEma50;
        if (d.vix)           vix           = d.vix;
        if (d.d0H)           d0H           = d.d0H;
        if (d.d0L)           d0L           = d.d0L;
        if (d.d0C)           d0C           = d.d0C;
        if (d.ema21)         ema21         = d.ema21;
        if (d.ema50)         ema50         = d.ema50;
        if (d.atr14)         atr14         = d.atr14;
        if (d.minRangePrev6) minRangePrev6 = d.minRangePrev6;
        if (d.high7)         high7         = d.high7;
        if (d.low7)          low7          = d.low7;
        if (d.capital)       capital       = d.capital;
      }
    }
    // 2. Автоподстановка SPY/VIX из маркет-данных за этот день
    const mkt = loadMarketData(t0Date);
    if (mkt) {
      if (!spyClose && mkt.spyClose !== undefined) spyClose = String(mkt.spyClose);
      if (!spyEma50 && mkt.spyEma50 !== undefined) spyEma50 = String(mkt.spyEma50);
      if (!vix      && mkt.vix      !== undefined) vix      = String(mkt.vix);
    }
    // Восстанавливаем размер позиции только если ещё не задан черновиком
    if (capital === '50000') {
      capital = String(loadCapital('nr7', 50000));
    }
    calc();
  });

  // Автосохранение черновика (только для new)
  $effect(() => {
    if (isEdit) return;
    // Сохраняем черновик
    saveDraft(draftKey, {
      ticker, t0Date, spyClose, spyEma50, vix,
      d0H, d0L, d0C, ema21, ema50, atr14,
      minRangePrev6, high7, low7, capital
    });
    // Сохраняем маркет-данные и размер позиции (работает и при редактировании)
    const _cap = parseFloat(capital.replace(',','.'));
    if (!isNaN(_cap) && _cap > 0) saveCapital('nr7', _cap);
  });

  function resetDraft() {
    if (!confirm('Очистить все поля и сбросить черновик?')) return;
    clearDraft(draftKey);
    ticker = '';
    spyClose = ''; spyEma50 = ''; vix = '';
    d0H = ''; d0L = ''; d0C = '';
    ema21 = ''; ema50 = ''; atr14 = '';
    minRangePrev6 = ''; high7 = ''; low7 = '';
    capital = '50000';
    preview = null; errors = []; warnings = [];
    // Восстанавливаем market data
    const mkt = loadMarketData(t0Date);
    if (mkt) {
      if (mkt.spyClose !== undefined) spyClose = String(mkt.spyClose);
      if (mkt.spyEma50 !== undefined) spyEma50 = String(mkt.spyEma50);
      if (mkt.vix      !== undefined) vix      = String(mkt.vix);
    }
  }

  const clr = (ok: boolean) => ok ? 'var(--color-acc)' : 'var(--color-acc2)';
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать' : 'Добавить T0'} · NR7 Breakout</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="hint">
      <div><b>LONG:</b> VIX&lt;35 · SPY&gt;EMA50 · Close&gt;EMA21 · EMA21&gt;EMA50 · NR7 · Close≥Mid7 · Range/ATR&lt;0.75</div>
      <div><b>SHORT:</b> VIX&lt;35 · SPY&lt;EMA50 · Close&lt;EMA21 · EMA21&lt;EMA50 · NR7 · Close≤Mid7 · Range/ATR&lt;0.75</div>
    </div>

    <div class="row-2">
      <div class="fg"><label>Ticker</label><input value={ticker} oninput={onTickerInput} placeholder="AAPL" class="up" disabled={isEdit} /></div>
      <div class="fg"><label>T0 Date</label><input type="date" bind:value={t0Date} disabled={isEdit} /></div>
    </div>

    <div class="sect">Market regime</div>
    <div class="row-3">
      <div class="fg"><label>SPY Close</label><input bind:value={spyClose} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>SPY EMA50</label><input bind:value={spyEma50} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>VIX</label><input bind:value={vix} oninput={calc} inputmode="decimal" placeholder="&lt; 35" /></div>
    </div>

    <div class="sect">Акция T0</div>
    <div class="row-3">
      <div class="fg"><label>T0 High</label><input bind:value={d0H} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>T0 Low</label><input bind:value={d0L} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>T0 Close</label><input bind:value={d0C} oninput={calc} inputmode="decimal" /></div>
    </div>

    <div class="sect">Индикаторы и 7-дневный диапазон</div>
    <div class="row-3" style="margin-bottom:6px">
      <div class="fg"><label>EMA21</label><input bind:value={ema21} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>EMA50</label><input bind:value={ema50} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>ATR14</label><input bind:value={atr14} oninput={calc} inputmode="decimal" /></div>
    </div>
    <div class="row-4">
      <div class="fg"><label>High7 (max 7д)</label><input bind:value={high7} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Low7 (min 7д)</label><input bind:value={low7} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>min Range[-6..-1]</label><input bind:value={minRangePrev6} oninput={calc} inputmode="decimal" placeholder="Range_T0 &lt; этого" /></div>
      <div class="fg"><label>Капитал $</label><input bind:value={capital} oninput={calc} inputmode="numeric" /></div>
    </div>

    {#if warnings.length}
      <div class="warn">{#each warnings as w}<div>⚠ {w}</div>{/each}</div>
    {/if}
    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    {#if preview}
      {@const m = preview.m}
      {@const v = preview.v}
      <div class="prev">
        <div class="prev-h">
          T0 VALIDATION ·
          <span style="color:{m.direction ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.direction ?? 'НЕТ СИГНАЛА'}</span>
          {#if m.spyRegime !== 'NEUTRAL'}<span style="color:var(--color-t2)"> · SPY: {m.spyRegime}</span>{/if}
        </div>
        <div class="checks">
          {#each v.checks as c}
            <div style="color:{clr(c.ok)}">
              {c.ok ? '✓' : '✗'} {c.label}: <b>{c.value}</b>
            </div>
          {/each}
        </div>
        {#if preview.entry && m.direction}
          {@const e = preview.entry}
          <div class="entry-block" class:entry-bad={e.excluded}>
            {#if e.excluded}
              <div style="color:var(--color-acc2)">⚠ {e.excludedReason}</div>
            {:else}
              <div>{m.direction === 'LONG' ? 'BuyStop' : 'SellStop'}: <b style="color:var(--color-acc)">${e.entry.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${e.stop.toFixed(2)}</b> (dist ${e.stopDistance.toFixed(2)})</div>
              <div>Shares: <b>{e.shares}</b> · Position: <b>${e.positionValue.toFixed(0)}</b> · Risk: <b>${e.riskAmount.toFixed(0)}</b> (1%)</div>
              <div>T1 (+1.5×ATR): <b>${e.target1.toFixed(2)}</b> · T2 (+3×ATR): <b>${e.target2.toFixed(2)}</b></div>
              <div style="color:var(--color-t3);font-size:9px;margin-top:4px">Ордер действует только D+1 · если не сработал к 15:45 EST → отменить</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <div class="ar">
      {#if !isEdit}<button onclick={resetDraft} type="button" title="Очистить черновик">↻ Сбросить</button>{/if}
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={!preview?.v?.valid || preview?.entry?.excluded || saving} class="btn-p">
        {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; overflow-y: auto; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 700px; max-width: 100%; max-height: 92vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.8; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 12px 0 8px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
  .row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 4px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .fg input:disabled { opacity: 0.6; }
  .up { text-transform: uppercase; }
  .warn { padding: 8px 12px; background: rgba(255,200,90,0.1); border: 1px solid rgba(255,200,90,0.4); color: var(--color-acc3); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 10px; }
  .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 10px; line-height: 1.7; margin-bottom: 8px; }
  .entry-block { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-line); font-size: 10px; line-height: 1.8; }
  .entry-block b { color: var(--color-text); }
  .entry-bad { color: var(--color-acc2); }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
