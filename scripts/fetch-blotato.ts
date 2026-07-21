// Quick Blotato docs fetcher
const url = "https://help.blotato.com/api/start";
const resp = await fetch(url, {
  headers: { "User-Agent": "Mozilla/5.0" },
  signal: AbortSignal.timeout(15000),
});
const html = await resp.text();
// Extract text
const text = html
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .replace(/\s{2,}/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
await Bun.write("/home/team/shared/marketing/blotato-docs.txt", text);
console.log("Length:", text.length);
console.log("---FIRST 3000---");
console.log(text.substring(0, 3000));
console.log("---LAST 2000---");
console.log(text.substring(text.length - 2000));
