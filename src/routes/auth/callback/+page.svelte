<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  let status = $state('Авторизация...');

  onMount(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      status = 'Ошибка: ' + error.message;
      setTimeout(() => goto('/auth'), 2000);
      return;
    }
    if (data.session) {
      goto('/');
    } else {
      status = 'Сессия не получена. Перенаправление...';
      setTimeout(() => goto('/auth'), 2000);
    }
  });
</script>

<div class="wrap">{status}</div>

<style>
  .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; color: var(--color-t2); font-family: var(--font-mono); font-size: 12px; }
</style>
