<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { insertTrade } from '$lib/data/trades';
  import { calcATRChMetrics, parseNum } from '$lib/strategies/atr_channel';
  import { saveCapital } from '$lib/utils/draftStorage';
  import type { TradeType } from '$lib/types';

  // prefill — необязательный (тикер/индикаторы из Universe)
  let { onClose, onSaved, prefill = null }: {
    onClose: () => void;
    onSaved: () => void;
    prefill?: { ticker?: string; ema200?: number | null; atr5?: number | null } | null;
  } = $props();

  function _readRisk() {
    if (typeof window === 'undefined') return '100';
    const v = localStorage.getItem('tj_capital_atr_channel');
    return v && parseFloat(v) > 0 ? v : '100';
  }

  let ticker    = $state(prefill?.ticker ?? '');
  let direction = $state<TradeType>('LONG');
  let entryDate = $state(new Date().toISOString().split('T')[0]);
  let entry     = $state('');
  let stop      = $state('');
  let shares    = $state('');
  let atr5      = $state(prefill?.atr5?.toString() ?? '');
  let ema200    = $state(prefill?.ema200?.toString() ?? '');
  let riskAmt   = $state(_readRisk());
  let commission = $state('0');
  let notes     = $state('');

  let preview = $state<any>(null);
  let errors  = $state<string[]>([]);
  let saving  = $state(false);

  function onTickerInput(e: Event) {
    ticker = (e.target as HTMLInputElement).value.toUpperCase();
  }

  // Авторасчёт stop/shares по ATR если заданы entry + atr5 (не перезаписывает ручной ввод)
  function autoCalc() {
    const e = parseNum(entry);
    const a = parseNum(atr5);
    const risk = parseNum(riskAmt) || 100;
    if (!isNaN(e) && !isNaN(a) && a > 0) {
      const riskPerShare = 2 * a;
      const sugStop = direction === 'LONG' ? e - riskPerShare : e + riskPerShare;
      const sugShares = Math.floor(risk / riskPerShare);
      preview = { riskPerShare, sugStop, sugShares };
    } else {
      preview = null;
    }
  }

  function applySuggested() {
    if (!preview) return;
    stop = preview.sugStop.toFixed(2);
    shares = String(preview.sugShares);
  }

  onMount(autoCalc);

  $effect(() => {
    const _r = parseFloat(riskAmt.replace(',', '.'));
    if (!isNaN(_r) && _r > 0) saveCapital('atr_channel', _r);
  });

  async function save() {
    errors = [];
    const e = parseNum(entry);
    const sh = parseNum(shares);
    if (!ticker.trim()) errors.push('Введи тикер');
    if (isNaN(e) || e <= 0) errors.push('Введи цену входа');
    if (isNaN(sh) || sh <= 0) errors.push('Введи количество акций');
    if (errors.length) return;
    if (!$user) return;

    saving = true;
    const st = parseNum(stop);
    const a = parseNum(atr5);
    try {
      await insertTrade({
        user_id: $user.id,
        ticker: ticker.trim().toUpperCase(),
        strategy: 'atr_channel',
        type: direction,
        status: 'OPEN',
        entry_date: entryDate,
        entry: e,
        shares: sh,
        stop: isNaN(st) ? null : st,
        target1: null,
        target2: null,
        commission: parseNum(commission) || 0,
        atr_abs: isNaN(a) ? null : a,
        atr_pct: !isNaN(a) && e > 0 ? a / e : null,
        notes: [
          'ATR-BREAKOUT-' + direction + ' (произвольный вход из Universe)',
          ema200 ? 'EMA200 at entry: ' + ema200 : '',
          a ? 'ATR(5) at entry: ' + a : '',
          'Трейлинг: ' + (direction === 'LONG' ? 'HH − 2×ATR' : 'LL + 2×ATR') + ' · TP нет',
          'Выход: EMA200 пробита или Close пробил трейлинг → Open T+1',
          notes.trim()
        ].filter(Boolean).join('\n')
      });
      onSaved(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>Произвольная сделка · ATR Channel</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="hint">
      Ручной вход вне T0-сигнала. Заполни Entry + ATR(5) → подскажу стоп (Entry ∓ 2×ATR) и размер ($Риск / 2×ATR).
    </div>

    <div class="row-2">
      <div class="fg"><label>Тикер</label><input value={ticker} oninput={onTickerInput} class="up" placeholder="AAPL" /></div>
      <div class="fg">
        <label>Направление</label>
        <select bind:value={direction} onchange={autoCalc}>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
      </div>
    </div>

    <div class="sect">Вход</div>
    <div class="row-3">
      <div class="fg"><label>Дата входа</label><input type="date" bind:value={entryDate} /></div>
      <div class="fg"><label>Entry</label><input bind:value={entry} oninput={autoCalc} inputmode="decimal" /></div>
      <div class="fg"><label>ATR(5)</label><input bind:value={atr5} oninput={autoCalc} inputmode="decimal" /></div>
    </div>

    {#if preview}
      <div class="suggest">
        <span>Подсказка: стоп <b>${preview.sugStop.toFixed(2)}</b> (Entry ∓ 2×ATR) · размер <b>{preview.sugShares}</b> акций · риск/акция ${preview.riskPerShare.toFixed(2)}</span>
        <button onclick={applySuggested} type="button" class="apply">Применить</button>
      </div>
    {/if}

    <div class="row-3" style="margin-top:8px">
      <div class="fg"><label>Stop</label><input bind:value={stop} inputmode="decimal" /></div>
      <div class="fg"><label>Кол-во акций</label><input bind:value={shares} inputmode="decimal" /></div>
      <div class="fg"><label>Риск $ (для подсказки)</label><input bind:value={riskAmt} oninput={autoCalc} inputmode="numeric" /></div>
    </div>

    <div class="sect">Контекст / комиссия</div>
    <div class="row-2">
      <div class="fg"><label>EMA200 at entry</label><input bind:value={ema200} inputmode="decimal" /></div>
      <div class="fg"><label>Комиссия</label><input bind:value={commission} inputmode="decimal" /></div>
    </div>
    <div class="fg" style="margin-top:8px">
      <label>Заметки</label>
      <textarea bind:value={notes} rows="2" placeholder="Причина входа вне сигнала..."></textarea>
    </div>

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={saving} class="btn-p">{saving ? 'Сохранение...' : 'Открыть сделку'}</button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; overflow-y: auto; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 600px; max-width: 100%; max-height: 92vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); padding: 8px 12px; background: var(--color-bg3); border-radius: 6px; line-height: 1.7; margin-bottom: 12px; }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 12px 0 8px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input, .fg select, .fg textarea { width: 100%; }
  .fg textarea { resize: vertical; }
  .up { text-transform: uppercase; }
  .suggest { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; padding: 8px 12px; background: var(--color-bg3); border: 1px solid var(--color-line); border-radius: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-t2); }
  .suggest b { color: var(--color-text); }
  .apply { font-size: 9px; padding: 4px 10px; flex-shrink: 0; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
