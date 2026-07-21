/**
 * generate-videos.ts
 * Step 1: Generate 5 HeyGen talking-head avatar videos from batch1-posts.md scripts.
 *
 * Usage: cd /home/team/shared/site && bun run scripts/generate-videos.ts
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ── Config from env ──────────────────────────────────────────────
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY!;
const HEYGEN_AVATAR_ID = process.env.HEYGEN_AVATAR_ID!;
const HEYGEN_VOICE_ID = process.env.HEYGEN_VOICE_ID!;
const BACKGROUND = "#0a0218";
const HEYGEN_BASE = "https://api.heygen.com";

const POSTS_MD = "/home/team/shared/marketing/batch1-posts.md";
const VIDEOS_MD = "/home/team/shared/marketing/videos.md";
const LOG_FILE = "/home/team/shared/marketing/pipeline-log.md";

// ── Logging ───────────────────────────────────────────────────────
function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

function initLog() {
  writeFileSync(LOG_FILE, `# Pipeline Log — ${new Date().toISOString()}\n\n`);
}

// ── Parse batch1-posts.md ─────────────────────────────────────────
interface PostScript {
  index: number;
  title: string;
  script: string;
}

function parsePosts(md: string): PostScript[] {
  const posts: PostScript[] = [];
  // Split on "## Post" headings
  const sections = md.split(/^## Post \d+:/m);
  
  // First element is header, skip it
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    // Extract title (first line, after "Post N: " header)
    const titleMatch = section.match(/"([^"]+)"/);
    const title = titleMatch ? titleMatch[1] : `Post ${i}`;

    // Extract voiceover script from "### Script (voiceover)" section
    const scriptMatch = section.match(/### Script \(voiceover\)\s*\n>\s*(.+?)(?:\n\n|\n###|\n\*\*Goal|\n\*\*CTA)/s);
    let script = scriptMatch ? scriptMatch[1].trim() : "";

    // Clean up markdown artifacts
    script = script.replace(/^>\s*/gm, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();

    if (script) {
      posts.push({ index: i - 1, title, script });
    }
  }

  return posts;
}

// ── HeyGen API: Create Video (v2) ──────────────────────────────────
async function createVideo(post: PostScript): Promise<{ video_id: string } | null> {
  // Try multiple v2 request body formats until one works
  const formats = [
    // Format A: voice with input_text inside, background as object
    {
      video_name: `post-${post.index + 1}-${post.title.slice(0, 40)}`,
      video_inputs: [{
        avatar_id: HEYGEN_AVATAR_ID,
        voice: {
          type: "text",
          voice_id: HEYGEN_VOICE_ID,
          input_text: post.script,
        },
        background: { type: "color", value: BACKGROUND },
      }],
    },
    // Format B: text at top level, voice with type only, background as object
    {
      video_name: `post-${post.index + 1}-${post.title.slice(0, 40)}`,
      video_inputs: [{
        avatar_id: HEYGEN_AVATAR_ID,
        voice: {
          type: "text",
          voice_id: HEYGEN_VOICE_ID,
        },
        text: post.script,
        background: { type: "color", value: BACKGROUND },
      }],
    },
    // Format C: background as flat string (original spec format)
    {
      video_name: `post-${post.index + 1}-${post.title.slice(0, 40)}`,
      video_inputs: [{
        avatar_id: HEYGEN_AVATAR_ID,
        voice: {
          type: "text",
          voice_id: HEYGEN_VOICE_ID,
          input_text: post.script,
        },
        background: BACKGROUND,
      }],
    },
  ];

  for (let fi = 0; fi < formats.length; fi++) {
    const body = formats[fi];
    const url = `${HEYGEN_BASE}/v2/video/generate`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-Api-Key": HEYGEN_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = await res.json() as any;

      if (json.data?.video_id) {
        log(`  ✅ Post ${post.index + 1}: Created video ${json.data.video_id} (format ${fi + 1})`);
        return { video_id: json.data.video_id };
      }

      if (json.error) {
        log(`  ⚠️  Post ${post.index + 1}, format ${fi + 1}: ${json.error.code} — ${json.error.message}`);
        if (fi === formats.length - 1) {
          log(`  ❌ Post ${post.index + 1}: All formats failed. Last error: ${JSON.stringify(json.error)}`);
        }
        // If this format failed with "insufficient_credit", stop trying
        if (json.error.code === "insufficient_credit") {
          log(`  ❌ Insufficient HeyGen credits. Stopping.`);
          return null;
        }
        continue;
      }
    } catch (err: any) {
      log(`  ⚠️  Post ${post.index + 1}, format ${fi + 1}: Network error — ${err.message}`);
    }
  }

  return null;
}

