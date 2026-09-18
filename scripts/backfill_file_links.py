#!/usr/bin/env python3
"""
Бэкфилл ссылок на файлы тезисов для уже импортированных заявок прошлого года.

Проблема: в оригинальном CSV была колонка со ссылкой на Google Drive файл,
но import_applications.py её не подхватывал (см. правку в самом скрипте) —
поэтому в уже загруженных applications.abstract_file_url пусто, хотя файлы
реально лежат на Drive.

Подход: сопоставляем строки CSV с уже существующими applications по списку
ФИО докладчиков (тот же порядок, что использовался при исходном импорте —
join через "; ", как в mailing_recipients). Это единственный устойчивый общий
ключ, т.к. applications не хранит номер исходной строки CSV.

ВАЖНО: скрипт не пишет в БД напрямую — генерирует .sql с UPDATE, который нужно
проверить глазами и выполнить в Supabase SQL Editor.

Использование:
    python backfill_file_links.py original.csv output.sql

Перед запуском: выгрузите текущие applications + агрегированные ФИО
докладчиков в CSV через SQL Editor:

    select
      a.id,
      string_agg(s.full_name, '; ' order by s.sort_order) as full_names
    from applications a
    join speakers s on s.application_id = a.id
    group by a.id;

Сохраните результат как existing_applications.csv (колонки: id, full_names)
и передайте третьим аргументом:

    python backfill_file_links.py original.csv output.sql existing_applications.csv
"""

import argparse
import csv
import sys


def find_column(fieldnames, *substrings):
    for fn in fieldnames:
        low = fn.lower()
        if all(s.lower() in low for s in substrings):
            return fn
    return None


def sql_escape(value):
    if value is None:
        return "NULL"
    v = str(value).strip()
    if v == "":
        return "NULL"
    return "'" + v.replace("'", "''") + "'"


def normalize_names(raw, delimiter=","):
    parts = [p.strip() for p in raw.split(delimiter) if p.strip()]
    return "; ".join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("original_csv", help="Оригинальный CSV из Google Формы (с колонкой-ссылкой)")
    parser.add_argument("output_sql", help="Путь для сохранения сгенерированного SQL с UPDATE")
    parser.add_argument("existing_csv", help="Экспорт applications.id + агрегированных full_names из БД (см. docstring)")
    parser.add_argument("--encoding", default="utf-8-sig")
    args = parser.parse_args()

    # 1. Читаем уже существующие заявки: full_names ("Иванов; Петров") -> id
    existing_by_names = {}
    with open(args.existing_csv, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = row["full_names"].strip()
            existing_by_names[key] = row["id"]

    # 2. Читаем оригинальный CSV, находим колонку ФИО и колонку ссылки
    with open(args.original_csv, encoding=args.encoding, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []

        full_name_col = find_column(fieldnames, "фио")
        link_col = (
            find_column(fieldnames, "файл", "тезис")
            or find_column(fieldnames, "ссылк")
        )

        if not full_name_col:
            print("ОШИБКА: не найдена колонка ФИО", file=sys.stderr)
            sys.exit(1)
        if not link_col:
            print("ОШИБКА: не найдена колонка со ссылкой на файл", file=sys.stderr)
            print(f"Доступные заголовки: {fieldnames}", file=sys.stderr)
            sys.exit(1)

        print(f"Колонка ФИО: {full_name_col!r}")
        print(f"Колонка ссылки: {link_col!r}")

        matched = []
        unmatched = []

        for i, row in enumerate(reader, start=2):
            raw_names = row.get(full_name_col, "") or ""
            link = (row.get(link_col, "") or "").strip()
            if not link:
                continue  # нет ссылки в этой строке — нечего бэкфиллить

            key = normalize_names(raw_names)
            app_id = existing_by_names.get(key)

            if app_id:
                matched.append((app_id, link, i))
            else:
                unmatched.append((i, raw_names, link))

    # 3. Генерируем UPDATE-ы
    lines = []
    lines.append("-- Автосгенерировано backfill_file_links.py")
    lines.append("-- Проверьте перед выполнением — особенно если ниже есть unmatched строки в консоли.")
    lines.append("begin;")
    lines.append("")

    for app_id, link, csv_row in matched:
        lines.append(f"-- CSV строка #{csv_row}")
        lines.append(
            f"update applications set abstract_file_url = {sql_escape(link)} "
            f"where id = {sql_escape(app_id)} "
            f"and (abstract_file_url is null or abstract_file_url = '__PENDING_BACKFILL__');"
        )

    lines.append("")
    lines.append("commit;")

    with open(args.output_sql, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\nСовпало: {len(matched)}")
    print(f"Не найдено соответствия в БД: {len(unmatched)}")
    if unmatched:
        print("\nНе сматчились (проверьте вручную — возможно, разное написание ФИО):")
        for csv_row, names, link in unmatched:
            print(f"  CSV строка #{csv_row}: {names!r} -> {link}")

    print(f"\nSQL сохранён: {args.output_sql}")


if __name__ == "__main__":
    main()
