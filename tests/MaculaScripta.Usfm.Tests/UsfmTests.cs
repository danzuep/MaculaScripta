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
    public void Word_wraps_gloss_ruby_inside_w_and_keeps_other_columns_as_attributes()
    {
        var usfm = UsfmWordWriter.Write(Words()[0]);

        Assert.Equal(
            "\\w \\+rb Ἐν|In [the]\\+rb*|x-xml-id=\"n1\" x-class=\"prep\" lemma=\"ἐν\" strong=\"1722\" x-morph=\"PREP\" x-english=\"in\" x-translit=\"En\"\\w*",
            usfm);
    }

    [Fact]
    public void Word_without_gloss_falls_back_to_english_and_escapes_quotes()
    {
        var usfm = UsfmWordWriter.Write(Words()[2]);

        Assert.Contains("\\+rb οὗτος|this \"one\"\\+rb*", usfm);
        Assert.DoesNotContain("lemma=", usfm);
    }

    [Fact]
    public void Book_has_header_chapters_verses_and_trailing_punctuation()
    {
        var book = UsfmBookWriter.Write("JHN", Words());
        var lines = book.Split('\n');

        Assert.Equal("\\id JHN Macula Greek SBLGNT", lines[0]);
        Assert.Contains("\\h John", lines);
        Assert.Contains("\\c 1", lines);
        Assert.Contains("\\c 2", lines);
        Assert.Contains(lines, l => l.StartsWith("\\v 1 \\w ") && l.EndsWith("\\w* \\w \\+rb ἀρχῇ|beginning\\+rb*|x-xml-id=\"n2\" x-class=\"noun\" lemma=\"ἀρχή\" strong=\"746\" x-morph=\"N-DSF\" x-english=\"beginning\" x-translit=\"archēi\"\\w*"));
        Assert.Contains(lines, l => l.StartsWith("\\v 2 ") && l.EndsWith("\\w*."));
    }

    [Fact]
    public void Hebrew_rows_use_their_own_transliteration_and_old_testament_numbering()
    {
        var words = MaculaTsvReader.Read(new StringReader(
            "xml:id\tref\ttext\ttransliteration\tafter\tgloss\n" +
            "o1\tHAG 1:1!1\tבִּ\tbi\t\tin\n")).ToList();

        var usfm = UsfmBookWriter.Write("HAG", words);

        Assert.StartsWith("\\id HAG Macula Hebrew WLC", usfm);
        Assert.Contains("x-translit=\"bi\"", usfm);
        Assert.DoesNotContain("x-transliteration", usfm);
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
