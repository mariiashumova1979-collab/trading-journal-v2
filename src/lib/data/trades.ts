import { supabase } from "../supabase";
import type { Trade, Strategy, TradeStatus } from "../types";

export async function listTrades(filter?: {
  strategy?: Strategy;
  status?: TradeStatus;
}): Promise<Trade[]> {
  let q = supabase.from("trades").select("*").order("entry_date", { ascending: false });
  if (filter?.strategy) q = q.eq("strategy", filter.strategy);
  if (filter?.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data as Trade[]) || [];
}

export async function insertTrade(row: Partial<Trade>): Promise<Trade> {
  const { data, error } = await supabase
    .from("trades")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as Trade;
}

export async function updateTrade(id: string, patch: Partial<Trade>): Promise<Trade> {
  const { data, error } = await supabase
    .from("trades")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Trade;
}

export async function deleteTrade(id: string): Promise<void> {
  const { error } = await supabase.from("trades").delete().eq("id", id);
  if (error) throw error;
}

export function subscribeTrades(callback: (payload: { eventType: string; new: any; old: any }) => void) {
  const channel = supabase
    .channel("trades_all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "trades" },
      (payload) => {
        callback({
          eventType: payload.eventType,
          new: payload.new,
          old: payload.old,
        });
      }
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}