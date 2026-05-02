import { supabase } from "../supabase";
import type { Candidate, Strategy, CandidateStatus } from "../types";

export async function listCandidates(strategy: Strategy): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("candidates")
    .select("*")
    .eq("strategy", strategy)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Candidate[]) || [];
}

export async function insertCandidate(row: Partial<Candidate>): Promise<Candidate> {
  const { data, error } = await supabase
    .from("candidates")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as Candidate;
}

export async function updateCandidate(id: string, patch: Partial<Candidate>): Promise<Candidate> {
  const { data, error } = await supabase
    .from("candidates")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Candidate;
}

export async function deleteCandidate(id: string): Promise<void> {
  const { error } = await supabase.from("candidates").delete().eq("id", id);
  if (error) throw error;
}

// Realtime subscription
export function subscribeCandidates(
  strategy: Strategy,
  callback: (payload: { eventType: string; new: any; old: any }) => void
) {
  const channel = supabase
    .channel("candidates_" + strategy)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "candidates",
        filter: "strategy=eq." + strategy,
      },
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
