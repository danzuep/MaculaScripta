namespace MaculaScripta.Usfm;

public static class UsfmBooks
{
    private static readonly string[] Codes =
    [
        "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH",
        "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON",
        "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
        "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH",
        "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
    ];

    private static readonly string[] Names =
    [
        "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
        "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
        "Ecclesiastes", "Song of Songs", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel",
        "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
        "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
        "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy",
        "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude",
        "Revelation",
    ];

    public static int Order(string code) => Array.IndexOf(Codes, code);

    public static string Name(string code) => Order(code) is var i and >= 0 ? Names[i] : code;

    /// <summary>The standard USFM file name stem, e.g. 44-JHN (the Old Testament is 01-39; the New Testament starts at 41 because 40 is reserved).</summary>
    public static string FileStem(string code) =>
        Order(code) is var i and >= 0 ? $"{(i < OldTestamentCount ? i + 1 : i + 2):00}-{code}" : code;

    public static bool IsOldTestament(string code) => Order(code) is var i and >= 0 && i < OldTestamentCount;

    /// <summary>The source dataset named in the USFM <c>\id</c> line.</summary>
    public static string Source(string code) => IsOldTestament(code) ? "Macula Hebrew WLC" : "Macula Greek SBLGNT";

    private const int OldTestamentCount = 39;
}
