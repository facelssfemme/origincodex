// Scoring logic for Starseed Origin Quiz
// Maps answers to 8 archetypes with weighted point system

export type Archetype =
  | "Sirian"
  | "Pleiadian"
  | "Arcturian"
  | "Lyran"
  | "Andromedan"
  | "Orion"
  | "Earth Angel"
  | "Angelic Realm";

export interface QuizAnswers {
  name: string;
  birthMonth: number;
  birthDay: number;
  belonging: number; // 0=Yes, 1=Sometimes, 2=No
  intensity: number; // 0=Often, 1=Rarely, 2=Never
  nightSky: number; // 0=Deeply at home, 1=Curious but distant, 2=Awestruck but small
  dreams: number; // 0=All the time, 1=Occasionally, 2=Rarely
  recharge: number; // 0=Nature alone, 1=With close people, 2=Creative flow
}

export interface QuizResult {
  primaryArchetype: Archetype;
  secondaryArchetype: Archetype;
  sunSign: string;
  scores: Record<Archetype, number>;
}

// Each question option maps to +points for specific archetypes
// Points per archetype per answer index
const belongingScores: Record<Archetype, number[]> = {
  Sirian: [3, 1, 0],
  Pleiadian: [1, 3, 0],
  Arcturian: [2, 2, 0],
  Lyran: [2, 1, 1],
  Andromedan: [1, 2, 1],
  Orion: [3, 0, 1],
  "Earth Angel": [2, 3, 2],
  "Angelic Realm": [3, 2, 1],
};

const intensityScores: Record<Archetype, number[]> = {
  Sirian: [3, 1, 0],
  Pleiadian: [0, 2, 2],
  Arcturian: [2, 2, 1],
  Lyran: [3, 1, 0],
  Andromedan: [1, 2, 1],
  Orion: [3, 1, 0],
  "Earth Angel": [0, 2, 3],
  "Angelic Realm": [1, 2, 2],
};

const nightSkyScores: Record<Archetype, number[]> = {
  Sirian: [3, 1, 0],
  Pleiadian: [3, 1, 0],
  Arcturian: [2, 2, 1],
  Lyran: [0, 2, 2],
  Andromedan: [2, 3, 0],
  Orion: [1, 1, 3],
  "Earth Angel": [0, 3, 2],
  "Angelic Realm": [1, 3, 1],
};

const dreamsScores: Record<Archetype, number[]> = {
  Sirian: [2, 2, 0],
  Pleiadian: [3, 1, 0],
  Arcturian: [3, 1, 0],
  Lyran: [0, 2, 2],
  Andromedan: [2, 2, 1],
  Orion: [1, 2, 2],
  "Earth Angel": [2, 2, 1],
  "Angelic Realm": [3, 1, 0],
};

const rechargeScores: Record<Archetype, number[]> = {
  Sirian: [3, 0, 1],
  Pleiadian: [1, 3, 1],
  Arcturian: [3, 0, 2],
  Lyran: [0, 2, 3],
  Andromedan: [2, 1, 2],
  Orion: [1, 0, 3],
  "Earth Angel": [3, 3, 0],
  "Angelic Realm": [2, 1, 2],
};

const allArchetypes: Archetype[] = [
  "Sirian",
  "Pleiadian",
  "Arcturian",
  "Lyran",
  "Andromedan",
  "Orion",
  "Earth Angel",
  "Angelic Realm",
];

