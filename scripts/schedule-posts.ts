/**
 * schedule-posts.ts — Blotato Scheduling Pipeline
 *
 * Reads videos-captioned.md (or videos.md as fallback) and week-1-calendar.md,
 * then schedules posts to Blotato via their API.
 *
 * Blotato API docs: https://help.blotato.com/api/start
 *
 * Usage: bun run scripts/schedule-posts.ts
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Configuration ───────────────────────────────────────────────
const BLOTATO_API_KEY = process.env.BLOTATO_API_KEY!;

// Blotato API configuration — verified from https://help.blotato.com/api/start
// Base URL: https://backend.blotato.com (NOT my.blotato.com or api.blotato.com)
// Auth: blotato-api-key header (NOT Bearer or X-Api-Key)
// Body: { "post": { "accountId": "...", "content": { "text": "...", "mediaUrls": [...], "platform": "tiktok" }, "target": { "targetType": "tiktok" } } }
const BLOTATO_BASE = "https://backend.blotato.com";
const BLOTATO_ACCOUNT_ID = process.env.BLOTATO_ACCOUNT_ID ?? ""; // Set in .env if needed

const BLOTATO_ENDPOINTS = [
  { base: BLOTATO_BASE, post: "/v2/posts", upload: "/v2/media" },
];

const VIDEOS_PATH = resolve(import.meta.dir, "../../marketing/videos-captioned.md");
const VIDEOS_FALLBACK_PATH = resolve(import.meta.dir, "../../marketing/videos.md");
const CALENDAR_PATH = resolve(import.meta.dir, "../../marketing/week-1-calendar.md");
const POSTS_PATH = resolve(import.meta.dir, "../../marketing/batch1-posts.md");
const LOG_PATH = resolve(import.meta.dir, "../../marketing/pipeline-log.md");
const SCHEDULE_RESULT_PATH = resolve(
  import.meta.dir,
  "../../marketing/schedule-results.md",
);

// ─── Types ───────────────────────────────────────────────────────
interface VideoEntry {
  index: number;
  title: string;
  videoUrl: string | null;
  captionedUrl: string | null;
}

interface ScheduleEntry {
  postIndex: number;
  title: string;
  day: string;
  time: string;
  postType: string;
  goal: string;
  cta: string;
  captionedUrl: string | null;
  accentWords: string[];
  script: string;
  caption: string;
  soundSuggestion: string;
}

interface ScheduleResult {
  postIndex: number;
  title: string;
  day: string;
  time: string;
  blotatoId: string | null;
  status: "scheduled" | "failed";
  error?: string;
}

// ─── Logging ─────────────────────────────────────────────────────
function log(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
}

// ─── Parse videos.md / videos-captioned.md ──────────────────────
function parseVideos(): Map<number, VideoEntry> {
  const map = new Map<number, VideoEntry>();

  // Try captioned first, fall back to original
  let raw: string;
  try {
    raw = readFileSync(VIDEOS_PATH, "utf-8");
    log("📹 Using captioned videos from videos-captioned.md");
  } catch {
    raw = readFileSync(VIDEOS_FALLBACK_PATH, "utf-8");
    log("📹 Using original videos from videos.md (no captioned versions found)");
  }

  const lines = raw.split("\n");
  for (const line of lines) {
    // Match: | 1 | Title | url | url | (status?) |
    const match = line.match(
      /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|(\s*\w+\s*\|)?$/,
    );
    if (!match || match[1] === "#") continue;

    const index = parseInt(match[1]);
    const title = match[2].trim();
    const firstUrl = match[3].trim();
    const secondUrl = match[4].trim();

    // Determine which URL is the video and which is status
    let videoUrl: string | null = null;
    let captionedUrl: string | null = null;

    const isUrl = (s: string) =>
      s.startsWith("http") && !s.includes("failed") && !s.includes("❌");

    if (isUrl(firstUrl) && isUrl(secondUrl)) {
      // Both are URLs: first = original, second = captioned
      videoUrl = firstUrl;
      captionedUrl = secondUrl;
    } else if (isUrl(firstUrl)) {
      videoUrl = firstUrl;
      captionedUrl = firstUrl;
    } else if (isUrl(secondUrl)) {
      videoUrl = secondUrl;
      captionedUrl = secondUrl;
    }

    map.set(index, { index, title, videoUrl, captionedUrl });
  }

  return map;
}

// ─── Parse week-1-calendar.md ────────────────────────────────────
function parseCalendar(): ScheduleEntry[] {
  const raw = readFileSync(CALENDAR_PATH, "utf-8");
  const entries: ScheduleEntry[] = [];

  // Extract table rows with schedule info
  const tableRegex =
    /\|\s*(\d+)\s*\|\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*\*\*"([^"]+)"\*\*\s*(?:\(Batch \d+, Post (\d+)\))?\s*[^|]*\|([^|]+)\|([^|]+)\|/g;

  let match;
  while ((match = tableRegex.exec(raw)) !== null) {
    const postNum = match[1];
    const timeSlot = match[2].trim();
    const postType = match[3].trim();
    const title = match[4].trim();
    const batchPostNum = match[5] ? parseInt(match[5]) : parseInt(postNum);
    const goal = match[6].trim();
    const sound = match[7].trim();

    entries.push({
      postIndex: batchPostNum,
      title,
      day: "", // Will be extracted from context
      time: timeSlot,
      postType,
      goal,
      cta: "Link in bio.",
      captionedUrl: null,
      accentWords: [],
      script: "",
      caption: "",
      soundSuggestion: sound,
    });
  }

  // Extract day headers and associate with entries
  const dayRegex = /^## Day (\d+): (\w+) — "([^"]+)"/gm;
  const days: { num: string; name: string; theme: string; startLine: number }[] = [];
  while ((match = dayRegex.exec(raw)) !== null) {
    days.push({
      num: match[1],
      name: match[2],
      theme: match[3],
      startLine: raw.substring(0, match.index).split("\n").length,
    });
  }

  // Assign days based on position in calendar
  let currentDay = "Day 1";
  let entryIdx = 0;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const dayMatch = lines[i].match(/^## Day (\d+):/);
    if (dayMatch) {
      currentDay = `Day ${dayMatch[1]} (${days.find((d) => d.num === dayMatch[1])?.name ?? ""})`;
    }
    const tableMatch = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (tableMatch && entryIdx < entries.length) {
      entries[entryIdx].day = currentDay;
      entryIdx++;
    }
  }

  // Default day if not assigned
  for (const e of entries) {
    if (!e.day) e.day = `Day ${Math.ceil(e.postIndex / 2)}`;
  }

  return entries;
}

// ─── Parse posts for captions and accent words ──────────────────
function parsePostDetails(): Map<
  number,
  { caption: string; accentWords: string[]; script: string; cta: string }
> {
  const raw = readFileSync(POSTS_PATH, "utf-8");
  const map = new Map();

  const postBlocks = raw.split(/^## Post \d+:/m).slice(1);
  for (let i = 0; i < postBlocks.length; i++) {
    const block = postBlocks[i];
    const index = i + 1;

    // Extract caption
    const captionMatch = block.match(/### Caption\s*\n```([\s\S]*?)```/);
    const caption = captionMatch?.[1]?.trim() ?? "";

    // Extract accent words from gold text overlays
    const accentWords: string[] = [];
    const goldMatches = block.matchAll(
      /\|.*?\|\s*"([^"]+)"\s*\|.*?\|\s*(?:Gold|Gold bold|Gold glow|Gold serif|Gold italic)/gi,
    );
    for (const m of goldMatches) {
      const word = m[1].trim();
      if (!accentWords.includes(word)) accentWords.push(word);
    }

    // Extract script
    const scriptMatch = block.match(
      /### Script \(voiceover\)\s*\n>\s*([\s\S]*?)(?=\n\n)/,
    );
    const script = scriptMatch?.[1]?.replace(/^>\s*/gm, "").replace(/\n/g, " ").trim() ?? "";

    // Extract CTA
    const ctaMatch = block.match(/\*\*CTA:\*\*\s*"([^"]+)"/);
    const cta = ctaMatch?.[1]?.trim() ?? "Link in bio.";

    map.set(index, { caption, accentWords, script, cta });
  }

  return map;
}

