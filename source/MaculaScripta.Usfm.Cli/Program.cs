using System.Text;
using MaculaScripta.Usfm;

const string usage = "Usage: macula-usfm <macula-greek-SBLGNT.tsv> <output-dir> [--zip <file.zip>]";
if (args.Length == 1 && args[0] is "-h" or "--help")
{
    Console.WriteLine(usage);
    return 0;
}

if (args.Length < 2)
{
    Console.Error.WriteLine(usage);
    return 1;
}

var tsvPath = args[0];
var outputDir = args[1];
var zipIndex = Array.IndexOf(args, "--zip");
var zipPath = zipIndex >= 0 && zipIndex + 1 < args.Length ? args[zipIndex + 1] : null;
if (zipIndex >= 0 && zipPath is null)
{
    Console.Error.WriteLine("--zip needs a file path.");
    return 1;
}

using var reader = new StreamReader(tsvPath);
var books = UsfmWriter.WriteBooks(MaculaTsvReader.Read(reader)).ToList();

Directory.CreateDirectory(outputDir);
foreach (var (book, usfm) in books)
{
    File.WriteAllText(Path.Combine(outputDir, $"{UsfmBooks.FileStem(book)}.usfm"), usfm, new UTF8Encoding(false));
}

if (zipPath is not null)
{
    if (Path.GetDirectoryName(Path.GetFullPath(zipPath)) is { } dir)
    {
        Directory.CreateDirectory(dir);
    }

    File.Delete(zipPath);
    UsfmWriter.WriteZip(books, zipPath);
}

Console.WriteLine($"Wrote {books.Count} book(s) to {outputDir}{(zipPath is null ? "" : $" and {zipPath}")}.");
return 0;
