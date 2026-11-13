using System.Text;

namespace MaculaScripta.Usfm;

/// <summary>Writes the words of one book as a USFM 3 document (headers, chapters, verses).</summary>
public static class UsfmBookWriter
{
    /// <summary>Groups words by book and writes each book, in canonical order.</summary>
    public static IEnumerable<(string Book, string Usfm)> WriteAll(IEnumerable<MaculaWord> words) =>
        words.GroupBy(w => w.Book)
            .OrderBy(g => UsfmBooks.Order(g.Key) is var o and >= 0 ? o : int.MaxValue)
            .Select(g => (g.Key, Write(g.Key, g)));

    public static string Write(string code, IEnumerable<MaculaWord> words)
    {
        var name = UsfmBooks.Name(code);
        var sb = new StringBuilder();
        sb.Append("\\id ").Append(code).Append(' ').Append(UsfmBooks.Source(code)).Append('\n')
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

            sb.Append(UsfmWordWriter.Write(word)).Append(word.Get("after"));
        }

        TrimLineEnd(sb);
        return sb.Append('\n').ToString();
    }

    private static void TrimLineEnd(StringBuilder sb)
    {
        while (sb.Length > 0 && (sb[^1] is ' ' or '\t'))
        {
            sb.Length--;
        }
    }
}
