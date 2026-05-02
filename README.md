# Trading Journal v2

POC миграции Trading Journal с одного HTML файла на SvelteKit + Supabase.

## Стек

- **Frontend:** SvelteKit + TypeScript + Tailwind
- **Backend:** Supabase (Postgres + Auth + Realtime)
- **Hosting:** Vercel (планируется)

## Локальный запуск

```powershell
# 1. Установить зависимости
npm install

# 2. Создать .env (см. ниже)
copy .env.example .env
# затем отредактировать .env и вставить свои ключи

# 3. Запустить dev-сервер
npm run dev
```

Откроется на http://localhost:5173

## .env

```
PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

## Что в POC

- ✅ Auth через magic link (Supabase)
- ✅ Layout с табами стратегий (только Impulse активен)
- ✅ Impulse Scanner полностью:
  - Форма «+ Добавить кандидата» с валидацией
  - D+1 паттерны (Inside Day / Weak Pullback / Compression)
  - Открытие сделки с предрасчётом позиции
- ✅ Список сделок с фильтрами
- ✅ Realtime синхронизация между устройствами

## Что НЕ в POC

- IBS, RSPC, PEAD, Event scanners (добавим после валидации Impulse)
- Watchlist
- Setup analysis в карточке сделки
- Дашборд расширенный
- Quarterly results
