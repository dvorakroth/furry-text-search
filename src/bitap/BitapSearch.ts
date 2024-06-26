// this file is based on src/search/bitap/index.js in Fuse JS but simplified
// and with type annotations added

// see: https://github.com/krisk/Fuse

import search, { SearchResult, MAX_BITS } from "./search";

interface PatternChunk {
  subpattern: string;
  alphabet: { [char: string]: number };
  startIndex: number;
}

export interface BitapSearchOptions {
  threshold: number;
  exactMatchScore: number;
  fullExactMatchScore: number;
}

export class BitapSearch {
  pattern: string;
  chunks: PatternChunk[];
  options: BitapSearchOptions;

  constructor(pattern: string, options: BitapSearchOptions) {
    this.pattern = pattern;
    this.chunks = [];
    this.options = { ...options };

    for (let i = 0; i < pattern.length; i += MAX_BITS) {
      const subpattern = pattern.substring(i, i + MAX_BITS);

      this.chunks.push({
        subpattern,
        alphabet: createPatternAlphabet(subpattern),
        startIndex: i,
      });
    }
  }

  searchIn(text: string): SearchResult {
    if (!text) {
      return {
        isMatch: false,
        score: 1,
        matchMask: [],
      };
    }

    if (this.pattern === text) {
      const matchMask = new Array(this.pattern.length);
      for (let i = 0; i < matchMask.length; i++) {
        matchMask[i] = 1;
      }

      // Exact match
      return {
        isMatch: true,
        score: this.options.fullExactMatchScore,
        matchMask,
      };
    }

    // Otherwise, use Bitap algorithm

    let allMatchMasks: (undefined | number)[] = [];
    let totalScore = 0;
    let hasMatches = false;

    // TODO?: make the bitap search go over all chunks at once isntead of this kludge:
    for (const { subpattern, alphabet } of this.chunks) {
      const { isMatch, score, matchMask } = search(
        text,
        subpattern,
        alphabet,
        this.options.threshold,
        this.options.exactMatchScore,
      );

      if (isMatch) {
        hasMatches = true;

        for (
          let i = 0;
          i < Math.max(allMatchMasks.length, matchMask?.length ?? 0);
          i++
        ) {
          allMatchMasks[i] = (allMatchMasks[i] || 0) | (matchMask?.[i] || 0);
        }
      } else {
        // because we're ANDing all of the patterns, then a single non-match
        // should stop the entire search
        return {
          isMatch: false,
          score: 1,
          matchMask: undefined,
        };
      }

      totalScore += score;
    }

    if (hasMatches) {
      return {
        isMatch: true,
        score: totalScore / this.chunks.length,
        matchMask: allMatchMasks,
      };
    } else {
      return {
        isMatch: false,
        score: 1,
        matchMask: undefined,
      };
    }
  }
}

function createPatternAlphabet(pattern: string) {
  let mask: { [char: string]: number } = {};

  for (let i = 0, len = pattern.length; i < len; i += 1) {
    const char = pattern.charAt(i);
    mask[char] = (mask[char] || 0) | (1 << (len - i - 1));
  }

  return mask;
}
