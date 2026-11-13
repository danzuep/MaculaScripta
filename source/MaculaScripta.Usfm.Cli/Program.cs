using System.Text;
using MaculaScripta.Usfm;

const string usage = "Usage: macula-usfm <output-dir> [--zip <file.zip>] [--include <entry-name>=<path>]... <macula.tsv>...";
if (args.Length == 1 && args[0] is "-h" or "--help")
{
    Console.WriteLine(usage);
    return 0;
}

string? outputDir = null;
string? zipPath = null;
var includes = new List<(string EntryName, string Path)>();
var tsvPaths = new List<string>();
for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--zip" when i + 1 < args.Length:
            zipPath = args[++i];
            break;
        case "--include" when i + 1 < args.Length && args[i + 1].Split('=', 2) is [var name, var path]:
            includes.Add((name, path));
            i++;
            break;
        case var option when option.StartsWith("--"):
            Console.Error.WriteLine($"Unknown or incomplete option {option}.\n{usage}");
            return 1;
        default:
            if (outputDir is null)
            {
                outputDir = args[i];
            }
            else
            {
                tsvPaths.Add(args[i]);
            }

            break;
    }
}

if (outputDir is null || tsvPaths.Count == 0)
{
    Console.Error.WriteLine(usage);
    return 1;
}

var words = new List<MaculaWord>();
foreach (var tsvPath in tsvPaths)
{
    using var reader = new StreamReader(tsvPath);
    words.AddRange(MaculaTsvReader.Read(reader));
}

var books = UsfmWriter.WriteBooks(words).ToList();

// Attribution files are optional: skip any that the checkout does not have.
var presentIncludes = includes.Where(f => File.Exists(f.Path)).ToList();

Directory.CreateDirectory(outputDir);
foreach (var (book, usfm) in books)
{
    File.WriteAllText(Path.Combine(outputDir, $"{UsfmBooks.FileStem(book)}.usfm"), usfm, new UTF8Encoding(false));
}

foreach (var (entryName, path) in presentIncludes)
{
    File.Copy(path, Path.Combine(outputDir, entryName), overwrite: true);
}

if (zipPath is not null)
{
    if (Path.GetDirectoryName(Path.GetFullPath(zipPath)) is { } dir)
    {
        Directory.CreateDirectory(dir);
    }

    File.Delete(zipPath);
    UsfmWriter.WriteZip(books, zipPath, presentIncludes);
}

Console.WriteLine($"Wrote {books.Count} book(s) and {presentIncludes.Count} attribution file(s) to {outputDir}{(zipPath is null ? "" : $" and {zipPath}")}.");
return 0;
