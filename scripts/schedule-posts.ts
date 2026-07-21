/**
 * schedule-posts.ts
 * Step 2: Upload generated HeyGen videos to Blotato with Hormozi-style captions and schedule them.
 *
 * Usage: cd /home/team/shared/site && bun run scripts/schedule-posts.ts
 */

import { readFileSync, appendFileSync, writeFileSync } from "node:fs";

// ── Config from env ──────────────────────────────────────────────
const BLOTATO_API_KEY = process.env.BLOTATO_API_KEY!;
const BLOTATO_BASE = "https://my.blotato.com/api";

const VIDEOS_MD = "/home/team/shared/marketing/videos.md";
const CALENDAR_MD = "/home/team/shared/marketing/week-1-calendar.md";
const BATCH1_MD = "/home/team/shared/marketing/batch1-posts.md";
const LOG_FILE = "/home/team/shared/marketing/pipeline-log.md";

// ── Logging ───────────────────────────────────────────────────────
function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

// ── Parse videos.md ────────────────────────────────────────────────
interface VideoResult {
  index: number;
  title: string;
  videoId: string | null;
  videoUrl: string | null;
}

function parseVideos(md: string): VideoResult[] {
  const results: VideoResult[] = [];
  const lines = md.split("\n");
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith("| # |")) { inTable = true; continue; }
    if (line.startsWith("|---")) continue;
    if (!inTable) continue;

    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 4 && /^\d+$/.test(cols[0])) {
      const idx = parseInt(cols[0]) - 1;
      const title = cols[1];
      const videoId = cols[2] === "❌" ? null : cols[2];
      const videoUrl = cols[3] === "❌" ? null : cols[3];
      results.push({ index: idx, title, videoId, videoUrl });
    }
  }

  return results;
}

// ── Parse week-1-calendar.md for batch1 schedule ──────────────────
interface ScheduleEntry {
  postNum: number;
  day: string;
  timeET: string;
  postType: string;
  content: string;
}

function parseCalendarForBatch1(md: string): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  const lines = md.split("\n");

  for (const line of lines) {
    // Look for lines like: | 1 | 7:30 AM | Storytelling | **"The Quiet Ache"** (Batch 1, Post 1) |
    const match = line.match(/^\|\s*(\d+)\s*\|.*?\|\s*(.+?)\s*\|.*?\(Batch 1,\s*Post\s*(\d+)\)/);
    if (match) {
      const postNum = parseInt(match[3]);
      const timeET = match[2].replace(/\*\*/g, "").trim();
      // Try to get day from previous heading
      entries.push({
        postNum,
        day: "",
        timeET,
        postType: "",
        content: match[0],
      });
    }
  }

  // Re-parse to add day context
  let currentDay = "";
  for (const line of lines) {
    const dayMatch = line.match(/^## Day (\d+):/);
    if (dayMatch) {
      currentDay = `Day ${dayMatch[1]}`;
    }
    const match = line.match(/^\|\s*(\d+)\s*\|.*?\|\s*(.+?)\s*\|.*?\(Batch 1,\s*Post\s*(\d+)\)/);
    if (match) {
      const entry = entries.find((e) => e.postNum === parseInt(match[3]));
      if (entry) entry.day = currentDay;
    }
  }

  return entries;
}

// ── Parse batch1-posts.md for scripts and accent words ────────────
interface PostWithAccents {
  index: number;
  title: string;
  script: string;
  accentWords: string[];
}

