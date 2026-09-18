#!/usr/bin/env python3
"""
Импорт заявок "СоцПоляны" из CSV (экспорт новой формы Yandex Forms) в
SQL-файл с INSERT-ами.

Использование:
    python import_applications_v2.py input.csv output.sql [--report report.csv]

Формат входного CSV — новая форма (см. чат, дизайн формы):
    Тема доклада
    Желаемая секция (предварительный список)
    Если хотите заявить отдельную секцию... (свободный текст, обычно пусто)
    E-mail для связи
    Телефон для связи
    Соцсети для связи
    Текст тезисов доклада
    Файл с тезисами (загружается на серверы Yandex Forms — см. отдельно
        процедуру выгрузки/переноса на Drive, не входит в этот скрипт)
    Число докладчиков
    Докладчики — все из одного города/вуза/курса? (мультивыбор: город,
        вуз, курс — независимо друг от друга)
    [если хотя бы один из вариантов не выбран в мультивыборе]
        Общий город / Общий вуз / Общая ступень / Общий год обучения
        (только те поля, что отмечены как общие)
    Информация о докладчике N (для N = 1..число_докладчиков):
        ФИО, личный email (необязательно), город (если не общий),
        вуз (если не общий), ступень обучения (если не общая),
        год обучения (если не общий)

КЛЮЧЕВОЕ ОТЛИЧИЕ от старого import_applications.py: НЕТ делимитеров вообще.
Каждый докладчик — отдельный набор колонок в CSV (Yandex Forms сам
разворачивает повторяющийся блок "Информация о докладчике N" в N наборов
колонок при экспорте, обычно с суффиксом номера в заголовке). Поэтому вся
логика split_csv_field/resolve_field из старого скрипта здесь не нужна —
её место заняла прямая проверка "что отмечено как общее" + чтение
соответствующих колонок per-докладчик.

ВАЖНО: реальные заголовки колонок при экспорте CSV из Yandex Forms могут
отличаться по нумерации/формату от предположений ниже (напр. "Информация о
докладчике 1: ФИО" vs "ФИО докладчика 1" vs что-то ещё) — при первом запуске
скрипт печатает все найденные заголовки, сверьте с выводом и поправьте
find_column-паттерны при необходимости.

Файл с тезисами: при экспорте CSV из Yandex Forms в колонке с файлом обычно
оказывается ссылка на скачивание с серверов Yandex (не Google Drive) —
такую ссылку сохраняем как есть в abstract_file_url. Отдельный шаг миграции
на Drive (если требуется) — вне этого скрипта, см. процедуру в чате.
"""

import argparse
import csv
import sys
import uuid
from dataclasses import dataclass, field


def find_column(fieldnames, *substrings):
    for fn in fieldnames:
        low = fn.lower()
        if all(s.lower() in low for s in substrings):
            return fn
    return None


def find_speaker_column(fieldnames, speaker_num, *substrings):
    """Ищет колонку конкретного докладчика — заголовок должен содержать
    номер докладчика И все переданные подстроки. Номер ищем как отдельное
    вхождение цифры, т.к. Yandex Forms обычно нумерует блоки в заголовке
    (точный формат уточняется по факту первого экспорта — см. warning в main)."""
    for fn in fieldnames:
        low = fn.lower()
        if str(speaker_num) in fn and all(s.lower() in low for s in substrings):
            return fn
    return None


def sql_escape(value):
    if value is None:
        return "NULL"
    v = str(value).strip()
    if v == "":
        return "NULL"
    return "'" + v.replace("'", "''") + "'"


@dataclass
class SpeakerRow:
    full_name: str
    personal_email: str | None
    education_level: str | None
    course_number: str | None
    university_raw: str | None
    city: str | None


@dataclass
class ApplicationRow:
    row_number: int
    proposed_topic: str | None
    desired_section: str | None
    contact_email: str | None
    contact_phone: str | None
    contact_social: str | None
    abstract_text: str | None
    abstract_file_url: str | None
    speakers: list[SpeakerRow] = field(default_factory=list)
    review_flags: list[str] = field(default_factory=list)


