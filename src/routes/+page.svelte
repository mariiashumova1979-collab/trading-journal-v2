<script lang="ts">
  import { STRATEGIES } from "$lib/types";

  function handleClick(e: MouseEvent, active: boolean) {
    if (!active) e.preventDefault();
  }
</script>

<div class="page">
  <h1>Trading Journal</h1>
  <p class="sub">Выбери стратегию для работы</p>

  <div class="grid">
    {#each Object.values(STRATEGIES) as s}
      <a
        href={s.active ? "/scanner/" + s.id : "#"}
        onclick={(e) => handleClick(e, s.active)}
        class="card"
        class:disabled={!s.active}
      >
        <div class="icon">{s.icon}</div>
        <div class="name" style="color:{s.color}">{s.name}</div>
        <div class="desc">{s.description}</div>
        {#if !s.active}
          <div class="soon">Скоро</div>
        {/if}
      </a>
    {/each}
  </div>
</div>

<style>
  .page { padding: 40px 0; }
  h1 { font-size: 24px; font-weight: 700; margin: 0 0 8px; }
  .sub { color: var(--color-t2); font-family: var(--font-mono); font-size: 12px; margin: 0 0 32px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .card {
    text-decoration: none;
    padding: 20px;
    border-radius: 10px;
    background: var(--color-bg2);
    border: 1px solid var(--color-line);
    display: block;
    color: var(--color-text);
  }
  .card.disabled { opacity: 0.5; cursor: not-allowed; }
  .icon { font-size: 28px; margin-bottom: 8px; }
  .name { font-weight: 700; font-size: 16px; margin-bottom: 6px; }
  .desc { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; line-height: 1.6; }
  .soon { margin-top: 10px; font-family: var(--font-mono); font-size: 9px; color: var(--color-t3); text-transform: uppercase; letter-spacing: 1px; }
</style>
