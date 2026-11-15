namespace MaculaScripta.Usfm;

/// <summary>Writes one Macula word as plain USFM: the text with its English gloss as the only ruby (<c>\rb text|gloss\rb*</c>).</summary>
public static class UsfmWordWriter
{
    public static string WriteRuby(MaculaWord word)
    {
        var text = Clean(word.Get("text"));
        var gloss = Clean(word.Get("gloss") is { Length: > 0 } g ? g : word.Get("english"));
        // Ruby needs a non-empty base, so textless rows (e.g. some Hebrew prefixes) write nothing.
        return text.Length == 0 ? "" : gloss.Length > 0 ? $"\\rb {text}|{gloss}\\rb*" : text;
    }

    // Backslashes start markup and pipes start ruby readings or attributes.
    private static string Clean(string value) => value.Replace("\\", "").Replace("|", "");
}
