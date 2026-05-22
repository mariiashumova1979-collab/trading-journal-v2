import { supabase } from '$lib/supabase';

export interface Investment {
  id: string;
  user_id: string;
  ticker: string;
  name: string | null;
  asset_type: string;
  currency: string;
  entry_date: string;
  entry_price: number;
  shares: number;
  current_price: number | null;
  exit_price: number | null;
  exit_date: string | null;
  dividends: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Calculated view
export interface InvestmentView extends Investment {
  cost_basis:         number;   // entry_price × shares
  current_value:      number | null; // current_price × shares
  exit_value:         number | null; // exit_price × shares
  pnl_net:            number | null; // realized or unrealized
  pnl_pct:            number | null;
  total_return:       number | null; // pnl_net + dividends
  total_return_pct:   number | null;
  is_closed:          boolean;
}

export function calcView(inv: Investment): InvestmentView {
  const cost_basis   = inv.entry_price * inv.shares;
  const is_closed    = inv.exit_price != null && inv.exit_date != null;
  const exit_value   = is_closed ? inv.exit_price! * inv.shares : null;
  const current_value = !is_closed && inv.current_price != null
    ? inv.current_price * inv.shares : null;

  let pnl_net: number | null = null;
  let pnl_pct: number | null = null;

  if (is_closed && exit_value != null) {
    pnl_net = exit_value - cost_basis;
    pnl_pct = cost_basis > 0 ? pnl_net / cost_basis * 100 : null;
  } else if (current_value != null) {
    pnl_net = current_value - cost_basis;
    pnl_pct = cost_basis > 0 ? pnl_net / cost_basis * 100 : null;
  }

  const total_return = pnl_net != null ? pnl_net + inv.dividends : null;
  const total_return_pct = total_return != null && cost_basis > 0
    ? total_return / cost_basis * 100 : null;

  return {
    ...inv,
    cost_basis, current_value, exit_value,
    pnl_net, pnl_pct,
    total_return, total_return_pct, is_closed
  };
}

export async function listInvestments(): Promise<Investment[]> {
  const { data, error } = await supabase
    .from('investments')
    .select('*')
    .order('entry_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Investment[];
}

export async function insertInvestment(row: Partial<Investment>): Promise<Investment> {
  const { data, error } = await supabase
    .from('investments')
    .insert([{ ...row, updated_at: new Date().toISOString() }])
    .select()
    .single();
  if (error) throw error;
  return data as Investment;
}

export async function updateInvestment(id: string, patch: Partial<Investment>): Promise<Investment> {
  const { data, error } = await supabase
    .from('investments')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Investment;
}

export async function deleteInvestment(id: string): Promise<void> {
  const { error } = await supabase.from('investments').delete().eq('id', id);
  if (error) throw error;
}
