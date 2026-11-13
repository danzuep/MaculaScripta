using System.IO.Compression;
using System.Text;

namespace MaculaScripta.Usfm;

/// <summary>Writes USFM books and attribution files to a flat directory or a single zip.</summary>
public static class UsfmPackager
{
    public static string FileName(string book) => $"{UsfmBooks.FileStem(book)}.usfm";

    public static void WriteDirectory(
        IEnumerable<(string Book, string Usfm)> books,
        string directory,
        IEnumerable<(string EntryName, string Path)> extraFiles)
    {
        Directory.CreateDirectory(directory);
        foreach (var (book, usfm) in books)
        {
            File.WriteAllText(Path.Combine(directory, FileName(book)), usfm, new UTF8Encoding(false));
        }

        foreach (var (entryName, path) in extraFiles)
        {
            File.Copy(path, Path.Combine(directory, entryName), overwrite: true);
        }
    }

    public static void WriteZip(
        IEnumerable<(string Book, string Usfm)> books,
        string zipPath,
        IEnumerable<(string EntryName, string Path)> extraFiles)
    {
        if (Path.GetDirectoryName(Path.GetFullPath(zipPath)) is { } directory)
        {
            Directory.CreateDirectory(directory);
        }

        File.Delete(zipPath);
        using var archive = ZipFile.Open(zipPath, ZipArchiveMode.Create);
        foreach (var (book, usfm) in books)
        {
            var entry = archive.CreateEntry(FileName(book), CompressionLevel.Optimal);
            using var stream = new StreamWriter(entry.Open(), new UTF8Encoding(false));
            stream.Write(usfm);
        }

        foreach (var (entryName, path) in extraFiles)
        {
            archive.CreateEntryFromFile(path, entryName, CompressionLevel.Optimal);
        }
    }
}
