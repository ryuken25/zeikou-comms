// Vercel serverless: playlist RSS proxy. No DB and no YouTube API key.
// Playlist 1 = covers, playlist 2 = mixing comms, playlist 3 = collab.
const FEEDS = [
  { id: "PL_OfizlA86cHWo1Mg7KfLfF__irmOK7hr", category: "covers" },
  { id: "PL_OfizlA86cFuK64xrb-4I1SiOB66d0pR", category: "mixing" },
  { id: "PL_OfizlA86cGpSaDF4wmunJL8Lpz4LBeP", category: "collab" }
];

function decode(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function parseFeed(xml, category) {
  return xml.split("<entry>").slice(1).flatMap((e) => {
    const pick = (re) => { const m = e.match(re); return m ? decode(m[1].trim()) : null; };
    const id = pick(/<yt:videoId>(.*?)<\/yt:videoId>/);
    if (!id) return [];
    const views = e.match(/views="(\d+)"/);
    const dur = e.match(/duration="(\d+)"/);
    const mediaThumb = e.match(/<media:thumbnail url="([^"]+)"/);
    return [{
      id, category, title: pick(/<title>(.*?)<\/title>/),
      url: `https://www.youtube.com/watch?v=${id}`,
      published: pick(/<published>(.*?)<\/published>/),
      views: views ? parseInt(views[1], 10) : null,
      duration: dur ? parseInt(dur[1], 10) : null,
      thumb: mediaThumb ? mediaThumb[1] : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    }];
  });
}

export default async function handler(_req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
  try {
    const results = await Promise.all(FEEDS.map(async ({ id, category }) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${id}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`feed ${r.status}`);
        return parseFeed(await r.text(), category);
      } finally { clearTimeout(timer); }
    }));
    const unique = new Map();
    results.flat().forEach((v) => { if (!unique.has(v.id)) unique.set(v.id, v); });
    const videos = [...unique.values()].sort((a, b) => String(b.published).localeCompare(String(a.published)));
    if (!videos.length) throw new Error("empty playlist feeds");
    return res.status(200).json({ live: true, source: "playlist-rss", videos });
  } catch (err) {
    return res.status(200).json({ live: false, error: String(err && err.message || err), videos: [] });
  }
}

// playlist categories are intentionally explicit so new uploads land in the right filter.
// playlist 1 COVERS + playlist 3 COLLABS => covers; playlist 2 MIX COMMS => mixing.
