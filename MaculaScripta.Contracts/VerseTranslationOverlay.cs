namespace MaculaScripta.Contracts;

public sealed record VerseTranslationOverlay(
    string VerseReference,
    string LanguageCode,
    string TranslationId,
    int RevisionNumber,
    string ActiveReviewStage,
    IReadOnlyList<ReviewMetadata> ReviewHistory,
    IReadOnlyList<TranslationAlignment> Alignments);
