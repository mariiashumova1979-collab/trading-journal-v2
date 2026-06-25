import { supabase } from '$lib/supabase';

export interface ATRUniverseItem {
  id: string;
  user_id: string;
  ticker: string;
  name: string | null;
  sector: string | null;
  ema200: number | null;
  atr5: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listUniverse(): Promise<ATRUniverseItem[]> {
  const { data, error } = await supabase
    .from('atr_universe')
    .select('*')
    .order('ticker', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ATRUniverseItem[];
}

export async function insertUniverse(row: Partial<ATRUniverseItem>): Promise<ATRUniverseItem> {
  const { data, error } = await supabase
    .from('atr_universe')
    .insert([{ ...row, updated_at: new Date().toISOString() }])
    .select()
    .single();
  if (error) throw error;
  return data as ATRUniverseItem;
}

export async function updateUniverse(id: string, patch: Partial<ATRUniverseItem>): Promise<ATRUniverseItem> {
  const { data, error } = await supabase
    .from('atr_universe')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ATRUniverseItem;
}

export async function deleteUniverse(id: string): Promise<void> {
  const { error } = await supabase.from('atr_universe').delete().eq('id', id);
  if (error) throw error;
}
