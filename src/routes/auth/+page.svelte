<script lang="ts">
  import { signInWithEmail } from "$lib/stores/auth";

  let email = $state("");
  let loading = $state(false);
  let sent = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!email) return;
    loading = true;
    error = null;
    const result = await signInWithEmail(email);
    if (result.error) {
      error = result.error;
      sent = false;
    } else {
      sent = true;
    }
    loading = false;
  }
</script>

<div class="wrap">
  <div class="box">
    <div class="head">
      <div class="logo">📈</div>
      <h1>Trading Journal</h1>
      <p>Вход через magic link</p>
    </div>

    {#if sent}
      <div class="ok">
        <div class="ok-title">✓ Письмо отправлено</div>
        <div>Проверь почту <b>{email}</b> — там ссылка для входа. Можешь закрыть это окно.</div>
      </div>
    {:else}
      <form onsubmit={handleSubmit}>
        <div class="field">
          <label for="email-input">Email</label>
          <input
            id="email-input"
            type="email"
            bind:value={email}
            required
            placeholder="you@example.com"
            disabled={loading}
          />
        </div>

        {#if error}
          <div class="err">{error}</div>
        {/if}

        <button type="submit" class="btn-p" disabled={loading || !email}>
          {loading ? "Отправка…" : "Отправить ссылку"}
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  .wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .box { max-width: 380px; width: 100%; }
  .head { text-align: center; margin-bottom: 32px; }
  .logo { font-size: 32px; margin-bottom: 8px; }
  .head h1 { font-size: 20px; font-weight: 700; margin: 0 0 6px; }
  .head p { color: var(--color-t2); font-family: var(--font-mono); font-size: 11px; margin: 0; }
  .ok {
    padding: 16px;
    background: var(--color-bg2);
    border: 1px solid var(--color-acc);
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.7;
    color: var(--color-t2);
  }
  .ok-title { color: var(--color-acc); font-weight: 700; margin-bottom: 6px; }
  .ok b { color: var(--color-text); }
  .field { margin-bottom: 16px; }
  .field label {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-t2);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .field input { width: 100%; padding: 12px; font-size: 13px; }
  .err {
    padding: 10px;
    background: #ff000010;
    border: 1px solid #ff000040;
    border-radius: 6px;
    color: var(--color-acc2);
    font-family: var(--font-mono);
    font-size: 10px;
    margin-bottom: 14px;
  }
  button[type="submit"] { width: 100%; padding: 12px; }
</style>
