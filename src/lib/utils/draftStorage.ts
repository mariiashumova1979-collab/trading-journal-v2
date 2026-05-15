// Утилита для сохранения черновиков форм и общих маркет-данных в localStorage
// Цели:
// 1. Защита от случайного закрытия формы — черновики восстанавливаются автоматически
// 2. Один раз ввёл SPY/VIX за вечер — автоподстановка в следующие формы того же дня

const DRAFT_PREFIX  = 'tj_draft_';
const MARKET_PREFIX = 'tj_market_';

export interface MarketData {
  spyClose?: number;
  spySma200?: number;       // для IBS Mean Reversion
  spyEma50?: number;        // для NR7
  vix?: number;             // для NR7, PEG
  // Для PEG (Post-Event Gap) market regime
  qqqAboveEma20?: boolean;
  spyAboveEma20?: boolean;
}

// ─── Drafts ───
export function saveDraft(key: string, data: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(data));
  } catch { /* quota, ignore */ }
}

export function loadDraft<T = Record<string, any>>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {}
}

// ─── Market data per date ───
export function saveMarketData(date: string, data: MarketData): void {
  if (typeof window === 'undefined' || !date) return;
  try {
    const existing = loadMarketData(date) || {};
    const merged = { ...existing, ...data };
    localStorage.setItem(MARKET_PREFIX + date, JSON.stringify(merged));
  } catch {}
}

export function loadMarketData(date: string): MarketData | null {
  if (typeof window === 'undefined' || !date) return null;
  try {
    const raw = localStorage.getItem(MARKET_PREFIX + date);
    return raw ? JSON.parse(raw) as MarketData : null;
  } catch {
    return null;
  }
}
