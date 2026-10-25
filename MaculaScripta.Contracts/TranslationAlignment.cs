namespace MaculaScripta.Contracts;

public sealed record TranslationAlignment(
    string TargetText,
    IReadOnlyList<string> TargetMaculaIds,
    AlignmentType Type)
{
    public IReadOnlyList<AlternateTranslation> Alternates { get; init; } =
        Array.Empty<AlternateTranslation>();

    public IReadOnlyList<Pronunciation> Pronunciations { get; init; } =
        Array.Empty<Pronunciation>();

    public string? TranslatorNotes { get; init; }

    public IReadOnlyDictionary<string, string> Metadata { get; init; } =
        new Dictionary<string, string>();
}
