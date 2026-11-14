using MaculaScripta.Usfm;

namespace MaculaScripta.Usfm.Cli;

internal sealed record CliOptions(
    string OutputDirectory,
    IReadOnlyList<string> TsvPaths,
    string? ZipPath,
    UsfmNoteLevel NoteLevel,
    IReadOnlyList<(string EntryName, string Path)> Includes)
{
    public const string Usage =
        "Usage: macula-usfm <output-dir> [--zip <file.zip>] [--notes verse|word] [--include <entry-name>=<path>]... <macula.tsv>...";

    /// <summary>Parses the arguments, or returns null with an error message.</summary>
    public static CliOptions? Parse(string[] args, out string? error)
    {
        string? outputDirectory = null;
        string? zipPath = null;
        var noteLevel = UsfmNoteLevel.Verse;
        var includes = new List<(string, string)>();
        var tsvPaths = new List<string>();
        error = null;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--zip" when i + 1 < args.Length:
                    zipPath = args[++i];
                    break;
                case "--notes" when i + 1 < args.Length && Enum.TryParse(args[i + 1], ignoreCase: true, out UsfmNoteLevel level)
                    && Enum.IsDefined(level):
                    noteLevel = level;
                    i++;
                    break;
                case "--include" when i + 1 < args.Length && args[i + 1].Split('=', 2) is [var name, var path]:
                    includes.Add((name, path));
                    i++;
                    break;
                case var option when option.StartsWith("--"):
                    error = $"Unknown or incomplete option {option}.";
                    return null;
                default:
                    if (outputDirectory is null)
                    {
                        outputDirectory = args[i];
                    }
                    else
                    {
                        tsvPaths.Add(args[i]);
                    }

                    break;
            }
        }

        if (outputDirectory is null || tsvPaths.Count == 0)
        {
            error = "An output directory and at least one TSV file are required.";
            return null;
        }

        return new CliOptions(outputDirectory, tsvPaths, zipPath, noteLevel, includes);
    }
}
