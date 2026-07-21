// Fetch Blotato API docs and save to file
const url = "https://help.blotato.com/api/start";

async function main() {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SyrenaBot/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    const html = await resp.text();
    // Extract text content (strip HTML tags for readability)
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    await Bun.write("/home/team/shared/marketing/blotato-docs.txt", text);
    console.log("Docs saved. Text length:", text.length);
    console.log("First 2000 chars:", text.substring(0, 2000));
  } catch (e) {
    console.error("Failed:", e);
  }
}

main();