def parse_row(row_number, row, columns, max_speakers):
    speaker_count_raw = row.get(columns["speaker_count"], "") or ""
    try:
        speaker_count = int(speaker_count_raw.strip())
    except (ValueError, AttributeError):
        speaker_count = None

    app = ApplicationRow(
        row_number=row_number,
        proposed_topic=row.get(columns["topic"]) if columns["topic"] else None,
        desired_section=row.get(columns["section"]) if columns["section"] else None,
        contact_email=row.get(columns["email"]) if columns["email"] else None,
        contact_phone=row.get(columns["phone"]) if columns["phone"] else None,
        contact_social=row.get(columns["social"]) if columns["social"] else None,
        abstract_text=row.get(columns["abstract_text"]) if columns["abstract_text"] else None,
        abstract_file_url=row.get(columns["abstract_file"]) if columns["abstract_file"] else None,
    )

    if speaker_count is None:
        app.review_flags.append(
            f"Не удалось распознать 'Число докладчиков' ({speaker_count_raw!r}) — "
            f"беру по факту непустых блоков докладчиков ниже"
        )

    shared_raw = (row.get(columns["shared_which"], "") or "") if columns["shared_which"] else ""
    shared_city = "город" in shared_raw.lower()
    shared_university = "вуз" in shared_raw.lower() or "учрежд" in shared_raw.lower()
    shared_course = "курс" in shared_raw.lower()

    common_city = (row.get(columns["common_city"]) or "").strip() if shared_city and columns["common_city"] else None
    common_university = (row.get(columns["common_university"]) or "").strip() if shared_university and columns["common_university"] else None
    common_level = (row.get(columns["common_level"]) or "").strip() if shared_course and columns["common_level"] else None
    common_year = (row.get(columns["common_year"]) or "").strip() if shared_course and columns["common_year"] else None

    n_to_check = speaker_count if speaker_count is not None else max_speakers

    for i in range(1, n_to_check + 1):
        name_col = find_speaker_column(row.keys(), i, "фио")
        if not name_col:
            continue
        full_name = (row.get(name_col) or "").strip()
        if not full_name:
            continue

        personal_email_col = find_speaker_column(row.keys(), i, "личн", "email") or find_speaker_column(row.keys(), i, "личн", "почт")
        city_col = find_speaker_column(row.keys(), i, "населенн") or find_speaker_column(row.keys(), i, "город")
        uni_col = find_speaker_column(row.keys(), i, "учрежд") or find_speaker_column(row.keys(), i, "вуз")
        level_col = find_speaker_column(row.keys(), i, "ступен")
        year_col = find_speaker_column(row.keys(), i, "год обучен")

        app.speakers.append(SpeakerRow(
            full_name=full_name,
            personal_email=(row.get(personal_email_col) or "").strip() or None if personal_email_col else None,
            city=common_city if shared_city else ((row.get(city_col) or "").strip() or None if city_col else None),
            university_raw=common_university if shared_university else ((row.get(uni_col) or "").strip() or None if uni_col else None),
            education_level=common_level if shared_course else ((row.get(level_col) or "").strip() or None if level_col else None),
            course_number=common_year if shared_course else ((row.get(year_col) or "").strip() or None if year_col else None),
        ))

    if not app.speakers:
        app.review_flags.append("Не найдено ни одного докладчика с заполненным ФИО — заявка требует ручной проверки")

    if not app.abstract_text and not app.abstract_file_url:
        app.review_flags.append("Нет ни текста тезисов, ни файла — заявка не пройдёт check-constraint в БД")

    return app


