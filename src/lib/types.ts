export type TradeType = 'LONG' | 'SHORT';
export type TradeStatus = 'OPEN' | 'PARTIAL' | 'CLOSED';
export type TradeResult = 'WIN' | 'LOSS' | null;
export type Strategy = 'impulse' | 'rspc' | 'ibs_swing' | 'pead' | 'event_continuation' | 'max_weekly' | 'nr7';

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
  payload: ImpulsePayload | MaxWeeklyPayload | null;
  created_at: string;
  updated_at: string;
}

export interface ImpulsePayload {
  d_1: OHLCV;
  d0: OHLCV;
  d1?: OHLCV | null;
  atr: number;
  rel_vol: number;
  metrics: SetupMetrics;
  pattern?: string | null;
  d1_note?: string | null;
}

export interface MaxWeeklyPayload {
  close_t0: number;
  atr14: number;
  adv20: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  max5d: number;
  min5d: number;
  return5d: number;
  volSpike5d: number;
  maxPct: number;
  minPct: number;
  returnPct: number;
  gap_cancel_threshold: number; // close * 1.04 (SHORT) или close * 0.96 (LONG)
}

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
    icon: 'IMP',
    color: '#e74c3c',
    description: 'Импульсное движение D0 с подтверждением на D+1',
    active: true
  },
  max_weekly: {
    id: 'max_weekly',
    name: 'MAX Weekly',
    icon: '📊',
    color: '#a78bfa',
    description: 'Еженедельный возврат к среднему после экстремального движения',
    active: true
  },
  rspc: {
    id: 'rspc',
    name: 'RSPC',
    icon: 'RSPC',
    color: '#f39c12',
    description: 'Range-Strength Pullback Continuation',
    active: false
  },
  ibs_swing: {
    id: 'ibs_swing',
    name: 'IBS MR',
    icon: '📉',
    color: '#3498db',
    description: 'IBS Mean Reversion в тренде (S&P500 + NDX)',
    active: true
  },
  pead: {
    id: 'pead',
    name: 'Post-Event Gap',
    icon: '🎯',
    color: '#9b59b6',
    description: 'B2 Post-Event Gap Continuation со scoring',
    active: true
  },
  event_continuation: {
    id: 'event_continuation',
    name: 'Event',
    icon: '⚡',
    color: '#f1c40f',
    description: 'Event impulse + compression + continuation',
    active: true
  },
  nr7: {
    id: 'nr7',
    name: 'NR7',
    icon: '📐',
    color: '#16a085',
    description: 'NR7 Volatility Expansion Breakout',
    active: true
  }
};
