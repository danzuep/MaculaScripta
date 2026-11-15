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
    public void Word_is_plain_gloss_ruby()
    {
        Assert.Equal("\\rb Ἐν|In [the]\\rb*", UsfmWordWriter.WriteRuby(Words()[0]));
    }

    [Fact]
    public void Word_without_gloss_falls_back_to_english_and_strips_markup_characters()
    {
        var ruby = UsfmWordWriter.WriteRuby(MaculaTsvReader.Read(new StringReader(
            "ref\ttext\tgloss\tenglish\nJHN 1:2!1\tοὗτος\t\tthis|one\\\n")).Single());

        Assert.Equal("\\rb οὗτος|thisone\\rb*", ruby);
    }

    [Fact]
    public void Textless_word_has_no_empty_ruby()
    {
        var word = MaculaTsvReader.Read(new StringReader(
            "xml:id\tref\ttext\tgloss\no9\tHAG 1:1!1\t\tthe\n")).Single();

        Assert.Equal("", UsfmWordWriter.WriteRuby(word));
    }

    [Fact]
    public void Chapters_and_verses_are_marked_and_only_the_gloss_is_kept()
    {
        var usfm = UsfmBookWriter.Write("JHN", Words());
        var lines = usfm.Split('\n');

        Assert.Equal("\\id JHN Macula Greek SBLGNT", lines[0]);
        Assert.Contains("\\h John", lines);
        Assert.Contains("\\c 1", lines);
        Assert.Contains("\\c 2", lines);
        Assert.Contains("\\v 1 \\rb Ἐν|In [the]\\rb* \\rb ἀρχῇ|beginning\\rb*", lines);
        Assert.Contains("\\v 2 \\rb οὗτος|this \"one\"\\rb*.", lines);
        Assert.DoesNotContain("\\f", usfm);
        Assert.DoesNotContain("translit", usfm);
    }

    [Fact]
    public void Hebrew_rows_use_their_own_transliteration_and_old_testament_numbering()
    {
        var words = MaculaTsvReader.Read(new StringReader(
            "xml:id\tref\ttext\ttransliteration\tafter\tgloss\n" +
            "o1\tHAG 1:1!1\tבִּ\tbi\t\tin\n")).ToList();

        var usfm = UsfmBookWriter.Write("HAG", words);

        Assert.StartsWith("\\id HAG Macula Hebrew WLC", usfm);
        Assert.Contains("\\rb בִּ|in\\rb*", usfm);
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
