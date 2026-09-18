#!/usr/bin/env python3
"""
Убирает мусор терминала из .sql-файлов, сохранённых из TUI-вывода.

Зачем: часть миграций СоцПоляны была сохранена не чистым экспортом, а
копированием вывода интерактивной программы, которая рисовала спиннер
"Downloading snippet". В начале файла остались escape-последовательности
и символы спиннера, из-за которых файл не проходит через psql.

Что вырезается:
  - CSI/OSC escape-последовательности (\x1b[...X, \x1b]...\x07)
  - символы спиннера: брайль (U+2800-U+28FF), геометрические фигуры
    (U+25A0-U+25FF, это ◒◐◓◑ — НЕ брайль, частая ошибка), рамки (U+2500-U+257F)
  - текст "Downloading snippet..." и прочие управляющие символы
  - ведущие строки до первой строки, похожей на SQL (комментарий или ключевое
    слово), с обрезкой отступа ТОЛЬКО у первой такой строки — отступы
    остального файла не трогаются

Использование:
    python strip_terminal_junk.py FILE [FILE ...]        # печатает результат в stdout
    python strip_terminal_junk.py --in-place FILE [...]  # перезаписывает файл
    python strip_terminal_junk.py --check FILE [...]     # только проверка, код 1 если есть мусор

Без аргументов обрабатывает все *.sql в ./supabase.
"""

import argparse
import glob
import os
import re
import sys

# \x1b[ ... буква  (CSI)   |   \x1b] ... \x07  (OSC)
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07")
SPINNER_TEXT_RE = re.compile(r"Downloading snippet\.*")

# Диапазоны "рисующих" символов, которых в нормальном SQL быть не может.
DRAWING_RANGES = (
    (0x2500, 0x257F),  # box drawing
    (0x25A0, 0x25FF),  # geometric shapes — спиннер ◒◐◓◑ живёт здесь
    (0x2800, 0x28FF),  # braille
)

# ВАЖНО: у "--" не может быть \b после него — дефис и следующий за ним пробел
# оба не-словесные символы, границы слова там нет, и "-- комментарий" не
# совпал бы. Поэтому "--" идёт отдельной альтернативой без \b.
SQL_LINE_RE = re.compile(
    r"^(--"
    r"|(create|alter|drop|insert|comment|grant|revoke|set|begin|do|select|with|update|delete)\b"
    r")",
    re.IGNORECASE,
)


def _is_drawing(ch: str) -> bool:
    o = ord(ch)
    return any(lo <= o <= hi for lo, hi in DRAWING_RANGES)


def strip_line(line: str) -> str:
    """Убирает escape-последовательности, символы спиннера и управляющие
    символы из одной строки. Отступы не трогает."""
    line = ANSI_RE.sub("", line)
    line = SPINNER_TEXT_RE.sub("", line)
    line = "".join(ch for ch in line if not _is_drawing(ch))
    # оставляем только печатаемые символы, таб и перевод строки
    return "".join(ch for ch in line if ord(ch) >= 0x20 or ch == "\t")


def strip_junk(text: str) -> str:
    """Чистит файл целиком, отбрасывая ведущие не-SQL строки."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        cleaned = strip_line(line)
        if cleaned.strip() == "":
            continue
        # первая содержательная строка — обрезаем у неё ведущий мусор
        cleaned = re.sub(r"^[\s│]+", "", cleaned)
        if not SQL_LINE_RE.match(cleaned):
            # не похоже на SQL: возможно, остаток спиннера — пропускаем
            rest = re.sub(r"[^\w\s]", "", cleaned).strip()
            if rest == "":
                continue
        return "\n".join([cleaned] + [strip_line(l) for l in lines[i + 1:]])
    return ""


def has_junk(text: str) -> bool:
    return text != strip_junk(text)


def main() -> int:
    ap = argparse.ArgumentParser(description="Убрать мусор терминала из SQL-файлов")
    ap.add_argument("files", nargs="*", help="файлы (по умолчанию — все supabase/*.sql)")
    ap.add_argument("--in-place", action="store_true", help="перезаписать файлы")
    ap.add_argument("--check", action="store_true", help="только проверить, код 1 если есть мусор")
    args = ap.parse_args()

    files = args.files or sorted(glob.glob("supabase/*.sql"))
    dirty = []
    for path in files:
        if not os.path.isfile(path):
            print(f"нет файла: {path}", file=sys.stderr)
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        cleaned = strip_junk(text)

        if args.check:
            if has_junk(text):
                dirty.append(path)
                print(f"ГРЯЗНО  {path}")
            else:
                print(f"чисто   {path}")
        elif args.in_place:
            if cleaned != text:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(cleaned if cleaned.endswith("\n") else cleaned + "\n")
                print(f"очищено {path}")
            else:
                print(f"без изменений {path}")
        else:
            sys.stdout.write(cleaned if cleaned.endswith("\n") else cleaned + "\n")

    if args.check:
        return 1 if dirty else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
