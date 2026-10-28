import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("import_macula", ROOT / "source/import_macula.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportMaculaTests(unittest.TestCase):
    def test_committed_book_matches_every_source_field(self):
        source = importer.read_books(
            ROOT / "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv", ["1JN"]
        )["1JN"]
        book = json.loads((ROOT / "site/data/nt/books/1JN.yaml").read_text())
        self.assertEqual(len(book["chapters"]), 5)
        self.assertEqual([len(c["verses"]) for c in book["chapters"]], [10, 29, 24, 21, 21])
        for chapter in book["chapters"]:
            for verse in chapter["verses"]:
                self.assertEqual(verse["words"], source[chapter["number"]][verse["number"]])
        words = [w for c in source.values() for v in c.values() for w in v]
        self.assertTrue(any(w["mandarin"] for w in words))
        self.assertTrue(any(w["after"].strip() for w in words))

    def test_catalog_has_all_books_and_only_mvp_available(self):
        catalog = json.loads((ROOT / "site/data/nt/catalog.yaml").read_text())
        self.assertEqual(len(catalog), 27)
        self.assertEqual(len({b["slug"] for b in catalog}), 27)
        self.assertIn("1JN", [b["code"] for b in catalog if b["available"]])
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
            (root / "data").mkdir()
            (root / "data/macula-greek").symlink_to(ROOT / "data/macula-greek",
                                                   target_is_directory=True)
            importer.generate(root, ["1JN"])
            path = root / "site/data/nt/books/1JN.yaml"
            original = path.read_bytes()
            importer.generate(root, ["1JN"])
            self.assertEqual(path.read_bytes(), original)
            book = json.loads(original)
            self.assertRegex(book["source_commit"], r"^[0-9a-f]{40}$")
            self.assertEqual(book["source_path"], "SBLGNT/tsv/macula-greek-SBLGNT.tsv")
            self.assertTrue((root / "site/content/nt/1-john/_index.md").is_file())

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

    def test_yaml_subset_preserves_unicode_and_unsafe_scalars(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "book.yaml"
            value = {"text": "Ὃ", "after": "· ", "english": 'yes: "word"\nnext'}
            importer.write_yaml(path, value)
            self.assertEqual(json.loads(path.read_text()), value)


if __name__ == "__main__":
    unittest.main()
