<script lang="ts">
  import { onMount } from 'svelte';
  import { parseNum, calcIBSD0Metrics, validateIBSD0 } from '$lib/strategies/ibs_mean_reversion';
  import { insertCandidate, updateCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  import { saveDraft, loadDraft, clearDraft, saveMarketData, loadMarketData } from '$lib/utils/draftStorage';
  import type { Candidate } from '$lib/types';

  let { onClose, onAdded, editCandidate = null }: {
    onClose: () => void;
    onAdded: () => void;
    editCandidate?: Candidate | null;
  } = $props();

  const isEdit = !!editCandidate;
  const ep = (editCandidate?.payload as any);

  let ticker      = $state(editCandidate?.ticker ?? '');
  let t0Date      = $state(editCandidate?.signal_date ?? new Date().toISOString().split('T')[0]);
  // SPY
  let spyClose    = $state(ep?.spy_close?.toString() ?? '');
  let spySma200   = $state(ep?.spy_sma200?.toString() ?? '');
  // Stock D0
  let d0O         = $state(ep?.d0?.O?.toString() ?? '');
  let d0H         = $state(ep?.d0?.H?.toString() ?? '');
  let d0L         = $state(ep?.d0?.L?.toString() ?? '');
  let d0C         = $state(ep?.d0?.C?.toString() ?? '');
  let sma200      = $state(ep?.sma200?.toString() ?? '');
  let sma200_20   = $state(ep?.sma200_20ago?.toString() ?? '');
  let rsi2        = $state(ep?.rsi2?.toString() ?? '');
  let atr14       = $state(ep?.atr14?.toString() ?? '');

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
      spyClose:    parseNum(spyClose),
      spySma200:   parseNum(spySma200),
      open:        parseNum(d0O),
      high:        parseNum(d0H),
      low:         parseNum(d0L),
      close:       parseNum(d0C),
      sma200:      parseNum(sma200),
      sma200_20ago: parseNum(sma200_20),
      rsi2:        parseNum(rsi2),
      atr14:       parseNum(atr14)
    };

    const missing: string[] = [];
    if (!ticker.trim()) missing.push('Ticker');
    for (const [k, v] of [
      ['SPY Close', d.spyClose], ['SPY SMA200', d.spySma200],
      ['D0 High', d.high], ['D0 Low', d.low], ['D0 Close', d.close],
      ['SMA200', d.sma200], ['SMA200 (20 дней назад)', d.sma200_20ago],
      ['RSI(2)', d.rsi2], ['ATR(14)', d.atr14]
    ] as [string, number][]) {
      if (isNaN(v)) missing.push(k);
    }
    if (missing.length) { errors = ['Заполни: ' + missing.join(', ')]; return; }

    const m = calcIBSD0Metrics(d);
    const v = validateIBSD0(d, m);
    errors = v.errors; warnings = v.warnings;
    preview = { d, m, v };
  }

  async function save() {
    calc();
    if (!preview?.v?.valid) return;
    if (!$user) return;
    saving = true;
    const { d, m } = preview;
    try {
      const t = ticker.trim().toUpperCase();
      const id = `${t}_IBS_${t0Date}`;
      const payload = {
        spy_close: d.spyClose, spy_sma200: d.spySma200,
        spy_regime: m.spyRegime,
        d0: { O: d.open, H: d.high, L: d.low, C: d.close },
        sma200: d.sma200, sma200_20ago: d.sma200_20ago,
        rsi2: d.rsi2, atr14: d.atr14,
        metrics: {
          ibs: m.ibs,
          range_atr_ratio: m.rangeAtrRatio,
          sma200_trend: m.sma200Trend
        }
      };
      if (isEdit && editCandidate) {
        await updateCandidate(editCandidate.id, {
          ticker: t, signal_date: t0Date,
          direction: m.direction, payload
        });
      } else {
        await insertCandidate({
          id, user_id: $user.id, strategy: 'ibs_swing',
          ticker: t, signal_date: t0Date,
          direction: m.direction, status: 'WAITING_D1',
          entry: null, stop: null, target1: null, target2: null,
          payload
        });
      }
      clearDraft(draftKey);
      const spyC = parseNum(spyClose), spyM = parseNum(spySma200);
      if (!isNaN(spyC) || !isNaN(spyM)) {
        saveMarketData(t0Date, {
          ...(isNaN(spyC) ? {} : { spyClose: spyC }),
          ...(isNaN(spyM) ? {} : { spySma200: spyM })
        });
      }
      onAdded(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  $effect(() => { if (isEdit && !preview) calc(); });

  // ─── Draft + Market data ───
  const draftKey = isEdit ? `ibs_edit_${editCandidate?.id}` : 'ibs_new';

  onMount(() => {
    if (!isEdit) {
      const d = loadDraft<any>(draftKey);
      if (d) {
        if (d.ticker)    ticker    = d.ticker;
        if (d.t0Date)    t0Date    = d.t0Date;
        if (d.spyClose)  spyClose  = d.spyClose;
        if (d.spySma200) spySma200 = d.spySma200;
        if (d.d0O)       d0O       = d.d0O;
        if (d.d0H)       d0H       = d.d0H;
        if (d.d0L)       d0L       = d.d0L;
        if (d.d0C)       d0C       = d.d0C;
        if (d.sma200)    sma200    = d.sma200;
        if (d.sma200_20) sma200_20 = d.sma200_20;
        if (d.rsi2)      rsi2      = d.rsi2;
        if (d.atr14)     atr14     = d.atr14;
      }
    }
    const mkt = loadMarketData(t0Date);
    if (mkt) {
      if (!spyClose  && mkt.spyClose  !== undefined) spyClose  = String(mkt.spyClose);
      if (!spySma200 && mkt.spySma200 !== undefined) spySma200 = String(mkt.spySma200);
    }
    calc();
  });

  $effect(() => {
    if (isEdit) return;
    saveDraft(draftKey, {
      ticker, t0Date, spyClose, spySma200,
      d0O, d0H, d0L, d0C, sma200, sma200_20, rsi2, atr14
    });
  });

  function resetDraft() {
    if (!confirm('Очистить все поля и сбросить черновик?')) return;
    clearDraft(draftKey);
    ticker = '';
    spyClose = ''; spySma200 = '';
    d0O = ''; d0H = ''; d0L = ''; d0C = '';
    sma200 = ''; sma200_20 = ''; rsi2 = ''; atr14 = '';
    preview = null; errors = []; warnings = [];
    const mkt = loadMarketData(t0Date);
    if (mkt) {
      if (mkt.spyClose  !== undefined) spyClose  = String(mkt.spyClose);
      if (mkt.spySma200 !== undefined) spySma200 = String(mkt.spySma200);
    }
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const clr = (ok: boolean) => ok ? 'var(--color-acc)' : 'var(--color-acc2)';
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать' : 'Добавить T0'} · IBS Mean Reversion</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="hint">
      <div><b>LONG:</b> SPY&gt;SMA200 · Close&gt;SMA200 · SMA200 растёт · IBS&lt;0.20 · RSI(2)&lt;10 · Range&lt;2×ATR</div>
      <div><b>SHORT:</b> SPY&lt;SMA200 · Close&lt;SMA200 · SMA200 падает · IBS&gt;0.80 · RSI(2)&gt;90 · Range&lt;2×ATR</div>
    </div>

    <div class="row-2">
      <div class="fg"><label>Ticker</label><input value={ticker} oninput={onTickerInput} placeholder="AAPL" class="up" disabled={isEdit} /></div>
      <div class="fg"><label>T0 Date</label><input type="date" bind:value={t0Date} disabled={isEdit} /></div>
    </div>

    <div class="sect">SPY (для определения режима рынка)</div>
    <div class="row-2">
      <div class="fg"><label>SPY Close</label><input bind:value={spyClose} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>SPY SMA200</label><input bind:value={spySma200} oninput={calc} inputmode="decimal" /></div>
    </div>

    <div class="sect">Акция T0 — OHLC + Индикаторы</div>
    <div class="row-4" style="margin-bottom:8px">
      <div class="fg"><label>Open</label><input bind:value={d0O} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>High</label><input bind:value={d0H} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Low</label><input bind:value={d0L} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Close</label><input bind:value={d0C} oninput={calc} inputmode="decimal" /></div>
    </div>
    <div class="row-4">
      <div class="fg"><label>SMA200 (сегодня)</label><input bind:value={sma200} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>SMA200 (20 дней назад)</label><input bind:value={sma200_20} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>RSI(2)</label><input bind:value={rsi2} oninput={calc} inputmode="decimal" placeholder="0–100" /></div>
      <div class="fg"><label>ATR(14)</label><input bind:value={atr14} oninput={calc} inputmode="decimal" /></div>
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
          <span style="color:{m.spyRegime === 'NEUTRAL' ? 'var(--color-acc2)' : 'var(--color-t2)'}"> · SPY: {m.spyRegime}</span>
        </div>
        <div class="checks">
          {#each v.checks as c}
            <div style="color:{clr(c.ok)}">
              {c.ok ? '✓' : '✗'} {c.label}: <b>{c.value}</b>
            </div>
          {/each}
        </div>
        {#if m.direction}
          <div class="d1-preview">
            <div>IBS: <b>{m.ibs.toFixed(3)}</b> · Range/ATR: <b>{m.rangeAtrRatio.toFixed(2)}</b></div>
            <div>Gap cancel: {m.direction === 'LONG' ? `≥ ${(preview.d.close * 1.02).toFixed(2)} (+2%)` : `≤ ${(preview.d.close * 0.98).toFixed(2)} (-2%)`}</div>
            <div style="color:var(--color-t3)">Вход = Open D+1 · Stop = Entry ± min(1.5×ATR, 6%) · Risk 1% капитала</div>
          </div>
        {/if}
      </div>
    {/if}

    <div class="ar">
      {#if !isEdit}<button onclick={resetDraft} type="button" title="Очистить черновик">↻ Сбросить</button>{/if}
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={!preview?.v?.valid || saving} class="btn-p">
        {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; overflow-y: auto; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 680px; max-width: 100%; max-height: 92vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.8; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 12px 0 8px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 4px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .fg input:disabled { opacity: 0.6; }
  .up { text-transform: uppercase; }
  .warn { padding: 8px 12px; background: rgba(255,200,90,0.1); border: 1px solid rgba(255,200,90,0.4); color: var(--color-acc3); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 10px; }
  .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 10px; line-height: 1.7; }
  .d1-preview { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-line); font-size: 10px; color: var(--color-t2); line-height: 1.7; }
  .d1-preview b { color: var(--color-text); }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
