<script lang="ts">
  import { onMount } from 'svelte';
  import { parseNum, calcGapD0Metrics, validateGapD0 } from '$lib/strategies/gap_reversal';
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

  let ticker       = $state(editCandidate?.ticker ?? '');
  let t0Date       = $state(editCandidate?.signal_date ?? new Date().toISOString().split('T')[0]);
  // SPY/VIX
  let spyClose     = $state(ep?.spy_close?.toString() ?? '');
  let spySma200    = $state(ep?.spy_sma200?.toString() ?? '');
  let vix          = $state(ep?.vix?.toString() ?? '');
  // Stock T0
  let closeT0      = $state(ep?.close_t0?.toString() ?? '');
  let sma100       = $state(ep?.sma100?.toString() ?? '');
  let sma100_20    = $state(ep?.sma100_20ago?.toString() ?? '');
  let sma50        = $state(ep?.sma50?.toString() ?? '');
  let atr14        = $state(ep?.atr14?.toString() ?? '');

  let preview  = $state<any>(null);
  let errors   = $state<string[]>([]);
  let warnings = $state<string[]>([]);
  let saving   = $state(false);

  const draftKey = isEdit ? `gap_edit_${editCandidate?.id}` : 'gap_new';

  function onTickerInput(e: Event) {
    ticker = (e.target as HTMLInputElement).value.toUpperCase();
  }

  onMount(() => {
    if (!isEdit) {
      const d = loadDraft<any>(draftKey);
      if (d) {
        if (d.ticker)     ticker     = d.ticker;
        if (d.t0Date)     t0Date     = d.t0Date;
        if (d.spyClose)   spyClose   = d.spyClose;
        if (d.spySma200)  spySma200  = d.spySma200;
        if (d.vix)        vix        = d.vix;
        if (d.closeT0)    closeT0    = d.closeT0;
        if (d.sma100)     sma100     = d.sma100;
        if (d.sma100_20)  sma100_20  = d.sma100_20;
        if (d.sma50)      sma50      = d.sma50;
        if (d.atr14)      atr14      = d.atr14;
      }
    }
    const mkt = loadMarketData(t0Date);
    if (mkt) {
      if (!spyClose  && mkt.spyClose  !== undefined) spyClose  = String(mkt.spyClose);
      if (!spySma200 && (mkt as any).spySma200 !== undefined) spySma200 = String((mkt as any).spySma200);
      if (!vix       && mkt.vix       !== undefined) vix       = String(mkt.vix);
    }
    calc();
  });

  $effect(() => {
    if (isEdit) return;
    saveDraft(draftKey, {
      ticker, t0Date, spyClose, spySma200, vix,
      closeT0, sma100, sma100_20, sma50, atr14
    });
    const _spyC = parseNum(spyClose);
    const _spyM = parseNum(spySma200);
    const _vix  = parseNum(vix);
    if (!isNaN(_spyC) || !isNaN(_spyM) || !isNaN(_vix)) {
      saveMarketData(t0Date, {
        ...(!isNaN(_spyC) ? { spyClose: _spyC } : {}),
        ...(!isNaN(_spyM) ? ({ spySma200: _spyM } as any) : {}),
        ...(!isNaN(_vix)  ? { vix: _vix } : {})
      });
    }
  });

  function calc() {
    preview = null; errors = []; warnings = [];
    const d = {
      spyClose:     parseNum(spyClose),
      spySma200:    parseNum(spySma200),
      vix:          parseNum(vix),
      close:        parseNum(closeT0),
      sma100:       parseNum(sma100),
      sma100_20ago: parseNum(sma100_20),
      sma50:        parseNum(sma50),
      atr14:        parseNum(atr14)
    };

    const missing: string[] = [];
    if (!ticker.trim()) missing.push('Ticker');
    for (const [k, v] of [
      ['SPY Close', d.spyClose], ['SPY SMA200', d.spySma200], ['VIX', d.vix],
      ['Close T0', d.close], ['SMA100', d.sma100], ['SMA100 (20D назад)', d.sma100_20ago],
      ['SMA50', d.sma50], ['ATR14', d.atr14]
    ] as [string, number][]) {
      if (isNaN(v)) missing.push(k);
    }
    if (missing.length) { errors = ['Заполни: ' + missing.join(', ')]; return; }

    const m = calcGapD0Metrics(d);
    const v = validateGapD0(d, m);
    errors = v.errors; warnings = v.warnings;
    preview = { d, m, v };
  }

  async function save() {
    calc();
    if (!preview?.v?.valid) return;
    if (!$user) return;
    saving = true;
    const { d } = preview;
    try {
      const t = ticker.trim().toUpperCase();
      const id = `${t}_GAP_${t0Date}`;
      const payload = {
        spy_close: d.spyClose, spy_sma200: d.spySma200, vix: d.vix,
        market_regime: preview.m.marketRegime,
        close_t0: d.close,
        sma100: d.sma100, sma100_20ago: d.sma100_20ago, sma50: d.sma50,
        atr14: d.atr14
      };
      if (isEdit && editCandidate) {
        await updateCandidate(editCandidate.id, {
          ticker: t, signal_date: t0Date, direction: 'LONG', payload
        });
      } else {
        await insertCandidate({
          id, user_id: $user.id, strategy: 'gap_reversal',
          ticker: t, signal_date: t0Date,
          direction: 'LONG', status: 'WAITING_D1',
          entry: null, stop: null, target1: null, target2: null,
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
    ticker = '';
    spyClose = ''; spySma200 = ''; vix = '';
    closeT0 = ''; sma100 = ''; sma100_20 = ''; sma50 = ''; atr14 = '';
    preview = null; errors = []; warnings = [];
    const mkt = loadMarketData(t0Date);
    if (mkt) {
      if (mkt.spyClose !== undefined) spyClose = String(mkt.spyClose);
      if ((mkt as any).spySma200 !== undefined) spySma200 = String((mkt as any).spySma200);
      if (mkt.vix !== undefined) vix = String(mkt.vix);
    }
  }

  const clr = (ok: boolean) => ok ? 'var(--color-acc)' : 'var(--color-acc2)';
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать' : 'Добавить T0'} · Gap Reversal 1</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="hint">
      <div><b>Watchlist (только LONG):</b> Close &gt; SMA100 · SMA100 растёт · <b>ATRp ≤ 5%</b> · Price &gt; $20 · Cap &gt; $10B · Vol &gt; 3M</div>
      <div><b>Рынок:</b> SPY &gt; SMA200 · VIX &lt; 30 · Нет earnings ближайшие 5 дней</div>
      <div><b>Завтра ждём:</b> gap down 1.0 ≤ GapATR ≤ 2.0 при Open &gt; SMA50</div>
    </div>

    <div class="row-2">
      <div class="fg"><label>Ticker</label><input value={ticker} oninput={onTickerInput} placeholder="AAPL" class="up" disabled={isEdit} /></div>
      <div class="fg"><label>T0 Date</label><input type="date" bind:value={t0Date} disabled={isEdit} /></div>
    </div>

    <div class="sect">Market regime</div>
    <div class="row-3">
      <div class="fg"><label>SPY Close</label><input bind:value={spyClose} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>SPY SMA200</label><input bind:value={spySma200} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>VIX</label><input bind:value={vix} oninput={calc} inputmode="decimal" placeholder="&lt; 30" /></div>
    </div>

    <div class="sect">Акция T0</div>
    <div class="row-3" style="margin-bottom:6px">
      <div class="fg"><label>Close T0</label><input bind:value={closeT0} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>ATR14</label><input bind:value={atr14} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>SMA50 (для D+1)</label><input bind:value={sma50} oninput={calc} inputmode="decimal" /></div>
    </div>
    <div class="row-2">
      <div class="fg"><label>SMA100 (сегодня)</label><input bind:value={sma100} oninput={calc} inputmode="decimal" /></div>
      <div class="fg"><label>SMA100 (20 дней назад)</label><input bind:value={sma100_20} oninput={calc} inputmode="decimal" /></div>
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
          WATCHLIST CHECK ·
          <span style="color:{m.inWatchlist ? 'var(--color-acc)' : 'var(--color-acc2)'}">{m.inWatchlist ? 'В СПИСКЕ' : 'НЕ ПОДХОДИТ'}</span>
        </div>
        <div class="checks">
          {#each v.checks as c}
            <div style="color:{clr(c.ok)}">{c.ok ? '✓' : '✗'} {c.label}: <b>{c.value}</b></div>
          {/each}
        </div>
        {#if m.inWatchlist}
          <div class="d1-note">
            Завтра утром (16:00-16:25 EET): ищем gap down · GapATR 1.0–2.0 · Open &gt; SMA50 · ATR14: <b>{preview.d.atr14.toFixed(2)}</b>
          </div>
        {/if}
      </div>
    {/if}

    <div class="ar">
      {#if !isEdit}<button onclick={resetDraft} type="button">↻ Сбросить</button>{/if}
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
  .d1-note { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-line); font-size: 10px; color: var(--color-t2); }
  .d1-note b { color: var(--color-text); }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