def generate_sql(applications):
    lines = ["-- Автосгенерировано import_applications_v2.py", "-- Проверьте строки с review_flags перед выполнением.", "begin;", ""]
    seen_universities = set()

    for app in applications:
        if not app.speakers:
            continue

        app_id = str(uuid.uuid4())
        lines.append(f"-- Заявка (CSV строка #{app.row_number})")
        for flag in app.review_flags:
            lines.append(f"-- ВНИМАНИЕ: {flag}")

        lines.append(
            "insert into applications "
            "(id, contact_email, contact_phone, contact_social, proposed_topic, "
            "desired_section, abstract_text, abstract_file_url, status) values ("
            f"{sql_escape(app_id)}, {sql_escape(app.contact_email)}, {sql_escape(app.contact_phone)}, "
            f"{sql_escape(app.contact_social)}, {sql_escape(app.proposed_topic)}, "
            f"{sql_escape(app.desired_section)}, {sql_escape(app.abstract_text)}, "
            f"{sql_escape(app.abstract_file_url)}, 'submitted'"
            ");"
        )

        for sort_order, sp in enumerate(app.speakers):
            if sp.university_raw and sp.university_raw not in seen_universities:
                seen_universities.add(sp.university_raw)
                lines.append(
                    "insert into universities (id, full_name, short_name) values ("
                    f"{sql_escape(str(uuid.uuid4()))}, {sql_escape(sp.university_raw)}, NULL"
                    ") on conflict (full_name) do nothing;"
                )

            speaker_id = str(uuid.uuid4())
            uni_lookup = (
                f"(select id from universities where full_name = {sql_escape(sp.university_raw)})"
                if sp.university_raw else "NULL"
            )
            lines.append(
                "insert into speakers "
                "(id, application_id, full_name, education_level, course_number, "
                "university_id, university_raw, city, personal_email, sort_order) values ("
                f"{sql_escape(speaker_id)}, {sql_escape(app_id)}, {sql_escape(sp.full_name)}, "
                f"{sql_escape(sp.education_level)}, {sql_escape(sp.course_number)}, "
                f"{uni_lookup}, {sql_escape(sp.university_raw)}, {sql_escape(sp.city)}, "
                f"{sql_escape(sp.personal_email)}, {sort_order}"
                ");"
            )

        lines.append("")

    lines.append("commit;")
    return "\n".join(lines)


def generate_report(applications):
    return [
        {"csv_row": app.row_number, "speakers": "; ".join(s.full_name for s in app.speakers), "flags": " | ".join(app.review_flags)}
        for app in applications if app.review_flags
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_csv")
    parser.add_argument("output_sql")
    parser.add_argument("--report", default=None)
    parser.add_argument("--encoding", default="utf-8-sig")
    parser.add_argument("--max-speakers", type=int, default=6, help="Верхняя граница числа докладчиков для поиска колонок, если 'Число докладчиков' не распозналось")
    args = parser.parse_args()

    with open(args.input_csv, encoding=args.encoding, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []

        columns = {
            "topic": find_column(fieldnames, "тема", "доклад"),
            "section": find_column(fieldnames, "желаем", "секц") or find_column(fieldnames, "секц"),
            "email": find_column(fieldnames, "email", "связ") or find_column(fieldnames, "почт", "связ"),
            "phone": find_column(fieldnames, "телефон"),
            "social": find_column(fieldnames, "соцсет"),
            "abstract_text": find_column(fieldnames, "текст", "тезис"),
            "abstract_file": find_column(fieldnames, "файл", "тезис"),
            "speaker_count": find_column(fieldnames, "число", "докладчик"),
            "shared_which": find_column(fieldnames, "одного", "город") or find_column(fieldnames, "докладчик", "все"),
            "common_city": find_column(fieldnames, "общ", "город") or find_column(fieldnames, "населенн"),
            "common_university": find_column(fieldnames, "общ", "учрежд") or find_column(fieldnames, "общ", "вуз"),
            "common_level": find_column(fieldnames, "общ", "ступен"),
            "common_year": find_column(fieldnames, "общ", "год"),
        }

        print("Найденные колонки (общий блок):")
        for k, v in columns.items():
            print(f"  {k}: {v!r}")
        print(f"\nВсе заголовки CSV (сверьте с колонками докладчиков выше, если что-то не нашлось):")
        for fn in fieldnames:
            print(f"  {fn!r}")

        missing_critical = [k for k in ("topic", "speaker_count") if not columns[k]]
        if missing_critical:
            print(f"\nВНИМАНИЕ: не найдены колонки: {missing_critical} — проверьте паттерны в find_column выше", file=sys.stderr)

        applications = []
        for i, row in enumerate(reader, start=2):
            applications.append(parse_row(i, row, columns, args.max_speakers))

    with open(args.output_sql, "w", encoding="utf-8") as f:
        f.write(generate_sql(applications))

    report_rows = generate_report(applications)
    if args.report:
        with open(args.report, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["csv_row", "speakers", "flags"])
            writer.writeheader()
            writer.writerows(report_rows)

    print(f"\nВсего заявок: {len(applications)}, требуют проверки: {len(report_rows)}")
    print(f"SQL сохранён: {args.output_sql}")


if __name__ == "__main__":
    main()
