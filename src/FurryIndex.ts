// this file is based on src/tools/FuseIndex.js in Fuse JS
// but greatly simplified and with type annotations added

// see: https://github.com/krisk/Fuse

import { BitapSearch } from "./bitap/BitapSearch";
import convertMaskToIndices from "./bitap/convertMaskToIndices";
import { SearchResult } from "./bitap/search";

// TODO allow defining some characters/sequences as identical?
//      (the mot confuses '' and " all the time; and iphone users can
//      only type gershayim on their keyboard usually; so they all need
//      to just be exactly the same)

export type FurrySearchOptions = {
  /**
   * What is the maximum score allowed before we consider something to be
   * not-found? (passed as an argument to the bitap function)
   *
   * Chef's tip: try something around 0.24-0.35!
   */
  threshold: number;

  /**
   * Should we return objects that didn't match at all? (And have score 1)
   *
   * Default: false
   */
  returnExcluded?: boolean;

  /**
   * After doing the bitap search, multiply an item's score by this number if
   * a match was found in the first 3 characters of the string to be searched
   *
   * null/undefined means this logic is disabled
   *
   * Chef's tip: try a value of 0.2-0.5
   */
  multiplierForMatchCloseToStart?: number | null | undefined;

  /**
   * After doing the bitap search, multiply an item's score by this number if
   * a match was found right after a space character.
   *
   * null/undefined means this logic is disabled
   *
   * I think the same value as `multiplierForMatchCloseToStart` should be ok?
   */
  multiplierForMatchAfterSpace?: number | null | undefined;

  /**
   * When `multiplierForMatchAfterSpace` is not null/undefined, this is the
   * list of characters that count as spaces for our purposes.
   *
   * Default: [' '] (just the regular ascii space)
   */
  spaceCharacters?: string[];

  /**
   * After doing the bitap search, multiply an item's score by this number if
   * the matches were found in vaguely the same order that they're given in.
   *
   * The idea is that when we're told to search ["tel", "aviv"], finding the
   * string "tel" before "aviv" is generally more better than finding the
   * string "aviv" before "tel"
   *
   * null/undefined means this logic is disabled
   *
   * Chef's tip: try 0.1
   */
  multiplierForMatchesInOrder?: number | null | undefined;

  /**
   * What score should we give to exact matches within a larger string?
   *
   * Chef's tip: try 0
   *
   * Default: 0.001 for compatibility-with-older-versions reasons.
   *
   * (if i ever decide to up this thing to 1.0.0, this will be defaulted to 0)
   */
  exactMatchScore?: number | null | undefined;

  /**
   * What score should we give to an exact match that's the entire string?
   *
   * Default: 0
   */
  fullExactMatchScore?: number | null | undefined;
};

const DEFAULT_SPACE_CHARS = [" "];

export class FurryIndex<T> {
  originalObjects: T[];
  keys: FurryKeyDefinition<T>[];
  totalKeyWeight: number;
  sortCompareFunc: FurrySortFunc<T>;

  processedObjects: ProcessedObject[];

  constructor(
    objects: T[],
    keys: FurryKeyDefinition<T>[],
    sortCompareFunc: FurrySortFunc<T>,
  ) {
    this.originalObjects = objects;
    this.keys = keys;
    this.totalKeyWeight = 0;
    this.sortCompareFunc = sortCompareFunc;

    for (const k of keys) {
      this.totalKeyWeight += k.weight || 1;
    }

    this.processedObjects = new Array(objects.length);

    for (let i = 0; i < objects.length; i++) {
      this.processedObjects[i] = {
        index: i,
        data: keys.map(({ get }) => get(objects[i]!)),
      };
    }
  }

