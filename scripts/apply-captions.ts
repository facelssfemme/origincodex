/**
 * apply-captions.ts — Format Finder Caption Application Pipeline
 *
 * Reads videos.md for HeyGen video URLs, calls Format Finder API to apply
 * Hormozi-style captions, and saves the edited video URLs.
 *
 * Caption style:
 *   - Accent/keywords: YELLOW (#FFD700), bold
 *   - Body text: WHITE (#FFFFFF), bold
 *   - TikTok-native placement (centered, mobile-optimized)
 *
 * Usage: bun run scripts/apply-captions.ts
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Configuration ───────────────────────────────────────────────
const FORMAT_FINDER_API_KEY = process.env.FORMAT_FINDER_API_KEY!;
const FORMAT_FINDER_BASE = "https://formatfinder.onepeakcreative.com";

const VIDEOS_PATH = resolve(import.meta.dir, "../../marketing/videos.md");
const CAPTIONED_PATH = resolve(import.meta.dir, "../../marketing/videos-captioned.md");
const LOG_PATH = resolve(import.meta.dir, "../../marketing/pipeline-log.md");
const POSTS_PATH = resolve(import.meta.dir, "../../marketing/batch1-posts.md");

// ─── Types ───────────────────────────────────────────────────────
interface VideoEntry {
  index: number;
  title: string;
  videoId: string | null;
  videoUrl: string | null;
  accentWords?: string[];
  script?: string;
}

interface CaptionResult {
  index: number;
  title: string;
  originalUrl: string | null;
  captionedUrl: string | null;
  status: "success" | "failed" | "skipped";
  error?: string;
}

// ─── Logging ─────────────────────────────────────────────────────
function log(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
}

// ─── Parse videos.md ─────────────────────────────────────────────
function parseVideos(): VideoEntry[] {
  const raw = readFileSync(VIDEOS_PATH, "utf-8");
  const entries: VideoEntry[] = [];

  const lines = raw.split("\n");
  for (const line of lines) {
    // Match table rows: | 1 | Title | videoId | videoUrl |
    const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (!match || match[1] === "#") continue;

    const index = parseInt(match[1]);
    const title = match[2].trim();
    const videoId = match[3].trim();
    const videoUrl = match[4].trim();

    if (videoUrl === "❌" || videoUrl === "Creation failed" || videoUrl === "Pending") {
      entries.push({
        index,
        title,
        videoId: null,
        videoUrl: null,
      });
      continue;
    }

    entries.push({
      index,
      title,
      videoId: videoId === "❌" ? null : videoId,
      videoUrl,
    });
  }

  return entries;
}

// ─── Parse accent words from batch1-posts.md ────────────────────
function parseAccentWords(): Map<number, string[]> {
  const raw = readFileSync(POSTS_PATH, "utf-8");
  const map = new Map<number, string[]>();

  const postBlocks = raw.split(/^## Post \d+:/m).slice(1);
  for (let i = 0; i < postBlocks.length; i++) {
    const block = postBlocks[i];
    const index = i + 1;
    const accentWords: string[] = [];

    // Extract from gold-highlighted text overlays
    const goldMatches = block.matchAll(
      /\|.*?\|\s*"([^"]+)"\s*\|.*?\|\s*(?:Gold|Gold bold|Gold glow|Gold serif|Gold italic)/gi,
    );
    for (const m of goldMatches) {
      const word = m[1].trim();
      if (!accentWords.includes(word)) {
        accentWords.push(word);
      }
    }

    // Also extract from the Caption section for additional keywords
    const captionMatch = block.match(/### Caption\s*\n```([\s\S]*?)```/);
    if (captionMatch) {
      const caption = captionMatch[1];
      // Extract hashtagged words (without #)
      const hashMatches = caption.matchAll(/#(\w+)/g);
      for (const m of hashMatches) {
        const word = m[1];
        if (!accentWords.includes(word)) {
          accentWords.push(word);
        }
      }
    }

    if (accentWords.length === 0) {
      // Fallback: key emotional phrases from the script
      const scriptMatch = block.match(
        /### Script \(voiceover\)\s*\n>\s*([\s\S]*?)(?=\n\n)/,
      );
      if (scriptMatch) {
        const script = scriptMatch[1];
        const keyPhrases = [
          "quiet ache",
          "not a flaw",
          "clue",
          "star system",
          "Welcome home",
          "completely different",
          "exactly one",
          "Which one",
          "rarest",
          "ancient predator",
          "fiercely protective",
          "rage",
          "guard",
          "cried",
          "secrets",
          "drained",
          "searched",
          "not broken",
          "starseed",
          "gift",
          "weight",
          "mission",
          "see through every lie",
          "drowning",
        ];
        for (const phrase of keyPhrases) {
          if (
            script.toLowerCase().includes(phrase.toLowerCase()) &&
            !accentWords.includes(phrase)
          ) {
            accentWords.push(phrase);
          }
        }
      }
    }

    map.set(index, accentWords);
  }

  return map;
}

// ─── Format Finder API Call ──────────────────────────────────────
async function applyCaptions(
  videoUrl: string,
  accentWords: string[],
  script: string,
): Promise<string> {
  // Format Finder API — apply Hormozi-style captions
  // Based on the Format Finder service at formatfinder.onepeakcreative.com

  const resp = await fetch(`${FORMAT_FINDER_BASE}/api/caption`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FORMAT_FINDER_API_KEY}`,
    },
    body: JSON.stringify({
      video_url: videoUrl,
      style: "hormozi", // Alex Hormozi caption style
      captions: {
        font: "bold",
        body_color: "#FFFFFF", // white body text
        accent_color: "#FFD700", // yellow accent words
        accent_words: accentWords,
        placement: "tiktok-native", // optimized for TikTok
        position: "center-bottom",
        max_chars_per_line: 30,
      },
      output_format: "mp4",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Format Finder API error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  // Format Finder might return the processed video URL directly or a job ID
  return data.video_url ?? data.url ?? data.output_url ?? "";
}

// ─── Alternative: Direct ffmpeg-style approach if API is different ──
async function applyCaptionsAlt(
  videoUrl: string,
  accentWords: string[],
  script: string,
): Promise<string> {
  // Try alternative endpoint structure
  const resp = await fetch(`${FORMAT_FINDER_BASE}/api/v1/captions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": FORMAT_FINDER_API_KEY,
    },
    body: JSON.stringify({
      source_url: videoUrl,
      text: script,
      highlights: accentWords,
      highlight_color: "#FFD700",
      text_color: "#FFFFFF",
      font_style: "bold",
      platform: "tiktok",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Format Finder alt API error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  return data.result_url ?? data.video_url ?? data.url ?? "";
}

// ─── Main Pipeline ────────────────────────────────────────────────
async function main() {
  log("🎬 Starting Format Finder caption pipeline");

  if (!FORMAT_FINDER_API_KEY) {
    log("❌ FORMAT_FINDER_API_KEY not set in environment");
    process.exit(1);
  }

  const videos = parseVideos();
  log(`📊 Videos found: ${videos.length}`);

  const accentMap = parseAccentWords();
  log(`📊 Accent word maps parsed for ${accentMap.size} posts`);

  const results: CaptionResult[] = [];
  let successCount = 0;

  for (const video of videos) {
    log(`\n✂️  Video ${video.index}: "${video.title}"`);

    if (!video.videoUrl) {
      log(`   ⏭️  Skipping — no video URL (generation failed)`);
      results.push({
        index: video.index,
        title: video.title,
        originalUrl: null,
        captionedUrl: null,
        status: "skipped",
      });
      continue;
    }

    const accentWords = accentMap.get(video.index) ?? [];
    log(`   Accent words: ${accentWords.join(", ") || "(none)"}`);

    try {
      let captionedUrl: string;

      // Try primary endpoint first, fall back to alternative
      try {
        captionedUrl = await applyCaptions(video.videoUrl, accentWords, "");
      } catch (primaryErr: any) {
        log(`   ⚠️  Primary endpoint failed: ${primaryErr.message}`);
        log(`   🔄 Trying alternative endpoint...`);
        captionedUrl = await applyCaptionsAlt(video.videoUrl, accentWords, "");
      }

      log(`   ✅ Captioned video: ${captionedUrl}`);

      results.push({
        index: video.index,
        title: video.title,
        originalUrl: video.videoUrl,
        captionedUrl,
        status: "success",
      });
      successCount++;
    } catch (err: any) {
      const msg = err.message ?? String(err);
      log(`   ❌ Failed: ${msg}`);

      // If both endpoints fail, use original
      results.push({
        index: video.index,
        title: video.title,
        originalUrl: video.videoUrl,
        captionedUrl: video.videoUrl, // fallback to original
        status: "failed",
        error: msg,
      });
    }
  }

  // ─── Write videos-captioned.md ────────────────────────────────
  const now = new Date().toISOString();
  let md = `# Captioned Videos — ${now}\n\n`;
  md += "| # | Title | Original URL | Captioned URL | Status |\n";
  md += "|---|---|---|---|---|\n";

  for (const r of results) {
    const orig = r.originalUrl ?? "N/A";
    const capt = r.captionedUrl ?? "N/A";
    md += `| ${r.index} | ${r.title} | ${orig} | ${capt} | ${r.status} |\n`;
  }

  writeFileSync(CAPTIONED_PATH, md);
  log(`\n📝 Written ${CAPTIONED_PATH}`);

  log(
    `\n🏁 Caption pipeline complete: ${successCount}/${videos.length} videos captioned.`,
  );

  if (successCount === 0 && videos.some((v) => v.videoUrl)) {
    log("⚠️  No captions were applied. Check Format Finder API key and endpoints.");
  }
}

main().catch((err) => {
  log(`💥 Fatal error: ${err.message ?? err}`);
  process.exit(1);
});
