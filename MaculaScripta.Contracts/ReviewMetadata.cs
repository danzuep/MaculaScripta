namespace MaculaScripta.Contracts;

public sealed record ReviewMetadata(
    string Stage,
    string ReviewerId,
    DateTimeOffset Timestamp,
    string? SignOffNotes = null);