  // multiple function signatures for backwards compatibility hopefully!! lol
  search(
    patterns: string[],
    options: FurrySearchOptions,
  ): FurrySearchResult<T>[];
  search(
    patterns: string[],
    threshold: number,
    returnExcluded?: boolean,
  ): FurrySearchResult<T>[];
  search(
    patterns: string[],
    thresholdOrOptions: number | FurrySearchOptions,
    optionalReturnExcluded?: boolean,
  ) {
    const optionsObj =
      typeof thresholdOrOptions === "object"
        ? thresholdOrOptions
        : {
            threshold: thresholdOrOptions,
            returnExcluded: !!optionalReturnExcluded,
          };

    const {
      threshold,
      returnExcluded,
      multiplierForMatchCloseToStart,
      multiplierForMatchAfterSpace,
      multiplierForMatchesInOrder,
    } = optionsObj;
    const shouldRewardMatchesAtStart =
      multiplierForMatchCloseToStart !== null &&
      multiplierForMatchCloseToStart !== undefined;
    const shouldRewardMatchesAfterSpace =
      multiplierForMatchAfterSpace !== null &&
      multiplierForMatchAfterSpace !== undefined;
    const shouldRewardMatchesInOrder =
      multiplierForMatchesInOrder !== null &&
      multiplierForMatchesInOrder !== undefined;

    const fullExactMatchScore = optionsObj.fullExactMatchScore ?? 0;
    const exactMatchScore = optionsObj.exactMatchScore ?? 0.001;

    const spaceCharacters = optionsObj.spaceCharacters ?? DEFAULT_SPACE_CHARS;

    const searchers = patterns.map(
      (p) =>
        new BitapSearch(p, { threshold, exactMatchScore, fullExactMatchScore }),
    );
    const numKeys = this.keys.length;

    const result: FurrySearchResult<T>[] = [];

    for (const obj of this.processedObjects) {
      const matches = new Array<SearchResult[]>(numKeys); // matches[keyIndex][valueIndex || 0]

      // for each pattern, have we found any matches for it?
      const hasMatchByPattern = new Array<boolean>(patterns.length);

      let totalScore = 1;

      for (let keyIndex = 0; keyIndex < numKeys; keyIndex++) {
        const keyDefinition = this.keys[keyIndex];
        if (!keyDefinition) continue;

        const { weight = 1, useExactSearch } = keyDefinition;
        const relativeWeight = weight / this.totalKeyWeight;
        const valueRaw = obj.data[keyIndex];

        if (!valueRaw) {
          continue;
        }

        const matchesForKey = (matches[keyIndex] = matches[keyIndex] || []);

        let fieldScore: number | null = null;

        const valueList = Array.isArray(valueRaw) ? valueRaw : [valueRaw];

        for (let valueIndex = 0; valueIndex < valueList.length; valueIndex++) {
          const innerValue = valueList[valueIndex];
          if (!innerValue) {
            continue;
          }

          // for every pattern+value combo -- at what index was the
          // first match we found?
          const firstMatchIdxByPattern = new Array<number | null>(
            patterns.length,
          );

          if (useExactSearch) {
            for (let patIndex = 0; patIndex < patterns.length; patIndex++) {
              const pattern = patterns[patIndex];
              if (!pattern) continue;

              if (valueList[valueIndex] === pattern) {
                fieldScore = 0;
                hasMatchByPattern[patIndex] = true;

                const matchMask = new Array<undefined | number>(pattern.length);
                for (let i = 0; i < pattern.length; i++) {
                  matchMask[i] = 1;
                }

                matchesForKey[valueIndex] = {
                  isMatch: true,
                  score: 0,
                  matchMask,
                };

                break; // stop going through more patterns; exact match already found
              }
            }
          } else {
            for (let patIndex = 0; patIndex < patterns.length; patIndex++) {
              const newResult = searchers[patIndex]?.searchIn(
                valueList[valueIndex] ?? "",
              );

              if (newResult?.isMatch && newResult.matchMask !== undefined) {
                hasMatchByPattern[patIndex] = true;
                if (
                  shouldRewardMatchesInOrder ||
                  shouldRewardMatchesAfterSpace
                ) {
                  const firstMatchIdx = (firstMatchIdxByPattern[patIndex] =
                    newResult.matchMask.findIndex((b) => !!b));

                  if (
                    shouldRewardMatchesAfterSpace &&
                    spaceCharacters.includes(valueRaw[firstMatchIdx - 1]!)
                  ) {
                    newResult.score *= multiplierForMatchAfterSpace;
                  }
                }

                // if the match is in the first 3 chars of the string, it's probably better than matches that aren't
                if (shouldRewardMatchesAtStart) {
                  if (
                    newResult.matchMask[0] ||
                    newResult.matchMask[1] ||
                    newResult.matchMask[2]
                  ) {
                    newResult.score *= multiplierForMatchCloseToStart;
                  }
                }

                const existingResult = matchesForKey[valueIndex];

                if (!existingResult?.matchMask) {
                  matchesForKey[valueIndex] = newResult;
                  fieldScore = newResult.score;
                } else {
                  if (shouldRewardMatchesInOrder && patIndex > 0) {
                    const previousPatternStart =
                      firstMatchIdxByPattern[patIndex - 1]!;
                    if (
                      firstMatchIdxByPattern[patIndex]! > previousPatternStart
                    ) {
                      // this pattern starts after the previous pattern -- this is generally a good thing
                      // because if we search ["tel", "aviv"], we want to match "tel aviv" higher than "aviv tel"

                      newResult.score *= multiplierForMatchesInOrder;
                    }
                  }

                  existingResult.score = fieldScore = Math.min(
                    newResult.score,
                    existingResult.score,
                  );
                  for (
                    let i = 0;
                    i <
                    Math.max(
                      existingResult.matchMask?.length ?? 0,
                      newResult.matchMask?.length ?? 0,
                    );
                    i++
                  ) {
                    existingResult.matchMask[i] =
                      (existingResult.matchMask[i] || 0) |
                      (newResult.matchMask[i] || 0);
                  }
                }
              }
            }
          }
        }

        // incorporate fieldScore into totalScore?
        if (fieldScore !== null) {
          totalScore *= Math.pow(
            fieldScore === 0 ? Number.EPSILON : fieldScore,
            relativeWeight,
          );
        }
      }

      // so, did this object match at least SOMETHING against each pattern?
      const allPatternsMatched = patterns.reduce<boolean>(
        (p, _, i) => !!(p && hasMatchByPattern[i]),
        true,
      );
      const originalObject = this.originalObjects[obj.index];
      if (!originalObject) continue;

      if (allPatternsMatched) {
        // yes!
        result.push({
          furrySearchResult: true,
          isMatch: true,
          idx: obj.index,
          obj: originalObject,
          score: totalScore,
          matches: matches.map((matchesForKey) =>
            matchesForKey?.map?.((matchForValue) =>
              matchForValue
                ? convertMaskToIndices(matchForValue.matchMask || [], 1)
                : null,
            ),
          ),
        });
      } else if (returnExcluded) {
        result.push({
          furrySearchResult: true,
          isMatch: false,
          idx: obj.index,
          obj: originalObject,
          score: Number.MAX_SAFE_INTEGER,
          matches: null,
        });
      }
    }

    if (this.sortCompareFunc) {
      result.sort(this.sortCompareFunc);
    }

    return result;
  }
}

export interface FurryKeyDefinition<T> {
  get: (obj: T) => string | string[];
  weight?: number;
  useExactSearch?: boolean;
}

export interface ProcessedObject {
  index: number;
  data: (string | string[])[];
}

export type FurrySearchMatch = [number, number][] | null;

export interface FurrySearchResult<T> {
  furrySearchResult: true;
  isMatch: boolean;
  obj: T;
  idx: number;
  score: number;
  matches: FurrySearchMatch[][] | null; // matches[keyIndex][valueIndex || 0]
}

export function isFurrySearchResult<T>(x: any): x is FurrySearchResult<T> {
  return !!x["furrySearchResult"];
}

export type FurrySortFunc<T> = (
  a: FurrySearchResult<T>,
  b: FurrySearchResult<T>,
) => number;
