<script lang="ts">
  import { parseNum, checkImpulseD1Patterns } from '$lib/strategies/impulse';
  import type { TradeSetup, OHLCV, TradeType } from '$lib/types';

  let { setup = $bindable(), direction }: {
    setup: TradeSetup | null;
    direction: TradeType | null;
  } = $props();

  let expanded = $state(false);

  // Локальные строковые поля
  let d_1_O = $state(setup?.d_1?.O?.toString() ?? '');
  let d_1_H = $state(setup?.d_1?.H?.toString() ?? '');
  let d_1_L = $state(setup?.d_1?.L?.toString() ?? '');
  let d_1_C = $state(setup?.d_1?.C?.toString() ?? '');
  let d_1_V = $state(setup?.d_1?.V?.toString() ?? '');

  let d0_O = $state(setup?.d0?.O?.toString() ?? '');
  let d0_H = $state(setup?.d0?.H?.toString() ?? '');
  let d0_L = $state(setup?.d0?.L?.toString() ?? '');
  let d0_C = $state(setup?.d0?.C?.toString() ?? '');
  let d0_V = $state(setup?.d0?.V?.toString() ?? '');

  let d1_O = $state(setup?.d1?.O?.toString() ?? '');
  let d1_H = $state(setup?.d1?.H?.toString() ?? '');
  let d1_L = $state(setup?.d1?.L?.toString() ?? '');
  let d1_C = $state(setup?.d1?.C?.toString() ?? '');

  let atrStr = $state(setup?.atr?.toString() ?? '');
  let relVolStr = $state(setup?.rel_vol?.toString() ?? '');
  let spyChgStr = $state(setup?.spy_chg?.toString() ?? '');

  let metrics = $state<any>(null);

  function buildOHLCV(o: string, h: string, l: string, c: string, v?: string): OHLCV | null {
    const obj: OHLCV = {};
    let any = false;
    const O = parseNum(o); if (!isNaN(O)) { obj.O = O; any = true; }
    const H = parseNum(h); if (!isNaN(H)) { obj.H = H; any = true; }
    const L = parseNum(l); if (!isNaN(L)) { obj.L = L; any = true; }
    const C = parseNum(c); if (!isNaN(C)) { obj.C = C; any = true; }
    if (v !== undefined) {
      const V = parseNum(v); if (!isNaN(V)) { obj.V = V; any = true; }
    }
    return any ? obj : null;
  }

  function recalc() {
    const d_1 = buildOHLCV(d_1_O, d_1_H, d_1_L, d_1_C, d_1_V);
    const d0 = buildOHLCV(d0_O, d0_H, d0_L, d0_C, d0_V);
    const d1 = buildOHLCV(d1_O, d1_H, d1_L, d1_C);
    const atr = parseNum(atrStr);
    const rel_vol = parseNum(relVolStr);
    const spy_chg = parseNum(spyChgStr);

    let m: any = {};
    let pattern: string | null = setup?.pattern ?? null;

    if (d0?.H != null && d0?.L != null && d0?.C != null && d0?.O != null) {
      const range = d0.H - d0.L;
      const mid = (d0.H + d0.L) / 2;
      m.range = range;
      m.mid = mid;
      if (range > 0) {
        m.clv = (d0.C - d0.L) / range;
        m.body = Math.abs(d0.C - d0.O) / range;
      }
      if (!isNaN(atr) && atr > 0) m.range_atr = range / atr;
      if (d_1?.C != null && d_1.C > 0) m.impulse = (d0.C - d_1.C) / d_1.C;
    }
    if (!isNaN(rel_vol)) m.vol_ratio = rel_vol;

    // D+1 паттерны
    if (d0 && d1 && direction && m.range != null && m.range > 0) {
      const result = checkImpulseD1Patterns(d0, d1, direction);
      pattern = result.matched.length ? result.matched.join(' + ') : 'не подтверждён';
    }

    // IBS для D-1 если есть
    if (d_1?.H != null && d_1?.L != null && d_1?.C != null) {
      const r1 = d_1.H - d_1.L;
      if (r1 > 0) m.ibs = (d_1.C - d_1.L) / r1;
    }

    metrics = m;

    // Обновляем родительский setup
    setup = {
      ...(setup || {}),
      d_1: d_1 || setup?.d_1 || null,
      d0: d0 || setup?.d0 || null,
      d1: d1 || setup?.d1 || null,
      atr: !isNaN(atr) ? atr : (setup?.atr ?? null),
      rel_vol: !isNaN(rel_vol) ? rel_vol : (setup?.rel_vol ?? null),
      spy_chg: !isNaN(spy_chg) ? spy_chg : (setup?.spy_chg ?? null),
      pattern,
      metrics: Object.keys(m).length ? m : (setup?.metrics ?? null)
    };
  }

  // Изначальный пересчёт при открытии (если есть данные)
  $effect(() => {
    if (expanded && !metrics) {
      recalc();
    }
  });

  function summary() {
    const parts: string[] = [];
    const m = setup?.metrics;
    if (setup?.d0_date) parts.push('D0: ' + setup.d0_date);
    if (m) {
      const sub: string[] = [];
      if (m.clv != null) sub.push('CLV ' + m.clv.toFixed(2));
      if (m.body != null) sub.push('Body ' + m.body.toFixed(2));
      if (m.range_atr != null) sub.push('R/ATR ' + m.range_atr.toFixed(2));
      if (m.vol_ratio != null) sub.push('VolR ' + m.vol_ratio.toFixed(1) + 'x');
      if (m.impulse != null) sub.push((m.impulse >= 0 ? '+' : '') + (m.impulse * 100).toFixed(1) + '%');
      if (sub.length) parts.push(sub.join(' · '));
    }
    if (setup?.pattern) parts.push('Pattern D+1: ' + setup.pattern);
    if (setup?.atr != null) parts.push('ATR ' + Number(setup.atr).toFixed(2));
    if (setup?.spy_chg != null) parts.push('SPY ' + (setup.spy_chg >= 0 ? '+' : '') + Number(setup.spy_chg).toFixed(2) + '%');
    return parts.length ? parts.join(' · ') : 'Нет данных. Разверни форму чтобы добавить OHLC.';
  }
