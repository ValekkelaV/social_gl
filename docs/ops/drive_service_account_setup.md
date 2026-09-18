# Настройка Google service account для чтения файлов тезисов с Drive

Отдельный аккаунт, только для чтения одной папки — не имеет отношения ни к
Supabase, ни к рассылкам. Занимает ~15 минут, разово.

## 1. Создать проект в Google Cloud Console

1. Откройте https://console.cloud.google.com/
2. Наверху слева — выпадающий список проектов → "New Project"
3. Название — любое, например `socpolyana-drive-reader`
4. Создать

## 2. Включить Google Drive API

1. В том же проекте: меню слева → "APIs & Services" → "Library"
2. Найти "Google Drive API" → открыть → "Enable"

## 3. Создать service account

1. "APIs & Services" → "Credentials"
2. "Create Credentials" → "Service account"
3. Имя — например `drive-reader`
4. Роль — можно пропустить (не нужна проектная роль, доступ дадим на уровне
   конкретной папки Drive, не на уровне GCP-проекта)
5. Готово

## 4. Создать ключ (JSON)

1. Открыть только что созданный service account
2. Вкладка "Keys" → "Add key" → "Create new key" → формат JSON
3. Скачается файл вида `socpolyana-drive-reader-xxxxx.json` — это единственный
   момент, когда его можно скачать. Сохраните в надёжном месте.

⚠️ Этот файл — секрет уровня пароля. Не коммитьте в git, не отправляйте в
чаты. Добавьте его путь в `.gitignore`, если будет лежать рядом с кодом.

## 5. Расшарить папку Drive на service account

1. Откройте JSON-файл, найдите поле `"client_email"` — выглядит как
   `drive-reader@socpolyana-drive-reader-xxxxx.iam.gserviceaccount.com`
2. В Google Drive откройте папку с файлами тезисов прошлого года
3. "Поделиться" → вставить этот email → права "Читатель" (Viewer) → отправить

Всё — теперь скрипт сможет читать файлы через этот service account, не имея
доступа ни к чему другому в вашем личном Google-аккаунте.

## 6. Установить зависимости для скрипта

```bash
pip install google-api-python-client google-auth python-docx pdfplumber --break-system-packages
```

## 7. Что передать скрипту

- Путь к JSON-файлу ключа (`--credentials path/to/key.json`)
- ID папки Drive (из URL папки: `https://drive.google.com/drive/folders/`
  **`ЭТОТ_ID`**)
