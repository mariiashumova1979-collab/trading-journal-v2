import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { POLYGON_API_KEY } from '$env/static/private';

// Прокси к Polygon.io Grouped Daily endpoint
// Возвращает OHLCV всех US акций за один день одним запросом
export const GET: RequestHandler = async ({ url }) => {
  const date = url.searchParams.get('date');
  if (!date) throw error(400, 'Parameter "date" required (YYYY-MM-DD)');
  if (!POLYGON_API_KEY) throw error(500, 'POLYGON_API_KEY not configured');

  const polygonUrl = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_API_KEY}`;

  try {
    const res = await fetch(polygonUrl, {
      signal: AbortSignal.timeout(15000)
    });

    if (res.status === 429) {
      return json({ rate_limited: true, date, results: [] }, { status: 200 });
    }

    if (!res.ok) {
      const text = await res.text();
      return json({ error: `Polygon HTTP ${res.status}: ${text.substring(0, 200)}`, date, results: [] }, { status: 200 });
    }

    const data = await res.json();
    return json({
      date,
      results: data.results || [],
      count: data.results?.length || 0,
      polygon_status: data.status
    });
  } catch (e: any) {
    return json({ error: e.message || String(e), date, results: [] }, { status: 200 });
  }
};
