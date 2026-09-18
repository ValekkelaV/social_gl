# Изменения в `supabase/index.ts` (telegram-webhook)

## 1. При проверке вайтлиста — забираем ещё и `preferred_full_name`

Было:
```ts
const { data: whitelistEntry, error: whitelistError } = await supabaseAdmin
  .from("whitelisted_usernames")
  .select("username")
  .ilike("username", telegramUsername)
  .maybeSingle();
```

Стало:
```ts
const { data: whitelistEntry, error: whitelistError } = await supabaseAdmin
  .from("whitelisted_usernames")
  .select("username, preferred_full_name")
  .ilike("username", telegramUsername)
  .maybeSingle();
```

## 2. При создании нового people — предпочитаем preferred_full_name

Было:
```ts
userId = newAuthUser.user.id;
const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ") || telegramUsername;
```

Стало:
```ts
userId = newAuthUser.user.id;
const fullName =
  whitelistEntry.preferred_full_name?.trim() ||
  [from.first_name, from.last_name].filter(Boolean).join(" ") ||
  telegramUsername;
```

Это единственные два изменения — остальной файл (webhook) не трогаем.
Не забудьте передеплоить функцию после правки:
```bash
supabase functions deploy telegram-webhook --no-verify-jwt
```