</script>

<div class="sa">
  <div class="sa-h">
    <div class="sa-title">📐 SETUP ANALYSIS · данные для анализа паттерна</div>
    <button type="button" class="btn-s" onclick={() => (expanded = !expanded)}>{expanded ? 'Свернуть' : 'Развернуть'}</button>
  </div>
  <div class="sa-summary">{summary()}</div>

  {#if expanded}
    <div class="sa-body">
      <div class="sect">Day D-1 (предыдущий)</div>
      <div class="row row-5">
        <div class="fg"><label>Open</label><input bind:value={d_1_O} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>High</label><input bind:value={d_1_H} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Low</label><input bind:value={d_1_L} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Close</label><input bind:value={d_1_C} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Volume</label><input bind:value={d_1_V} oninput={recalc} inputmode="numeric" /></div>
      </div>

      <div class="sect">Day D0 (импульс)</div>
      <div class="row row-5">
        <div class="fg"><label>Open</label><input bind:value={d0_O} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>High</label><input bind:value={d0_H} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Low</label><input bind:value={d0_L} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Close</label><input bind:value={d0_C} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Volume</label><input bind:value={d0_V} oninput={recalc} inputmode="numeric" /></div>
      </div>

      <div class="sect">Day D+1 (паттерн)</div>
      <div class="row row-4">
        <div class="fg"><label>Open</label><input bind:value={d1_O} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>High</label><input bind:value={d1_H} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Low</label><input bind:value={d1_L} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>Close</label><input bind:value={d1_C} oninput={recalc} inputmode="decimal" /></div>
      </div>

      <div class="sect">Контекст</div>
      <div class="row row-3">
        <div class="fg"><label>ATR (абс)</label><input bind:value={atrStr} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>RelVol</label><input bind:value={relVolStr} oninput={recalc} inputmode="decimal" /></div>
        <div class="fg"><label>SPY change %</label><input bind:value={spyChgStr} oninput={recalc} inputmode="decimal" /></div>
      </div>

      {#if metrics && Object.keys(metrics).length > 0}
        <div class="sect" style="color:var(--color-acc4)">Авторасчёт</div>
        <div class="metrics">
          {#if metrics.range != null}
            <div><b>D0:</b> Range={metrics.range.toFixed(2)} · Mid={metrics.mid?.toFixed(2)}{#if metrics.clv != null} · CLV=<b>{metrics.clv.toFixed(2)}</b>{/if}{#if metrics.body != null} · Body=<b>{metrics.body.toFixed(2)}</b>{/if}{#if metrics.range_atr != null} · Range/ATR=<b>{metrics.range_atr.toFixed(2)}</b>{/if}{#if metrics.impulse != null} · Impulse=<b>{(metrics.impulse >= 0 ? '+' : '') + (metrics.impulse * 100).toFixed(2)}%</b>{/if}{#if metrics.vol_ratio != null} · RelVol=<b>{metrics.vol_ratio.toFixed(2)}×</b>{/if}</div>
          {/if}
          {#if setup?.pattern}
            <div><b>D+1 Pattern:</b> <span style="color:{setup.pattern.includes('не подтверждён') ? 'var(--color-acc2)' : 'var(--color-acc)'}"><b>{setup.pattern}</b></span></div>
          {/if}
          {#if metrics.ibs != null}
            <div><b>IBS (D-1):</b> {metrics.ibs.toFixed(2)}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sa { border: 1px solid var(--color-line); border-radius: 8px; padding: 12px; background: var(--color-bg2); margin: 12px 0; }
  .sa-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .sa-title { font-family: var(--font-mono); font-size: 10px; color: var(--color-acc4); letter-spacing: 1.5px; text-transform: uppercase; }
  .btn-s { font-size: 9px; padding: 4px 8px; }
  .sa-summary { font-family: var(--font-mono); font-size: 10px; padding: 10px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; color: var(--color-t2); }
  .sa-body { margin-top: 12px; padding: 12px; background: var(--color-bg3); border-radius: 8px; }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; margin: 14px 0 8px; color: var(--color-text); }
  .sect:first-child { margin-top: 0; }
  .row { display: grid; gap: 6px; margin-bottom: 4px; }
  .row-3 { grid-template-columns: repeat(3, 1fr); }
  .row-4 { grid-template-columns: repeat(4, 1fr); }
  .row-5 { grid-template-columns: repeat(5, 1fr); }
  .fg label { display: block; font-size: 9px; color: var(--color-t2); margin-bottom: 2px; font-family: var(--font-mono); }
  .fg input { width: 100%; padding: 6px 8px; font-size: 11px; }
  .metrics { font-family: var(--font-mono); font-size: 10px; padding: 10px 12px; background: var(--color-bg2); border-radius: 6px; line-height: 2; color: var(--color-t2); }
  .metrics b { color: var(--color-text); }
</style>
