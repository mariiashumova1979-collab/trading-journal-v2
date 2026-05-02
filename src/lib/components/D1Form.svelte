<script lang="ts">
  import { checkImpulseD1Patterns, calculateStopPrice, calculatePosition, parseNum } from '$lib/strategies/impulse';
  import { updateCandidate } from '$lib/data/candidates';
  import type { Candidate } from '$lib/types';

  let { candidate, onClose, onUpdated }: {
    candidate: Candidate;
    onClose: () => void;
    onUpdated: () => void;
  } = $props();

  let d1_O = $state('');
  let d1_H = $state('');
  let d1_L = $state('');
  let d1_C = $state('');

  let errors = $state<string[]>([]);
  let preview = $state<any>(null);
  let saving = $state(false);

  function readD1() {
    return {
      O: parseNum(d1_O),
      H: parseNum(d1_H),
      L: parseNum(d1_L),
      C: parseNum(d1_C)
    };
  }

  function calc() {
    const d1 = readD1();
    const missing: string[] = [];
    if (isNaN(d1.O)) missing.push('Open');
    if (isNaN(d1.H)) missing.push('High');
    if (isNaN(d1.L)) missing.push('Low');
    if (isNaN(d1.C)) missing.push('Close');

    if (missing.length) {
      errors = ['Заполни поля D+1: ' + missing.join(', ')];
      preview = null;
      return;
    }

    const payload = candidate.payload;
    if (!payload || !payload.d0 || !candidate.direction) {
      errors = ['У кандидата нет данных D0'];
      return;
    }

    const result = checkImpulseD1Patterns(payload.d0, d1, candidate.direction);
    const isValid = result.matched.length > 0;

    const stop = calculateStopPrice(payload.d0, payload.atr, candidate.direction);
    const entry = candidate.entry || 0;
    const pos = calculatePosition(entry, stop, payload.atr, 100, candidate.direction);

    errors = isValid ? [] : ['Ни один паттерн D+1 не подтверждён — кандидат отклоняется'];

    preview = {
      d1,
      patterns: result.matched,
      details: result.details,
      stop,
      entry,
      pos,
      newStatus: isValid ? 'READY_ENTRY' : 'REJECTED'
    };
  }

  async function save() {
    calc();
    if (!preview) return;
    saving = true;
    try {
      const newPayload = {
        ...candidate.payload!,
        d1: preview.d1,
        pattern: preview.patterns.join(' + ') || null
      };
      await updateCandidate(candidate.id, {
        status: preview.newStatus,
        stop: preview.stop,
        target1: preview.pos.target1,
        target2: preview.pos.target2,
        payload: newPayload
      });
      onUpdated();
      onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>D+1 — {candidate.ticker} ({candidate.direction})</div>
      <button onclick={onClose} class="cls" aria-label="Close">×</button>
    </div>

    <div class="info">
      <div>D0 ({candidate.signal_date}): O={candidate.payload?.d0.O?.toFixed(2)} H={candidate.payload?.d0.H?.toFixed(2)} L={candidate.payload?.d0.L?.toFixed(2)} C={candidate.payload?.d0.C?.toFixed(2)}</div>
      <div>ATR={candidate.payload?.atr?.toFixed(2)} · RelVol={candidate.payload?.rel_vol?.toFixed(2)}x</div>
    </div>

    <div class="hint">
      <div><b>Ищем один из паттернов:</b></div>
      <div>• <b>Inside Day:</b> H1 ≤ H_D0 AND L1 ≥ L_D0 (день внутри предыдущего)</div>
      {#if candidate.direction === 'LONG'}
        <div>• <b>Weak Pullback:</b> L1 &gt; Mid_D0 AND retracement &lt; 50% AND C1 &gt; Mid_D0</div>
        <div>• <b>Compression:</b> Range1/Range_D0 &lt; 0.5 AND |C1 − C_D0| &lt; 0.3·Range_D0 AND C1 &gt; Mid_D0</div>
      {:else}
        <div>• <b>Weak Pullback:</b> H1 &lt; Mid_D0 AND retracement &lt; 50% AND C1 &lt; Mid_D0</div>
        <div>• <b>Compression:</b> Range1/Range_D0 &lt; 0.5 AND |C1 − C_D0| &lt; 0.3·Range_D0 AND C1 &lt; Mid_D0</div>
      {/if}
    </div>

    <div class="shdif">Day D+1</div>
    <div class="row row-4">
      <div class="fg"><label for="d1-o">Open</label><input id="d1-o" bind:value={d1_O} inputmode="decimal" /></div>
      <div class="fg"><label for="d1-h">High</label><input id="d1-h" bind:value={d1_H} inputmode="decimal" /></div>
      <div class="fg"><label for="d1-l">Low</label><input id="d1-l" bind:value={d1_L} inputmode="decimal" /></div>
      <div class="fg"><label for="d1-c">Close</label><input id="d1-c" bind:value={d1_C} inputmode="decimal" /></div>
    </div>

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    {#if preview}
      {#if preview.patterns.length > 0}
        <div class="prev">
          <div class="prev-h">PATTERNS MATCHED</div>
          <div><b style="color:var(--color-acc)">{preview.patterns.join(' + ')}</b></div>
          <div style="font-size:9px;color:var(--color-t2);margin-top:6px">
            {#each preview.details as d}<div>{d}</div>{/each}
          </div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-line)">
            <b>Position preview (риск $100):</b><br>
            Entry: ${preview.entry.toFixed(2)} · Stop: ${preview.stop.toFixed(2)} · Risk/share: ${preview.pos.risk_per_share.toFixed(2)}<br>
            Shares: {preview.pos.shares} · Position: ${preview.pos.position_value.toFixed(0)} · Risk/ATR: {preview.pos.risk_atr_ratio.toFixed(2)}
            {#if preview.pos.risk_warning}<br><span style="color:#ff9900">⚠ Risk/ATR &gt; 1.5</span>{/if}<br>
            T1: ${preview.pos.target1.toFixed(2)} (+1R) · T2: ${preview.pos.target2.toFixed(2)} (+2R)
          </div>
        </div>
      {:else}
        <div class="rejected">
          <div class="prev-h" style="color:var(--color-acc2)">PATTERN NOT MATCHED</div>
          <div style="font-size:10px;color:var(--color-t2);margin-top:6px">
            {#each preview.details as d}<div>{d}</div>{/each}
          </div>
          <div style="margin-top:8px">Кандидат будет помечен как REJECTED</div>
        </div>
      {/if}
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      <button onclick={calc}>Рассчитать</button>
      <button onclick={save} disabled={!preview || saving} class="btn-p">
        {saving ? 'Сохранение...' : 'Сохранить D+1'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 600px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .info { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 10px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 10px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .shdif { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 14px 0 8px; }
  .row { display: grid; gap: 10px; }
  .row-4 { grid-template-columns: repeat(4, 1fr); }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .err { padding: 10px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.9; }
  .rejected { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc2); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.9; }
  .prev-h { font-weight: 700; color: var(--color-acc); letter-spacing: 1px; margin-bottom: 6px; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
