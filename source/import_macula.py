"""Import Macula's word-level SBLGNT TSV as native YAML for Hugo."""

import argparse
import csv
import json
import re
import subprocess
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
BOOKS = [
    ("MAT", "matthew", "Matthew", 28),
    ("MRK", "mark", "Mark", 16),
    ("LUK", "luke", "Luke", 24),
    ("JHN", "john", "John", 21),
    ("ACT", "acts", "Acts", 28),
    ("ROM", "romans", "Romans", 16),
    ("1CO", "1-corinthians", "1 Corinthians", 16),
    ("2CO", "2-corinthians", "2 Corinthians", 13),
    ("GAL", "galatians", "Galatians", 6),
    ("EPH", "ephesians", "Ephesians", 6),
    ("PHP", "philippians", "Philippians", 4),
    ("COL", "colossians", "Colossians", 4),
    ("1TH", "1-thessalonians", "1 Thessalonians", 5),
    ("2TH", "2-thessalonians", "2 Thessalonians", 3),
    ("1TI", "1-timothy", "1 Timothy", 6),
    ("2TI", "2-timothy", "2 Timothy", 4),
    ("TIT", "titus", "Titus", 3),
    ("PHM", "philemon", "Philemon", 1),
    ("HEB", "hebrews", "Hebrews", 13),
    ("JAS", "james", "James", 5),
    ("1PE", "1-peter", "1 Peter", 5),
    ("2PE", "2-peter", "2 Peter", 3),
    ("1JN", "1-john", "1 John", 5),
    ("2JN", "2-john", "2 John", 1),
    ("3JN", "3-john", "3 John", 1),
    ("JUD", "jude", "Jude", 1),
    ("REV", "revelation", "Revelation", 22),
]
REFERENCE = re.compile(r"(\w+) (\d+):(\d+)!(\d+)")


def read_books(path, selected):
    books = {code: {} for code in selected}
    seen = set()
    previous = {}
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        required = {"xml:id", "ref", "text", "after", "english", "mandarin", "gloss"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("TSV is missing required Macula columns")
        for row in reader:
            if None in row or None in row.values():
                raise ValueError("TSV row has the wrong number of columns")
            match = REFERENCE.fullmatch(row["ref"])
            if not match:
                raise ValueError(f"Invalid Macula reference: {row['ref']}")
            code, chapter, verse, word = match.groups()
            if code not in books:
                continue
            position = tuple(map(int, (chapter, verse, word)))
            if not row["xml:id"] or row["xml:id"] in seen or not row["text"]:
                raise ValueError(f"Missing text or duplicate/empty ID: {row['ref']}")
            if position <= previous.get(code, (0, 0, 0)):
                raise ValueError(f"Words are not in reading order: {row['ref']}")
            seen.add(row["xml:id"])
            previous[code] = position
            chapters = books[code]
            chapters.setdefault(int(chapter), {}).setdefault(int(verse), []).append(row)
    for code, chapters in books.items():
        expected = next(book[3] for book in BOOKS if book[0] == code)
        if list(chapters) != list(range(1, expected + 1)):
            raise ValueError(f"{code}: expected all {expected} chapters")
    return books


def write_yaml(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(value, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


def generate(root, selected):
    submodule = root / "data/macula-greek"
    tsv = submodule / "SBLGNT/tsv/macula-greek-SBLGNT.tsv"
    if not tsv.is_file():
        raise ValueError("Initialize data first: git submodule update --init --depth 1")
    books = read_books(tsv, selected)
    commit = subprocess.check_output(
        ["git", "-C", str(submodule), "rev-parse", "HEAD"], text=True
    ).strip()
    data = root / "site/data/nt"
    for code, slug, title, _ in BOOKS:
        if code not in books:
            continue
        book = {
            "code": code,
            "title": title,
            "source_commit": commit,
            "source_path": "SBLGNT/tsv/macula-greek-SBLGNT.tsv",
            "chapters": [{"number": chapter} for chapter in books[code]],
        }
        write_yaml(data / "books" / f"{code}.yaml", book)
        for chapter, verses in books[code].items():
            write_yaml(data / code / f"{chapter}.yaml", {
                "number": chapter,
                "verses": [
                    {"number": verse, "words": words}
                    for verse, words in verses.items()
                ],
            })
        page = root / "site/content/nt" / slug / "_index.md"
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text(
            f'---\ntitle: "{title}"\nlayout: reader\nbook: "{code}"\n---\n',
            encoding="utf-8",
        )
        for chapter in book["chapters"]:
            number = chapter["number"]
            if number == 1:
                continue
            (page.parent / f"{number}.md").write_text(
                f'---\ntitle: "{title} {number}"\nlayout: reader\n'
                f'book: "{code}"\nchapter: {number}\n---\n',
                encoding="utf-8",
            )
    write_yaml(data / "catalog.yaml", [
        {"code": code, "slug": slug, "title": title, "chapters": chapters,
         "available": (data / "books" / f"{code}.yaml").is_file()}
        for code, slug, title, chapters in BOOKS
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--books", nargs="+", choices=[book[0] for book in BOOKS],
                       default=["1JN", "JHN"], help="Book codes to import (default: 1JN JHN)")
    group.add_argument("--all", action="store_true", help="Import the whole New Testament")
    args = parser.parse_args()
    try:
        generate(ROOT, [book[0] for book in BOOKS] if args.all else args.books)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
