#!/usr/bin/env python3
"""
Извлечение текста тезисов из файлов на Google Drive + флаг наличия картинок.

Читает applications, у которых abstract_file_url указывает на Drive-файл и
abstract_text ещё пуст, скачивает файл через service account, извлекает
текст (docx через python-docx, pdf через pdfplumber), проверяет наличие
встроенных изображений, генерирует SQL с UPDATE.

Не пишет напрямую в БД — только генерирует .sql для проверки и ручного
выполнения в Supabase SQL Editor (тот же паттерн, что import_applications.py
и backfill_file_links.py).

Использование:
    python extract_abstract_text.py \\
        --credentials service_account.json \\
        --applications-csv applications_to_process.csv \\
        --output-sql output.sql \\
        --download-dir ./downloaded_files

applications_to_process.csv — экспорт из Supabase (id, abstract_file_url,
abstract_text) для заявок, у которых abstract_file_url — реальная ссылка:

    select id, abstract_file_url, abstract_text
    from applications
    where abstract_file_url is not null
      and abstract_file_url != '__PENDING_BACKFILL__'
      and abstract_file_url ~ '^https?://';

Существующий abstract_text не блокирует извлечение по признаку "непусто" —
короткие плейсхолдеры (напр. "Текст в файле", варьируются по формулировке)
всё равно перезаписываются: считается плейсхолдером всё, что короче ~50 слов
(реальные тезисы — 500-700 слов по контексту формы). Уже извлечённый
настоящий текст (50+ слов) не трогается.

Ссылка в abstract_file_url ожидается в формате Google Drive share-ссылки
(https://drive.google.com/file/d/FILE_ID/view?... или .../open?id=FILE_ID) —
скрипт сам вытаскивает FILE_ID регэкспом. Если ссылки другого формата
(напр. drive.google.com/drive/folders/... — это папка, не файл), такие
строки попадут в консоль как "не удалось распознать FILE_ID" и пропустятся.

ВАЖНО: скачанные файлы остаются в --download-dir после работы скрипта — это
осознанно, чтобы можно было вручную пролистать те, что помечены
has_images=true, не открывая Drive заново.
"""

import argparse
import csv
import re
import sys
from pathlib import Path

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
except ImportError:
    print("Нужно: pip install google-api-python-client google-auth --break-system-packages", file=sys.stderr)
    sys.exit(1)

try:
    import docx  # python-docx
except ImportError:
    print("Нужно: pip install python-docx --break-system-packages", file=sys.stderr)
    sys.exit(1)

try:
    import pdfplumber
except ImportError:
    print("Нужно: pip install pdfplumber --break-system-packages", file=sys.stderr)
    sys.exit(1)

import io


DRIVE_FILE_ID_PATTERNS = [
    re.compile(r"/file/d/([a-zA-Z0-9_-]+)"),
    re.compile(r"[?&]id=([a-zA-Z0-9_-]+)"),
]


def extract_drive_file_id(url):
    for pattern in DRIVE_FILE_ID_PATTERNS:
        m = pattern.search(url)
        if m:
            return m.group(1)
    return None


def sql_escape(value):
    if value is None:
        return "NULL"
    v = str(value)
    return "'" + v.replace("'", "''") + "'"


MIN_REAL_ABSTRACT_WORDS = 50  # тексты короче — считаем плейсхолдером/мусором, перезаписываем


def is_placeholder_text(text):
    """Короче ~50 слов — не может быть настоящими тезисами (500-700 слов по
    контексту формы), значит это плейсхолдер/заглушка вроде 'Текст в файле',
    который варьируется и поэтому не ловится точным сравнением строк."""
    if text is None:
        return True
    words = text.strip().split()
    return len(words) < MIN_REAL_ABSTRACT_WORDS


def download_drive_file(service, file_id, dest_path):
    """Скачивает файл по его Drive file_id, возвращает mimeType."""
    meta = service.files().get(fileId=file_id, fields="name, mimeType").execute()
    mime_type = meta.get("mimeType", "")

    request = service.files().get_media(fileId=file_id)
    fh = io.FileIO(dest_path, "wb")
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    fh.close()
    return mime_type, meta.get("name", "")


def extract_docx(path):
    """Возвращает (текст, есть_ли_картинки)."""
    document = docx.Document(path)
    text = "\n".join(p.text for p in document.paragraphs if p.text.strip())

    has_images = False
    # Картинки в docx лежат как inline shapes / drawing-элементы в XML
    for rel in document.part.rels.values():
        if "image" in rel.reltype:
            has_images = True
            break

    return text, has_images


