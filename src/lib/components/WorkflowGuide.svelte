<script lang="ts">
  // Раскрывающийся блок с workflow-напоминаниями для каждой стратегии
  // Состояние "раскрыто/свёрнуто" сохраняется в localStorage отдельно по стратегии

  interface Section {
    title: string;        // например "Вечером (T0)"
    steps: string[];      // строки шагов, можно с эмодзи и markdown-подобной разметкой *bold*
  }

  let { strategyId, title = 'Workflow напоминания', sections }: {
    strategyId: string;
    title?: string;
    sections: Section[];
  } = $props();

  const storageKey = `wf_open_${strategyId}`;

  // Открыт по умолчанию для новых стратегий, потом запоминаем выбор
  let open = $state<boolean>(false);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) open = saved === '1';
  });

  function toggle() {
    open = !open;
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, open ? '1' : '0');
    }
  }

  // Простой inline-парсер: **bold**, `code`, переводы строк
  function renderStep(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
</script>

<div class="wf">
  <button class="wf-hdr" onclick={toggle} type="button">
    <span class="wf-icon">{open ? '▾' : '▸'}</span>
    <span class="wf-title">{title}</span>
    <span class="wf-hint">{open ? 'свернуть' : 'раскрыть'}</span>
  </button>

  {#if open}
    <div class="wf-body">
      {#each sections as sec}
        <div class="wf-sec">
          <div class="wf-sec-h">{sec.title}</div>
          <ol class="wf-steps">
            {#each sec.steps as step}
              <li>{@html renderStep(step)}</li>
            {/each}
          </ol>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wf { margin-bottom: 16px; border: 1px solid var(--color-line); border-radius: 8px; background: var(--color-bg2); overflow: hidden; }
  .wf-hdr { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: transparent; border: none; cursor: pointer; color: var(--color-text); font-family: var(--font-mono); font-size: 11px; text-align: left; }
  .wf-hdr:hover { background: var(--color-bg3); }
  .wf-icon { font-family: monospace; color: var(--color-acc); font-size: 12px; min-width: 12px; }
  .wf-title { font-weight: 700; flex: 1; letter-spacing: 0.5px; }
  .wf-hint { color: var(--color-t3); font-size: 9px; text-transform: uppercase; letter-spacing: 1px; }
  .wf-body { padding: 4px 14px 14px; border-top: 1px solid var(--color-line); background: var(--color-bg3); }
  .wf-sec { margin-top: 12px; }
  .wf-sec-h { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: var(--color-acc); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed var(--color-line); }
  .wf-steps { margin: 0; padding-left: 24px; font-family: var(--font-mono); font-size: 11px; line-height: 1.85; color: var(--color-t2); }
  .wf-steps li { margin-bottom: 4px; }
  .wf-steps :global(b) { color: var(--color-text); font-weight: 700; }
  .wf-steps :global(code) { background: var(--color-bg2); border: 1px solid var(--color-line); border-radius: 3px; padding: 1px 5px; font-size: 10px; color: var(--color-acc3); }
</style>
