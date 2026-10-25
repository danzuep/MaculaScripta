namespace MaculaScripta.Contracts;

public sealed record VerseTranslationOverlay(
    string VerseReference,
    string LanguageCode,
    string TranslationId,
    long Revision,
    ReviewMetadata CurrentReviewStage,
    IReadOnlyList<ReviewMetadata> ReviewHistory,
    IReadOnlyList<TranslationAlignment> Alignments);
