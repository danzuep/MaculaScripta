namespace MaculaScripta.Contracts;

public sealed record TranslationAlignment(
    string Id,
    string TargetText,
    IReadOnlyList<string> TargetMaculaIds,
    AlignmentType AlignmentType)
{
    public IReadOnlyList<AlternateTranslation> Alternates { get; init; } =
        Array.Empty<AlternateTranslation>();

    public IReadOnlyList<Pronunciation> Pronunciations { get; init; } =
        Array.Empty<Pronunciation>();

    public string? TranslatorNotes { get; init; }

    public IReadOnlyDictionary<string, string> CustomMetadata { get; init; } =
        new Dictionary<string, string>();
}
