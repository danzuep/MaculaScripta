using MaculaScripta.Contracts;

namespace MaculaScripta.Core;

public sealed record GlossingRule(string SourceKey, string TargetText);

public sealed record GlossingResult(string? TargetText, IReadOnlyDictionary<string, string> Metadata)
{
    public bool RequiresSenseReview => Metadata.ContainsKey("requires_sense_review");
}

public sealed class GlossingService
{
    public GlossingResult ResolveGloss(
        MaculaBaseToken token,
        IEnumerable<GlossingRule> rules)
    {
        ArgumentNullException.ThrowIfNull(token);
        ArgumentNullException.ThrowIfNull(rules);

        var rulesByKey = rules
            .Where(rule => !string.IsNullOrWhiteSpace(rule.SourceKey))
            .GroupBy(rule => rule.SourceKey, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Select(rule => rule.TargetText)
                .Distinct(StringComparer.Ordinal).ToArray(), StringComparer.Ordinal);

        var matchingGlosses = token.SenseKeys
            .Concat(token.LouwNidaDomains)
            .Where(rulesByKey.ContainsKey)
            .SelectMany(key => rulesByKey[key])
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (matchingGlosses.Length == 1)
        {
            return new GlossingResult(matchingGlosses[0], new Dictionary<string, string>());
        }

        return new GlossingResult(
            null,
            new Dictionary<string, string> { ["requires_sense_review"] = "true" });
    }
}
