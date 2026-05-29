<script lang="ts">
  import { onMount } from 'svelte';
  import {
    parseNum, calcPEGD1Compression, calcPEGPosition
  } from '$lib/strategies/post_event_gap';
  import { updateCandidate } from '$lib/data/candidates';
  import { updateTrade } from '$lib/data/trades';
  import { saveDraft, loadDraft, clearDraft } from '$lib/utils/draftStorage';
  import type { Candidate } from '$lib/types';

  let { candidate, onClose, onUpdated }: {
    candidate: Candidate;
    onClose: () => void;
    onUpdated: () => void;
  } = $props();

  const payload = candidate.payload as any;
  const d0 = payload?.d0;
  const atr14 = payload?.atr14 ?? 0;
  const midpoint = d0 ? (d0.H + d0.L) / 2 : 0;
  const rangeD0 = d0 ? d0.H - d0.L : 0;

  let d1H = $state(''), d1L = $state(''), d1C = $state(''), d1V = $state('');
  let d1Date = $state(new Date().toISOString().split('T')[0]);
  function _readCap_pead() {
    if (typeof window === 'undefined') return '100';
    const v = localStorage.getItem('tj_capital_pead');
    return v && parseFloat(v) > 0 ? v : '100';
  }
  let riskAmt  = $state(_readCap_pead());

  const draftKey = `peg_d1_${candidate.id}`;
  onMount(() => {
    // Восстанавливаем размер позиции как начальное значение (черновик может перезаписать ниже)
    if (riskAmt === '100') riskAmt = String(loadCapital('pead', 100));
    const d = loadDraft<any>(draftKey);
    if (d) {
      if (d.d1H)     d1H     = d.d1H;
      if (d.d1L)     d1L     = d.d1L;
      if (d.d1C)     d1C     = d.d1C;
      if (d.d1V)     d1V     = d.d1V;
      if (d.d1Date)  d1Date  = d.d1Date;
      if (d.riskAmt) riskAmt = d.riskAmt;
    }
  });
  $effect(() => {
    saveDraft(draftKey, { d1H, d1L, d1C, d1V, d1Date, riskAmt });

    // Сохраняем размер позиции (работает и при редактировании)
    const _cap = parseFloat(riskAmt.replace(',','.'));
    if (!isNaN(_cap) && _cap > 0) saveCapital('pead', _cap);
  });

  let result = $state<any>(null);
  let errors = $state<string[]>([]);
  let saving = $state(false);

  function calc() {
    result = null;
    const d1 = {
      high: parseNum(d1H), low: parseNum(d1L),
      close: parseNum(d1C), volume: parseNum(d1V)
    };
    const missing: string[] = [];
    if (isNaN(d1.high)) missing.push('High');
    if (isNaN(d1.low)) missing.push('Low');
    if (isNaN(d1.close)) missing.push('Close');
    if (isNaN(d1.volume)) missing.push('Volume');
    if (missing.length) { errors = ['Заполни: ' + missing.join(', ')]; return; }
    errors = [];

    if (!d0 || !candidate.direction) return;

    const compression = calcPEGD1Compression(
      { high: d0.H, low: d0.L, volume: d0.V, midpoint, range: rangeD0 },
      d1, candidate.direction
    );
    const pos = calcPEGPosition({ atr14 }, d1, candidate.direction, parseNum(riskAmt) || 100);
    const status = compression.valid ? 'READY_ENTRY' : 'REJECTED';

    const noteLines = [
      `D1 (${d1Date}): ${compression.valid ? '✓ Compression OK' : '✗ Compression FAIL'} · Score ${compression.compressionScore}/6`,
      `OHLC H=${d1.high.toFixed(2)} L=${d1.low.toFixed(2)} C=${d1.close.toFixed(2)} V=${d1.volume.toLocaleString()}`,
      `Vol D1/D0=${compression.volRatioD1D0.toFixed(2)} · Range D1/D0=${compression.rangeRatio.toFixed(2)} · Retrace=${(compression.retracement * 100).toFixed(0)}%`,
      ...(compression.errors.length ? ['Ошибки: ' + compression.errors.join('; ')] : [])
    ];
    if (compression.valid) {
      noteLines.push(`Entry: $${pos.entry.toFixed(2)} | Stop: $${pos.stop.toFixed(2)} | T1: $${pos.target1.toFixed(2)} | T2: $${pos.target2.toFixed(2)}`);
    }

    result = { d1, compression, pos, status, note: noteLines.join('\n') };
  }

  async function save() {
    if (!result) return;
    saving = true;
    try {
      const newPayload = {
        ...payload,
        d1: { H: result.d1.high, L: result.d1.low, C: result.d1.close, V: result.d1.volume },
        d1_date: d1Date, d1_note: result.note,
        compression_score: result.compression.compressionScore
      };
      const updates: any = { status: result.status, payload: newPayload };
      if (result.status === 'READY_ENTRY') {
        updates.entry = result.pos.entry;
        updates.stop = result.pos.stop;
        updates.target1 = result.pos.target1;
        updates.target2 = result.pos.target2;
      }
      await updateCandidate(candidate.id, updates);

      if (candidate.status === 'ENTERED' && candidate.trade_id) {
        const { listTrades } = await import('$lib/data/trades');
        const trades = await listTrades();
        const trade = trades.find(t => t.id === candidate.trade_id);
        if (trade) {
          const newNotes = (trade.notes || '') + '\n' + result.note;
          await updateTrade(trade.id, { notes: newNotes });
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
      <div>D1 Compression — {candidate.ticker} ({candidate.direction}) · PEG</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="info">
      <div>D0 ({candidate.signal_date}): H={d0?.H?.toFixed(2)} L={d0?.L?.toFixed(2)} C={d0?.C?.toFixed(2)} V={d0?.V?.toLocaleString()}</div>
      <div>ATR14=<b>{atr14.toFixed(2)}</b> · Mid D0=<b>${midpoint.toFixed(2)}</b> · Range D0=<b>{rangeD0.toFixed(2)}</b></div>
    </div>

    <div class="hint">
      <div><b>D1 Core:</b> Vol≤0.70×D0 · Range≤0.75×D0 · Retrace≤35%</div>
      <div><b>LONG:</b> Low D1 &gt; Low D0 · Close D1 &gt; Mid D0</div>
      <div><b>SHORT:</b> High D1 &lt; High D0 · Close D1 &lt; Mid D0</div>
      <div><b>Compression Score:</b> ≥2 / 6 (Inside, Vol≤0.50, Range≤0.60, Retrace≤25%, Close в upper/lower 1/3)</div>
      <div><b>Entry D2:</b> {candidate.direction === 'LONG' ? 'High D1 + 0.10×ATR' : 'Low D1 − 0.10×ATR'}</div>
      <div><b>T1:</b> +1.5R (50% выход) · <b>T2:</b> +2.2R · <b>Time:</b> D+5</div>
    </div>

    <div class="row-2" style="margin-bottom:8px">
      <div class="fg"><label>D1 Date</label><input type="date" bind:value={d1Date} /></div>
      <div class="fg"><label>Риск $</label><input bind:value={riskAmt} oninput={calc} inputmode="numeric" /></div>
    </div>

    <div class="row-4">
      <div class="fg"><label>High</label><input bind:value={d1H} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Low</label><input bind:value={d1L} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Close</label><input bind:value={d1C} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Volume</label><input bind:value={d1V} oninput={calc} inputmode="numeric" /></div>
    </div>

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    {#if result}
      {@const c = result.compression}
      {@const p = result.pos}
      <div class="prev" class:prev-ok={c.valid} class:prev-fail={!c.valid}>
        <div class="prev-h">{c.valid ? '✓ COMPRESSION OK' : '✗ COMPRESSION FAIL'} · Score {c.compressionScore}/6</div>
        {#each c.details as d}<div>{d}</div>{/each}
        {#each c.errors as e}<div style="color:var(--color-acc2)">✗ {e}</div>{/each}

        {#if c.valid}
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-line)">
            <div>Entry D2: <b style="color:var(--color-acc)">${p.entry.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${p.stop.toFixed(2)}</b></div>
            <div>Risk/share: <b>${p.riskPerShare.toFixed(2)}</b> · Risk/ATR: <b>{p.riskAtrRatio.toFixed(2)}</b></div>
            <div>Shares: <b>{p.shares}</b> · Size: <b>${p.positionValue.toFixed(0)}</b></div>
            <div>T1 (+1.5R, 50%): <b>${p.target1.toFixed(2)}</b> · T2 (+2.2R): <b>${p.target2.toFixed(2)}</b></div>
          </div>
        {/if}
      </div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={!result || saving} class="btn-p">{saving ? 'Сохранение...' : 'Сохранить D1'}</button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 620px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .info { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 10px; }
  .info b { color: var(--color-text); }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 8px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .prev { padding: 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; margin: 12px 0; line-height: 1.8; }
  .prev-ok { background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); }
  .prev-fail { background: var(--color-bg3); border: 1px solid var(--color-acc2); color: var(--color-text); }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 6px; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
