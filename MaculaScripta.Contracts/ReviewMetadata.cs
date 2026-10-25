namespace MaculaScripta.Contracts;

public sealed record ReviewMetadata(
    string Stage,
    string ReviewerId,
    string Timestamp,
    string? Notes = null);
