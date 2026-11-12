// ISO 843 / ELOT 743 style transliteration adapted to biblical (polytonic) Greek: η→ē, ω→ō, φ→ph, rough breathing→h,
// iota subscript→i, γ before a velar→n, and υ→u in diphthongs (au, eu, ēu, ou, ui). Accents are dropped.
// A classic script shared by the reader (reader.js) and the audio page (an ES module reads globalThis.MaculaGreek).
(() => {
  const greekLetters = { α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "ē", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "ph", χ: "ch", ψ: "ps", ω: "ō" };
  const greekVowels = "αεηιουω";
  const greekDiphthongs = new Set(["αι", "ει", "οι", "υι", "αυ", "ευ", "ηυ", "ου"]);
  const transliterateGreek = (text) => {
    const clusters = [...text.normalize("NFD").matchAll(/(.)([\u0300-\u036f]*)/gsu)].map(([, letter, marks]) => ({
      raw: letter,
      base: letter.toLowerCase(),
      upper: letter !== letter.toLowerCase(),
      rough: marks.includes("\u0314"),
      diaeresis: marks.includes("\u0308"),
      iotaSubscript: marks.includes("\u0345")
    }));
    const isLetter = (cluster) => cluster !== undefined && cluster.base in greekLetters;
    let out = "";
    clusters.forEach((cluster, i) => {
      const previous = clusters[i - 1];
      const next = clusters[i + 1];
      if (!isLetter(cluster)) { out += cluster.raw; return; }
      const wordStart = !isLetter(previous);
      const pair = isLetter(next) && !cluster.diaeresis && !next.diaeresis ? cluster.base + next.base : "";
      let latin = greekLetters[cluster.base];
      if (cluster.base === "υ") {
        const afterVowel = isLetter(previous) && "αεηο".includes(previous.base) && !cluster.diaeresis;
        const beforeIota = next?.base === "ι" && !next.diaeresis;
        if (afterVowel || beforeIota) latin = "u";
      } else if (cluster.base === "γ" && next && "γκξχ".includes(next.base)) {
        latin = "n";
      }
      if (cluster.iotaSubscript) latin += "i";
      let breathing = "";
      if (wordStart && greekVowels.includes(cluster.base) && (cluster.rough || (greekDiphthongs.has(pair) && next.rough))) breathing = "h";
      else if (wordStart && cluster.base === "ρ" && cluster.rough) latin += "h";
      if (cluster.upper) {
        if (breathing) breathing = "H"; else latin = latin[0].toUpperCase() + latin.slice(1);
      }
      out += breathing + latin;
    });
    return out.normalize("NFC");
  };
  globalThis.MaculaGreek = { transliterateGreek };
})();
