// Typo-forgiving answer matching. Strategy: normalize hard (case, accents,
// punctuation, spaces), then exact match, then Damerau-Levenshtein within a
// length-scaled budget. Trailing plural s/es is stripped before matching so
// "apples" counts for "apple" without listing plurals as aliases.
const Fuzzy = (() => {
  function normalize(s) {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]/g, '');
  }

  // Edit budget scales with the word: short words must be exact or nearly so,
  // long ones (saintvincentandthegrenadines) earn more slack.
  function budget(len) {
    if (len <= 3) return 0;
    if (len <= 6) return 1;
    if (len <= 11) return 2;
    return 3;
  }

  // Damerau-Levenshtein (adjacent transpositions count as one edit — the most
  // common typo shape) with early exit once the row minimum exceeds max.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const la = a.length, lb = b.length;
    let prev2 = null;
    let prev = Array.from({ length: lb + 1 }, (_, j) => j);
    for (let i = 1; i <= la; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d = Math.min(d, prev2[j - 2] + 1);
        }
        cur[j] = d;
        if (d < rowMin) rowMin = d;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[lb];
  }

  function singulars(n) {
    const forms = [n];
    if (n.endsWith('es') && n.length > 4) forms.push(n.slice(0, -2));
    if (n.endsWith('s') && n.length > 3) forms.push(n.slice(0, -1));
    return forms;
  }

  // entries: [{c: canonical, a: [aliases]}] — returns {entry, exact} or null.
  // Every candidate form of the input is tried against every form of every
  // entry; the closest in-budget entry wins, exact beating fuzzy.
  function match(input, entries) {
    const forms = singulars(normalize(input));
    if (!forms[0]) return null;
    let best = null, bestDist = Infinity;
    for (const entry of entries) {
      const names = [entry.c, ...(entry.a || [])].map(normalize);
      for (const name of names) {
        const b = budget(name.length);
        for (const form of forms) {
          if (form === name) return { entry, exact: true };
          const d = distance(form, name, b);
          if (d <= b && d < bestDist) { bestDist = d; best = entry; }
        }
      }
    }
    return best ? { entry: best, exact: false } : null;
  }

  return { normalize, match };
})();
