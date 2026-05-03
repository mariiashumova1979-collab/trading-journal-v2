// US Stock Market holidays (NYSE/NASDAQ)
// Returns Set of date strings in YYYY-MM-DD format for given year

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  // weekday: 0=Sun, 1=Mon, ..., 6=Sat
  // n: 1=first, 2=second, etc; -1 = last
  const date = new Date(Date.UTC(year, month, 1));
  if (n > 0) {
    const firstDay = date.getUTCDay();
    const offset = (weekday - firstDay + 7) % 7 + (n - 1) * 7;
    date.setUTCDate(1 + offset);
  } else {
    // last
    date.setUTCMonth(month + 1, 0); // last day of month
    const lastDay = date.getUTCDay();
    const offset = (lastDay - weekday + 7) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
  }
  return date;
}

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Easter Sunday (Western, Anonymous Gregorian algorithm)
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function getMarketHolidays(year: number): Set<string> {
  const holidays = new Set<string>();

  // Helper to add holiday, with weekend observance shift
  const observe = (date: Date) => {
    const d = new Date(date);
    const day = d.getUTCDay();
    if (day === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun → Mon
    else if (day === 6) d.setUTCDate(d.getUTCDate() - 1); // Sat → Fri
    holidays.add(fmtDate(d));
  };

  observe(new Date(Date.UTC(year, 0, 1))); // New Year
  holidays.add(fmtDate(nthWeekdayOfMonth(year, 0, 1, 3))); // MLK = 3rd Mon Jan
  holidays.add(fmtDate(nthWeekdayOfMonth(year, 1, 1, 3))); // Presidents = 3rd Mon Feb

  // Good Friday = Easter - 2 days
  const goodFriday = easter(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(fmtDate(goodFriday));

  holidays.add(fmtDate(nthWeekdayOfMonth(year, 4, 1, -1))); // Memorial = last Mon May
  observe(new Date(Date.UTC(year, 5, 19))); // Juneteenth
  observe(new Date(Date.UTC(year, 6, 4))); // July 4
  holidays.add(fmtDate(nthWeekdayOfMonth(year, 8, 1, 1))); // Labor = 1st Mon Sep
  holidays.add(fmtDate(nthWeekdayOfMonth(year, 10, 4, 4))); // Thanksgiving = 4th Thu Nov
  observe(new Date(Date.UTC(year, 11, 25))); // Christmas

  return holidays;
}

export function isWeekend(date: Date): boolean {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}

export function dateToString(date: Date): string {
  return fmtDate(date);
}
