import { readFileSync } from "node:fs";

const raw = readFileSync("/home/team/shared/marketing/batch1-posts.md", "utf-8");
const blocks = raw.split(/^## Post \d+:/m).slice(1);

console.log("Blocks:", blocks.length);

for (const block of blocks.slice(0, 2)) {
  // Title
  const titleMatch = block.match(/^\s*"([^"]+)"/m);
  console.log("Title:", titleMatch?.[1] ?? "NOT FOUND");

  // Alt script match
  const altMatch = block.match(
    /### Script \(voiceover\)\s*\n>\s*([\s\S]*?)(?=\n\n)/,
  );
  console.log("AltMatch found:", !!altMatch);
  if (altMatch) {
    console.log("Script:", altMatch[1].substring(0, 150));
  } else {
    // Debug: find voiceover section manually
    const lines = block.split("\n");
    const voIdx = lines.findIndex((l) => l.includes("Script (voiceover)"));
    console.log("VO line index:", voIdx);
    if (voIdx >= 0) {
      for (let j = voIdx; j < Math.min(voIdx + 6, lines.length); j++) {
        console.log(`  [${j}]:`, JSON.stringify(lines[j]));
      }
    }
    // Check what the block looks like around the script area
    const scriptIdx = block.indexOf("Script (voiceover)");
    if (scriptIdx >= 0) {
      console.log(
        "\nContext around script:",
        JSON.stringify(block.substring(scriptIdx, scriptIdx + 300)),
      );
    }
  }
  console.log("---");
}
