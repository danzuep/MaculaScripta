import csv
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("import_macula", ROOT / "source/import_macula.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def read_yaml(path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class ImportMaculaTests(unittest.TestCase):
    def test_committed_books_match_every_source_field(self):
        source = importer.read_books(
            ROOT / "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv", ["1JN", "JHN"]
        )
        for code, count in [("1JN", 5), ("JHN", 21)]:
            book = read_yaml(ROOT / f"site/data/nt/books/{code}.yaml")
            self.assertEqual(len(book["chapters"]), count)
            for entry in book["chapters"]:
                number = entry["number"]
                chapter = read_yaml(ROOT / f"site/data/nt/{code}/{number}.yaml")
                self.assertEqual(chapter["number"], number)
                self.assertEqual(len(chapter["verses"]), len(source[code][number]))
                for verse in chapter["verses"]:
                    self.assertEqual(verse["words"], source[code][number][verse["number"]])
            words = [w for c in source[code].values() for v in c.values() for w in v]
            self.assertTrue(any(w["mandarin"] for w in words))
            self.assertTrue(any(w["after"].strip() for w in words))

    def test_catalog_has_all_books_and_both_john_books_available(self):
        catalog = read_yaml(ROOT / "site/data/nt/catalog.yaml")
        self.assertEqual(len(catalog), 27)
        self.assertNotIn("slug", catalog[0])
        self.assertEqual({"1JN", "JHN"}, {b["code"] for b in catalog if b["available"]})
        for book in catalog:
            self.assertEqual(book["available"],
                             (ROOT / f'site/data/nt/books/{book["code"]}.yaml').is_file())

    def test_entire_new_testament_can_be_read(self):
        codes = [book[0] for book in importer.BOOKS]
        books = importer.read_books(
            ROOT / "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv", codes
        )
        self.assertEqual(list(books), codes)
        self.assertEqual(sum(len(chapters) for chapters in books.values()), 260)

    def test_generation_is_deterministic_and_records_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            submodule = root / "data/macula-greek"
            tsv = submodule / "SBLGNT/tsv/macula-greek-SBLGNT.tsv"
            tsv.parent.mkdir(parents=True)
            headers = ["xml:id", "ref", "text", "after", "english", "mandarin", "gloss"]
            with tsv.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=headers, delimiter="\t")
                writer.writeheader()
                for code, chapters in [("1JN", 5), ("JHN", 21)]:
                    for number in range(1, chapters + 1):
                        writer.writerow({
                            "xml:id": f"{code}-{number}",
                            "ref": f"{code} {number}:1!1",
                            "text": "λόγος",
                            "after": " ",
                            "english": "word",
                            "mandarin": "道",
                            "gloss": "word",
                        })
            subprocess.run(["git", "-C", str(submodule), "init"], check=True, capture_output=True)
            subprocess.run(
                ["git", "-C", str(submodule), "config", "user.email", "test@example.com"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", str(submodule), "config", "user.name", "Test"],
                check=True,
            )
            subprocess.run(["git", "-C", str(submodule), "add", "."], check=True)
            subprocess.run(
                ["git", "-C", str(submodule), "commit", "-m", "fixture data"],
                check=True,
                capture_output=True,
            )
            importer.generate(root, ["1JN"])
            path = root / "site/data/nt/books/1JN.yaml"
            original = path.read_bytes()
            chapter_path = root / "site/data/nt/1JN/2.yaml"
            original_chapter = chapter_path.read_bytes()
            importer.generate(root, ["1JN"])
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(chapter_path.read_bytes(), original_chapter)
            book = yaml.safe_load(original)
            self.assertRegex(book["source_commit"], r"^[0-9a-f]{40}$")
            self.assertEqual(book["source_path"], "SBLGNT/tsv/macula-greek-SBLGNT.tsv")
            importer.generate(root, ["JHN"])
            catalog = read_yaml(root / "site/data/nt/catalog.yaml")
            self.assertEqual({"1JN", "JHN"}, {b["code"] for b in catalog if b["available"]})
            self.assertEqual(chapter_path.read_bytes(), original_chapter)

    def test_native_yaml_uses_block_mappings_not_json_documents(self):
        paths = list((ROOT / "site/data/nt").rglob("*.yaml"))
        self.assertGreater(len(paths), 0)
        for path in paths:
            text = path.read_text(encoding="utf-8")
            self.assertFalse(text.lstrip().startswith(("{", "[")), path)
            self.assertIsNotNone(read_yaml(path), path)
        chapter = read_yaml(ROOT / "site/data/nt/1JN/1.yaml")
        self.assertTrue(chapter["verses"])

    def test_invalid_headers_and_duplicate_ids_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.tsv"
            path.write_text("ref\ttext\n1JN 1:1!1\tλόγος\n")
            with self.assertRaisesRegex(ValueError, "columns"):
                importer.read_books(path, ["1JN"])
            headers = ["xml:id", "ref", "text", "after", "english", "mandarin", "gloss"]
            with path.open("w", newline="") as stream:
                writer = csv.writer(stream, delimiter="\t")
                writer.writerow(headers)
                writer.writerow(["n1", "1JN 1:1!1", "λόγος", ".", "word", "道", "word"])
                writer.writerow(["n1", "1JN 1:1!2", "λόγος", " ", "word", "道", "word"])
            with self.assertRaisesRegex(ValueError, "duplicate"):
                importer.read_books(path, ["1JN"])

    def test_native_yaml_preserves_unicode_and_unsafe_scalars(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "book.yaml"
            value = {"text": "Ὃ", "after": "· ", "english": 'yes: "word"\nnext'}
            importer.write_yaml(path, value)
            self.assertEqual(yaml.safe_load(path.read_text()), value)
            self.assertFalse(path.read_text().lstrip().startswith("{"))


if __name__ == "__main__":
    unittest.main()
