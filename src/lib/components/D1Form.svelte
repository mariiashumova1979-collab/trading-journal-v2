<script lang="ts">
  import { checkImpulseD1Patterns, calculateStopPrice, calculatePosition, parseNum } from '$lib/strategies/impulse';
  import { updateCandidate } from '$lib/data/candidates';
  import { updateTrade } from '$lib/data/trades';
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
  let d1_Date = $state(new Date().toISOString().split('T')[0]);

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

    const stopD0 = calculateStopPrice(payload.d0, payload.atr, candidate.direction);

    let trailedStop = stopD0;
    let stopMoved = false;
    if (candidate.direction === 'LONG') {
      if (d1.L > stopD0) {
        trailedStop = d1.L;
        stopMoved = true;
      }
    } else {
      if (d1.H < stopD0) {
        trailedStop = d1.H;
        stopMoved = true;
      }
    }

    const newEntry = candidate.direction === 'LONG' ? d1.H : d1.L;
    const pos = calculatePosition(newEntry, trailedStop, payload.atr, 100, candidate.direction);

    errors = isValid ? [] : ['Ни один паттерн D+1 не подтверждён — кандидат отклоняется'];

    preview = {
      d1,
      patterns: result.matched,
      details: result.details,
      stopD0,
      trailedStop,
      stopMoved,
      newEntry,
      pos,
      newStatus: isValid ? 'READY_ENTRY' : 'REJECTED'
    };
  }

  // Формирует автозаметку D+1 для сделки
  function buildD1Note(): string {
    if (!preview) return '';
    const patterns = preview.patterns.length ? preview.patterns.join(' + ') : 'не подтверждён';
    const ohlc = `O ${preview.d1.O.toFixed(2)} / H ${preview.d1.H.toFixed(2)} / L ${preview.d1.L.toFixed(2)} / C ${preview.d1.C.toFixed(2)}`;
    let trail = '';
    if (preview.stopMoved) {
      trail = ` | Trail stop: $${preview.stopD0.toFixed(2)} → $${preview.trailedStop.toFixed(2)}`;
    } else {
      trail = ` | Stop $${preview.stopD0.toFixed(2)} (без изменений)`;
    }
    return `D+1 (${d1_Date}): Pattern: ${patterns} | OHLC ${ohlc}${trail}`;
  }

  async function save() {
    calc();
    if (!preview) return;
    saving = true;
    try {
      const d1Note = buildD1Note();
      const newPayload = {
        ...candidate.payload!,
        d1: preview.d1,
        d1_date: d1_Date,
        d1_note: d1Note,
        pattern: preview.patterns.join(' + ') || null
      };
      await updateCandidate(candidate.id, {
        status: preview.newStatus,
        entry: preview.newEntry,
        stop: preview.trailedStop,
        target1: preview.pos.target1,
        target2: preview.pos.target2,
        payload: newPayload
      });

      // Если сделка уже открыта (кандидат был ENTERED) — добавить заметку в notes сделки
      if (candidate.status === 'ENTERED' && candidate.trade_id) {
        // Получаем текущие notes и добавляем D+1
        const { listTrades } = await import('$lib/data/trades');
        const trades = await listTrades();
        const trade = trades.find(t => t.id === candidate.trade_id);
        if (trade) {
          const newNotes = (trade.notes || '') + (trade.notes ? '\n' : '') + d1Note;
          await updateTrade(trade.id, { notes: newNotes });
        }
      }

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
      <div>Текущий Entry: <b>${candidate.entry?.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${candidate.stop != null ? Number(candidate.stop).toFixed(2) : '—'}</b></div>
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
      <div style="margin-top:6px"><b>Entry D+2:</b> {candidate.direction === 'LONG' ? 'High_D+1' : 'Low_D+1'} · <b>Trail:</b> {candidate.direction === 'LONG' ? 'max(Stop_D0, Low_D+1)' : 'min(Stop_D0, High_D+1)'}</div>
    </div>

    <div class="row row-2">
      <div class="fg">
        <label for="d1-date">D+1 Date</label>
        <input id="d1-date" type="date" bind:value={d1_Date} />
      </div>
      <div></div>
    </div>

    <div class="shdif">Day D+1 OHLC</div>
    <div class="row row-4">
      <div class="fg"><label for="d1-o">Open</label><input id="d1-o" bind:value={d1_O} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="d1-h">High</label><input id="d1-h" bind:value={d1_H} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="d1-l">Low</label><input id="d1-l" bind:value={d1_L} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label for="d1-c">Close</label><input id="d1-c" bind:value={d1_C} oninput={calc} inputmode="decimal" /></div>
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
            <b>Position update (риск $100):</b><br>
            <span style="color:var(--color-acc4)">New Entry: <b>${preview.newEntry.toFixed(2)}</b></span> ({candidate.direction === 'LONG' ? 'High' : 'Low'} D+1)<br>
            Stop D0: ${preview.stopD0.toFixed(2)} → 
            {#if preview.stopMoved}
              <span style="color:var(--color-acc)">Trail: <b>${preview.trailedStop.toFixed(2)}</b></span> (подтянут)
            {:else}
              <span style="color:var(--color-t2)"><b>${preview.trailedStop.toFixed(2)}</b></span> (без изменений)
            {/if}<br>
            Risk/share: ${preview.pos.risk_per_share.toFixed(2)} · Risk/ATR: {preview.pos.risk_atr_ratio.toFixed(2)}{#if preview.pos.risk_warning} ⚠{/if}<br>
            Shares: <b>{preview.pos.shares}</b> · Position: ${preview.pos.position_value.toFixed(0)}<br>
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

      <div class="note-preview">
        <div class="prev-h" style="color:var(--color-acc4)">ЗАМЕТКА В СДЕЛКУ</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--color-t2);line-height:1.6">{buildD1Note()}</div>
      </div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
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
  .info b { color: var(--color-text); }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 10px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 12px; }
  .hint b { color: var(--color-text); }
  .shdif { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 14px 0 8px; }
  .row { display: grid; gap: 10px; }
  .row-2 { grid-template-columns: 1fr 1fr; }
  .row-4 { grid-template-columns: repeat(4, 1fr); }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .err { padding: 10px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.9; }
  .rejected { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc2); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.9; }
  .prev-h { font-weight: 700; color: var(--color-acc); letter-spacing: 1px; margin-bottom: 6px; }
  .note-preview { padding: 10px 12px; background: var(--color-bg3); border-left: 3px solid var(--color-acc4); border-radius: 6px; margin: 12px 0; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
