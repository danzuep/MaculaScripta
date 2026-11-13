using System.IO.Compression;
using System.Text;

namespace MaculaScripta.Usfm;

/// <summary>
/// Writes Macula words as USFM 3. Each word is <c>\w \+rb text|gloss="…"\+rb*|attributes\w*</c>: the English gloss is the
/// only ruby text and every other TSV column (plus <c>x-translit</c>) is a <c>\w</c> attribute.
/// </summary>
public static class UsfmWriter
{
    // Columns with a standard \w attribute name; all others get an x- prefix (USFM 3 custom attributes).
    private static readonly HashSet<string> StandardAttributes = ["lemma", "strong"];

    // Structural or rendered columns that are not repeated as attributes.
    private static readonly HashSet<string> Consumed = ["ref", "text", "after", "gloss"];

    public static IEnumerable<(string Book, string Usfm)> WriteBooks(IEnumerable<MaculaWord> words) =>
        words.GroupBy(w => w.Book)
            .OrderBy(g => UsfmBooks.Order(g.Key) is var o and >= 0 ? o : int.MaxValue)
            .Select(g => (g.Key, WriteBook(g.Key, g)));

    public static string WriteBook(string code, IEnumerable<MaculaWord> words)
    {
        var name = UsfmBooks.Name(code);
        var sb = new StringBuilder();
        sb.Append("\\id ").Append(code).Append(UsfmBooks.IsOldTestament(code) ? " Macula Hebrew WLC\n" : " Macula Greek SBLGNT\n")
            .Append("\\usfm 3.0\n")
            .Append("\\ide UTF-8\n")
            .Append("\\h ").Append(name).Append('\n')
            .Append("\\toc1 ").Append(name).Append('\n')
            .Append("\\mt1 ").Append(name).Append('\n');

        var chapter = 0;
        string? verse = null;
        foreach (var word in words)
        {
            if (word.Chapter != chapter)
            {
                TrimLineEnd(sb);
                chapter = word.Chapter;
                verse = null;
                sb.Append(sb[^1] == '\n' ? "" : "\n").Append("\\c ").Append(chapter).Append("\n\\p");
            }

            if (word.Verse != verse)
            {
                TrimLineEnd(sb);
                verse = word.Verse;
                sb.Append("\n\\v ").Append(verse).Append(' ');
            }

            sb.Append(WriteWord(word)).Append(word.Get("after"));
        }

        TrimLineEnd(sb);
        return sb.Append('\n').ToString();
    }

    public static string WriteWord(MaculaWord word)
    {
        var text = EscapeText(word.Get("text"));
        var gloss = word.Get("gloss");
        if (gloss.Length == 0)
        {
            gloss = word.Get("english");
        }

        var sb = new StringBuilder("\\w ");
        sb.Append(gloss.Length > 0 ? $"\\+rb {text}|gloss=\"{EscapeValue(gloss)}\"\\+rb*" : text);

        var attributes = new List<string>();
        foreach (var (column, value) in word.Fields)
        {
            if (value.Length > 0 && !Consumed.Contains(column) && column != "transliteration")
            {
                var name = StandardAttributes.Contains(column) ? column : $"x-{column.Replace(':', '-')}";
                attributes.Add($"{name}=\"{EscapeValue(value)}\"");
            }
        }

        // Hebrew rows already carry a transliteration column; Greek rows get ours.
        var translit = word.Get("transliteration");
        if (translit.Length == 0)
        {
            translit = GreekTransliterator.Transliterate(word.Get("text"));
        }

        attributes.Add($"x-translit=\"{EscapeValue(translit)}\"");
        return sb.Append('|').AppendJoin(' ', attributes).Append("\\w*").ToString();
    }

    public static void WriteZip(
        IEnumerable<(string Book, string Usfm)> books,
        string zipPath,
        IEnumerable<(string EntryName, string Path)>? extraFiles = null)
    {
        using var archive = ZipFile.Open(zipPath, ZipArchiveMode.Create);
        foreach (var (book, usfm) in books)
        {
            var entry = archive.CreateEntry($"{UsfmBooks.FileStem(book)}.usfm", CompressionLevel.Optimal);
            using var stream = new StreamWriter(entry.Open(), new UTF8Encoding(false));
            stream.Write(usfm);
        }

        foreach (var (entryName, path) in extraFiles ?? [])
        {
            archive.CreateEntryFromFile(path, entryName, CompressionLevel.Optimal);
        }
    }

    // Backslashes and pipes would start markup or attributes inside a word.
    private static string EscapeText(string value) => value.Replace("\\", "").Replace("|", "");

    private static string EscapeValue(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static void TrimLineEnd(StringBuilder sb)
    {
        while (sb.Length > 0 && (sb[^1] is ' ' or '\t'))
        {
            sb.Length--;
        }
    }
}