def extract_pdf(path):
    """Возвращает (текст, есть_ли_картинки)."""
    text_parts = []
    has_images = False

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            text_parts.append(page_text)
            if page.images:
                has_images = True

    return "\n".join(text_parts), has_images


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--credentials", required=True, help="Путь к JSON-ключу service account")
    parser.add_argument("--applications-csv", required=True, help="CSV с колонками id, abstract_file_url")
    parser.add_argument("--output-sql", required=True, help="Куда сохранить сгенерированный SQL")
    parser.add_argument("--download-dir", default="./downloaded_abstracts", help="Куда сохранять скачанные файлы")
    args = parser.parse_args()

    download_dir = Path(args.download_dir)
    download_dir.mkdir(parents=True, exist_ok=True)

    creds = service_account.Credentials.from_service_account_file(
        args.credentials, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    service = build("drive", "v3", credentials=creds)

    sql_lines = ["-- Автосгенерировано extract_abstract_text.py", "begin;", ""]
    processed = 0
    skipped = []

    with open(args.applications_csv, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            app_id = row["id"]
            url = (row.get("abstract_file_url") or "").strip()
            existing_text = row.get("abstract_text") or ""
            if not url:
                continue

            file_id = extract_drive_file_id(url)
            if not file_id:
                skipped.append((app_id, url, "не удалось распознать FILE_ID из ссылки"))
                continue

            try:
                dest_path = download_dir / f"{app_id}_{file_id}"
                mime_type, original_name = download_drive_file(service, file_id, str(dest_path))

                # Определяем тип файла по имени/mime, добавляем расширение для читаемости
                ext = ""
                if "wordprocessingml" in mime_type or original_name.lower().endswith(".docx"):
                    ext = ".docx"
                elif mime_type == "application/pdf" or original_name.lower().endswith(".pdf"):
                    ext = ".pdf"

                final_path = dest_path.with_suffix(ext) if ext else dest_path
                dest_path.rename(final_path)

                if ext == ".docx":
                    text, has_images = extract_docx(final_path)
                elif ext == ".pdf":
                    text, has_images = extract_pdf(final_path)
                else:
                    skipped.append((app_id, url, f"неизвестный формат файла (mimeType={mime_type}, name={original_name})"))
                    continue

                if not text.strip():
                    skipped.append((app_id, url, "текст не извлёкся (возможно, скан без текстового слоя — проверьте файл вручную)"))
                    # Всё равно фиксируем факт наличия картинок, если извлечение это определило
                    sql_lines.append(
                        f"-- {app_id}: текст не извлёкся, вероятно скан — abstract_text не трогаем, только флаг картинок"
                    )
                    sql_lines.append(
                        f"update applications set abstract_file_has_images = {str(has_images).lower()} "
                        f"where id = {sql_escape(app_id)};"
                    )
                    continue

                sql_lines.append(f"-- {app_id} ({original_name})")
                if is_placeholder_text(existing_text):
                    sql_lines.append(
                        f"update applications set abstract_text = {sql_escape(text.strip())}, "
                        f"abstract_file_has_images = {str(has_images).lower()} "
                        f"where id = {sql_escape(app_id)};"
                    )
                else:
                    sql_lines.append(
                        f"-- ПРОПУЩЕНО: abstract_text уже содержит {len(existing_text.split())} слов "
                        f"(не похоже на плейсхолдер) — не перезаписываем автоматически. "
                        f"Если нужно перезаписать вручную, извлечённый текст файла ниже закомментирован."
                    )
                    for line in text.strip().splitlines():
                        sql_lines.append(f"-- {line}")
                    # Флаг картинок всё равно обновляем — это не зависит от текста
                    sql_lines.append(
                        f"update applications set abstract_file_has_images = {str(has_images).lower()} "
                        f"where id = {sql_escape(app_id)};"
                    )
                processed += 1

            except Exception as e:
                skipped.append((app_id, url, f"ошибка: {e}"))

    sql_lines.append("")
    sql_lines.append("commit;")

    with open(args.output_sql, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_lines))

    print(f"Обработано: {processed}")
    print(f"Пропущено: {len(skipped)}")
    if skipped:
        print("\nПропущенные строки (проверьте вручную):")
        for app_id, url, reason in skipped:
            print(f"  {app_id}: {reason} ({url})")

    print(f"\nSQL сохранён: {args.output_sql}")
    print(f"Скачанные файлы остались в: {download_dir} (для ручной проверки помеченных has_images=true)")


if __name__ == "__main__":
    main()
