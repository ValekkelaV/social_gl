#!/usr/bin/env python3
"""
Импорт заявок "СоцПоляны" из CSV (экспорт Google Формы) в SQL-файл с INSERT-ами.

Использование:
    python import_applications.py input.csv output.sql [--report report.csv]

Формат входного CSV (заголовки колонок Google Формы, порядок не важен,
скрипт ищет по подстроке в заголовке, регистронезависимо):
    Тип заявки
    ФИО
    Формат участия
    Уровень получаемого образования
    Укажите номер курса, на котором вы обучаетесь сейчас
    Место обучения (ВУЗ)
    Почта
    Телефон
    Ваши контакты в социальных сетях (ВК/ТГ/иное)
    Укажите тематику вашего доклада или секцию, на которую хотите подать тезисы
    Тезисы вашего доклада (500-700 слов)
    Файл с тезисами

Логика разбора соавторов (см. обсуждение):
    - Главный разделитель между соавторами — запятая (","), везде.
    - ФИО разбивается по запятой без исключений (в ФИО не встречается
      внутренних запятых) -> определяет N = число соавторов заявки.
    - Уровень образования / курс / вуз тоже пытаемся разбить по запятой:
        - если получилось ровно N частей -> используем как есть (i-e значение
          для i-го ФИО);
        - если не совпало (частей меньше или больше N) -> считаем, что всё
          поле — ОДНО общее значение на всех соавторов (не разбиваем), И
          помечаем заявку флагом needs_manual_review в отчёте, т.к.
          несовпадение может означать не "одно значение на всех", а
          "запятая внутри названия вуза" (напр. "НИУ ВШЭ, Москва"),
          что скрипт не может отличить автоматически.

Вывод:
    - SQL-файл с INSERT в applications, speakers, universities (только новые,
      не найденные по full_name в уже существующем справочнике — если нужно
      сопоставлять с реальным списком университетов, передайте --universities-csv).
    - Отчёт (CSV) со списком заявок, требующих ручной проверки, и коротким
      описанием причины.

ВАЖНО: скрипт не пишет напрямую в Supabase (доступа к базе нет на момент
написания) — он генерирует .sql-файл, который нужно выполнить вручную в
Supabase SQL editor после того, как накатана схема (файлы 01-12 из миграции).
Перед реальным запуском рекомендуется прогнать на копии/first 5 строках и
проверить сгенерированный SQL глазами.
"""

import argparse
import csv
import sys
import uuid
from dataclasses import dataclass, field


# ---------- Утилиты ----------

def find_column(fieldnames, *substrings):
    """Находит имя колонки по подстроке заголовка (регистронезависимо).
    Возвращает первое совпадение или None."""
    for fn in fieldnames:
        low = fn.lower()
        if all(s.lower() in low for s in substrings):
            return fn
    return None


def sql_escape(value):
    """Экранирование строки для вставки в SQL-литерал. None -> NULL."""
    if value is None:
        return "NULL"
    v = str(value).strip()
    if v == "":
        return "NULL"
    return "'" + v.replace("'", "''") + "'"


def split_csv_field(value):
    """Разбивает поле по запятой, обрезая пробелы вокруг каждой части.
    Пустая строка -> []."""
    if value is None or value.strip() == "":
        return []
    return [p.strip() for p in value.split(",")]


# ---------- Структуры данных ----------

@dataclass
class SpeakerRow:
    full_name: str
    education_level: str | None
    course_number: str | None
    university_raw: str | None


@dataclass
class ApplicationRow:
    row_number: int  # номер строки в исходном CSV (для отчёта/отладки)
    participation_format: str | None
    proposed_topic: str | None
    abstract_text: str | None
    abstract_file_url: str | None
    contact_email: str | None
    contact_phone: str | None
    contact_social: str | None
    speakers: list[SpeakerRow] = field(default_factory=list)
    review_flags: list[str] = field(default_factory=list)


# ---------- Разбор одной строки CSV ----------