function parseBatch1ForAccents(md: string): PostWithAccents[] {
  const posts: PostWithAccents[] = [];
  const sections = md.split(/^## Post \d+:/m);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const titleMatch = section.match(/"([^"]+)"/);
    const title = titleMatch ? titleMatch[1] : `Post ${i}`;

    const scriptMatch = section.match(/### Script \(voiceover\)\s*\n>\s*(.+?)(?:\n\n|\n###|\n\*\*Goal|\n\*\*CTA)/s);
    let script = scriptMatch ? scriptMatch[1].trim() : "";
    script = script.replace(/^>\s*/gm, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();

    // Determine accent words (1-2 per sentence) based on emotional weight
    // The accent words are words that carry emotional punch - typically adjectives, key nouns, emotional verbs
    const accentWords = getAccentWords(script, i - 1);

    posts.push({ index: i - 1, title, script, accentWords });
  }

  return posts;
}

function getAccentWords(script: string, postIndex: number): string[] {
  // Per-post curated accent words that map to Hormozi-style highlighting
  const accentMaps: Record<number, string[]> = {
    0: ["quiet ache", "not a flaw", "clue", "star system", "Welcome home"],       // Post 1: The Quiet Ache
    1: ["completely different", "exactly one", "Which one"],                        // Post 2: The 8 Origins
    2: ["rarest", "ancient predator", "fiercely protective", "rage", "guard"],      // Post 3: Lyran
    3: ["cried", "secrets", "drained", "searched", "not broken", "starseed"],       // Post 4: If This Is You
    4: ["gift", "weight", "mission", "see through every lie", "drowning"],          // Post 5: Hardest to Be
  };

  return accentMaps[postIndex] || [];
}

// ── Build Hormozi-style caption JSON ──────────────────────────────
function buildCaptions(script: string, accentWords: string[]): object[] {
  const words = script.split(/\s+/);
  const captions: object[] = [];

  for (const word of words) {
    const cleanWord = word.replace(/[.,!?;:'"]/g, "");
    const isAccent = accentWords.some((aw) => {
      const awLower = aw.toLowerCase();
      const cleanLower = cleanWord.toLowerCase();
      return cleanLower === awLower || awLower.includes(cleanLower) || cleanLower.includes(awLower);
    });

    captions.push({
      word,
      color: isAccent ? "#FFD700" : "#FFFFFF",
      bold: isAccent,
    });
  }

  return captions;
}

// ── Blotato API: Upload video with captions ────────────────────────
async function uploadToBlotato(
  videoUrl: string,
  post: PostWithAccents,
  schedule: ScheduleEntry | undefined
): Promise<boolean> {
  const captions = buildCaptions(post.script, post.accentWords);

  // Try multiple Blotato API endpoint patterns
  const endpoints = [
    { url: `${BLOTATO_BASE}/v1/posts`, method: "POST" },
    { url: `${BLOTATO_BASE}/posts`, method: "POST" },
    { url: `${BLOTATO_BASE}/v1/videos`, method: "POST" },
    { url: `${BLOTATO_BASE}/v1/content`, method: "POST" },
  ];

  const payload = {
    title: post.title,
    video_url: videoUrl,
    platform: "tiktok",
    captions: {
      style: "hormozi",
      words: captions,
      font: "bold",
    },
    schedule: schedule
      ? {
          time: schedule.timeET,
          day: schedule.day,
        }
      : undefined,
    template: "talking_head",
    hashtags: ["#starseed", "#spiritualtiktok", "#lightworker", "#starseedawakening"],
    caption: post.script.slice(0, 150),
  };

  for (const endpoint of endpoints) {
    try {
      log(`   Trying ${endpoint.method} ${endpoint.url}...`);
      const res = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: {
          Authorization: `Bearer ${BLOTATO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      log(`   Response (${res.status}): ${text.slice(0, 200)}`);

      if (res.ok) {
        log(`   ✅ Uploaded to Blotato via ${endpoint.url}`);
        return true;
      }
    } catch (err: any) {
      log(`   ⚠️  ${endpoint.url}: ${err.message}`);
    }
  }

  log(`   ❌ All Blotato endpoints failed for post "${post.title}"`);
  return false;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  log("\n📋 Starting Blotato scheduling pipeline");

  // Parse all input files
  let videosMd: string;
  let calendarMd: string;
  let batch1Md: string;

  try {
    videosMd = readFileSync(VIDEOS_MD, "utf-8");
    calendarMd = readFileSync(CALENDAR_MD, "utf-8");
    batch1Md = readFileSync(BATCH1_MD, "utf-8");
  } catch (err: any) {
    log(`❌ Failed to read input files: ${err.message}`);
    log(`   Ensure videos.md exists (run generate-videos.ts first)`);
    return;
  }

  const videos = parseVideos(videosMd);
  const schedule = parseCalendarForBatch1(calendarMd);
  const posts = parseBatch1ForAccents(batch1Md);

  log(`📊 Videos found: ${videos.length}`);
  log(`📊 Schedule entries: ${schedule.length}`);
  log(`📊 Posts with accents: ${posts.length}`);

  // Match videos to posts and schedule
  const successfullyUploaded: string[] = [];
  const failed: string[] = [];

  for (const video of videos) {
    if (!video.videoUrl) {
      log(`\n⏭️  Skipping Post ${video.index + 1} — no video URL`);
      failed.push(`Post ${video.index + 1}: No video URL`);
      continue;
    }

    const post = posts.find((p) => p.index === video.index);
    if (!post) {
      log(`\n⚠️  Post ${video.index + 1}: No script data found`);
      failed.push(`Post ${video.index + 1}: No script`);
      continue;
    }

    const sched = schedule.find((s) => s.postNum === video.index + 1);
    const scheduleInfo = sched ? `${sched.day} @ ${sched.timeET}` : "unscheduled";

    log(`\n📤 Post ${video.index + 1}: "${post.title}" → ${scheduleInfo}`);
    log(`   Accent words: ${post.accentWords.join(", ")}`);

    const success = await uploadToBlotato(video.videoUrl, post, sched);
    if (success) {
      successfullyUploaded.push(`Post ${video.index + 1}: ${post.title}`);
    } else {
      failed.push(`Post ${video.index + 1}: Upload failed`);
    }
  }

  // Write results to pipeline log
  log(`\n${"═".repeat(60)}`);
  log(`📊 Blotato Upload Results:`);
  log(`   ✅ Successfully uploaded: ${successfullyUploaded.length}`);
  for (const s of successfullyUploaded) log(`      - ${s}`);
  log(`   ❌ Failed: ${failed.length}`);
  for (const f of failed) log(`      - ${f}`);

  if (failed.length > 0) {
    log(`\n⚠️  Note: Blotato API endpoints could not be verified.`);
    log(`   The API key format (blt_*) and app domain (my.blotato.com) were confirmed.`);
    log(`   API documentation was not publicly accessible — endpoint URLs are best guesses.`);
    log(`   Verify correct Blotato API endpoints at https://www.blotato.com and update scripts/schedule-posts.ts.`);
  }

  log(`\n🏁 Blotato scheduling pipeline complete.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  log(`❌ FATAL: ${err.message}`);
  process.exit(1);
});
