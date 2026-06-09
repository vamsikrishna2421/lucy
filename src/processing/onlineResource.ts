import type { SQLiteDatabase } from 'expo-sqlite';

export interface OnlineResourceRow {
  id: number;
  url: string;
  title: string;
  platform: string;
  thumbnail: string | null;
  topic: string;
  created_at: string;
}

const URL_RE = /(https?:\/\/[^\s]+)/i;

/** Extracts the first URL from shared text, or null. */
export function extractUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[1].replace(/[)\]}.,]+$/, '') : null;
}

/** True when the shared content is essentially just a link (reel/short/article). */
export function isResourceShare(text: string): boolean {
  const t = text.trim();
  const url = extractUrl(t);
  if (!url) return false;
  // Treat as a resource if the text is mostly the URL (short caption ok).
  return t.length - url.length < 40 || /youtu|instagram|tiktok|reel|shorts|vimeo|twitter|x\.com/i.test(url);
}

function platformOf(url: string): string {
  if (/youtu\.be|youtube\.com/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/vimeo\.com/i.test(url)) return 'vimeo';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'web';
}

/** Fetches a human title for the link (oEmbed for YouTube/TikTok, else page <title>). */
async function fetchTitle(url: string, platform: string): Promise<{ title: string; thumbnail: string | null }> {
  try {
    if (platform === 'youtube') {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (r.ok) { const j = await r.json() as { title?: string; thumbnail_url?: string }; return { title: j.title ?? '', thumbnail: j.thumbnail_url ?? null }; }
    }
    if (platform === 'tiktok') {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
      if (r.ok) { const j = await r.json() as { title?: string; thumbnail_url?: string }; return { title: j.title ?? '', thumbnail: j.thumbnail_url ?? null }; }
    }
    // Generic: try to read the page <title>
    const r = await fetch(url);
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
        || html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      if (m) return { title: m[1].trim().slice(0, 160), thumbnail: null };
    }
  } catch { /* network/CORS — fall through */ }
  return { title: '', thumbnail: null };
}

const TOPIC_KEYWORDS: Array<{ topic: string; re: RegExp }> = [
  { topic: 'Tech & AI', re: /\b(ai|ml|gpt|llm|coding|developer|software|programming|tech|startup|saas|cloud|data)\b/i },
  { topic: 'Fitness & Health', re: /\b(workout|fitness|gym|health|diet|nutrition|yoga|running|weight|protein)\b/i },
  { topic: 'Cooking & Food', re: /\b(recipe|cooking|food|baking|meal|kitchen|dish|cook)\b/i },
  { topic: 'Finance & Money', re: /\b(invest|stock|money|finance|crypto|trading|budget|savings|tax)\b/i },
  { topic: 'Travel', re: /\b(travel|trip|destination|flight|hotel|vacation|tour)\b/i },
  { topic: 'Productivity', re: /\b(productivity|habit|focus|notion|workflow|organize|routine)\b/i },
  { topic: 'Entertainment', re: /\b(movie|music|song|comedy|funny|meme|game|gaming|trailer)\b/i },
];

function topicFromTitle(title: string, platform: string): string {
  for (const { topic, re } of TOPIC_KEYWORDS) if (re.test(title)) return topic;
  return platform === 'web' ? 'Articles' : 'Watch Later';
}

/** Saves a shared link as an online resource, organized by topic. Returns the row. */
export async function saveOnlineResource(db: SQLiteDatabase, rawText: string): Promise<OnlineResourceRow | null> {
  const url = extractUrl(rawText);
  if (!url) return null;
  const platform = platformOf(url);
  const { title, thumbnail } = await fetchTitle(url, platform);
  // Use a leftover caption (text minus the URL) as a fallback title.
  const caption = rawText.replace(url, '').trim();
  const finalTitle = (title || caption || `${platform.charAt(0).toUpperCase()}${platform.slice(1)} link`).slice(0, 200);
  const topic = topicFromTitle(`${finalTitle} ${caption}`, platform);

  await db.runAsync(
    `INSERT INTO online_resources (url, title, platform, thumbnail, topic)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title = excluded.title, topic = excluded.topic`,
    url, finalTitle, platform, thumbnail, topic,
  );
  return db.getFirstAsync<OnlineResourceRow>('SELECT * FROM online_resources WHERE url = ?', url);
}

export async function listOnlineResources(db: SQLiteDatabase): Promise<OnlineResourceRow[]> {
  return db.getAllAsync<OnlineResourceRow>('SELECT * FROM online_resources ORDER BY created_at DESC LIMIT 300');
}

export async function deleteOnlineResource(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM online_resources WHERE id = ?', id);
}