def parse_row(row_number, row, columns):
    full_name_raw = row.get(columns["full_name"], "") or ""
    education_raw = row.get(columns["education_level"], "") or "" if columns["education_level"] else ""
    course_raw = row.get(columns["course_number"], "") or "" if columns["course_number"] else ""
    university_raw = row.get(columns["university"], "") or "" if columns["university"] else ""

    names = split_csv_field(full_name_raw)
    n = len(names)

    app = ApplicationRow(
        row_number=row_number,
        participation_format=row.get(columns["participation_format"]) if columns["participation_format"] else None,
        proposed_topic=row.get(columns["topic"]) if columns["topic"] else None,
        abstract_text=row.get(columns["abstract_text"]) if columns["abstract_text"] else None,
        abstract_file_url=row.get(columns["abstract_file"]) if columns["abstract_file"] else None,
        contact_email=row.get(columns["email"]) if columns["email"] else None,
        contact_phone=row.get(columns["phone"]) if columns["phone"] else None,
        contact_social=row.get(columns["social"]) if columns["social"] else None,
    )

    if n == 0:
        app.review_flags.append("Пустое поле ФИО — заявка пропущена или требует ручного ввода")
        return app

    education_parts = split_csv_field(education_raw)
    course_parts = split_csv_field(course_raw)
    university_parts = split_csv_field(university_raw)

    def resolve_field(parts, field_label):
        """Возвращает список длины n. Если parts не совпадает по длине —
        одно общее значение на всех + флаг ручной проверки."""
        if len(parts) == n:
            return parts
        elif len(parts) == 0:
            return [None] * n
        else:
            app.review_flags.append(
                f"Поле «{field_label}»: {len(parts)} значений на {n} ФИО — "
                f"применено одно общее значение ко всем соавторам, ПРОВЕРЬ ВРУЧНУЮ "
                f"(вероятно запятая внутри значения, напр. вуз с городом через запятую). "
                f"Исходное значение: {parts!r}"
            )
            joined = ", ".join(parts) if parts else None
            return [joined] * n

    education_resolved = resolve_field(education_parts, "Уровень образования")
    course_resolved = resolve_field(course_parts, "Курс")
    university_resolved = resolve_field(university_parts, "Вуз")

    for i, name in enumerate(names):
        app.speakers.append(SpeakerRow(
            full_name=name,
            education_level=education_resolved[i] if i < len(education_resolved) else None,
            course_number=course_resolved[i] if i < len(course_resolved) else None,
            university_raw=university_resolved[i] if i < len(university_resolved) else None,
        ))

    if not app.abstract_text and not app.abstract_file_url:
        app.review_flags.append("Нет ни текста тезисов, ни ссылки на файл — заявка не пройдёт check-constraint в БД")

    return app


# ---------- Генерация SQL ----------

def generate_sql(applications):
    lines = []
    lines.append("-- Автосгенерировано import_applications.py")
    lines.append("-- Проверьте вручную строки, отмеченные needs_manual_review в отчёте, перед выполнением.")
    lines.append("begin;")
    lines.append("")

    # Собираем уникальные "сырые" названия вузов, которых ещё нет в universities,
    # чтобы можно было завести черновые записи в справочнике (short_name = NULL,
    # что в схеме подсвечивается в UI как "нужно заполнить вручную").
    seen_universities = set()

    for app in applications:
        if not app.speakers:
            continue

        app_id = str(uuid.uuid4())

        lines.append(f"-- Заявка (исходная строка CSV #{app.row_number})")
        if app.review_flags:
            for flag in app.review_flags:
                lines.append(f"-- ВНИМАНИЕ: {flag}")

        lines.append(
            "insert into applications "
            "(id, contact_email, contact_phone, contact_social, proposed_topic, "
            "participation_format, abstract_text, abstract_file_url, status) values ("
            f"{sql_escape(app_id)}, {sql_escape(app.contact_email)}, {sql_escape(app.contact_phone)}, "
            f"{sql_escape(app.contact_social)}, {sql_escape(app.proposed_topic)}, "
            f"{sql_escape(app.participation_format)}, {sql_escape(app.abstract_text)}, "
            f"{sql_escape(app.abstract_file_url)}, 'submitted'"
            ");"
        )

        for sort_order, sp in enumerate(app.speakers):
            uni_raw = sp.university_raw
            if uni_raw and uni_raw not in seen_universities:
                seen_universities.add(uni_raw)
                lines.append(
                    "insert into universities (id, full_name, short_name) values ("
                    f"{sql_escape(str(uuid.uuid4()))}, {sql_escape(uni_raw)}, NULL"
                    ") on conflict (full_name) do nothing;"
                )

            speaker_id = str(uuid.uuid4())
            uni_lookup = (
                f"(select id from universities where full_name = {sql_escape(uni_raw)})"
                if uni_raw else "NULL"
            )
            lines.append(
                "insert into speakers "
                "(id, application_id, full_name, education_level, course_number, "
                "university_id, university_raw, sort_order) values ("
                f"{sql_escape(speaker_id)}, {sql_escape(app_id)}, {sql_escape(sp.full_name)}, "
                f"{sql_escape(sp.education_level)}, {sql_escape(sp.course_number)}, "
                f"{uni_lookup}, {sql_escape(uni_raw)}, {sort_order}"
                ");"
            )

        lines.append("")

    lines.append("commit;")
    return "\n".join(lines)


