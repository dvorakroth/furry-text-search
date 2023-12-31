// this file is based on src/tools/FuseIndex.js in Fuse JS
// but greatly simplified and with type annotations added

// see: https://github.com/krisk/Fuse

import BitapSearch from "./bitap";
import convertMaskToIndices from "./bitap/convertMaskToIndices";
import { SearchResult } from "./bitap/search";

// TODO allow defining some characters/sequences as identical?
//      (the mot confuses '' and " all the time; and iphone users can
//      only type gershayim on their keyboard usually; so they all need
//      to just be exactly the same)

export class FurryIndex<T> {
    originalObjects: T[];
    keys: FurryKeyDefinition<T>[];
    totalKeyWeight: number;
    sortCompareFunc: FurrySortFunc<T>;

    processedObjects: ProcessedObject[];

    constructor(
        objects: T[],
        keys: FurryKeyDefinition<T>[],
        sortCompareFunc: FurrySortFunc<T>
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
                data: keys.map(({get}) => get(objects[i]!))
            };
        }
    }

    search(patterns: string[], threshold: number, returnExcluded: boolean) {
        const searchers = patterns.map(p => new BitapSearch(p, threshold));
        const numKeys = this.keys.length;

        const result: FurrySearchResult<T>[] = [];

        for (const obj of this.processedObjects) {
            const matches = new Array<SearchResult[]>(numKeys); // matches[keyIndex][valueIndex || 0]
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

                let fieldScore: number|null = null;

                const valueList = Array.isArray(valueRaw) ? valueRaw : [valueRaw];
                
                for (let valueIndex = 0; valueIndex < valueList.length; valueIndex++) {
                    const innerValue = valueList[valueIndex];
                    if (!innerValue) {
                        continue;
                    }

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
                                    matchMask
                                };

                                break; // stop going through more patterns; exact match already found
                            }
                        }
                    } else {
                        for (let patIndex = 0; patIndex < patterns.length; patIndex++) {
                            const newResult = searchers[patIndex]?.searchIn(valueList[valueIndex] ?? "");

                            if (newResult?.isMatch && newResult.matchMask !== undefined) {
                                hasMatchByPattern[patIndex] = true;
                                fieldScore = fieldScore == null ? newResult.score : Math.min(fieldScore, newResult.score);

                                const existingResult = matchesForKey[valueIndex];

                                if (!existingResult?.matchMask) {
                                    matchesForKey[valueIndex] = newResult;
                                } else {
                                    existingResult.score = Math.min(newResult.score, existingResult.score);
                                    for (
                                        let i = 0;
                                        i < Math.max(existingResult.matchMask?.length ?? 0, newResult.matchMask?.length ?? 0);
                                        i++
                                    ) {
                                        existingResult.matchMask[i] =
                                            (existingResult.matchMask[i] || 0)
                                            |
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
                        relativeWeight
                    )
                }
            }

            // so, did this object match at least SOMETHING against each pattern?
            const allPatternsMatched = patterns.reduce<boolean>((p, _, i) => !!(p && hasMatchByPattern[i]), true);
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
                    matches: matches.map(matchesForKey =>
                        matchesForKey?.map?.(matchForValue => 
                            matchForValue ? convertMaskToIndices(matchForValue.matchMask || [], 1) : null
                        )
                    )
                });
            } else if (returnExcluded) {
                result.push({
                    furrySearchResult: true,
                    isMatch: false,
                    idx: obj.index,
                    obj: originalObject,
                    score: Number.MAX_SAFE_INTEGER,
                    matches: null
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
    get: (obj: T) => (string | string[]);
    weight?: number;
    useExactSearch?: boolean;
}

export interface ProcessedObject {
    index: number;
    data: (string | string[])[];
}

export type FurrySearchMatch = [number, number][]|null;

export interface FurrySearchResult<T> {
    furrySearchResult: true,
    isMatch: boolean
    obj: T;
    idx: number;
    score: number;
    matches: FurrySearchMatch[][]|null; // matches[keyIndex][valueIndex || 0]
}

export function isFurrySearchResult<T>(x: any): x is FurrySearchResult<T> {
    return !!x["furrySearchResult"];
}

export type FurrySortFunc<T> = (a: FurrySearchResult<T>, b: FurrySearchResult<T>) => number;