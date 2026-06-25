<script lang="ts">
  import { user } from '$lib/stores/auth';
  import { insertUniverse, updateUniverse } from '$lib/data/atrUniverse';
  import type { ATRUniverseItem } from '$lib/data/atrUniverse';

  let { onClose, onSaved, editItem = null }: {
    onClose: () => void;
    onSaved: () => void;
    editItem?: ATRUniverseItem | null;
  } = $props();

  const isEdit = !!editItem;

  let ticker = $state(editItem?.ticker ?? '');
  let name   = $state(editItem?.name ?? '');
  let sector = $state(editItem?.sector ?? '');
  let ema200 = $state(editItem?.ema200?.toString() ?? '');
  let atr5   = $state(editItem?.atr5?.toString() ?? '');
  let notes  = $state(editItem?.notes ?? '');

  let errors = $state<string[]>([]);
  let saving = $state(false);

  function parseN(v: string): number | null {
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  async function save() {
    errors = [];
    if (!ticker.trim()) { errors = ['Введи тикер']; return; }
    if (!$user) return;
    saving = true;
    const row: Partial<ATRUniverseItem> = {
      ticker: ticker.trim().toUpperCase(),
      name: name.trim() || null,
      sector: sector.trim() || null,
      ema200: parseN(ema200),
      atr5: parseN(atr5),
      notes: notes.trim() || null,
      user_id: $user.id
    };
    try {
      if (isEdit && editItem) await updateUniverse(editItem.id, row);
      else await insertUniverse(row);
      onSaved(); onClose();
    } catch (e: any) {
      errors = ['Ошибка: ' + (e.message || String(e))];
    } finally { saving = false; }
  }
</script>

<div class="mo-bg" onclick={onClose} role="presentation">
  <div class="mo" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="mh">
      <div>{isEdit ? 'Редактировать инструмент' : 'Добавить в Universe'}</div>
      <button onclick={onClose} class="cls">×</button>
    </div>

    <div class="row-2">
      <div class="fg">
        <label>Тикер</label>
        <input bind:value={ticker} class="up" placeholder="AAPL" disabled={isEdit} />
      </div>
      <div class="fg">
        <label>Сектор</label>
        <input bind:value={sector} placeholder="Tech, Energy..." />
      </div>
    </div>

    <div class="fg" style="margin-top:8px">
      <label>Название (необязательно)</label>
      <input bind:value={name} placeholder="Apple Inc." />
    </div>

    <div class="sect">Последние индикаторы (для быстрого расчёта сигнала)</div>
    <div class="row-2">
      <div class="fg"><label>EMA200</label><input bind:value={ema200} inputmode="decimal" placeholder="0.00" /></div>
      <div class="fg"><label>ATR(5)</label><input bind:value={atr5} inputmode="decimal" placeholder="0.00" /></div>
    </div>

    <div class="fg" style="margin-top:8px">
      <label>Заметки</label>
      <textarea bind:value={notes} rows="2" placeholder="..."></textarea>
    </div>

    {#if errors.length}
      <div class="err">{#each errors as e}<div>• {e}</div>{/each}</div>
    {/if}

    <div class="ar">
      <button onclick={onClose}>Отмена</button>
      <button onclick={save} disabled={saving} class="btn-p">
        {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить'}
      </button>
    </div>
  </div>
</div>

<style>
  .mo-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .mo { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 12px; padding: 20px; width: 520px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
  .mh { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px; }
  .cls { background: transparent; border: none; color: var(--color-t2); font-size: 22px; cursor: pointer; padding: 0 8px; }
  .sect { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-text); margin: 12px 0 8px; border-bottom: 1px solid var(--color-line); padding-bottom: 4px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .fg label { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--color-t2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fg input, .fg textarea { width: 100%; }
  .fg textarea { resize: vertical; }
  .up { text-transform: uppercase; }
  .up:disabled { opacity: 0.6; }
  .err { padding: 8px 12px; background: #ff000010; border: 1px solid #ff000040; color: var(--color-acc2); font-family: var(--font-mono); font-size: 10px; border-radius: 6px; margin: 10px 0; }
  .ar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
