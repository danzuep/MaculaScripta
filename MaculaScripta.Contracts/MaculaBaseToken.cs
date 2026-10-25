namespace MaculaScripta.Contracts;

public sealed record MaculaBaseToken(
    string MaculaId,
    string SurfaceText,
    string Lemma,
    string PartOfSpeech)
{
    public IReadOnlyList<string> LouwNidaDomains { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> SenseKeys { get; init; } = Array.Empty<string>();

    public const string DataAttribution = "Macula Greek dataset (SBLGNT base), CC BY 4.0";

    public string Attribution { get; init; } = DataAttribution;
}
