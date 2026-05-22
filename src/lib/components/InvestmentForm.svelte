<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { insertInvestment, updateInvestment } from '$lib/data/investments';
  import { saveDraft, loadDraft, clearDraft } from '$lib/utils/draftStorage';
  import type { Investment } from '$lib/data/investments';

  let { onClose, onSaved, editInvestment = null }: {
    onClose: () => void;
    onSaved: () => void;
    editInvestment?: Investment | null;
  } = $props();

  const isEdit = !!editInvestment;
  const draftKey = isEdit ? `inv_edit_${editInvestment?.id}` : 'inv_new';

  const ASSET_TYPES = [
    { value: 'stock',  label: 'Акции' },
    { value: 'etf',    label: 'ETF' },
    { value: 'crypto', label: 'Крипта' },
    { value: 'bond',   label: 'Облигации' },
    { value: 'reit',   label: 'REIT' },
    { value: 'other',  label: 'Другое' },
  ];
  const CURRENCIES = ['USD','EUR','GBP','CHF','USDT','BTC','ETH','SOL','Другое'];

  let ticker       = $state(editInvestment?.ticker ?? '');
  let name         = $state(editInvestment?.name ?? '');
  let asset_type   = $state(editInvestment?.asset_type ?? 'stock');
  let currency     = $state(editInvestment?.currency ?? 'USD');
  let customCur    = $state('');
  let entry_date   = $state(editInvestment?.entry_date ?? new Date().toISOString().split('T')[0]);
  let entry_price  = $state(editInvestment?.entry_price?.toString() ?? '');
  let shares       = $state(editInvestment?.shares?.toString() ?? '');
  let current_price = $state(editInvestment?.current_price?.toString() ?? '');
  let exit_price   = $state(editInvestment?.exit_price?.toString() ?? '');
  let exit_date    = $state(editInvestment?.exit_date ?? '');
  let dividends    = $state(editInvestment?.dividends?.toString() ?? '0');
  let notes        = $state(editInvestment?.notes ?? '');

  let errors  = $state<string[]>([]);
  let saving  = $state(false);
  let preview = $state<any>(null);

  onMount(() => {
    if (!isEdit) {
      const d = loadDraft<any>(draftKey);
      if (d) {
        if (d.ticker)       ticker       = d.ticker;
        if (d.name)         name         = d.name;
        if (d.asset_type)   asset_type   = d.asset_type;
        if (d.currency)     currency     = d.currency;
        if (d.entry_date)   entry_date   = d.entry_date;
        if (d.entry_price)  entry_price  = d.entry_price;
        if (d.shares)       shares       = d.shares;
        if (d.dividends)    dividends    = d.dividends;
      }
    }
    calc();
  });

  $effect(() => {
    if (!isEdit) saveDraft(draftKey, {
      ticker, name, asset_type, currency, entry_date,
      entry_price, shares, dividends
    });
  });

  function parseN(v: string): number {
    return parseFloat(v.replace(',', '.')) || 0;
  }

  function calc() {
    errors = [];
    const ep = parseN(entry_price);
    const sh = parseN(shares);
    if (ep <= 0 || sh <= 0) { preview = null; return; }

    const cost_basis = ep * sh;
    const cur = currency === 'Другое' ? customCur : currency;

    const cp = parseN(current_price);
    const xp = parseN(exit_price);
    const div = parseN(dividends);

    const current_value = cp > 0 ? cp * sh : null;
    const exit_value    = xp > 0 ? xp * sh : null;

    const is_closed = xp > 0 && !!exit_date;
    const ref_value = is_closed ? exit_value : current_value;
    const pnl_net = ref_value != null ? ref_value - cost_basis + div : null;
    const pnl_pct = pnl_net != null ? pnl_net / cost_basis * 100 : null;

    preview = { cost_basis, current_value, exit_value, pnl_net, pnl_pct, is_closed, cur, div };
  }

  async function save() {
    errors = [];
    const ep = parseN(entry_price);
    const sh = parseN(shares);
    if (!ticker.trim()) errors.push('Введи тикер');
    if (ep <= 0) errors.push('Введи цену входа');
    if (sh <= 0) errors.push('Введи количество');
    if (errors.length) return;
    if (!$user) return;

    saving = true;
    const finalCurrency = currency === 'Другое' ? (customCur || 'USD') : currency;
    const row: Partial<Investment> = {
      ticker: ticker.trim().toUpperCase(),
      name: name.trim() || null,
      asset_type,
      currency: finalCurrency,
      entry_date,
      entry_price: ep,
      shares: sh,
      current_price: parseN(current_price) || null,
      exit_price:    parseN(exit_price) || null,
      exit_date:     exit_date || null,
      dividends:     parseN(dividends),
      notes:         notes.trim() || null,
      user_id:       $user.id
    };

    try {
      if (isEdit && editInvestment) {
        await updateInvestment(editInvestment.id, row);
      } else {
        await insertInvestment(row);
        clearDraft(draftKey);
      }
      onSaved();
      onClose();
    } catch(e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }

  function resetDraft() {
    if (!confirm('Очистить форму?')) return;
    clearDraft(draftKey);
    ticker = ''; name = ''; entry_price = ''; shares = '';
    current_price = ''; exit_price = ''; exit_date = ''; dividends = '0'; notes = '';
    preview = null; errors = [];
  }

  const fmtN = (v: number, dec = 2) => v.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const pnlColor = (v: number) => v >= 0 ? 'var(--color-acc)' : 'var(--color-acc2)';
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать позицию' : 'Добавить позицию'}</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <!-- Тикер + тип + валюта -->
    <div class="row-3" style="margin-bottom:8px">
      <div class="fg">
        <label>Тикер</label>
        <input bind:value={ticker} oninput={calc} class="up" placeholder="AAPL, BTC..." />
      </div>
      <div class="fg">
        <label>Тип актива</label>
        <select bind:value={asset_type}>
          {#each ASSET_TYPES as t}<option value={t.value}>{t.label}</option>{/each}
        </select>
      </div>
      <div class="fg">
        <label>Валюта</label>
        <select bind:value={currency} onchange={calc}>
          {#each CURRENCIES as c}<option>{c}</option>{/each}
        </select>
      </div>
    </div>
    {#if currency === 'Другое'}
      <div class="fg" style="margin-bottom:8px">
        <label>Своя валюта</label>
        <input bind:value={customCur} placeholder="RUB, CNY..." style="width:120px" />
      </div>
    {/if}

    <div class="fg" style="margin-bottom:8px">
      <label>Название (необязательно)</label>
      <input bind:value={name} placeholder="Apple Inc." />
    </div>

    <div class="sect">Вход</div>
    <div class="row-3">
      <div class="fg"><label>Дата входа</label><input type="date" bind:value={entry_date} /></div>
      <div class="fg"><label>Цена входа</label><input bind:value={entry_price} oninput={calc} inputmode="decimal" placeholder="0.00" /></div>
      <div class="fg"><label>Количество / Лоты</label><input bind:value={shares} oninput={calc} inputmode="decimal" placeholder="10" /></div>
    </div>

    <div class="sect">Текущая цена (необязательно)</div>
    <div class="row-2">
      <div class="fg">
        <label>Текущая цена — для нереализованного P/L</label>
        <input bind:value={current_price} oninput={calc} inputmode="decimal" placeholder="оставь пустым если нет" />
      </div>
      <div class="fg">
        <label>Дивиденды / Купоны получено</label>
        <input bind:value={dividends} oninput={calc} inputmode="decimal" placeholder="0" />
      </div>
    </div>

    <div class="sect">Выход (если закрыта)</div>
    <div class="row-2">
      <div class="fg"><label>Цена выхода</label><input bind:value={exit_price} oninput={calc} inputmode="decimal" placeholder="оставь пустым если открыта" /></div>
      <div class="fg"><label>Дата выхода</label><input type="date" bind:value={exit_date} /></div>
    </div>

    <div class="fg" style="margin:8px 0">
      <label>Заметки</label>
      <textarea bind:value={notes} rows="2" placeholder="Причина входа, стратегия..."></textarea>
    </div>

    {#if preview}
      <div class="prev">
        <div class="prev-row">
          <span>Cost basis</span>
          <b>{fmtN(preview.cost_basis)} {preview.cur}</b>
        </div>
        {#if preview.current_value != null && !preview.is_closed}
          <div class="prev-row">
            <span>Текущая стоимость</span>
            <b>{fmtN(preview.current_value)} {preview.cur}</b>
          </div>
        {/if}
        {#if preview.exit_value != null}
          <div class="prev-row">
            <span>Стоимость выхода</span>
            <b>{fmtN(preview.exit_value)} {preview.cur}</b>
          </div>
        {/if}
        {#if preview.div > 0}
          <div class="prev-row">
            <span>Дивиденды</span>
            <b style="color:var(--color-acc)">+{fmtN(preview.div)} {preview.cur}</b>
          </div>
        {/if}
        {#if preview.pnl_net != null}
          <div class="prev-row prev-pnl">
            <span>{preview.is_closed ? 'Реализованный P/L' : 'Нереализованный P/L'}</span>
            <b style="color:{pnlColor(preview.pnl_net)}">
              {preview.pnl_net >= 0 ? '+' : ''}{fmtN(preview.pnl_net)} {preview.cur}
              {#if preview.pnl_pct != null}({fmtPct(preview.pnl_pct)}){/if}
            </b>
          </div>
        {/if}
      </div>
    {/if}

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    <div class="ar">
      {#if !isEdit}<button onclick={resetDraft} type="button">↻ Сбросить</button>{/if}
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={saving} class="btn-p">
        {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; overflow-y: auto; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 680px; max-width: 100%; max-height: 92vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 12px 0 8px; border-bottom: 1px solid var(--color-line); padding-bottom: 4px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input, .fg select, .fg textarea { width: 100%; }
  .fg textarea { resize: vertical; min-height: 48px; }
  .up { text-transform: uppercase; }
  .prev { background: var(--color-bg3); border: 1px solid var(--color-line); border-radius: 8px; padding: 12px; margin: 10px 0; font-family: var(--font-mono); font-size: 11px; }
  .prev-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; color: var(--color-t2); border-bottom: 1px solid var(--color-line); }
  .prev-row:last-child { border-bottom: none; }
  .prev-row b { color: var(--color-text); }
  .prev-pnl { padding-top: 8px; font-weight: 700; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; line-height: 1.7; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
