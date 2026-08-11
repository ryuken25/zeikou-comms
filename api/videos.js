// Vercel serverless: proxy YouTube RSS feed (keeps site DB-less, always fresh).
// GET /api/videos -> { live: true, videos: [...] } | { live: false, videos: [] }
const CHANNEL_ID = "UCKw-FdF0DPlKoRGwCFBcQQA";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

function decode(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export default async function handler(_req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(FEED, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`feed ${r.status}`);
    const xml = await r.text();

    const videos = [];
    const entries = xml.split("<entry>").slice(1);
    for (const e of entries) {
      const pick = (re) => {
        const m = e.match(re);
        return m ? decode(m[1].trim()) : null;
      };
      const id = pick(/<yt:videoId>(.*?)<\/yt:videoId>/);
      if (!id) continue;
      const published = pick(/<published>(.*?)<\/published>/);
      const views = e.match(/views="(\d+)"/);
      const dur = e.match(/duration="(\d+)"/);
      const title = pick(/<title>(.*?)<\/title>/);
      const mediaThumb = e.match(/<media:thumbnail url="([^"]+)"/);
      videos.push({
        id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        published,
        views: views ? parseInt(views[1], 10) : null,
        duration: dur ? parseInt(dur[1], 10) : null,
        thumb: mediaThumb ? mediaThumb[1] : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      });
    }
    if (!videos.length) throw new Error("empty feed");
    return res.status(200).json({ live: true, source: "rss", videos });
  } catch (err) {
    return res.status(200).json({ live: false, error: String(err && err.message || err), videos: [] });
  }
}
