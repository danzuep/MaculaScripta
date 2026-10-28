using MaculaScripta.Contracts;

namespace MaculaScripta.Core;

public sealed record LemmaFrequency(string Lemma, int Frequency, int Rank);

public sealed class LemmaFrequencyRanker
{
    public IReadOnlyList<LemmaFrequency> RankTopLemmas(
        IEnumerable<MaculaBaseToken> tokens,
        int topCount = 100)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        ArgumentOutOfRangeException.ThrowIfNegative(topCount);

        return tokens
            .Where(token => !string.IsNullOrWhiteSpace(token.Lemma))
            .GroupBy(token => token.Lemma, StringComparer.Ordinal)
            .Select(group => new { Lemma = group.Key, Frequency = group.Count() })
            .OrderByDescending(item => item.Frequency)
            .ThenBy(item => item.Lemma, StringComparer.Ordinal)
            .Take(topCount)
            .Select((item, index) => new LemmaFrequency(item.Lemma, item.Frequency, index + 1))
            .ToArray();
    }
}
