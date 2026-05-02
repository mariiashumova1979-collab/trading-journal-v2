import { writable } from 'svelte/store';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export const user = writable<User | null>(null);
export const session = writable<Session | null>(null);
export const authLoading = writable<boolean>(true);

// Инициализация — проверяем существующую сессию
export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  session.set(data.session);
  user.set(data.session?.user ?? null);
  authLoading.set(false);

  // Подписываемся на изменения
  supabase.auth.onAuthStateChange((_event, newSession) => {
    session.set(newSession);
    user.set(newSession?.user ?? null);
  });
}

export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`
    }
  });
  return { error: error?.message ?? null };
}

export async function signOut() {
  await supabase.auth.signOut();
}