using MaculaScripta.Contracts;

namespace MaculaScripta.Core;

public sealed class AudioBindingService
{
    public IReadOnlyList<VerseTranslationOverlay> BindLemmaAudio(
        IEnumerable<VerseTranslationOverlay> overlays,
        IReadOnlyDictionary<string, MaculaBaseToken> tokensById,
        string lemma,
        string audioUrl,
        string scheme = "lemma-audio")
    {
        ArgumentNullException.ThrowIfNull(overlays);
        ArgumentNullException.ThrowIfNull(tokensById);
        ArgumentException.ThrowIfNullOrWhiteSpace(lemma);
        ArgumentException.ThrowIfNullOrWhiteSpace(scheme);

        if (!Uri.TryCreate(audioUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("Audio URL must be an absolute HTTP(S) URL.", nameof(audioUrl));
        }

        var matchingIds = tokensById.Values
            .Where(token => string.Equals(token.Lemma, lemma, StringComparison.Ordinal))
            .Select(token => token.MaculaId)
            .ToHashSet(StringComparer.Ordinal);

        return overlays.Select(overlay => overlay with
        {
            Alignments = overlay.Alignments.Select(alignment =>
            {
                if (!alignment.TargetMaculaIds.Any(matchingIds.Contains))
                {
                    return alignment;
                }

                var replacement = new Pronunciation(scheme, string.Empty, uri.AbsoluteUri);
                var pronunciations = alignment.Pronunciations
                    .Where(pronunciation =>
                        !string.Equals(pronunciation.Scheme, scheme, StringComparison.Ordinal))
                    .Append(replacement)
                    .ToArray();

                return alignment with { Pronunciations = pronunciations };
            }).ToArray()
        }).ToArray();
    }
}
