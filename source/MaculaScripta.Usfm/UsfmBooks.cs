namespace MaculaScripta.Usfm;

public static class UsfmBooks
{
    private static readonly string[] Codes =
    [
        "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH",
        "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
    ];

    private static readonly string[] Names =
    [
        "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
        "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy",
        "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude",
        "Revelation",
    ];

    public static int Order(string code) => Array.IndexOf(Codes, code);

    public static string Name(string code) => Order(code) is var i and >= 0 ? Names[i] : code;

    /// <summary>The standard USFM file name stem, e.g. 44JHN (the New Testament starts at 41 because 40 is reserved).</summary>
    public static string FileStem(string code) => Order(code) is var i and >= 0 ? $"{41 + i}{code}" : code;
}