// ── HeyGen API: Poll Video Status ──────────────────────────────────
async function pollVideoStatus(videoId: string, maxWaitSec = 300): Promise<string | null> {
  const url = `${HEYGEN_BASE}/v2/video/status?video_id=${videoId}`;
  const start = Date.now();
  const interval = 5000; // poll every 5s

  while ((Date.now() - start) < maxWaitSec * 1000) {
    await sleep(interval);
    try {
      const res = await fetch(url, {
        headers: { "X-Api-Key": HEYGEN_API_KEY },
      });
      const json = await res.json() as any;

      const status = json.data?.status || json.data?.state;

      if (status === "completed" || status === "success" || status === 2) {
        const videoUrl = json.data?.video_url || json.data?.url;
        if (videoUrl) {
          return videoUrl;
        }
        // Try download_url
        return json.data?.download_url || json.data?.video_url || null;
      }

      if (status === "failed" || status === "error" || status === 3) {
        log(`  ❌ Video ${videoId} failed: ${JSON.stringify(json.data)}`);
        return null;
      }

      // Still processing
    } catch (err: any) {
      log(`  ⚠️  Poll error for ${videoId}: ${err.message}`);
    }
  }

  log(`  ⚠️  Video ${videoId} timed out after ${maxWaitSec}s`);
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  initLog();
  log("🚀 Starting HeyGen video generation pipeline");
  log(`   Avatar: ${HEYGEN_AVATAR_ID}`);
  log(`   Voice: ${HEYGEN_VOICE_ID}`);
  log(`   Background: ${BACKGROUND}`);

  // Parse posts
  const md = readFileSync(POSTS_MD, "utf-8");
  const posts = parsePosts(md);
  log(`📄 Parsed ${posts.length} posts from batch1-posts.md`);

  const results: { index: number; title: string; videoId: string | null; videoUrl: string | null; error?: string }[] = [];

  for (const post of posts.slice(0, 5)) {
    log(`\n🎬 Post ${post.index + 1}: "${post.title}"`);
    log(`   Script (${post.script.length} chars): "${post.script.slice(0, 100)}..."`);

    // Create video
    const createResult = await createVideo(post);
    if (!createResult) {
      results.push({ index: post.index, title: post.title, videoId: null, videoUrl: null, error: "Creation failed" });
      continue;
    }

    // Poll for completion
    log(`   ⏳ Polling for video ${createResult.video_id}...`);
    const videoUrl = await pollVideoStatus(createResult.video_id);

    if (videoUrl) {
      log(`   ✅ Video ready: ${videoUrl}`);
    }

    results.push({
      index: post.index,
      title: post.title,
      videoId: createResult.video_id,
      videoUrl,
      error: videoUrl ? undefined : "No video URL received",
    });
  }

  // Write videos.md
  let videosMd = `# Generated Videos — ${new Date().toISOString()}\n\n`;
  videosMd += `| # | Title | Video ID | Video URL |\n`;
  videosMd += `|---|---|---|---|\n`;

  for (const r of results) {
    videosMd += `| ${r.index + 1} | ${r.title} | ${r.videoId || "❌"} | ${r.videoUrl || (r.error || "❌")} |\n`;
  }

  writeFileSync(VIDEOS_MD, videosMd);
  log(`\n📝 Written ${VIDEOS_MD}`);

  const successCount = results.filter((r) => r.videoUrl).length;
  log(`\n🏁 Pipeline complete: ${successCount}/${results.length} videos generated successfully.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  log(`❌ FATAL: ${err.message}`);
  process.exit(1);
});
