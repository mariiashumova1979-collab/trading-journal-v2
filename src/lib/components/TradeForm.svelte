<script lang="ts">
  import { parseNum } from '$lib/strategies/impulse';
  import { insertTrade } from '$lib/data/trades';
  import { updateCandidate } from '$lib/data/candidates';
  import { user } from '$lib/stores/auth';
  import type { Candidate, MaxWeeklyPayload } from '$lib/types';

  let { candidate, onClose, onSaved }: {
    candidate: Candidate;
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  const isMaxWeekly = candidate.strategy === 'max_weekly';
  const mwPayload = isMaxWeekly ? (candidate.payload as MaxWeeklyPayload) : null;

  // Стратегии с уже рассчитанными entry/stop/target в кандидате
  const isGeneric = ['ibs_swing', 'nr7', 'event_continuation', 'pead'].includes(candidate.strategy);
  const strategyNames: Record<string, string> = {
    ibs_swing: 'IBS Mean Reversion',
    nr7: 'NR7 Breakout',
    event_continuation: 'Event Continuation',
    pead: 'Post-Event Gap'
  };
  const genericAtr = isGeneric ? (
    (candidate.payload as any)?.atr14 ||
    (candidate.payload as any)?.atr ||
    0
  ) : 0;

  let entryDate = $state(new Date().toISOString().split('T')[0]);
  let entryActual = $state(isMaxWeekly ? '' : (candidate.entry || 0).toFixed(2));
  let riskAmt = $state('100');
  let commission = $state('0');

  let errors = $state<string[]>([]);
  let warnings = $state<string[]>([]);
  let preview = $state<any>(null);
  let gapAlert = $state<{ triggered: boolean; msg: string } | null>(null);
  let saving = $state(false);

  // ─── Расчёт позиции ───
  function calc() {
    errors = [];
    warnings = [];
    gapAlert = null;

    const entry = parseNum(entryActual);
    const risk = parseNum(riskAmt) || 100;

    if (isNaN(entry) || entry <= 0) {
      errors = [isMaxWeekly ? 'Введи Open price понедельника' : 'Введи Entry'];
      preview = null;
      return;
    }

    if (isMaxWeekly && mwPayload) {
      // GAP CHECK для MAX Weekly
      if (candidate.direction === 'SHORT' && entry >= mwPayload.gap_cancel_threshold) {
        gapAlert = {
          triggered: true,
          msg: `Open ${entry.toFixed(2)} ≥ ${mwPayload.gap_cancel_threshold.toFixed(2)} (+4% от пятницы) — GAP CANCEL`
        };
      } else if (candidate.direction === 'LONG' && entry <= mwPayload.gap_cancel_threshold) {
        gapAlert = {
          triggered: true,
          msg: `Open ${entry.toFixed(2)} ≤ ${mwPayload.gap_cancel_threshold.toFixed(2)} (−4% от пятницы) — GAP CANCEL`
        };
      } else {
        gapAlert = { triggered: false, msg: `Gap OK: ${candidate.direction === 'SHORT' ? '<' : '>'} ${mwPayload.gap_cancel_threshold.toFixed(2)}` };
      }

      // Стоп и цели от Entry (а не от Close T0)
      const atr = mwPayload.atr14;
      const stopDist = Math.min(2 * atr, entry * 0.10);
      const stop = candidate.direction === 'SHORT' ? entry + stopDist : entry - stopDist;
      // T1 = 1.5×ATR (Докрутка 2A для MAX Weekly), T2 = 2×ATR
      const target1 = candidate.direction === 'SHORT' ? entry - 1.5 * atr : entry + 1.5 * atr;
      const target2 = candidate.direction === 'SHORT' ? entry - 2 * atr : entry + 2 * atr;
      const riskPerShare = Math.abs(entry - stop);
      const shares = riskPerShare > 0
        ? Math.min(
            Math.floor((risk) / riskPerShare),
            Math.floor((parseFloat(riskAmt) || 100) * 10 / entry)
          )
        : 0;
      const positionValue = shares * entry;
      const riskAtrRatio = atr > 0 ? riskPerShare / atr : 0;

      if (shares < 1) {
        errors = ['Слишком мало акций — увеличь риск'];
        preview = null;
        return;
      }
      if (riskAtrRatio > 2.5) {
        warnings = [`⚠ Stop distance ${riskPerShare.toFixed(2)} > 2.5×ATR — стоп очень широкий`];
      }

      preview = { entry, stop, target1, target2, shares, positionValue, riskPerShare, riskAtrRatio };
    } else if (isGeneric) {
      // IBS / NR7 / Event / PEG — stop/target уже сохранены в кандидате
      if (!candidate.direction || candidate.stop === null || candidate.stop === undefined) {
        errors = ['Стоп не рассчитан — сначала заполни D+1 форму'];
        preview = null;
        return;
      }
      const stop = Number(candidate.stop);
      const riskPerShare = Math.abs(entry - stop);
      if (riskPerShare <= 0) { errors = ['Entry слишком близко к Stop']; preview = null; return; }
      const shares = Math.floor(risk / riskPerShare);
      const riskAtrRatio = genericAtr > 0 ? riskPerShare / genericAtr : 0;
      const positionValue = shares * entry;
      const target1 = candidate.target1 != null ? Number(candidate.target1) : (
        candidate.direction === 'LONG' ? entry + riskPerShare : entry - riskPerShare
      );
      const target2 = candidate.target2 != null ? Number(candidate.target2) : (
        candidate.direction === 'LONG' ? entry + 2 * riskPerShare : entry - 2 * riskPerShare
      );
      if (shares < 1) { errors = ['Слишком мало акций — увеличь риск']; preview = null; return; }
      if (riskAtrRatio > 2.0) warnings = [`⚠ Risk/ATR = ${riskAtrRatio.toFixed(2)} > 2.0`];
      preview = { entry, stop, target1, target2, shares, positionValue, riskPerShare, riskAtrRatio };

    } else {
      // Impulse логика
      if (!candidate.direction || candidate.stop === null || candidate.stop === undefined) {
        errors = ['Кандидат без direction/stop'];
        preview = null;
        return;
      }
      const stop = Number(candidate.stop);
      const atr = (candidate.payload as any)?.atr || 0;
      const riskPerShare = Math.abs(entry - stop);
      const shares = riskPerShare > 0 ? Math.floor(risk / riskPerShare) : 0;
      const riskAtrRatio = atr > 0 ? riskPerShare / atr : 0;
      const positionValue = shares * entry;
      const target1 = candidate.direction === 'LONG' ? entry + riskPerShare : entry - riskPerShare;
      const target2 = candidate.direction === 'LONG' ? entry + 2 * riskPerShare : entry - 2 * riskPerShare;
      if (shares < 1) { errors = ['Слишком мало акций — увеличь риск']; preview = null; return; }
      if (riskAtrRatio > 1.5) warnings = [`⚠ Risk/ATR = ${riskAtrRatio.toFixed(2)} > 1.5`];
      preview = { entry, stop, target1, target2, shares, positionValue, riskPerShare, riskAtrRatio };
    }
  }

  async function handleGapCancel() {
    saving = true;
    try {
      await updateCandidate(candidate.id, { status: 'GAP_CANCEL' });
      onSaved();
      onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + e.message];
    } finally {
      saving = false;
    }
  }

  async function save() {
    calc();
    if (!preview) return;
    if (!$user) return;

    saving = true;
    try {
      const entry = parseNum(entryActual);
      const atr = isMaxWeekly ? mwPayload!.atr14 : (candidate.payload as any)?.atr || 0;

      // Правила выхода зависят от направления
      const exitRules = isMaxWeekly && candidate.direction === 'LONG'
        ? [
            '─ LONG DOWN-LOTTERY правила ─',
            'Time stop: D+3 (среда)',
            'D+1 EOD exit: закрыть если Close ≤ Entry ИЛИ Close < Open',
            'После T1 (1.5×ATR, 60%): stop = MAX(текущий стоп, Low предыдущего дня)',
            'T2: 2×ATR (40%)'
          ]
        : isMaxWeekly && candidate.direction === 'SHORT'
        ? [
            '─ SHORT правила ─',
            'Time stop: D+5 (пятница)',
            'После T1 (1.5×ATR, 60%): стоп в безубыток',
            'T2: 2×ATR (40%)',
            '─ D+1 EOD check (22:45 EET) ─',
            'Close D+1 < Entry → стоп остаётся на Entry + 2×ATR',
            'Close D+1 ≥ Entry → стоп → Close_D+1 × 1.01'
          ]
        : [];

      const notes = isMaxWeekly && mwPayload
        ? [
            `MAX Weekly signal: ${candidate.direction}`,
            `Friday close (T0): $${mwPayload.close_t0.toFixed(2)}`,
            `MAX_5d: ${(mwPayload.max5d * 100).toFixed(1)}% | MAX_pct: ${mwPayload.maxPct.toFixed(0)}`,
            `Return_5d: ${(mwPayload.return5d * 100).toFixed(1)}% | VolSpike: ${mwPayload.volSpike5d.toFixed(2)}x`,
            `ATR14: ${mwPayload.atr14.toFixed(2)} | ADV20: $${(mwPayload.adv20 / 1_000_000).toFixed(1)}M`,
            ...exitRules
          ].join('\n')
        : isGeneric
        ? (() => {
            const p = candidate.payload as any;
            const name = strategyNames[candidate.strategy] || candidate.strategy;
            const lines = [
              `${name}: ${candidate.direction} | T0: ${candidate.signal_date}`,
              `ATR14: ${(p?.atr14 || p?.atr || 0).toFixed(2)} | Entry: ${Number(candidate.entry || 0).toFixed(2)} | Stop: ${Number(candidate.stop || 0).toFixed(2)}`
            ];
            if (p?.d1_note)      lines.push(p.d1_note);
            if (p?.d1_fill_note) lines.push(p.d1_fill_note);
            return lines.join('\n');
          })()
        : (() => {
            const p = candidate.payload as any;
            const base = 'D0: ' + candidate.signal_date + ' | Pattern: ' + (p?.pattern || 'N/A') + ' | ATR: ' + (p?.atr?.toFixed(2) || 'N/A');
            return p?.d1_note ? base + '\n' + p.d1_note : base;
          })();

      const trade = await insertTrade({
        user_id: $user.id,
        ticker: candidate.ticker,
        type: candidate.direction!,
        strategy: candidate.strategy,
        entry_date: entryDate,
        entry: preview.entry,
        shares: preview.shares,
        stop: preview.stop,
        target1: preview.target1,
        target2: preview.target2,
        status: 'OPEN',
        commission: parseNum(commission) || 0,
        notes,
        atr_pct: atr ? (atr / preview.entry * 100) : null,
        atr_abs: atr || null,
        impulse_anchor: isMaxWeekly ? mwPayload!.close_t0 : (
          candidate.direction === 'LONG'
            ? (candidate.payload as any)?.d0?.L ?? null
            : (candidate.payload as any)?.d0?.H ?? null
        ),
        setup: isMaxWeekly ? null : {
          d0: (candidate.payload as any)?.d0,
          d1: (candidate.payload as any)?.d1,
          atr: (candidate.payload as any)?.atr,
          rel_vol: (candidate.payload as any)?.rel_vol,
          pattern: (candidate.payload as any)?.pattern,
          d0_date: candidate.signal_date,
          metrics: (candidate.payload as any)?.metrics
        }
      });

      await updateCandidate(candidate.id, { status: 'ENTERED', trade_id: trade.id });
      onSaved();
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
      <div>Открыть сделку — {candidate.ticker} ({candidate.direction})</div>
      <button onclick={onClose} class="cls" aria-label="Close">×</button>
    </div>

    <!-- INFO: MAX Weekly -->
    {#if isMaxWeekly && mwPayload}
      <div class="info">
        <div>Стратегия: <b style="color:#a78bfa">MAX Weekly</b> · Сигнал: <b style="color:{candidate.direction==='SHORT'?'var(--color-acc2)':'var(--color-acc)'}">{candidate.direction}</b></div>
        <div>Пятница Close (T0): <b>${mwPayload.close_t0.toFixed(2)}</b> · ATR14: <b>{mwPayload.atr14.toFixed(2)}</b></div>
        <div>MAX_5d: <b>{(mwPayload.max5d*100).toFixed(1)}%</b> · MAX_pct: <b>{mwPayload.maxPct.toFixed(0)}</b> · VolSpike: <b>{mwPayload.volSpike5d.toFixed(2)}x</b></div>
        <div>Gap cancel: <b style="color:var(--color-acc3)">{candidate.direction==='SHORT' ? 'Open ≥' : 'Open ≤'} ${mwPayload.gap_cancel_threshold.toFixed(2)}</b></div>
      </div>
    {:else if isGeneric}
      <div class="info">
        <div>Стратегия: <b>{strategyNames[candidate.strategy] || candidate.strategy}</b> · <span style="color:{candidate.direction==='LONG'?'var(--color-acc)':'var(--color-acc2)'};font-weight:700">{candidate.direction}</span></div>
        <div>Entry: <b>${candidate.entry != null ? Number(candidate.entry).toFixed(2) : '—'}</b> · Stop: <b style="color:var(--color-acc2)">${candidate.stop != null ? Number(candidate.stop).toFixed(2) : '—'}</b></div>
        <div>ATR14: <b>{genericAtr > 0 ? genericAtr.toFixed(2) : '—'}</b> · T1: <b>${candidate.target1 != null ? Number(candidate.target1).toFixed(2) : '—'}</b> · T2: <b>${candidate.target2 != null ? Number(candidate.target2).toFixed(2) : '—'}</b></div>
        {#if candidate.stop == null}<div style="color:var(--color-acc2);font-size:10px;margin-top:4px">⚠ Стоп не рассчитан — сначала заполни D+1 форму</div>{/if}
      </div>
    {:else}
      <div class="info">
        <div>Pattern D+1: <b>{(candidate.payload as any)?.pattern || 'не подтверждён'}</b></div>
        <div>Calculated entry: ${candidate.entry?.toFixed(2)} · Stop: ${candidate.stop !== null ? Number(candidate.stop).toFixed(2) : '—'}</div>
        <div>ATR: {(candidate.payload as any)?.atr?.toFixed(2)} · 0.2×ATR: {(candidate.payload as any)?.atr ? (0.2 * (candidate.payload as any).atr).toFixed(2) : '—'}</div>
      </div>
    {/if}

    <div class="row">
      <div class="fg">
        <label for="tf-date">Дата входа</label>
        <input id="tf-date" type="date" bind:value={entryDate} />
      </div>
      <div class="fg">
        <label for="tf-entry">{isMaxWeekly ? 'Open price (понедельник)' : 'Фактический Entry'}</label>
        <input id="tf-entry" bind:value={entryActual} oninput={calc} inputmode="decimal"
          placeholder={isMaxWeekly ? 'Введи Open понедельника' : isGeneric ? 'Фактическая цена входа' : ''} />
      </div>
    </div>

    <div class="row">
      <div class="fg">
        <label for="tf-risk">Риск $</label>
        <input id="tf-risk" bind:value={riskAmt} oninput={calc} inputmode="numeric" />
      </div>
      <div class="fg">
        <label for="tf-comm">Комиссия $</label>
        <input id="tf-comm" bind:value={commission} inputmode="decimal" />
      </div>
    </div>

    <!-- GAP CHECK для MAX Weekly -->
    {#if isMaxWeekly && gapAlert}
      <div class="gap-check" class:gap-ok={!gapAlert.triggered} class:gap-fail={gapAlert.triggered}>
        {#if gapAlert.triggered}
          ⚠ {gapAlert.msg}
          <div style="margin-top:8px">
            <button class="btn-r" onclick={handleGapCancel} disabled={saving} style="font-size:10px">
              Пометить GAP CANCEL
            </button>
          </div>
        {:else}
          ✓ {gapAlert.msg}
        {/if}
      </div>
    {/if}

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}
    {#if warnings.length}
      <div class="warn">{#each warnings as w}<div>{w}</div>{/each}</div>
    {/if}

    {#if preview && (!gapAlert?.triggered)}
      <div class="prev">
        <div class="prev-h">POSITION</div>
        <div>Entry: <b>${preview.entry.toFixed(2)}</b> · Stop: <b style="color:var(--color-acc2)">${preview.stop.toFixed(2)}</b></div>
        <div>Risk/share: <b>${preview.riskPerShare.toFixed(2)}</b>{#if preview.riskAtrRatio} · Risk/ATR: <b>{preview.riskAtrRatio.toFixed(2)}</b>{/if}</div>
        <div>Shares: <b>{preview.shares}</b> · Position: <b>${preview.positionValue.toFixed(0)}</b></div>
        <div>T1 (60%): <b>${preview.target1.toFixed(2)}</b> · T2 (40%): <b>${preview.target2.toFixed(2)}</b></div>
        {#if isMaxWeekly}
          {#if candidate.direction === 'LONG'}
            <div class="mw-rules">
              <div><b>Time stop:</b> D+3 (среда)</div>
              <div><b>D+1 EOD exit:</b> если Close ≤ Entry или Close &lt; Open → закрыть всю позицию</div>
              <div><b>После T1:</b> stop = MAX(текущий, Low вчерашнего дня)</div>
            </div>
          {:else}
            <div class="mw-rules">
              <div><b>Time stop:</b> D+5 (пятница) · <b>После T1:</b> стоп в безубыток</div>
              <div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,200,90,0.2)">
                <b>D+1 EOD check:</b><br>
                Close &lt; Entry → стоп остаётся (Entry + 2×ATR)<br>
                Close ≥ Entry → стоп → Close × 1.01
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      {#if !isMaxWeekly && !isGeneric}
        <button onclick={calc}>Рассчитать</button>
      {/if}
      <button onclick={save} disabled={!preview || saving || gapAlert?.triggered} class="btn-p">
        {saving ? 'Сохранение...' : 'Открыть сделку'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 540px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .info { font-family: var(--font-mono); font-size: 11px; color: var(--color-text); padding: 10px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.9; margin-bottom: 14px; }
  .info b { color: var(--color-acc); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input { width: 100%; }
  .gap-check { padding: 10px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 11px; margin: 12px 0; }
  .gap-ok { background: rgba(126,232,162,0.1); border: 1px solid var(--color-acc); }
  .gap-fail { background: rgba(255,107,138,0.1); border: 1px solid var(--color-acc2); color: var(--color-text); }
  .err { padding: 10px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.7; }
  .warn { padding: 10px 12px; background: rgba(255,200,90,0.1); border: 1px solid rgba(255,200,90,0.4); color: var(--color-acc3); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; }
  .prev { padding: 12px; background: var(--color-bg3); border: 1px solid var(--color-acc); color: var(--color-text); font-family: var(--font-mono); font-size: 11px; border-radius: 6px; margin: 12px 0; line-height: 1.9; }
  .prev-h { font-weight: 700; color: var(--color-acc); letter-spacing: 1px; margin-bottom: 6px; }
  .mw-rules { font-family: var(--font-mono); font-size: 9px; color: var(--color-acc3); padding: 6px 10px; background: rgba(255,200,90,0.06); border: 1px solid rgba(255,200,90,0.2); border-radius: 4px; margin-top: 8px; line-height: 1.7; }
  .mw-rules b { color: var(--color-text); }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
