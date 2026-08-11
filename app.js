/* Zeikou — comms site logic
   - videos: fetched from /api/videos (serverless YouTube RSS proxy, always fresh)
     with graceful fallback to /data/videos.json (scraped snapshot)
   - player: YouTube IFrame API with video / audio-only modes
*/
(() => {
  "use strict";

  const CHANNEL_URL = "https://www.youtube.com/@zeikouch";
  const grid = document.getElementById("video-grid");
  const feedNote = document.getElementById("feed-note");
  const overlay = document.getElementById("player-overlay");
  const stage = document.getElementById("player-stage");
  const frameWrap = document.getElementById("player-frame-wrap");
  const audioUI = document.getElementById("player-audio-ui");
  const playerThumb = document.getElementById("player-thumb");
  const playerTitle = document.getElementById("player-title");
  const playerYt = document.getElementById("player-yt");
  const playerClose = document.getElementById("player-close");

  /* ---------------- state ---------------- */
  let mode = localStorage.getItem("zeikou-mode") || "video";
  let videos = [];
  let player = null;
  let apiReady = false;
  let pendingId = null;

  /* ---------------- stars ---------------- */
  const stars = document.getElementById("stars");
  const starCount = Math.min(70, Math.floor(window.innerWidth / 16));
  for (let i = 0; i < starCount; i++) {
    const s = document.createElement("i");
    const size = Math.random() * 2.2 + 0.8;
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 100 + "%";
    s.style.animationDelay = (Math.random() * 3).toFixed(2) + "s";
    s.style.animationDuration = (2.4 + Math.random() * 2.4).toFixed(2) + "s";
    stars.appendChild(s);
  }

  /* ---------------- yt iframe api ---------------- */
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => { apiReady = true; flushPending(); };

  function ensurePlayer(videoId) {
    if (!apiReady) { pendingId = videoId; return; }
    if (player) {
      player.loadVideoById(videoId);
      player.playVideo();
      return;
    }
    player = new YT.Player("yt-player", {
      videoId,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
      events: { onReady: (e) => e.target.playVideo() }
    });
  }
  function flushPending() {
    if (pendingId) { const id = pendingId; pendingId = null; ensurePlayer(id); }
  }

  /* ---------------- data ---------------- */
  function cleanTitle(t) {
    return t.replace(/^【[^】]*】\s*/, (m) => m).trim();
  }
  function fmtDur(sec) {
    if (!sec) return "";
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  async function loadVideos() {
    // fallback snapshot first (has duration + local thumbs)
    let fallback = [];
    try {
      const r2 = await fetch("/data/videos.json", { cache: "no-store" });
      if (r2.ok) fallback = await r2.json();
    } catch (e) { /* ignore */ }
    const fb = {};
    (Array.isArray(fallback) ? fallback : []).forEach((v) => { fb[v.id] = v; });

    let data = null, live = false;
    try {
      const r = await fetch("/api/videos", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        live = !!j.live;
        data = j.videos || [];
      }
    } catch (e) { /* fallthrough */ }

    if (!Array.isArray(data) || !data.length) {
      data = fallback;
      feedNote.hidden = false;
    } else {
      // merge: fill duration + prefer local thumbs from snapshot
      data = data.map((v) => Object.assign({}, v, {
        duration: v.duration || (fb[v.id] && fb[v.id].duration) || null,
        thumb: (fb[v.id] && fb[v.id].thumb) || v.thumb,
      }));
      if (!live) feedNote.hidden = false;
    }
    videos = Array.isArray(data) ? data : [];
    render();
  }

  function render() {
    grid.innerHTML = "";
    if (!videos.length) {
      grid.innerHTML = '<div class="grid-skeleton">No covers loaded — <a href="' + CHANNEL_URL + '" target="_blank" rel="noopener">open the channel</a>.</div>';
      return;
    }
    videos.forEach((v, i) => {
      const card = document.createElement("article");
      card.className = "vcard";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      const thumb = v.thumb || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
      card.innerHTML = `
        <div class="vcard-thumb">
          <img src="${thumb}" alt="" loading="lazy"/>
          <div class="vcard-play"><span>${mode === "audio" ? "♪" : "▶"}</span></div>
        </div>
        <div class="vcard-body">
          <p class="vcard-title">${escapeHtml(v.title)}</p>
          <div class="vcard-meta">
            ${v.duration ? `<span>${fmtDur(v.duration)}</span>` : ""}
            ${v.views ? `<span>${v.views.toLocaleString()} plays</span>` : ""}
            ${v.published ? `<span>${fmtDate(v.published)}</span>` : ""}
            <span class="vcard-audio-badge">${mode === "audio" ? "♪ audio mode" : ""}</span>
          </div>
        </div>`;
      const open = () => openPlayer(v);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      grid.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- player ---------------- */
  function openPlayer(v) {
    playerTitle.textContent = v.title;
    playerYt.href = v.url || `https://www.youtube.com/watch?v=${v.id}`;
    const thumb = v.thumb || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    playerThumb.src = thumb.replace(/^\/assets\//, "/assets/");
    playerThumb.alt = v.title;
    applyMode();
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (!frameWrap.querySelector("iframe")) {
      const holder = document.createElement("div");
      holder.id = "yt-player";
      frameWrap.appendChild(holder);
    }
    ensurePlayer(v.id);
    if (document.activeElement) document.activeElement.blur();
  }
  function closePlayer() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    if (player && player.stopVideo) player.stopVideo();
  }
  playerClose.addEventListener("click", closePlayer);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closePlayer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closePlayer(); });

  function applyMode() {
    stage.classList.toggle("audio-mode", mode === "audio");
    document.querySelectorAll(".mode-toggle").forEach((g) => {
      g.querySelectorAll(".chip").forEach((c) => {
        const m = c.dataset.mode || c.dataset.pmode;
        c.classList.toggle("is-on", m === mode);
      });
    });
  }

  document.querySelectorAll(".mode-toggle").forEach((g) => {
    g.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const m = btn.dataset.mode || btn.dataset.pmode;
      if (m === mode) return;
      mode = m;
      localStorage.setItem("zeikou-mode", mode);
      applyMode();
      render(); // refresh card play icons
    });
  });
  applyMode();

  /* ---------------- request form ---------------- */
  const form = document.getElementById("request-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const get = (k) => (fd.get(k) || "").toString().trim();
    const subject = `[Mix Request] from ${get("name") || "anonymous"}`;
    const body = [
      `Name: ${get("name")}`,
      `Contact: ${get("contact")}`,
      `Deadline: ${get("deadline") || "flexible"}`,
      `References: ${get("refs") || "-"}`,
      ``,
      `Brief:`,
      get("brief"),
      ``,
      `(sent from zeikou comms site)`
    ].join("\n");
    window.location.href = `mailto:Zeikou@wyna.dev?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  /* ---------------- open-request buttons ---------------- */
  document.querySelectorAll("[data-open-request]").forEach((b) => {
    b.addEventListener("click", () => {
      document.getElementById("request").scrollIntoView({ behavior: "smooth" });
    });
  });

  loadVideos();
})();
