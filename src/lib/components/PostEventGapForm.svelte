<script lang="ts">
  import { onMount } from 'svelte';
  import {
    parseNum, calcPEGD0Metrics, validatePEGD0
  } from '$lib/strategies/post_event_gap';
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

  let ticker  = $state(editCandidate?.ticker ?? '');
  let d0Date  = $state(editCandidate?.signal_date ?? new Date().toISOString().split('T')[0]);

  let prevC   = $state(ep?.d_1?.C?.toString() ?? '');
  let d0O     = $state(ep?.d0?.O?.toString() ?? '');
  let d0H     = $state(ep?.d0?.H?.toString() ?? '');
  let d0L     = $state(ep?.d0?.L?.toString() ?? '');
  let d0C     = $state(ep?.d0?.C?.toString() ?? '');
  let d0V     = $state(ep?.d0?.V?.toString() ?? '');
  let atr14   = $state(ep?.atr14?.toString() ?? '');
  let avgVol  = $state(ep?.avg_vol_20?.toString() ?? '');
  let hc10    = $state(ep?.highest_close_10?.toString() ?? '');
  let lc10    = $state(ep?.lowest_close_10?.toString() ?? '');
  let hc20    = $state(ep?.highest_close_20?.toString() ?? '');
  let lc20    = $state(ep?.lowest_close_20?.toString() ?? '');

  // Market regime
  let spyAbove = $state(ep?.spy_above_ema20 ?? true);
  let qqqAbove = $state(ep?.qqq_above_ema20 ?? true);
  let vix      = $state(ep?.vix?.toString() ?? '18');
  let sectorAbove = $state(ep?.sector_above_ema20 ?? true);

  let errors   = $state<string[]>([]);
  let warnings = $state<string[]>([]);
  let preview  = $state<any>(null);
  let saving   = $state(false);

  function onTickerInput(e: Event) {
    ticker = (e.target as HTMLInputElement).value.toUpperCase();
  }

  function calc() {
    errors = []; warnings = []; preview = null;
    const d = {
      prevClose: parseNum(prevC),
      open: parseNum(d0O), high: parseNum(d0H), low: parseNum(d0L), close: parseNum(d0C),
      volume: parseNum(d0V), avgVol20: parseNum(avgVol), atr14: parseNum(atr14),
      highestClose10: parseNum(hc10), lowestClose10: parseNum(lc10),
      highestClose20: parseNum(hc20), lowestClose20: parseNum(lc20),
      spyAboveEma20: !!spyAbove, qqqAboveEma20: !!qqqAbove,
      vix: parseNum(vix), sectorAboveEma20: !!sectorAbove
    };

    const missing: string[] = [];
    if (!ticker.trim()) missing.push('Ticker');
    for (const [k, v] of Object.entries({
      'Close D-1': d.prevClose, 'D0 Open': d.open, 'D0 High': d.high, 'D0 Low': d.low,
      'D0 Close': d.close, 'D0 Volume': d.volume, 'ATR14': d.atr14, 'AvgVol20': d.avgVol20,
      'HighClose10': d.highestClose10, 'LowClose10': d.lowestClose10,
      'HighClose20': d.highestClose20, 'LowClose20': d.lowestClose20, 'VIX': d.vix
    })) {
      if (isNaN(v as number)) missing.push(k);
    }
    if (missing.length) { errors = ['Заполни: ' + missing.join(', ')]; return; }

    const m = calcPEGD0Metrics(d);
    const v = validatePEGD0(d, m);
    errors = v.errors; warnings = v.warnings;
    preview = { d, m, v };
  }

  async function save() {
    calc();
    if (!preview || !preview.v.valid) return;
    if (!$user) return;
    saving = true;
    const { d, m } = preview;
    try {
      const tickerUp = ticker.trim().toUpperCase();
      const id = tickerUp + '_PEG_' + d0Date;
      const payload = {
        d_1: { C: d.prevClose },
        d0: { O: d.open, H: d.high, L: d.low, C: d.close, V: d.volume },
        atr14: d.atr14, avg_vol_20: d.avgVol20,
        highest_close_10: d.highestClose10, lowest_close_10: d.lowestClose10,
        highest_close_20: d.highestClose20, lowest_close_20: d.lowestClose20,
        spy_above_ema20: d.spyAboveEma20, qqq_above_ema20: d.qqqAboveEma20,
        vix: d.vix, sector_above_ema20: d.sectorAboveEma20,
        metrics: {
          gap_pct: m.gapPct, range_atr_ratio: m.rangePct,
          vol_ratio: m.volRatio, close_position: m.closePosition,
          d0_score: m.d0Score
        }
      };

      if (isEdit && editCandidate) {
        await updateCandidate(editCandidate.id, {
          ticker: tickerUp, signal_date: d0Date, direction: m.direction,
          payload: { ...payload, d1: (editCandidate.payload as any)?.d1 ?? null, d1_note: (editCandidate.payload as any)?.d1_note ?? null }
        });
      } else {
        await insertCandidate({
          id, user_id: $user.id, strategy: 'pead',
          ticker: tickerUp, signal_date: d0Date, direction: m.direction,
          status: 'WAITING_D1', entry: null, stop: null, target1: null, target2: null,
          payload
        });
      }
      clearDraft(draftKey);
      const v = parseNum(vix);
      saveMarketData(d0Date, {
        ...(isNaN(v) ? {} : { vix: v }),
        spyAboveEma20: spyAbove
      });
      onAdded(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }

  $effect(() => { if (isEdit && !preview) calc(); });

  // ─── Draft + Market ───
  const draftKey = isEdit ? `peg_edit_${editCandidate?.id}` : 'peg_new';

  onMount(() => {
    if (!isEdit) {
      const d = loadDraft<any>(draftKey);
      if (d) {
        if (d.ticker)      ticker      = d.ticker;
        if (d.d0Date)      d0Date      = d.d0Date;
        if (d.prevC)       prevC       = d.prevC;
        if (d.d0O)         d0O         = d.d0O;
        if (d.d0H)         d0H         = d.d0H;
        if (d.d0L)         d0L         = d.d0L;
        if (d.d0C)         d0C         = d.d0C;
        if (d.d0V)         d0V         = d.d0V;
        if (d.atr14)       atr14       = d.atr14;
        if (d.avgVol)      avgVol      = d.avgVol;
        if (d.hc10)        hc10        = d.hc10;
        if (d.lc10)        lc10        = d.lc10;
        if (d.hc20)        hc20        = d.hc20;
        if (d.lc20)        lc20        = d.lc20;
        if (typeof d.spyAbove === 'boolean')    spyAbove    = d.spyAbove;
        if (typeof d.qqqAbove === 'boolean')    qqqAbove    = d.qqqAbove;
        if (d.vix)                              vix         = d.vix;
        if (typeof d.sectorAbove === 'boolean') sectorAbove = d.sectorAbove;
      }
    }
    const mkt = loadMarketData(d0Date);
    if (mkt) {
      if (mkt.vix !== undefined && !vix) vix = String(mkt.vix);
      if (typeof mkt.spyAboveEma20 === 'boolean') spyAbove = mkt.spyAboveEma20;
      // qqqAboveEma20 хранится отдельно — добавим как extension
    }
    calc();
  });

  $effect(() => {
    if (isEdit) return;
    saveDraft(draftKey, {
      ticker, d0Date, prevC, d0O, d0H, d0L, d0C, d0V,
      atr14, avgVol, hc10, lc10, hc20, lc20,
      spyAbove, qqqAbove, vix, sectorAbove
    });
  });

  function resetDraft() {
    if (!confirm('Очистить все поля и сбросить черновик?')) return;
    clearDraft(draftKey);
    ticker = '';
    prevC = ''; d0O = ''; d0H = ''; d0L = ''; d0C = ''; d0V = '';
    atr14 = ''; avgVol = ''; hc10 = ''; lc10 = ''; hc20 = ''; lc20 = '';
    spyAbove = true; qqqAbove = true; vix = '18'; sectorAbove = true;
    preview = null; errors = []; warnings = [];
    const mkt = loadMarketData(d0Date);
    if (mkt) {
      if (mkt.vix !== undefined) vix = String(mkt.vix);
      if (typeof mkt.spyAboveEma20 === 'boolean') spyAbove = mkt.spyAboveEma20;
    }
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const clr = (ok: boolean) => ok ? 'var(--color-acc)' : 'var(--color-acc2)';
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать' : 'Добавить'} · Post-Event Gap</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="hint">
      <div><b>D0 Core:</b> Gap ±4% · RVOL 3.0× · Range 1.5×ATR · ClosePos ≥0.70/≤0.30 · Close дольше Open · Close break 10D</div>
      <div><b>+ Market filter:</b> SPY/QQQ vs EMA20, VIX &lt;25 (LONG) / SPY/QQQ &lt; EMA20 (SHORT)</div>
      <div><b>D0 Score:</b> ≥3 / 6 (Gap≥6%, RVOL≥5, Range≥2ATR, CP≥0.85, break20D, Sector)</div>
    </div>

    <div class="row-2">
      <div class="fg"><label>Ticker</label><input value={ticker} oninput={onTickerInput} placeholder="NVDA" class="up" disabled={isEdit} /></div>
      <div class="fg"><label>D0 Date</label><input type="date" bind:value={d0Date} disabled={isEdit} /></div>
    </div>

    <div class="sect">Day D-1 / D0</div>
    <div class="row-6">
      <div class="fg"><label>Close D-1</label><input bind:value={prevC} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>D0 Open</label><input bind:value={d0O} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>D0 High</label><input bind:value={d0H} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>D0 Low</label><input bind:value={d0L} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>D0 Close</label><input bind:value={d0C} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>D0 Volume</label><input bind:value={d0V} oninput={calc} inputmode="numeric" /></div>
    </div>

    <div class="sect">Контекст</div>
    <div class="row-6">
      <div class="fg"><label>ATR(14)</label><input bind:value={atr14} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>AvgVol20</label><input bind:value={avgVol} oninput={calc} inputmode="numeric" /></div>
      <div class="fg"><label>HiClose 10</label><input bind:value={hc10} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>LoClose 10</label><input bind:value={lc10} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>HiClose 20</label><input bind:value={hc20} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>LoClose 20</label><input bind:value={lc20} oninput={calc} inputmode="decimal" /></div>
    </div>

    <div class="sect">Market regime</div>
    <div class="row-4">
      <div class="fg ck">
        <label><input type="checkbox" bind:checked={spyAbove} onchange={calc} /> SPY &gt; EMA20</label>
      </div>
      <div class="fg ck">
        <label><input type="checkbox" bind:checked={qqqAbove} onchange={calc} /> QQQ &gt; EMA20</label>
      </div>
      <div class="fg"><label>VIX</label><input bind:value={vix} oninput={calc} inputmode="decimal" /></div>
      <div class="fg ck">
        <label><input type="checkbox" bind:checked={sectorAbove} onchange={calc} /> Sector &gt; EMA20</label>
      </div>
    </div>

    {#if warnings.length}
      <div class="warn">{#each warnings as w}<div>⚠ {w}</div>{/each}</div>
    {/if}
    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    {#if preview}
      {@const m = preview.m}
      <div class="prev">
        <div class="prev-h">
          D0 ANALYSIS ·
          <span style="color:{m.direction ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.direction ?? 'НЕТ СИГНАЛА'}</span>
          {#if m.direction}
            · <span style="color:{m.d0Score >= 3 ? 'var(--color-acc)' : 'var(--color-acc2)'}">Score {m.d0Score}/6</span>
            · Market: <span style="color:{m.marketOk ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.marketOk ? 'OK' : 'FAIL'}</span>
          {/if}
        </div>
        <div class="checks">
          <div style="color:{clr(Math.abs(m.gapPct) >= 0.04)}">Gap: <b>{fmtPct(m.gapPct)}</b></div>
          <div style="color:{clr(m.volRatio >= 3)}">RVOL: <b>{m.volRatio.toFixed(2)}×</b></div>
          <div style="color:{clr(m.rangePct >= 1.5)}">Range/ATR: <b>{m.rangePct.toFixed(2)}</b></div>
          <div style="color:{clr(m.gapPct >= 0 ? m.closePosition >= 0.70 : m.closePosition <= 0.30)}">CP: <b>{m.closePosition.toFixed(2)}</b></div>
          <div style="color:{clr(m.breakout10)}">10D break: <b>{m.breakout10 ? '✓' : '✗'}</b></div>
          <div style="color:{m.breakout20 ? 'var(--color-acc)' : 'var(--color-t3)'}">20D break: <b>{m.breakout20 ? '✓ +1' : '—'}</b></div>
          <div>Mid D0: <b>${m.midpoint.toFixed(2)}</b></div>
        </div>
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
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 760px; max-width: 100%; max-height: 92vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.8; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 12px 0 8px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 4px; }
  .row-6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 4px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .fg input:disabled { opacity: 0.6; }
  .up { text-transform: uppercase; }
  .ck label { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-text); text-transform: none; letter-spacing: 0; cursor: pointer; padding: 8px 10px; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-bg3); }
  .ck input { width: auto; }
  .warn { padding: 8px 12px; background: rgba(255,200,90,0.1); border: 1px solid rgba(255,200,90,0.4); color: var(--color-acc3); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 8px; }
  .checks { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 4px 14px; font-size: 10px; line-height: 1.7; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
