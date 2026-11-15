using System.Text;

namespace MaculaScripta.Usfm;

/// <summary>
/// Writes one Macula word as plain USFM: the text with its English gloss as ruby (<c>\rb text|gloss\rb*</c>), and every
/// other TSV column (plus the transliteration) as a footnote entry (<c>\fk text \ft name: value; …</c>).
/// </summary>
public static class UsfmWordWriter
{
    // Columns that are rendered elsewhere or replaced by the transliteration entry.
    private static readonly HashSet<string> NotNoted = ["ref", "text", "after", "gloss", "transliteration"];

    public static string WriteRuby(MaculaWord word)
    {
        var text = Clean(word.Get("text"));
        var gloss = Gloss(word);
        // Ruby needs a non-empty base; textless rows (e.g. some Hebrew prefixes) keep their gloss in the note instead.
        return text.Length == 0 ? "" : gloss.Length > 0 ? $"\\rb {text}|{Clean(gloss)}\\rb*" : text;
    }

    /// <summary>The footnote body for a word, e.g. <c>\fk Ἐν \ft translit: En; lemma: ἐν</c>.</summary>
    public static string WriteNoteEntry(MaculaWord word)
    {
        var fields = new List<string> { $"translit: {Clean(Transliteration(word))}" };
        if (word.Get("text").Length == 0 && Gloss(word) is { Length: > 0 } textlessGloss)
        {
            fields.Add($"gloss: {Clean(textlessGloss)}");
        }

        foreach (var (column, value) in word.Fields)
        {
            if (value.Length > 0 && !NotNoted.Contains(column))
            {
                fields.Add($"{column}: {Clean(value)}");
            }
        }

        var key = Clean(word.Get("text")) is { Length: > 0 } t ? t : word.Get("xml:id");
        return new StringBuilder("\\fk ").Append(key).Append(" \\ft ").AppendJoin("; ", fields).ToString();
    }

    private static string Gloss(MaculaWord word) =>
        word.Get("gloss") is { Length: > 0 } g ? g : word.Get("english");

    // Hebrew rows already carry a transliteration column; Greek rows get ours.
    private static string Transliteration(MaculaWord word) =>
        word.Get("transliteration") is { Length: > 0 } existing
            ? existing
            : GreekTransliterator.Transliterate(word.Get("text"));

    // Backslashes start markup and pipes start ruby readings or attributes.
    private static string Clean(string value) => value.Replace("\\", "").Replace("|", "");
}
