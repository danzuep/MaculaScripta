namespace MaculaScripta.Usfm;

/// <summary>Where the per-word Macula metadata goes in the USFM footnotes.</summary>
public enum UsfmNoteLevel
{
    /// <summary>One footnote at the end of each verse, listing every word's metadata.</summary>
    Verse,

    /// <summary>A footnote straight after each word.</summary>
    Word,
}
