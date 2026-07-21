/**
 * generate-videos.ts — HeyGen Video Generation Pipeline
 *
 * Reads batch1-posts.md, extracts scripts, and generates videos via HeyGen API.
 * Uses avatar + voice from .env. Saves results to videos.md.
 *
 * Usage: bun run scripts/generate-videos.ts
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Configuration ───────────────────────────────────────────────
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY!;
const AVATAR_ID = process.env.HEYGEN_AVATAR_ID!;
const VOICE_ID = process.env.HEYGEN_VOICE_ID!;
const BACKGROUND_COLOR = "#0a0218"; // deep cosmic indigo

const HEYGEN_BASE = "https://api.heygen.com";
const POSTS_PATH = resolve(import.meta.dir, "../../marketing/batch1-posts.md");
const VIDEOS_PATH = resolve(import.meta.dir, "../../marketing/videos.md");
const LOG_PATH = resolve(import.meta.dir, "../../marketing/pipeline-log.md");

// ─── Types ───────────────────────────────────────────────────────
interface Post {
  index: number;
  title: string;
  script: string;
  postType: string;
  goal: string;
  cta: string;
  accentWords: string[];
}

interface VideoResult {
  index: number;
  title: string;
  videoId: string | null;
  videoUrl: string | null;
  status: "success" | "failed";
  error?: string;
}

// ─── Logging ─────────────────────────────────────────────────────
function log(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
}

// ─── Parse batch1-posts.md ───────────────────────────────────────
function parsePosts(): Post[] {
  const raw = readFileSync(POSTS_PATH, "utf-8");
  const posts: Post[] = [];

  // Split on ## Post N: pattern
  const postBlocks = raw.split(/^## Post \d+:/m).slice(1);

  for (const block of postBlocks) {
    // Extract title: first line after "## Post N:"
    // Block starts with:  "Title" (duration) — note leading space
    const titleMatch = block.match(/^\s*"([^"]+)"/m);
    if (!titleMatch) {
      console.log(`  ⚠️  Could not extract title from block: "${block.substring(0, 80)}..."`);
      continue;
    }

    // Extract script from voiceover block
    const scriptMatch = block.match(
      />\s*(You've always felt[\s\S]*?)(?=\n\n(?:###|\*\*|##|\s*\|))/,
    );
    const altScriptMatch = block.match(
      /### Script \(voiceover\)\s*\n>\s*([\s\S]*?)(?=\n\n)/,
    );

    let script = "";
    if (altScriptMatch) {
      script = altScriptMatch[1].replace(/^>\s*/gm, "").replace(/\n/g, " ").trim();
    } else if (scriptMatch) {
      script = scriptMatch[1].replace(/\n/g, " ").trim();
    } else {
      // Try more general extraction
      const lines = block.split("\n");
      const voiceoverStart = lines.findIndex((l) =>
        l.includes("Script (voiceover)")
      );
      if (voiceoverStart >= 0) {
        const scriptLines: string[] = [];
        for (let i = voiceoverStart + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith(">")) {
            scriptLines.push(line.replace(/^>\s*/, ""));
          } else if (scriptLines.length > 0 && line === "") {
            continue;
          } else if (scriptLines.length > 0) {
            break;
          }
        }
        script = scriptLines.join(" ").trim();
      }
    }

    if (!script || script.length < 10) continue;

    // Extract accent words from Caption block
    const captionMatch = block.match(/### Caption\s*\n```[\s\S]*?```/);
    const accentWords: string[] = [];
    // Extract from Text Overlay gold/bold entries
    const goldMatches = block.matchAll(/\|.*?\|\s*"([^"]+)"\s*\|.*?\|\s*Gold/gi);
    for (const m of goldMatches) {
      accentWords.push(m[1].trim());
    }

    const title = titleMatch[1].trim();
    const postTypeMatch = block.match(/\*\*Post Type:\*\*\s*(.+)/);
    const goalMatch = block.match(/\*\*Goal:\*\*\s*(.+)/);
    const ctaMatch = block.match(/\*\*CTA:\*\*\s*"([^"]+)"/);

    posts.push({
      index: posts.length + 1,
      title,
      script,
      postType: postTypeMatch?.[1]?.trim() ?? "Storytelling",
      goal: goalMatch?.[1]?.trim() ?? "Shares",
      cta: ctaMatch?.[1]?.trim() ?? "Link in bio.",
      accentWords: accentWords.length > 0 ? accentWords : extractAccentWords(script),
    });
  }

  return posts;
}

function extractAccentWords(script: string): string[] {
  // Extract key emotional phrases as accent words
  const phrases: string[] = [];
  const matches = script.matchAll(
    /(?:quiet ache|not a flaw|clue|star system|Welcome home|completely different|exactly one|rarest|ancient predator|fiercely protective|rage|guard|cried|secrets|drained|searched|not broken|starseed|gift|weight|mission|see through every lie|drowning)/gi,
  );
  for (const m of matches) {
    if (!phrases.includes(m[0].toLowerCase())) {
      phrases.push(m[0].toLowerCase());
    }
  }
  return phrases.slice(0, 8);
}

// ─── HeyGen API Calls (v3) ───────────────────────────────────────

