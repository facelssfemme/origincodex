const archetypes = [
  "Sirian",
  "Pleiadian",
  "Arcturian",
  "Lyran",
  "Andromedan",
  "Orion",
  "Earth Angel",
  "Angelic Realm",
];
/** Public summary only: never accept a private URL, name, reading, or capability. */
export function readingShare(
  paid: boolean,
  hasReading: boolean,
  archetype: string,
) {
  if (!paid || !hasReading || !archetypes.includes(archetype)) return null;
  return {
    title: "My Origin Codex reflection",
    text: `My Origin Codex reflection is ${archetype}. Explore your own archetype with Syrena, an AI guide for entertainment and self-reflection.`,
    url: "https://syrenacodex.com/",
  };
}
