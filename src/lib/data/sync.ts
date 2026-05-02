// Синхронизация статуса кандидата при изменении/удалении сделки

import { supabase } from '../supabase';
import type { Trade } from '../types';

// Когда сделка переходит в CLOSED — кандидат → CLOSED
export async function syncCandidateOnTradeUpdate(trade: Trade) {
  const { data: cand } = await supabase
    .from('candidates')
    .select('id')
    .eq('trade_id', trade.id)
    .maybeSingle();

  if (!cand) return;

  const newStatus = trade.status === 'CLOSED' ? 'CLOSED' : 'ENTERED';
  await supabase.from('candidates').update({ status: newStatus }).eq('id', cand.id);
}

// При удалении сделки кандидат возвращается в READY_ENTRY
export async function unbindCandidateFromTrade(tradeId: string) {
  await supabase
    .from('candidates')
    .update({ trade_id: null, status: 'READY_ENTRY' })
    .eq('trade_id', tradeId);
}