// ─── Blotato API: Build auth headers ────────────────────────────
function blotatoHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "blotato-api-key": BLOTATO_API_KEY, // Correct header per docs
  };
}

// ─── Blotato API: Schedule post ──────────────────────────────────
async function scheduleBlotatoPost(
  endpoint: { base: string; post: string },
  entry: ScheduleEntry,
): Promise<string | null> {
  const url = `${endpoint.base}${endpoint.post}`;

  // Correct body format per Blotato docs:
  // { "post": { "accountId": "...", "content": { "text": "...", "mediaUrls": [...], "platform": "tiktok" }, "target": { "targetType": "tiktok" } } }
  const body: Record<string, any> = {
    post: {
      accountId: BLOTATO_ACCOUNT_ID,
      content: {
        text: entry.caption || entry.script?.substring(0, 500) || entry.title,
        mediaUrls: entry.captionedUrl ? [entry.captionedUrl] : [],
        platform: "tiktok",
      },
      target: {
        targetType: "tiktok",
        privacyLevel: "PUBLIC_TO_EVERYONE",
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: true,
        isAiGenerated: false,
      },
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: blotatoHeaders(),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const bodyText = await resp.text();
    log(`   ⚠️  Schedule failed (${resp.status}): ${bodyText.substring(0, 300)}`);
    return null;
  }

  const data = await resp.json();
  return data.post_id ?? data.id ?? data.post?.id ?? JSON.stringify(data);
}

// ─── Main Pipeline ────────────────────────────────────────────────
async function main() {
  log("\n📋 Starting Blotato scheduling pipeline");

  if (!BLOTATO_API_KEY) {
    log("❌ BLOTATO_API_KEY not set in environment");
    process.exit(1);
  }

  if (!BLOTATO_ACCOUNT_ID) {
    log("⚠️  BLOTATO_ACCOUNT_ID not set — some endpoints may require it");
  }

  // Parse data sources
  const videos = parseVideos();
  log(`📊 Videos found: ${videos.size}`);

  const schedule = parseCalendar();
  log(`📊 Schedule entries: ${schedule.length}`);

  const postDetails = parsePostDetails();
  log(`📊 Posts with details: ${postDetails.size}`);

  // Enrich schedule entries
  for (const entry of schedule) {
    const details = postDetails.get(entry.postIndex);
    if (details) {
      entry.caption = details.caption;
      entry.accentWords = details.accentWords;
      entry.script = details.script;
      entry.cta = details.cta;
    }
    const video = videos.get(entry.postIndex);
    if (video) {
      entry.captionedUrl = video.captionedUrl;
    }
  }

  // Filter to batch 1 posts (indices 1-5)
  const batch1Schedule = schedule.filter((e) => e.postIndex >= 1 && e.postIndex <= 5);
  log(`📊 Batch 1 schedule entries: ${batch1Schedule.length}`);

  const endpoint = BLOTATO_ENDPOINTS[0];
  log(`🔗 Using Blotato endpoint: ${endpoint.base}${endpoint.post}`);

  const results: ScheduleResult[] = [];
  let successCount = 0;

  for (const entry of batch1Schedule) {
    log(`\n📤 Post ${entry.postIndex}: "${entry.title}" → ${entry.day} @ ${entry.time}`);
    log(`   Post type: ${entry.postType} | Goal: ${entry.goal}`);
    log(`   Accent words: ${entry.accentWords.slice(0, 5).join(", ")}`);
    log(`   Captioned URL: ${entry.captionedUrl?.substring(0, 60) ?? "N/A"}...`);

    try {
      const postId = await scheduleBlotatoPost(endpoint, entry);

      if (postId) {
        log(`   ✅ Scheduled! Blotato ID: ${postId}`);
        results.push({
          postIndex: entry.postIndex,
          title: entry.title,
          day: entry.day,
          time: entry.time,
          blotatoId: postId,
          status: "scheduled",
        });
        successCount++;
      } else {
        throw new Error("Blotato endpoint returned no post ID");
      }
    } catch (err: any) {
      const msg = err.message ?? String(err);
      log(`   ❌ Failed: ${msg}`);
      results.push({
        postIndex: entry.postIndex,
        title: entry.title,
        day: entry.day,
        time: entry.time,
        blotatoId: null,
        status: "failed",
        error: msg,
      });
    }
  }

  // ─── Write schedule-results.md ────────────────────────────────
  const now = new Date().toISOString();
  let md = `# Blotato Schedule Results — ${now}\n\n`;
  md += "| # | Title | Day | Time | Blotato ID | Status |\n";
  md += "|---|---|---|---|---|---|\n";

  for (const r of results) {
    const id = r.blotatoId ?? "❌";
    md += `| ${r.postIndex} | ${r.title} | ${r.day} | ${r.time} | ${id} | ${r.status} |\n`;
  }

  writeFileSync(SCHEDULE_RESULT_PATH, md);
  log(`\n📝 Written ${SCHEDULE_RESULT_PATH}`);

  log(`\n════════════════════════════════════════════════════════════`);
  log(`📊 Blotato Upload Results:`);
  log(`   ✅ Successfully scheduled: ${successCount}`);
  log(`   ❌ Failed: ${results.length - successCount}`);

  for (const r of results.filter((r) => r.status === "failed")) {
    log(`      - Post ${r.postIndex}: ${r.error ?? "Unknown error"}`);
  }

  if (successCount === 0) {
    log(`\n⚠️  No posts were scheduled. Check:`);
    log(`   1. BLOTATO_ACCOUNT_ID in .env (required by the API)`);
    log(`   2. BLOTATO_API_KEY permissions`);
    log(`   3. Video URLs are valid and accessible`);
  }

  log(`\n🏁 Blotato scheduling pipeline complete.`);
}

main().catch((err) => {
  log(`💥 Fatal error: ${err.message ?? err}`);
  process.exit(1);
});
