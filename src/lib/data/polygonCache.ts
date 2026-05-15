// Кэш дневных баров Polygon в Supabase
// Используется для всех стратегий что работают с дневными OHLCV
// TTL: 90 дней (бары старше удаляются)

import { supabase } from '$lib/supabase';

export interface DailyBar {
  date: string;        // YYYY-MM-DD
  ticker: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const TTL_DAYS = 90;

// Получить даты которые уже есть в кэше из списка запрошенных
export async function findCachedDates(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  // Берём один любой тикер чтобы проверить наличие дня
  // Polygon Grouped Daily — атомарная единица, либо весь день есть, либо нет
  const { data, error } = await supabase
    .from('polygon_daily_bars')
    .select('date')
    .in('date', dates)
    .limit(50000);
  if (error) {
    console.error('[polygonCache] findCachedDates error:', error);
    return new Set();
  }
  return new Set((data ?? []).map((r: any) => r.date));
}

// Загрузка баров за конкретные дни (всё что есть в кэше)
export async function loadBarsForDates(dates: string[]): Promise<Map<string, DailyBar[]>> {
  const result = new Map<string, DailyBar[]>();
  if (dates.length === 0) return result;

  // Supabase ограничивает размер ответа — читаем порциями по дням
  // 10000 строк/день × 25 дней = 250k. Запрашиваем все одной пачкой через range
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('polygon_daily_bars')
      .select('date, ticker, o, h, l, c, v')
      .in('date', dates)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('[polygonCache] loadBarsForDates error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data as any[]) {
      const t = row.ticker.toUpperCase();
      if (!result.has(t)) result.set(t, []);
      result.get(t)!.push({
        date: row.date,
        ticker: t,
        o: Number(row.o), h: Number(row.h), l: Number(row.l),
        c: Number(row.c), v: Number(row.v)
      });
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Сортируем по дате внутри каждого тикера
  for (const arr of result.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }
  return result;
}

// Сохранение баров за конкретный день
export async function saveBarsForDate(date: string, bars: Omit<DailyBar, 'date'>[]): Promise<number> {
  if (bars.length === 0) return 0;
  // Подготовка rows: дата + округление чисел до 4 знаков
  const rows = bars.map(b => ({
    date,
    ticker: b.ticker.toUpperCase(),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v
  }));

  // Supabase инсертит порциями
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('polygon_daily_bars')
      .upsert(chunk, { onConflict: 'date,ticker' });
    if (error) {
      console.error(`[polygonCache] saveBarsForDate ${date} chunk ${i} error:`, error);
      continue;
    }
    inserted += chunk.length;
  }
  return inserted;
}

// Удаление старых баров (TTL 90 дней)
export async function cleanupOldBars(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TTL_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const { error, count } = await supabase
    .from('polygon_daily_bars')
    .delete({ count: 'exact' })
    .lt('date', cutoffStr);
  if (error) {
    console.error('[polygonCache] cleanup error:', error);
    return 0;
  }
  return count ?? 0;
}

// Статистика кэша (сколько дней / тикеров)
export async function getCacheStats(): Promise<{ days: number; totalRows: number }> {
  const { data: daysData } = await supabase
    .from('polygon_daily_bars')
    .select('date')
    .limit(50000);
  const { count } = await supabase
    .from('polygon_daily_bars')
    .select('*', { count: 'exact', head: true });
  const uniqueDays = new Set((daysData ?? []).map((r: any) => r.date)).size;
  return { days: uniqueDays, totalRows: count ?? 0 };
}
