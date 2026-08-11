# Zeikou — Comms Site

Static-ish comms website for **Zeikou** (utaite / vocal covers).
Structure inspired by suzu-comms; night-plum theme matched to Zeikou's art.

## Features
- ✅ Covers list **fetched live** from the YouTube channel RSS via `/api/videos`
  (tiny serverless proxy — no database, no YouTube API key)
- ✅ Fallback to `/data/videos.json` (scraped snapshot) when the feed is unreachable
- ▶ Video mode: plays the actual YouTube video in a modal
- ♪ Audio-only mode: hidden player (sound only) + visualizer UI, preference persisted
- 💰 Price list: Mixing **200k+ / DM for more info** — `Zeikou@wyna.dev`
- 📩 Request form (opens mail client, no backend needed)
- 🌌 Starfield background, GSAP-less CSS animations, fully responsive

## Stack
Pure HTML/CSS/JS + one Vercel serverless function (`/api/videos`).
No DB, no build step, no framework.

## Local dev
```bash
npx serve .          # static files
curl "http://localhost:3000/api/videos"  # needs: npx vercel dev
```

## Data refresh
Videos auto-refresh from the RSS feed (5 min edge cache).
To refresh the fallback snapshot:
```bash
curl -s "https://www.youtube.com/feeds/videos.xml?channel_id=UCKw-FdF0DPlKoRGwCFBcQQA"
```

## Channel
- YouTube: https://www.youtube.com/@zeikouch (UC Kw-FdF0DPlKoRGwCFBcQQA)
- X: @Zeikou_Ch
- Email: Zeikou@wyna.dev