// HeyGen v3 uses Bearer token auth (not X-Api-Key).
// The API key from env works as a Bearer token.
const HEYGEN_AUTH_HEADER = `Bearer ${HEYGEN_API_KEY}`;

async function createHeyGenVideo(script: string): Promise<{ videoId: string }> {
  const body: Record<string, any> = {
    type: "avatar",
    avatar_id: AVATAR_ID,
    script: script,
    voice_id: VOICE_ID,
    aspect_ratio: "9:16", // TikTok vertical
    background: {
      type: "color",
      value: BACKGROUND_COLOR,
    },
    voice_settings: {
      speed: 0.95,
    },
  };

  const resp = await fetch(`${HEYGEN_BASE}/v3/videos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: HEYGEN_AUTH_HEADER,
      "X-Api-Key": HEYGEN_API_KEY, // fallback for older auth
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`HeyGen API error ${resp.status}: ${bodyText.substring(0, 500)}`);
  }

  const data = await resp.json();
  return { videoId: data.data?.video_id ?? data.video_id };
}

async function pollVideoStatus(videoId: string, maxAttempts = 60): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(`${HEYGEN_BASE}/v3/videos/${videoId}`, {
      headers: {
        Authorization: HEYGEN_AUTH_HEADER,
        "X-Api-Key": HEYGEN_API_KEY,
      },
    });

    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new Error(`Status check error ${resp.status}: ${bodyText.substring(0, 300)}`);
    }

    const data = await resp.json();
    const videoData = data.data ?? data;
    const status = videoData.status;

    if (status === "completed" || status === "success") {
      return videoData.video_url ?? videoData.url ?? "";
    }
    if (status === "failed" || status === "error") {
      throw new Error(
        `Video generation failed: ${JSON.stringify(videoData)}`,
      );
    }

    // Wait 5 seconds before next poll
    await new Promise((r) => setTimeout(r, 5000));
  }

  throw new Error(`Timed out waiting for video ${videoId}`);
}

// ─── Main Pipeline ────────────────────────────────────────────────
async function main() {
  log("🚀 Starting HeyGen video generation pipeline");
  log(`   Avatar: ${AVATAR_ID}`);
  log(`   Voice: ${VOICE_ID}`);
  log(`   Background: ${BACKGROUND_COLOR}`);

  // Validate API key
  if (!HEYGEN_API_KEY) {
    log("❌ HEYGEN_API_KEY not set in environment");
    process.exit(1);
  }
  if (!AVATAR_ID || !VOICE_ID) {
    log("⚠️  HEYGEN_AVATAR_ID or HEYGEN_VOICE_ID not set — using defaults");
  }

  const posts = parsePosts();
  log(`📄 Parsed ${posts.length} posts from batch1-posts.md`);

  const results: VideoResult[] = [];
  let successCount = 0;

  for (const post of posts) {
    log(`\n🎬 Post ${post.index}: "${post.title}"`);
    log(`   Script (${post.script.length} chars): "${post.script.substring(0, 120)}..."`);

    try {
      const { videoId } = await createHeyGenVideo(post.script);
      log(`   ✅ Video created: ${videoId}`);

      log(`   ⏳ Polling for completion...`);
      const videoUrl = await pollVideoStatus(videoId);
      log(`   🎥 Video URL: ${videoUrl}`);

      results.push({
        index: post.index,
        title: post.title,
        videoId,
        videoUrl,
        status: "success",
      });
      successCount++;
    } catch (err: any) {
      const msg = err.message ?? String(err);
      log(`   ❌ Failed: ${msg}`);

      // Check for credit exhaustion
      if (msg.includes("insufficient_credit") || msg.includes("Insufficient credits")) {
        log("   ⚠️  Insufficient HeyGen credits. Stopping remaining videos.");
        results.push({
          index: post.index,
          title: post.title,
          videoId: null,
          videoUrl: null,
          status: "failed",
          error: "insufficient_credit",
        });
        break; // Stop processing more videos — credits are exhausted
      }

      results.push({
        index: post.index,
        title: post.title,
        videoId: null,
        videoUrl: null,
        status: "failed",
        error: msg,
      });
    }
  }

  // ─── Write videos.md ──────────────────────────────────────────
  const now = new Date().toISOString();
  let md = `# Generated Videos — ${now}\n\n`;
  md += "| # | Title | Video ID | Video URL |\n";
  md += "|---|---|---|---|\n";

  for (const r of results) {
    const vidId = r.videoId ?? "❌";
    const vidUrl = r.videoUrl ?? (r.status === "failed" ? "Creation failed" : "Pending");
    md += `| ${r.index} | ${r.title} | ${vidId} | ${vidUrl} |\n`;
  }

  writeFileSync(VIDEOS_PATH, md);
  log(`\n📝 Written ${VIDEOS_PATH}`);

  // ─── Summary ──────────────────────────────────────────────────
  log(`\n🏁 Pipeline complete: ${successCount}/${posts.length} videos generated successfully.`);

  if (successCount === 0) {
    log("⚠️  No videos were generated. Check HeyGen credits and API key.");
  }
}

main().catch((err) => {
  log(`💥 Fatal error: ${err.message ?? err}`);
  process.exit(1);
});
