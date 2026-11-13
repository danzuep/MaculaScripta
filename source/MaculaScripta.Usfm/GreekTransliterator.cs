using System.Text;

namespace MaculaScripta.Usfm;

/// <summary>
/// C# port of site/static/greek-translit.js (ISO 843 / ELOT 743 style, adapted to biblical Greek). Keep the two in sync.
/// </summary>
public static class GreekTransliterator
{
    private static readonly Dictionary<char, string> Letters = new()
    {
        ['α'] = "a", ['β'] = "b", ['γ'] = "g", ['δ'] = "d", ['ε'] = "e", ['ζ'] = "z", ['η'] = "ē", ['θ'] = "th",
        ['ι'] = "i", ['κ'] = "k", ['λ'] = "l", ['μ'] = "m", ['ν'] = "n", ['ξ'] = "x", ['ο'] = "o", ['π'] = "p",
        ['ρ'] = "r", ['σ'] = "s", ['ς'] = "s", ['τ'] = "t", ['υ'] = "y", ['φ'] = "ph", ['χ'] = "ch", ['ψ'] = "ps",
        ['ω'] = "ō",
    };

    private const string Vowels = "αεηιουω";
    private static readonly HashSet<string> Diphthongs = ["αι", "ει", "οι", "υι", "αυ", "ευ", "ηυ", "ου"];

    private readonly record struct Cluster(char Raw, char Base, bool Upper, bool Rough, bool Diaeresis, bool IotaSubscript);

    public static string Transliterate(string text)
    {
        var clusters = Split(text.Normalize(NormalizationForm.FormD));
        var output = new StringBuilder();

        for (var i = 0; i < clusters.Count; i++)
        {
            var cluster = clusters[i];
            Cluster? previous = i > 0 ? clusters[i - 1] : null;
            Cluster? next = i + 1 < clusters.Count ? clusters[i + 1] : null;

            if (!IsLetter(cluster))
            {
                output.Append(cluster.Raw);
                continue;
            }

            var wordStart = !IsLetter(previous);
            var pair = IsLetter(next) && !cluster.Diaeresis && !next!.Value.Diaeresis
                ? $"{cluster.Base}{next.Value.Base}"
                : "";
            var latin = Letters[cluster.Base];

            if (cluster.Base == 'υ')
            {
                var afterVowel = IsLetter(previous) && "αεηο".Contains(previous!.Value.Base) && !cluster.Diaeresis;
                var beforeIota = next is { Base: 'ι', Diaeresis: false };
                if (afterVowel || beforeIota)
                {
                    latin = "u";
                }
            }
            else if (cluster.Base == 'γ' && next is not null && "γκξχ".Contains(next.Value.Base))
            {
                latin = "n";
            }

            if (cluster.IotaSubscript)
            {
                latin += "i";
            }

            var breathing = "";
            if (wordStart && Vowels.Contains(cluster.Base) && (cluster.Rough || (Diphthongs.Contains(pair) && next!.Value.Rough)))
            {
                breathing = "h";
            }
            else if (wordStart && cluster.Base == 'ρ' && cluster.Rough)
            {
                latin += "h";
            }

            if (cluster.Upper)
            {
                if (breathing.Length > 0)
                {
                    breathing = "H";
                }
                else
                {
                    latin = char.ToUpperInvariant(latin[0]) + latin[1..];
                }
            }

            output.Append(breathing).Append(latin);
        }

        return output.ToString().Normalize(NormalizationForm.FormC);
    }

    private static bool IsLetter(Cluster? cluster) => cluster is { } c && Letters.ContainsKey(c.Base);

    private static List<Cluster> Split(string decomposed)
    {
        var clusters = new List<Cluster>();
        for (var i = 0; i < decomposed.Length; i++)
        {
            var letter = decomposed[i];
            bool rough = false, diaeresis = false, iotaSubscript = false;
            while (i + 1 < decomposed.Length && decomposed[i + 1] is >= '\u0300' and <= '\u036f')
            {
                var mark = decomposed[++i];
                rough |= mark == '\u0314';
                diaeresis |= mark == '\u0308';
                iotaSubscript |= mark == '\u0345';
            }

            var lower = char.ToLowerInvariant(letter);
            clusters.Add(new Cluster(letter, lower, letter != lower, rough, diaeresis, iotaSubscript));
        }

        return clusters;
    }
}
