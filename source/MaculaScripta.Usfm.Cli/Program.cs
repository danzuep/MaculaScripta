using MaculaScripta.Usfm;
using MaculaScripta.Usfm.Cli;

if (args is ["-h" or "--help"])
{
    Console.WriteLine(CliOptions.Usage);
    return 0;
}

if (CliOptions.Parse(args, out var error) is not { } options)
{
    Console.Error.WriteLine($"{error}\n{CliOptions.Usage}");
    return 1;
}

var words = new List<MaculaWord>();
foreach (var tsvPath in options.TsvPaths)
{
    using var reader = new StreamReader(tsvPath);
    words.AddRange(MaculaTsvReader.Read(reader));
}

var books = UsfmBookWriter.WriteAll(words, options.NoteLevel).ToList();

// Attribution files are optional: skip any that the checkout does not have.
var includes = options.Includes.Where(f => File.Exists(f.Path)).ToList();

UsfmPackager.WriteDirectory(books, options.OutputDirectory, includes);
if (options.ZipPath is not null)
{
    UsfmPackager.WriteZip(books, options.ZipPath, includes);
}

Console.WriteLine(
    $"Wrote {books.Count} book(s) and {includes.Count} attribution file(s) to {options.OutputDirectory}" +
    (options.ZipPath is null ? "." : $" and {options.ZipPath}."));
return 0;
