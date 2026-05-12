<script lang="ts">
  import {
    parseNum,
    calcEventD0Metrics,
    validateEventD0,
    calcEventPosition
  } from '$lib/strategies/event_continuation';
  import { insertCandidate, updateCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  import type { Candidate } from '$lib/types';

  let { onClose, onAdded, editCandidate = null }: {
    onClose: () => void;
    onAdded: () => void;
    editCandidate?: Candidate | null;
  } = $props();

  const isEdit = !!editCandidate;
  const ep = (editCandidate?.payload as any);

  let ticker   = $state(editCandidate?.ticker ?? '');
  let d0Date   = $state(editCandidate?.signal_date ?? new Date().toISOString().split('T')[0]);
  let prevC    = $state(ep?.d_1?.C?.toString() ?? '');
  let d0O      = $state(ep?.d0?.O?.toString() ?? '');
  let d0H      = $state(ep?.d0?.H?.toString() ?? '');
  let d0L      = $state(ep?.d0?.L?.toString() ?? '');
  let d0C      = $state(ep?.d0?.C?.toString() ?? '');
  let d0V      = $state(ep?.d0?.V?.toString() ?? '');
  let avgVol20 = $state(ep?.avg_vol_20?.toString() ?? '');
  let atr14    = $state(ep?.atr14?.toString() ?? '');
  let high10d  = $state(ep?.high_10d?.toString() ?? '');
  let low10d   = $state(ep?.low_10d?.toString() ?? '');
  let riskAmt  = $state('100');

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
      open:      parseNum(d0O),
      high:      parseNum(d0H),
      low:       parseNum(d0L),
      close:     parseNum(d0C),
      volume:    parseNum(d0V),
      avgVol20:  parseNum(avgVol20),
      atr14:     parseNum(atr14),
      high10d:   parseNum(high10d),
      low10d:    parseNum(low10d)
    };

    const missing: string[] = [];
    if (!ticker.trim()) missing.push('Тикер');
    if (isNaN(d.prevClose))  missing.push('Close D-1');
    if (isNaN(d.open))       missing.push('D0 Open');
    if (isNaN(d.high))       missing.push('D0 High');
    if (isNaN(d.low))        missing.push('D0 Low');
    if (isNaN(d.close))      missing.push('D0 Close');
    if (isNaN(d.volume))     missing.push('D0 Volume');
    if (isNaN(d.avgVol20))   missing.push('AvgVol20');
    if (isNaN(d.atr14))      missing.push('ATR14');
    if (isNaN(d.high10d))    missing.push('High 10D');
    if (isNaN(d.low10d))     missing.push('Low 10D');

    if (missing.length) {
      errors = ['Заполни поля: ' + missing.join(', ')];
      return;
    }

    const m = calcEventD0Metrics(d);
    const v = validateEventD0(d, m);
    errors   = v.errors;
    warnings = v.warnings;

    preview = { d, m };
  }

  async function save() {
    calc();
    if (!preview || errors.length) return;
    if (!$user) return;

    saving = true;
    const { d, m } = preview;

    try {
      const tickerUp = ticker.trim().toUpperCase();
      const id = tickerUp + '_EC_' + d0Date;
      const payload = {
        d_1: { C: d.prevClose },
        d0: { O: d.open, H: d.high, L: d.low, C: d.close, V: d.volume },
        atr14: d.atr14,
        avg_vol_20: d.avgVol20,
        high_10d: d.high10d,
        low_10d: d.low10d,
        metrics: {
          gap_pct: m.gapPct,
          close_position: m.closePosition,
          vol_ratio: m.volRatio,
          range_atr_ratio: m.rangePct
        }
      };

      if (isEdit && editCandidate) {
        await updateCandidate(editCandidate.id, {
          ticker: tickerUp,
          signal_date: d0Date,
          direction: m.direction,
          payload: {
            ...payload,
            d1: (editCandidate.payload as any)?.d1 ?? null,
            d1_note: (editCandidate.payload as any)?.d1_note ?? null
          }
        });
      } else {
        await insertCandidate({
          id,
          user_id: $user.id,
          strategy: 'event_continuation',
          ticker: tickerUp,
          signal_date: d0Date,
          direction: m.direction,
          status: 'WAITING_D1',
          entry: null,
          stop: null,
          target1: null,
          target2: null,
          payload
        });
      }
      onAdded();
      onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally {
      saving = false;
    }
  }

  // Авторасчёт в реалтайме
  $effect(() => {
    if (isEdit && !preview) calc();
  });

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const clr = (ok: boolean) => ok ? 'var(--color-acc)' : 'var(--color-acc2)';
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать' : 'Добавить кандидата'} · Event Continuation</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="hint">
      <div><b>LONG:</b> Gap ≥ +4% · Range ≥ 1.5×ATR · Vol ≥ 2.5× · ClosePos ≥ 0.75 · Close > High10D</div>
      <div><b>SHORT:</b> Gap ≤ -4% · Range ≥ 1.5×ATR · Vol ≥ 2.5× · ClosePos ≤ 0.25 · Close &lt; Low10D</div>
    </div>

    <div class="row-2">
      <div class="fg"><label>Ticker</label><input value={ticker} oninput={onTickerInput} placeholder="NVDA" class="up" disabled={isEdit} /></div>
      <div class="fg"><label>D0 Date</label><input type="date" bind:value={d0Date} disabled={isEdit} /></div>
    </div>

    <div class="sect">Day D-1</div>
    <div class="row-1">
      <div class="fg"><label>Close D-1</label><input bind:value={prevC} oninput={calc} inputmode="decimal" /></div>
    </div>

    <div class="sect">Day D0 (Event impulse)</div>
    <div class="row-5">
      <div class="fg"><label>Open</label><input bind:value={d0O} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>High</label><input bind:value={d0H} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Low</label><input bind:value={d0L} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Close</label><input bind:value={d0C} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Volume</label><input bind:value={d0V} oninput={calc} inputmode="numeric" /></div>
    </div>

    <div class="sect">Контекст</div>
    <div class="row-4">
      <div class="fg"><label>ATR(14)</label><input bind:value={atr14} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>AvgVol(20)</label><input bind:value={avgVol20} oninput={calc} inputmode="numeric" /></div>
      <div class="fg"><label>High 10D</label><input bind:value={high10d} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>Low 10D</label><input bind:value={low10d} oninput={calc} inputmode="decimal" /></div>
    </div>

    {#if warnings.length}
      <div class="warn">{#each warnings as w}<div>⚠ {w}</div>{/each}</div>
    {/if}
    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    {#if preview}
      {@const m = preview.m}
      {@const d = preview.d}
      <div class="prev">
        <div class="prev-h">
          D0 VALIDATION ·
          <span style="color:{m.direction ? 'var(--color-acc)' : 'var(--color-acc2)'}">
            {m.direction ?? 'НЕТ СИГНАЛА'}
          </span>
        </div>
        <div class="checks">
          <div style="color:{clr(Math.abs(m.gapPct) >= 0.04)}">Gap: <b>{fmtPct(m.gapPct)}</b> {Math.abs(m.gapPct) >= 0.04 ? '✓' : '✗ нужен ≥ ±4%'}</div>
          <div style="color:{clr(m.rangePct >= 1.5)}">Range/ATR: <b>{m.rangePct.toFixed(2)}</b> {m.rangePct >= 1.5 ? '✓' : '✗ нужен ≥ 1.5'}</div>
          <div style="color:{clr(m.volRatio >= 2.5)}">VolRatio: <b>{m.volRatio.toFixed(2)}×</b> {m.volRatio >= 2.5 ? '✓' : '✗ нужен ≥ 2.5×'}</div>
          <div style="color:{clr(m.gapPct >= 0 ? m.closePosition >= 0.75 : m.closePosition <= 0.25)}">
            ClosePosition: <b>{m.closePosition.toFixed(2)}</b>
            {m.gapPct >= 0 ? (m.closePosition >= 0.75 ? '✓' : '✗ нужен ≥ 0.75') : (m.closePosition <= 0.25 ? '✓' : '✗ нужен ≤ 0.25')}
          </div>
          <div style="color:{clr(m.breakout10d)}">10D breakout: <b>{m.gapPct >= 0 ? d.high10d.toFixed(2) : d.low10d.toFixed(2)}</b> {m.breakout10d ? '✓' : '✗ нет пробоя'}</div>
          <div>Midpoint D0: <b>${m.midpoint.toFixed(2)}</b></div>
        </div>
        {#if m.direction}
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-line);font-size:10px;color:var(--color-t2)">
            Ждём D1 compression. Entry и Stop будут рассчитаны после ввода D1.
          </div>
        {/if}
      </div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={!preview?.m?.direction || saving || errors.length > 0} class="btn-p">
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
  .row-1 { display: grid; grid-template-columns: 1fr 3fr; gap: 10px; margin-bottom: 4px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 4px; }
  .row-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 4px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .up { text-transform: uppercase; }
  .fg input:disabled { opacity: 0.6; }
  .warn { padding: 8px 12px; background: rgba(255,200,90,0.1); border: 1px solid rgba(255,200,90,0.4); color: var(--color-acc3); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; }
  .prev-h { font-weight: 700; letter-spacing: 1px; margin-bottom: 8px; }
  .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 10px; line-height: 1.7; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