def generate_report(applications):
    rows = []
    for app in applications:
        if app.review_flags:
            rows.append({
                "csv_row": app.row_number,
                "speakers": "; ".join(s.full_name for s in app.speakers),
                "flags": " | ".join(app.review_flags),
            })
    return rows


# ---------- Main ----------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_csv", help="Путь к CSV-файлу с заявками (экспорт Google Формы)")
    parser.add_argument("output_sql", help="Путь для сохранения сгенерированного SQL-файла")
    parser.add_argument("--report", help="Путь для сохранения отчёта о строках, требующих ручной проверки (CSV)", default=None)
    parser.add_argument("--encoding", help="Кодировка входного файла (по умолчанию utf-8-sig, т.к. Google Forms часто добавляет BOM)", default="utf-8-sig")
    args = parser.parse_args()

    with open(args.input_csv, encoding=args.encoding, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []

        columns = {
            "full_name": find_column(fieldnames, "фио"),
            "participation_format": find_column(fieldnames, "формат", "участ"),
            "education_level": find_column(fieldnames, "уровень", "образован"),
            "course_number": find_column(fieldnames, "курс"),
            "university": find_column(fieldnames, "вуз") or find_column(fieldnames, "место", "обучен"),
            "email": find_column(fieldnames, "почт") or find_column(fieldnames, "email"),
            "phone": find_column(fieldnames, "телефон"),
            "social": find_column(fieldnames, "социальн"),
            "topic": find_column(fieldnames, "тематик") or find_column(fieldnames, "секци"),
            "abstract_text": find_column(fieldnames, "тезис") and find_column(fieldnames, "500"),
            "abstract_file": find_column(fieldnames, "файл", "тезис"),
        }

        missing_required = [k for k in ("full_name",) if not columns[k]]
        if missing_required:
            print(f"ОШИБКА: не найдены обязательные колонки в CSV: {missing_required}", file=sys.stderr)
            print(f"Доступные заголовки: {fieldnames}", file=sys.stderr)
            sys.exit(1)

        print("Найденные колонки:")
        for k, v in columns.items():
            print(f"  {k}: {v!r}")

        applications = []
        for i, row in enumerate(reader, start=2):  # строка 1 — заголовок
            applications.append(parse_row(i, row, columns))

    sql_text = generate_sql(applications)
    with open(args.output_sql, "w", encoding="utf-8") as f:
        f.write(sql_text)

    report_rows = generate_report(applications)
    if args.report:
        with open(args.report, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["csv_row", "speakers", "flags"])
            writer.writeheader()
            writer.writerows(report_rows)
        print(f"\nОтчёт по строкам, требующим проверки, сохранён: {args.report}")

    print(f"\nВсего заявок обработано: {len(applications)}")
    print(f"Заявок, требующих ручной проверки: {len(report_rows)}")
    print(f"SQL сохранён: {args.output_sql}")


if __name__ == "__main__":
    main()
