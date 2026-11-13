using System.Text.RegularExpressions;

namespace MaculaScripta.Usfm;

/// <summary>One Macula word row: every TSV column in file order.</summary>
public sealed record MaculaWord(string Book, int Chapter, string Verse, IReadOnlyList<KeyValuePair<string, string>> Fields)
{
    public string Get(string column) =>
        Fields.FirstOrDefault(f => f.Key == column).Value ?? "";
}

public static partial class MaculaTsvReader
{
    [GeneratedRegex(@"^(?<book>\S+) (?<chapter>\d+):(?<verse>[^!\s]+)")]
    private static partial Regex RefPattern();

    public static IEnumerable<MaculaWord> Read(TextReader reader)
    {
        var header = reader.ReadLine()?.TrimStart('\uFEFF').Split('\t')
            ?? throw new InvalidDataException("The TSV is empty.");
        var refIndex = Array.IndexOf(header, "ref");
        if (refIndex < 0)
        {
            throw new InvalidDataException("The TSV has no 'ref' column.");
        }

        while (reader.ReadLine() is { } line)
        {
            if (line.Length == 0)
            {
                continue;
            }

            var cells = line.Split('\t');
            var match = RefPattern().Match(cells.ElementAtOrDefault(refIndex) ?? "");
            if (!match.Success)
            {
                throw new InvalidDataException($"Unrecognised ref in row: {line}");
            }

            var fields = header
                .Select((name, i) => KeyValuePair.Create(name, i < cells.Length ? cells[i] : ""))
                .ToList();
            yield return new MaculaWord(
                match.Groups["book"].Value,
                int.Parse(match.Groups["chapter"].Value),
                match.Groups["verse"].Value,
                fields);
        }
    }
}
