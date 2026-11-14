using System.IO.Compression;
using MaculaScripta.Usfm;
using Xunit;

namespace MaculaScripta.Usfm.Tests;

public class UsfmTests
{
    private const string Tsv =
        "xml:id\tref\tclass\tgloss\ttext\tafter\tlemma\tstrong\tmorph\tenglish\n" +
        "n1\tJHN 1:1!1\tprep\tIn [the]\tἘν\t \tἐν\t1722\tPREP\tin\n" +
        "n2\tJHN 1:1!2\tnoun\tbeginning\tἀρχῇ\t \tἀρχή\t746\tN-DSF\tbeginning\n" +
        "n3\tJHN 1:2!1\tpron\t\tοὗτος\t.\t\t\t\tthis \"one\"\n" +
        "n4\tJHN 2:1!1\tverb\tsaid\tεἶπεν\t \tλέγω\t3004\tV-AAI-3S\tsay\n";

    private static List<MaculaWord> Words() => MaculaTsvReader.Read(new StringReader(Tsv)).ToList();

    [Theory]
    [InlineData("Ἐν", "En")]
    [InlineData("ἀρχῇ", "archēi")]
    [InlineData("Εὐαγγέλιον", "Euangelion")]
    [InlineData("ῥῆμα", "rhēma")]
    [InlineData("ᾠδή", "ōidē")]
    [InlineData("λόγχη", "lonchē")]
    [InlineData("υἱός", "huios")]
    public void Transliteration_matches_the_javascript_reader(string greek, string expected) =>
        Assert.Equal(expected, GreekTransliterator.Transliterate(greek));

    [Fact]
    public void Word_is_plain_gloss_ruby_with_other_columns_in_a_note_entry()
    {
        var word = Words()[0];

        Assert.Equal("\\rb Ἐν|In [the]\\rb*", UsfmWordWriter.WriteRuby(word));
        Assert.Equal(
            "\\fk Ἐν \\ft translit: En; xml:id: n1; class: prep; lemma: ἐν; strong: 1722; morph: PREP; english: in",
            UsfmWordWriter.WriteNoteEntry(word));
    }

    [Fact]
    public void Word_without_gloss_falls_back_to_english_and_strips_markup_characters()
    {
        var ruby = UsfmWordWriter.WriteRuby(MaculaTsvReader.Read(new StringReader(
            "ref\ttext\tgloss\tenglish\nJHN 1:2!1\tοὗτος\t\tthis|one\\\n")).Single());

        Assert.Equal("\\rb οὗτος|thisone\\rb*", ruby);
    }

    [Fact]
    public void Verse_level_notes_end_each_verse_and_chapters_and_verses_are_marked()
    {
        var lines = UsfmBookWriter.Write("JHN", Words()).Split('\n');

        Assert.Equal("\\id JHN Macula Greek SBLGNT", lines[0]);
        Assert.Contains("\\h John", lines);
        Assert.Contains("\\c 1", lines);
        Assert.Contains("\\c 2", lines);
        var verse1 = lines.First(l => l.StartsWith("\\v 1 "));
        Assert.StartsWith("\\v 1 \\rb Ἐν|In [the]\\rb* \\rb ἀρχῇ|beginning\\rb* \\f + \\fr 1:1 \\fk Ἐν \\ft translit: En;", verse1);
        Assert.Equal(2, verse1.Split("\\f + ").Length);
        Assert.EndsWith("english: beginning\\f*", verse1);
        Assert.Contains(lines, l => l.StartsWith("\\v 2 \\rb οὗτος|this \"one\"\\rb*.") && l.EndsWith("\\f*"));
    }

    [Fact]
    public void Word_level_notes_follow_each_word()
    {
        var verse1 = UsfmBookWriter.Write("JHN", Words(), UsfmNoteLevel.Word).Split('\n').First(l => l.StartsWith("\\v 1 "));

        Assert.Equal(2, verse1.Split("\\f + ").Length - 1);
        Assert.StartsWith("\\v 1 \\rb Ἐν|In [the]\\rb*\\f + \\fr 1:1 \\fk Ἐν \\ft translit: En;", verse1);
    }

    [Fact]
    public void Hebrew_rows_use_their_own_transliteration_and_old_testament_numbering()
    {
        var words = MaculaTsvReader.Read(new StringReader(
            "xml:id\tref\ttext\ttransliteration\tafter\tgloss\n" +
            "o1\tHAG 1:1!1\tבִּ\tbi\t\tin\n")).ToList();

        var usfm = UsfmBookWriter.Write("HAG", words);

        Assert.StartsWith("\\id HAG Macula Hebrew WLC", usfm);
        Assert.Contains("translit: bi", usfm);
        Assert.DoesNotContain("transliteration:", usfm);
        Assert.Equal("37-HAG", UsfmBooks.FileStem("HAG"));
    }

    [Fact]
    public void Zip_holds_one_numbered_file_per_book_plus_attribution_files()
    {
        var path = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}.zip");
        var licence = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}.md");
        try
        {
            File.WriteAllText(licence, "CC BY 4.0");
            UsfmPackager.WriteZip(UsfmBookWriter.WriteAll(Words()), path, [("LICENSE-test.md", licence)]);
            using var zip = ZipFile.OpenRead(path);
            Assert.Equal(["44-JHN.usfm", "LICENSE-test.md"], zip.Entries.Select(e => e.FullName));
        }
        finally
        {
            File.Delete(path);
            File.Delete(licence);
        }
    }
}
