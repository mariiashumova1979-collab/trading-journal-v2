<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user, authLoading, initAuth, signOut } from '$lib/stores/auth';
  import { STRATEGIES } from '$lib/types';

  let { children } = $props();

  onMount(() => {
    initAuth();
  });

  $effect(() => {
    if ($authLoading) return;
    const path = $page.url.pathname;
    const isAuthPage = path.startsWith('/auth');
    if (!$user && !isAuthPage) {
      goto('/auth');
    } else if ($user && path === '/auth') {
      goto('/');
    }
  });

  async function handleSignOut() {
    await signOut();
    goto('/auth');
  }

  function handleStrategyClick(e: MouseEvent, active: boolean) {
    if (!active) e.preventDefault();
  }
</script>

{#if $authLoading}
  <div class="loader">Загрузка...</div>
{:else if !$user}
  {@render children()}
{:else}
  <header>
    <div class="hdr">
      <a href="/" class="brand">TRADING JOURNAL</a>
      <nav class="tabs">
        {#each Object.values(STRATEGIES) as s}
          {@const isActiveTab = $page.url.pathname.startsWith('/scanner/' + s.id)}
          <a
            href={s.active ? '/scanner/' + s.id : '#'}
            onclick={(e) => handleStrategyClick(e, s.active)}
            class="tab"
            class:tab-active={isActiveTab}
            class:tab-disabled={!s.active}
            style="--tab-color: {s.color}"
          >
            {s.icon} {s.name}
          </a>
        {/each}
      </nav>
      <div class="user-area">
        <a href="/trades" class="link" class:active={$page.url.pathname === '/trades'}>Сделки</a>
        <a href="/scanner/max-weekly" class="link" class:active={$page.url.pathname === '/scanner/max-weekly'}>📊 MAX Weekly</a>
        <a href="/scanner/max-weekly-candidates" class="link" class:active={$page.url.pathname === '/scanner/max-weekly-candidates'}>📋 MW Кандидаты</a>
        <a href="/calendar" class="link" class:active={$page.url.pathname === '/calendar'}>📅 Календарь</a>
        <span class="user-email">{$user.email}</span>
        <button onclick={handleSignOut} class="signout-btn">Выйти</button>
      </div>
    </div>
  </header>
  <main>
    {@render children()}
  </main>
{/if}

<style>
  .loader { min-height: 100vh; display: flex; align-items: center; justify-content: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 12px; }
  header { border-bottom: 1px solid var(--color-line); background: var(--color-bg2); }
  .hdr { max-width: 1400px; margin: 0 auto; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .brand { font-weight: 800; font-size: 14px; letter-spacing: 1px; text-decoration: none; color: var(--color-text); }
  .tabs { display: flex; gap: 6px; flex: 1; justify-content: center; }
  .tab {
    text-decoration: none; padding: 8px 14px; border-radius: 6px;
    font-family: var(--font-mono); font-size: 11px; font-weight: 600;
    border: 1px solid var(--color-line);
    color: var(--tab-color);
    background: transparent;
  }
  .tab-active { border-color: var(--tab-color); background: color-mix(in srgb, var(--tab-color) 13%, transparent); }
  .tab-disabled { opacity: 0.5; color: var(--color-t3); cursor: not-allowed; }
  .user-area { display: flex; align-items: center; gap: 10px; }
  .link {
    text-decoration: none; padding: 8px 12px; border-radius: 6px;
    font-family: var(--font-mono); font-size: 11px; font-weight: 600;
    border: 1px solid var(--color-line); color: var(--color-text); background: transparent;
  }
  .link.active { background: var(--color-bg3); }
  .user-email { font-family: var(--font-mono); font-size: 10px; color: var(--color-t3); }
  .signout-btn { font-size: 10px; padding: 6px 10px; }
  main { max-width: 1400px; margin: 0 auto; padding: 20px; }
</style>
