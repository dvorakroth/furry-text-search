import { FurryIndex } from "./dist";

type BusLine = {
  routeShortName: string;
  agencyId: number;
  cities: string[];
};

type TransitAgency = {
  agencyId: number;
  agencyName: string;
};

// some example data
const agencies: Record<number, TransitAgency> = {
  1: {
    agencyId: 1,
    agencyName: "Egged",
  },
  2: {
    agencyId: 2,
    agencyName: "Dan",
  },
  3: {
    agencyId: 3,
    agencyName: "Metropoline",
  },
};

const lines: BusLine[] = [
  {
    routeShortName: "74",
    agencyId: 1,
    cities: ["Tel Aviv - Yafo", "Rishon LeZion", "Azor"],
  },
  {
    routeShortName: "201",
    agencyId: 1,
    cities: [
      "Tel Aviv - Yafo",
      "Azor",
      "Rishon LeZion",
      "Rehovot",
      "Nes Ziona",
    ],
  },
  {
    routeShortName: "1",
    agencyId: 2,
    cities: [
      "Bat Yam",
      "Tel Aviv - Yafo",
      "Ramat Gan",
      "Bney Brak",
      "Petah Tikva",
    ],
  },
  {
    routeShortName: "25",
    agencyId: 2,
    cities: ["Holon", "Bat Yam", "Tel Aviv - Yafo"],
  },
  {
    routeShortName: "24",
    agencyId: 3,
    cities: ["Ramat HaSharon", "Tel Aviv - Yafo"],
  },
];

// create an index to search through
const searchIndex = new FurryIndex<BusLine>(
  // the data to search through
  lines,

  // the fields we allow searching through, and their weight in scoring
  [
    {
      get: (line) => line.routeShortName,
      weight: 1,
    },
    {
      get: (line) => agencies[line.agencyId]?.agencyName ?? "",
      weight: 0.1,
    },
    {
      get: (line) => line.cities,
      weight: 0.1,
    },
  ],

  // how to sort search results
  (a, b) => {
    if (a.score === b.score) {
      return a.obj.routeShortName.localeCompare(b.obj.routeShortName);
    } else {
      return a.score - b.score;
    }
  },
);

// run a search:
const result = searchIndex.search(
  // we don't have any cities with "Ramot" in the name,
  // but we DO have cities with "Ramat" in the name!
  ["Ramot"],

  // this threshold value was reached through trial and error sorry :<
  0.35,

  // don't return things that don't match
  false,
);

console.log(result);

// value of result:
[
  {
    furrySearchResult: true,
    isMatch: true,
    idx: 2,
    obj: {
      routeShortName: "1",
      agencyId: 2,
      cities: [
        "Bat Yam",
        "Tel Aviv - Yafo",
        "Ramat Gan",
        "Bney Brak",
        "Petah Tikva",
      ],
    },
    score: 0.8744852722211678,
    matches: [
      [], // no matches in first field (routeShortName)
      [], // no matches in second field (agencyName)
      [
        // matches in third field (cities)
        null, // no matches in first item ("Bat Yam")
        null, // no matches in second item ("Tel Aviv - Yafo")
        [
          // matches in third item ("Ramat Gan")
          [0, 3], // characters 0 through 3 ("Rama")
        ],
      ],
    ],
  },
  {
    furrySearchResult: true,
    isMatch: true,
    idx: 4,
    obj: {
      routeShortName: "24",
      agencyId: 3,
      cities: ["Ramat HaSharon", "Tel Aviv - Yafo"],
    },
    score: 0.8744852722211678,
    matches: [[], [], [[0, 3]]],
  },
];
