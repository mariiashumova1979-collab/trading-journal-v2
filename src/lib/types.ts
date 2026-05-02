// ═══════════════════════════════════════════════════════════
// TRADE
// ═══════════════════════════════════════════════════════════
export type TradeType = 'LONG' | 'SHORT';
export type TradeStatus = 'OPEN' | 'PARTIAL' | 'CLOSED';
export type TradeResult = 'WIN' | 'LOSS' | null;
export type Strategy = 'impulse' | 'rspc' | 'ibs_swing' | 'pead' | 'event_continuation';

export interface Trade {
  id: string;
  user_id: string;
  ticker: string;
  type: TradeType;
  strategy: Strategy;
  entry_date: string | null;
  entry: number | null;
  shares: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  status: TradeStatus;
  exit_price: number | null;
  exit_date: string | null;
  exit_reason: string | null;
  commission: number;
  pnl_pct: number | null;
  pnl_net: number | null;
  result: TradeResult;
  notes: string | null;
  setup: TradeSetup | null;
  partial_exit: PartialExit | null;
  atr_pct: number | null;
  atr_abs: number | null;
  impulse_anchor: number | null;
  created_at: string;
  updated_at: string;
}

export interface PartialExit {
  date: string;
  price: number;
  shares: number;
  commission: number;
  breakeven_set?: boolean;
  pnl_pct?: number;
  pnl_net?: number;
}

export interface OHLCV {
  O?: number;
  H?: number;
  L?: number;
  C?: number;
  V?: number;
}

export interface TradeSetup {
  d_1?: OHLCV | null;
  d0?: OHLCV | null;
  d1?: OHLCV | null;
  atr?: number | null;
  rel_vol?: number | null;
  spy_chg?: number | null;
  pattern?: string | null;
  signal_date?: string | null;
  d0_date?: string | null;
  earnings_date?: string | null;
  metrics?: SetupMetrics | null;
}

export interface SetupMetrics {
  impulse?: number;
  clv?: number;
  body?: number;
  range_atr?: number;
  vol_ratio?: number;
  mid?: number;
  range?: number;
  ibs?: number;
  range_pct?: number;
  sma_trend?: 'up' | 'down' | 'flat';
  rsi2?: number;
}

// ═══════════════════════════════════════════════════════════
// CANDIDATE
// ═══════════════════════════════════════════════════════════
export type CandidateStatus =
  | 'WAITING_D1'
  | 'READY_ENTRY'
  | 'WAITING_OPEN'
  | 'GAP_CANCEL'
  | 'ENTERED'
  | 'CLOSED'
  | 'REJECTED';

export interface Candidate {
  id: string;
  user_id: string;
  strategy: Strategy;
  ticker: string;
  signal_date: string | null;
  direction: TradeType | null;
  status: CandidateStatus;
  trade_id: string | null;
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  payload: ImpulsePayload | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════
// IMPULSE-specific
// ═══════════════════════════════════════════════════════════
export interface ImpulsePayload {
  d_1: OHLCV;
  d0: OHLCV;
  d1?: OHLCV | null;
  atr: number;
  rel_vol: number;
  metrics: SetupMetrics;
  pattern?: string | null;
}

// ═══════════════════════════════════════════════════════════
// STRATEGY DEFINITIONS
// ═══════════════════════════════════════════════════════════
export interface StrategyDef {
  id: Strategy;
  name: string;
  icon: string;
  color: string;
  description: string;
  active: boolean;
}

export const STRATEGIES: Record<Strategy, StrategyDef> = {
  impulse: {
    id: 'impulse',
    name: 'Impulse',
    icon: '🚀',
    color: '#e74c3c',
    description: 'Импульсное движение D0 с подтверждением на D+1',
    active: true
  },
  rspc: {
    id: 'rspc',
    name: 'RSPC',
    icon: '🎯',
    color: '#f39c12',
    description: 'Range-Strength Pullback Continuation',
    active: false
  },
  ibs_swing: {
    id: 'ibs_swing',
    name: 'IBS RSI(2)',
    icon: '📊',
    color: '#3498db',
    description: 'Mean reversion на RSI(2) + IBS',
    active: false
  },
  pead: {
    id: 'pead',
    name: 'PEAD',
    icon: '📈',
    color: '#9b59b6',
    description: 'Post-earnings drift',
    active: false
  },
  event_continuation: {
    id: 'event_continuation',
    name: 'Event',
    icon: '⚡',
    color: '#f1c40f',
    description: 'Event continuation после impulse',
    active: false
  }
};