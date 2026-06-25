<script lang="ts">
  import { onMount } from 'svelte';
  import { parseNum, calcATRChMetrics, validateATRChD0 } from '$lib/strategies/atr_channel';
  import { insertCandidate, updateCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  import { saveDraft, loadDraft, clearDraft, saveCapital } from '$lib/utils/draftStorage';
  import type { Candidate } from '$lib/types';

  let { onClose, onAdded, editCandidate = null, prefill = null }: {
    onClose: () => void;
    onAdded: () => void;
    editCandidate?: Candidate | null;
    prefill?: { ticker?: string; ema200?: number | null; atr5?: number | null } | null;
  } = $props();

  const isEdit = !!editCandidate;
  const ep = (editCandidate?.payload as any);

  function _readRisk() {
    if (typeof window === 'undefined') return '100';
    const v = localStorage.getItem('tj_capital_atr_channel');
    return v && parseFloat(v) > 0 ? v : '100';
  }

  let ticker   = $state(editCandidate?.ticker ?? prefill?.ticker ?? '');
  let t0Date   = $state(editCandidate?.signal_date ?? new Date().toISOString().split('T')[0]);
  let closeT0  = $state(ep?.close?.toString() ?? '');
  let ema200   = $state(ep?.ema200?.toString() ?? prefill?.ema200?.toString() ?? '');
  let atr5     = $state(ep?.atr5?.toString() ?? prefill?.atr5?.toString() ?? '');
  let rangeT0  = $state(ep?.range_t0?.toString() ?? '');
  let avgVol20 = $state(ep?.avg_vol20?.toString() ?? '');
  let volT0    = $state(ep?.vol_t0?.toString() ?? '');
  let riskAmt  = $state(_readRisk());

  let preview  = $state<any>(null);
  let errors   = $state<string[]>([]);
  let warnings = $state<string[]>([]);
  let saving   = $state(false);

  const draftKey = isEdit ? `atrch_edit_${editCandidate?.id}` : 'atrch_new';

  function onTickerInput(e: Event) {
    ticker = (e.target as HTMLInputElement).value.toUpperCase();
  }

  onMount(() => {
    if (!isEdit) {
      const d = loadDraft<any>(draftKey);
      if (d) {
        if (d.ticker)   ticker   = d.ticker;
        if (d.t0Date)   t0Date   = d.t0Date;
        if (d.closeT0)  closeT0  = d.closeT0;
        if (d.ema200)   ema200   = d.ema200;
        if (d.atr5)     atr5     = d.atr5;
        if (d.rangeT0)  rangeT0  = d.rangeT0;
        if (d.avgVol20) avgVol20 = d.avgVol20;
        if (d.volT0)    volT0    = d.volT0;
        if (d.riskAmt)  riskAmt  = d.riskAmt;
      }
    }
    calc();
  });

  $effect(() => {
    if (!isEdit) saveDraft(draftKey, {
      ticker, t0Date, closeT0, ema200, atr5, rangeT0, avgVol20, volT0, riskAmt
    });
    const _r = parseFloat(riskAmt.replace(',','.'));
    if (!isNaN(_r) && _r > 0) saveCapital('atr_channel', _r);
  });

  function calc() {
    preview = null; errors = []; warnings = [];
    const d = {
      close:    parseNum(closeT0),
      ema200:   parseNum(ema200),
      atr5:     parseNum(atr5),
      rangeT0:  parseNum(rangeT0),
      avgVol20: parseNum(avgVol20),
      volT0:    parseNum(volT0)
    };

    const missing: string[] = [];
    if (!ticker.trim()) missing.push('Ticker');
    if (isNaN(d.close))  missing.push('Close');
    if (isNaN(d.ema200)) missing.push('EMA200');
    if (isNaN(d.atr5))   missing.push('ATR(5)');
    if (missing.length) { errors = ['Заполни: ' + missing.join(', ')]; return; }

    // range/vol необязательны для расчёта, по умолчанию 0
    if (isNaN(d.rangeT0))  d.rangeT0 = 0;
    if (isNaN(d.avgVol20)) d.avgVol20 = 0;
    if (isNaN(d.volT0))    d.volT0 = 0;

    const risk = parseNum(riskAmt) || 100;
    const m = calcATRChMetrics(d, risk);
    const v = validateATRChD0(d, m);
    errors = v.errors; warnings = v.warnings;
    preview = { d, m, v, risk };
  }

  async function save() {
    calc();
    if (!preview?.v?.valid) return;
    if (!$user) return;
    saving = true;
    const { d, m } = preview;
    try {
      const t = ticker.trim().toUpperCase();
      const id = `${t}_ATRCH_${t0Date}`;
      const payload = {
        close: d.close, ema200: d.ema200, atr5: d.atr5,
        range_t0: d.rangeT0, avg_vol20: d.avgVol20, vol_t0: d.volT0,
        direction: m.direction,
        buy_stop: m.buyStop, sell_stop: m.sellStop,
        risk_per_share: m.riskPerShare,
        ema200_at_entry: d.ema200
      };
      if (isEdit && editCandidate) {
        await updateCandidate(editCandidate.id, {
          ticker: t, signal_date: t0Date, direction: m.direction,
          entry: m.entry, stop: m.initialStop, payload
        });
      } else {
        await insertCandidate({
          id, user_id: $user.id, strategy: 'atr_channel',
          ticker: t, signal_date: t0Date,
          direction: m.direction, status: 'READY_ENTRY',
          entry: m.entry, stop: m.initialStop, target1: null, target2: null,
          payload
        });
      }
      clearDraft(draftKey);
      onAdded(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  function resetDraft() {
    if (!confirm('Очистить все поля?')) return;
    clearDraft(draftKey);
    ticker = ''; closeT0 = ''; ema200 = ''; atr5 = '';
    rangeT0 = ''; avgVol20 = ''; volT0 = ''; riskAmt = '100';
    preview = null; errors = []; warnings = [];
  }

  const clr = (ok: boolean) => ok ? 'var(--color-acc)' : 'var(--color-acc2)';
  const dirColor = (d: string | null) => d === 'LONG' ? 'var(--color-acc)' : d === 'SHORT' ? 'var(--color-acc2)' : 'var(--color-t3)';
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать' : 'Добавить T0'} · ATR Channel Breakout</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="hint">
      <div><b>LONG:</b> Close &gt; EMA200 → Buy Stop = Close + 0.75×ATR(5)</div>
      <div><b>SHORT:</b> Close &lt; EMA200 → Sell Stop = Close − 0.75×ATR(5)</div>
      <div><b>Стоп:</b> Entry ∓ 2×ATR(5) · <b>Трейлинг:</b> HH/LL ∓ 2×ATR · <b>TP:</b> нет</div>
      <div><b>Ордер живёт 1 день.</b> Флэт ±0.5% EMA200 → пропуск</div>
    </div>

    <div class="row-2">
      <div class="fg"><label>Ticker</label><input value={ticker} oninput={onTickerInput} placeholder="AAPL" class="up" disabled={isEdit} /></div>
      <div class="fg"><label>T0 Date</label><input type="date" bind:value={t0Date} disabled={isEdit} /></div>
    </div>

    <div class="sect">Данные T0</div>
    <div class="row-3">
      <div class="fg"><label>Close T0</label><input bind:value={closeT0} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>EMA200</label><input bind:value={ema200} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>ATR(5)</label><input bind:value={atr5} oninput={calc} inputmode="decimal" /></div>
    </div>

    <div class="sect">Контекст (пропуск сделки) — необязательно</div>
    <div class="row-3">
      <div class="fg"><label>Range T0 (H−L)</label><input bind:value={rangeT0} oninput={calc} inputmode="decimal" placeholder="свеча &gt; 2.5×ATR?" /></div>
      <div class="fg"><label>AvgVol(20)</label><input bind:value={avgVol20} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Vol T0</label><input bind:value={volT0} oninput={calc} inputmode="decimal" /></div>
    </div>
    <div class="fg" style="margin-top:8px;max-width:160px"><label>Риск $</label><input bind:value={riskAmt} oninput={calc} inputmode="numeric" /></div>

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
          СИГНАЛ ·
          <span style="color:{dirColor(m.direction)}">{m.direction ?? 'ФЛЭТ — пропуск'}</span>
        </div>
        <div class="checks">
          {#each v.checks as c}
            <div style="color:{clr(c.ok)}">{c.ok ? '✓' : '✗'} {c.label}: <b>{c.value}</b></div>
          {/each}
        </div>
        {#if m.direction}
          <div class="entry-block">
            <div>{m.direction === 'LONG' ? 'Buy Stop' : 'Sell Stop'}: <b style="color:{dirColor(m.direction)}">${m.entry.toFixed(2)}</b></div>
            <div>Начальный стоп: <b style="color:var(--color-acc2)">${m.initialStop.toFixed(2)}</b> (Entry ∓ 2×ATR)</div>
            <div>Риск/акция: <b>${m.riskPerShare.toFixed(2)}</b> · Shares: <b>{m.shares}</b> (${preview.risk} / 2×ATR)</div>
            <div style="color:var(--color-acc3);margin-top:6px">⚠ Ордер действует 1 день · TP нет · трейлинг от HH/LL ∓ 2×ATR</div>
          </div>
        {/if}
      </div>
    {/if}

    <div class="ar">
      {#if !isEdit}<button onclick={resetDraft} type="button">↻ Сбросить</button>{/if}
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={!preview?.v?.valid || saving} class="btn-p">
        {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Выставить ордер'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; overflow-y: auto; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 660px; max-width: 100%; max-height: 92vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.8; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 12px 0 8px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .fg input:disabled { opacity: 0.6; }
  .up { text-transform: uppercase; }
  .warn { padding: 8px 12px; background: rgba(255,200,90,0.1); border: 1px solid rgba(255,200,90,0.4); color: var(--color-acc3); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 10px; }
  .checks { display: flex; flex-direction: column; gap: 4px; font-size: 10px; line-height: 1.7; }
  .entry-block { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-line); line-height: 1.9; }
  .entry-block b { color: var(--color-text); }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