// Sun sign calculation from month and day
function getSunSign(month: number, day: number): string {
  const signs = [
    { name: "Capricorn", start: [12, 22], end: [1, 19] },
    { name: "Aquarius", start: [1, 20], end: [2, 18] },
    { name: "Pisces", start: [2, 19], end: [3, 20] },
    { name: "Aries", start: [3, 21], end: [4, 19] },
    { name: "Taurus", start: [4, 20], end: [5, 20] },
    { name: "Gemini", start: [5, 21], end: [6, 20] },
    { name: "Cancer", start: [6, 21], end: [7, 22] },
    { name: "Leo", start: [7, 23], end: [8, 22] },
    { name: "Virgo", start: [8, 23], end: [9, 22] },
    { name: "Libra", start: [9, 23], end: [10, 22] },
    { name: "Scorpio", start: [10, 23], end: [11, 21] },
    { name: "Sagittarius", start: [11, 22], end: [12, 21] },
  ];

  for (const sign of signs) {
    if (
      (month === sign.start[0] && day >= sign.start[1]) ||
      (month === sign.end[0] && day <= sign.end[1])
    ) {
      return sign.name;
    }
  }
  return "Unknown";
}

export function scoreQuiz(answers: QuizAnswers): QuizResult {
  const scores: Record<Archetype, number> = {
    Sirian: 0,
    Pleiadian: 0,
    Arcturian: 0,
    Lyran: 0,
    Andromedan: 0,
    Orion: 0,
    "Earth Angel": 0,
    "Angelic Realm": 0,
  };

  // Accumulate points from each question
  for (const arch of allArchetypes) {
    scores[arch] += belongingScores[arch][answers.belonging];
    scores[arch] += intensityScores[arch][answers.intensity];
    scores[arch] += nightSkyScores[arch][answers.nightSky];
    scores[arch] += dreamsScores[arch][answers.dreams];
    scores[arch] += rechargeScores[arch][answers.recharge];
  }

  // Sort by score descending
  const sorted = [...allArchetypes].sort((a, b) => scores[b] - scores[a]);

  return {
    primaryArchetype: sorted[0],
    secondaryArchetype: sorted[1],
    sunSign: getSunSign(answers.birthMonth, answers.birthDay),
    scores,
  };
}

// Archetype descriptions for the teaser reveal
export const archetypeDescriptions: Record<Archetype, string> = {
  Sirian:
    "Sirians carry the frequency of ancient wisdom and divine order. Your energy feels old — older than this lifetime. You came here with a mission, even if you don't remember it yet. Your soul has served on councils of light across galaxies.",
  Pleiadian:
    "Pleiadians vibrate with nurturing love and artistic creation. You're a healer by nature, often drawn to beauty, harmony, and helping others remember their worth. Your presence soothes the chaotic energies around you.",
  Arcturian:
    "Arcturians are highly evolved, intellectual beings of crystalline light. You see through illusion quickly and have a natural gift for quantum thinking and energy healing. You came here to help raise the collective frequency.",
  Lyran:
    "Lyrans are the original starseed warriors — lion-hearted, fiercely loyal, and deeply protective. You carry the courage of ancient feline civilizations. You're here to stand for truth and protect the vulnerable.",
  Andromedan:
    "Andromedans are explorers of consciousness and technology. You're deeply curious, slightly detached, and see the universe as a grand experiment. Your energy bridges dimensions — you're a natural channel for cosmic information.",
  Orion:
    "Orion energy is intense, magnetic, and transformative. You've known conflict and redemption across lifetimes. You're here to transmute darkness into light and to teach others the power of choice.",
  "Earth Angel":
    "You carry an unusually pure light — so bright it sometimes feels heavy. Earth Angels incarnated specifically to bring compassion and gentle healing to this world. You feel others' pain as your own and exist to ease suffering.",
  "Angelic Realm":
    "You carry the vibration of pure divine source. Your presence is felt before you enter a room. You maintain a deep soul connection to the celestial realms and often act as a living bridge between heaven and earth.",
};

// Archetype star system references for teaser
export const archetypeStars: Record<Archetype, string> = {
  Sirian: "Sirius",
  Pleiadian: "the Pleiades",
  Arcturian: "Arcturus",
  Lyran: "Lyra",
  Andromedan: "Andromeda",
  Orion: "Orion",
  "Earth Angel": "Earth's angelic realms",
  "Angelic Realm": "the Celestial Throne",
};