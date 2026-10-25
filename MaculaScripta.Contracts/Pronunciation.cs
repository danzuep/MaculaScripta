namespace MaculaScripta.Contracts;

public sealed record Pronunciation(string Scheme, string PhoneticText, string? AudioUrl = null)
{
    public IReadOnlyDictionary<string, string> CustomAttributes { get; init; } =
        new Dictionary<string, string>();
}
