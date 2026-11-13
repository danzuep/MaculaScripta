using System.Text;

namespace MaculaScripta.Usfm;

/// <summary>
/// Writes one Macula word as <c>\w \+rb text|gloss="…"\+rb*|attributes\w*</c>: the English gloss is the only ruby text and
/// every other TSV column (plus <c>x-translit</c>) is a <c>\w</c> attribute.
/// </summary>
public static class UsfmWordWriter
{
    // Columns with a standard \w attribute name; all others get an x- prefix (USFM 3 custom attributes).
    private static readonly HashSet<string> StandardAttributes = ["lemma", "strong"];

    // Columns that are rendered elsewhere or replaced by x-translit, so they are not repeated as attributes.
    private static readonly HashSet<string> NotAttributes = ["ref", "text", "after", "gloss", "transliteration"];

    public static string Write(MaculaWord word)
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
            if (value.Length > 0 && !NotAttributes.Contains(column))
            {
                var name = StandardAttributes.Contains(column) ? column : $"x-{column.Replace(':', '-')}";
                attributes.Add($"{name}=\"{EscapeValue(value)}\"");
            }
        }

        attributes.Add($"x-translit=\"{EscapeValue(Transliteration(word))}\"");
        return sb.Append('|').AppendJoin(' ', attributes).Append("\\w*").ToString();
    }

    // Hebrew rows already carry a transliteration column; Greek rows get ours.
    private static string Transliteration(MaculaWord word) =>
        word.Get("transliteration") is { Length: > 0 } existing
            ? existing
            : GreekTransliterator.Transliterate(word.Get("text"));

    // Backslashes and pipes would start markup or attributes inside a word.
    private static string EscapeText(string value) => value.Replace("\\", "").Replace("|", "");

    private static string EscapeValue(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
