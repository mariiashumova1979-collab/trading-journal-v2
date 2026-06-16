<script lang="ts">
  import {
    calculateImpulseD0Metrics,
    validateImpulseD0,
    calculateEntryPrice,
    calculateStopPrice,
    calculatePosition,
    parseNum
  } from '$lib/strategies/impulse';
  import { insertCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  import { onMount } from 'svelte';
  import { saveDraft, loadDraft, clearDraft, saveCapital } from '$lib/utils/draftStorage';

  let { onClose, onAdded }: { onClose: () => void; onAdded: () => void } = $props();

  function _readRisk() {
    if (typeof window === 'undefined') return '100';
    const v = localStorage.getItem('tj_capital_impulse');
    return v && parseFloat(v) > 0 ? v : '100';
  }

  let ticker = $state('');
  let d0Date = $state(new Date().toISOString().split('T')[0]);
  let d_1_C = $state('');
  let d0_O = $state('');
  let d0_H = $state('');
  let d0_L = $state('');
  let d0_C = $state('');
  let d0_V = $state('');
  let atr = $state('');
  let relVol = $state('');
  let riskAmt = $state(_readRisk());

  let errors = $state<string[]>([]);
  let preview = $state<any>(null);
  let saving = $state(false);

  const draftKey = 'impulse_new';

  onMount(() => {
    const d = loadDraft<any>(draftKey);
    if (d) {
      if (d.ticker)  ticker  = d.ticker;
      if (d.d0Date)  d0Date  = d.d0Date;
      if (d.d_1_C)   d_1_C   = d.d_1_C;
      if (d.d0_O)    d0_O    = d.d0_O;
      if (d.d0_H)    d0_H    = d.d0_H;
      if (d.d0_L)    d0_L    = d.d0_L;
      if (d.d0_C)    d0_C    = d.d0_C;
      if (d.d0_V)    d0_V    = d.d0_V;
      if (d.atr)     atr     = d.atr;
      if (d.relVol)  relVol  = d.relVol;
      if (d.riskAmt) riskAmt = d.riskAmt;
    }
    calc();
  });

  $effect(() => {
    saveDraft(draftKey, { ticker, d0Date, d_1_C, d0_O, d0_H, d0_L, d0_C, d0_V, atr, relVol, riskAmt });
    const _r = parseFloat(riskAmt.replace(',','.'));
    if (!isNaN(_r) && _r > 0) saveCapital('impulse', _r);
  });

  function resetDraft() {
    if (!confirm('Очистить все поля?')) return;
    clearDraft(draftKey);
    ticker = ''; d_1_C = ''; d0_O = ''; d0_H = ''; d0_L = ''; d0_C = ''; d0_V = '';
    atr = ''; relVol = ''; riskAmt = '100';
    preview = null; errors = [];
  }

  function onTickerInput(e: Event) {
    const target = e.target as HTMLInputElement;
    ticker = target.value.toUpperCase();
  }

  function readForm() {
    return {
      d_1: { C: parseNum(d_1_C) },
      d0: {
        O: parseNum(d0_O),
        H: parseNum(d0_H),
        L: parseNum(d0_L),
        C: parseNum(d0_C),
        V: parseNum(d0_V)
      },
      atrNum: parseNum(atr),
      relVolNum: parseNum(relVol),
      riskNum: parseNum(riskAmt)
    };
  }

  function calc() {
    const f = readForm();
    const missing: string[] = [];
    if (!ticker.trim()) missing.push('Тикер');
    if (!d0Date) missing.push('Дата D0');
    if (isNaN(f.d_1.C)) missing.push('Close D-1');
    if (isNaN(f.d0.O)) missing.push('D0 Open');
    if (isNaN(f.d0.H)) missing.push('D0 High');
    if (isNaN(f.d0.L)) missing.push('D0 Low');
    if (isNaN(f.d0.C)) missing.push('D0 Close');
    if (isNaN(f.d0.V)) missing.push('D0 Volume');
    if (isNaN(f.atrNum)) missing.push('ATR');
    if (isNaN(f.relVolNum)) missing.push('RelVol');

    if (missing.length) {
      errors = ['Заполни поля: ' + missing.join(', ')];
      preview = null;
      return;
    }

    const metrics = calculateImpulseD0Metrics(f.d_1, f.d0, f.atrNum, f.relVolNum);
    const v = validateImpulseD0(f.d_1, metrics);
    errors = v.errors;

    if (metrics.direction) {
      const entry = calculateEntryPrice(f.d0, f.atrNum, metrics.direction);
      const stop = calculateStopPrice(f.d0, f.atrNum, metrics.direction);
      const risk = isNaN(f.riskNum) ? 100 : f.riskNum;
      const pos = calculatePosition(entry, stop, f.atrNum, risk, metrics.direction);
      preview = {
        direction: metrics.direction,
        impulse: metrics.impulse ?? 0,
        clv: metrics.clv ?? 0,
        body: metrics.body ?? 0,
        range: metrics.range ?? 0,
        entry,
        stop,
        pos,
        d_1: f.d_1,
        d0: f.d0,
        atr: f.atrNum,
        relVol: f.relVolNum
      };
    } else {
      preview = null;
    }
  }

  async function save() {
    calc();
    if (!preview || errors.length) return;
    if (!$user) return;

    saving = true;
    try {
      const id = ticker.trim().toUpperCase() + '_' + d0Date;
      await insertCandidate({
        id,
        user_id: $user.id,
        strategy: 'impulse',
        ticker: ticker.trim().toUpperCase(),
        signal_date: d0Date,
        direction: preview.direction,
        status: 'WAITING_D1',
        entry: preview.entry,
        stop: preview.stop,
        target1: preview.pos.target1,
        target2: preview.pos.target2,
        payload: {
          d_1: preview.d_1,
          d0: preview.d0,
          atr: preview.atr,
          rel_vol: preview.relVol,
          metrics: {
            impulse: preview.impulse,
            clv: preview.clv,
            body: preview.body,
            range: preview.range,
            vol_ratio: preview.relVol
          }
        }
      });
      clearDraft(draftKey);
      onAdded();
      onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }

  function fmtPct(v: number) {
    const s = (v * 100).toFixed(1);
    return (v >= 0 ? '+' : '') + s + '%';
  }
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>Добавить импульсного кандидата</div>
      <button onclick={onClose} class="cls" aria-label="Close">×</button>
    </div>

    <div class="hint">
      <div><b>D0 LONG:</b> Move +5% to +12%, CLV &gt; 0.70, Body &gt; 0.50, RelVol &gt;= 1.5</div>
      <div><b>D0 SHORT:</b> Move -5% to -12%, CLV &lt; 0.30, Body &gt; 0.50, RelVol &gt;= 1.5</div>
      <div><b>D+1:</b> Inside Day OR Weak Pullback OR Compression</div>
      <div><b>Entry D+2:</b> LONG = High_D0 + 0.1*ATR; SHORT = Low_D0 - 0.1*ATR</div>
      <div><b>Stop:</b> LONG = Low_D0 - 0.2*ATR; SHORT = High_D0 + 0.2*ATR</div>
    </div>

    <div class="row">
      <div class="fg">
        <label for="if-ticker">Ticker</label>
        <input id="if-ticker" value={ticker} oninput={onTickerInput} placeholder="NVDA" class="up" />
      </div>
      <div class="fg">
        <label for="if-d0date">D0 date</label>
        <input id="if-d0date" type="date" bind:value={d0Date} />
      </div>
    </div>

    <div class="shdif">Day D-1</div>
    <div class="row row-5">
      <div class="fg">
        <label for="if-d1c">Close</label>
        <input id="if-d1c" bind:value={d_1_C} oninput={calc} inputmode="decimal" />
      </div>
      <div></div><div></div><div></div><div></div>
    </div>

    <div class="shdif">Day D0 (impulse)</div>
    <div class="row row-5">
      <div class="fg"><label for="if-d0o">Open</label><input id="if-d0o" bind:value={d0_O} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="if-d0h">High</label><input id="if-d0h" bind:value={d0_H} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="if-d0l">Low</label><input id="if-d0l" bind:value={d0_L} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="if-d0c">Close</label><input id="if-d0c" bind:value={d0_C} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="if-d0v">Volume</label><input id="if-d0v" bind:value={d0_V} oninput={calc} inputmode="numeric" /></div>
    </div>

    <div class="shdif">Metrics & risk</div>
    <div class="row row-3">
      <div class="fg"><label for="if-atr">ATR(14)</label><input id="if-atr" bind:value={atr} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="if-relvol">RelVol</label><input id="if-relvol" bind:value={relVol} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="if-risk">Риск $</label><input id="if-risk" bind:value={riskAmt} oninput={calc} inputmode="numeric" /></div>
    </div>

    {#if errors.length}
      <div class="err">
        {#each errors as e}<div>• {e}</div>{/each}
      </div>
    {/if}

    {#if preview}
      <div class="prev">
        <div class="prev-h">D0 METRICS</div>
        <div>Direction: <b style="color:{preview.direction === 'LONG' ? 'var(--color-acc)' : 'var(--color-acc2)'}">{preview.direction}</b></div>
        <div>Impulse: <b>{fmtPct(preview.impulse)}</b> · CLV: <b>{preview.clv.toFixed(2)}</b> · Body: <b>{preview.body.toFixed(2)}</b></div>

        <div class="prev-h" style="margin-top:10px">POSITION FORECAST (риск ${parseNum(riskAmt) || 100})</div>
        <div>Entry (D+2): <b style="color:var(--color-acc)">${preview.entry.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${preview.stop.toFixed(2)}</b></div>
        <div>Risk/share: <b>${preview.pos.risk_per_share.toFixed(2)}</b> · Risk/ATR: <b>{preview.pos.risk_atr_ratio.toFixed(2)}</b>{#if preview.pos.risk_warning}<span style="color:#ff9900"> ⚠ &gt; 1.5</span>{/if}</div>
        <div>Shares: <b>{preview.pos.shares}</b> · Size: <b>${preview.pos.position_value.toFixed(0)}</b> · Real risk: <b>${preview.pos.risk_amount.toFixed(2)}</b></div>
        <div>T1: <b>${preview.pos.target1.toFixed(2)}</b> (+1R) · T2: <b>${preview.pos.target2.toFixed(2)}</b> (+2R)</div>
      </div>
    {/if}

    <div class="ar">
      <button onclick={resetDraft} type="button">↻ Сбросить</button>
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={!preview || saving || errors.length > 0} class="btn-p">
        {saving ? 'Сохранение...' : 'Добавить'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 640px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 10px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .shdif { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 14px 0 8px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row-3 { grid-template-columns: repeat(3, 1fr); }
  .row-5 { grid-template-columns: repeat(5, 1fr); }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .up { text-transform: uppercase; }
  .err { padding: 10px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.9; }
  .prev-h { font-weight: 700; color: var(--color-acc); letter-spacing: 1px; margin-bottom: 6px; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
