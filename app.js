/* Zeikou — comms site logic
   - videos: /api/videos (RSS proxy) + /data/videos.json fallback
   - ONE permanent player shell that morphs full ⇄ mini:
     the iframe never moves in the DOM, so minimize/expand never restarts the song
*/
(() => {
  "use strict";

  const CHANNEL_URL = "https://www.youtube.com/@zeikouch";
  const grid = document.getElementById("video-grid");
  const feedNote = document.getElementById("feed-note");

  const root = document.getElementById("player-root");
  const backdrop = document.getElementById("player-backdrop");
  const stage = document.getElementById("ps-stage");
  const frameBox = document.getElementById("ps-frame");
  const audioUI = document.getElementById("ps-audio");
  const thumb = document.getElementById("ps-thumb");
  const title = document.getElementById("ps-title");
  const ytLink = document.getElementById("ps-yt");

  const miniTitle = document.getElementById("ps-mini-title");
  const miniMode = document.getElementById("ps-mini-mode");
  const miniInfo = document.getElementById("ps-mini-info");

  /* ---------------- state ---------------- */
  let mode = localStorage.getItem("zeikou-mode") || "video";
  let videos = [];
  let current = null;
  let player = null;
  let apiReady = false;
  let pendingId = null;
  let isPlaying = false;
  let shellBuilt = false;

  /* ---------------- stars ---------------- */
  const stars = document.getElementById("stars");
  const starCount = Math.min(80, Math.floor(window.innerWidth / 14));
  for (let i = 0; i < starCount; i++) {
    const s = document.createElement("i");
    const size = Math.random() * 2.2 + 0.8;
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 100 + "%";
    s.style.animationDelay = (Math.random() * 3).toFixed(2) + "s";
    s.style.animationDuration = (2.4 + Math.random() * 2.4).toFixed(2) + "s";
    if (Math.random() < 0.18) s.classList.add("star-pink");
    stars.appendChild(s);
  }

  /* ---------------- yt iframe api ---------------- */
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => { apiReady = true; flushPending(); };

  function buildShell() {
    if (shellBuilt) return;
    shellBuilt = true;
    const holder = document.createElement("div");
    holder.id = "yt-player";
    frameBox.appendChild(holder);
  }

  function ensurePlayer(videoId) {
    if (!apiReady) { pendingId = videoId; return; }
    buildShell();
    if (player) {
      player.loadVideoById(videoId);
      player.playVideo();
      return;
    }
    player = new YT.Player("yt-player", {
      videoId,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
      events: {
        onReady: (e) => e.target.playVideo(),
        onStateChange: (e) => {
          isPlaying = e.data === YT.PlayerState.PLAYING;
          updatePlayIcons();
          if (e.data === YT.PlayerState.ENDED) playNext();
        },
      },
    });
  }
  function flushPending() {
    if (pendingId) { const id = pendingId; pendingId = null; ensurePlayer(id); }
  }

  function updatePlayIcons() {
    [document.getElementById("ps-play"), document.getElementById("pm-play")].forEach((btn) => {
      if (!btn) return;
      btn.querySelector(".ic-pause").hidden = !isPlaying;
      btn.querySelector(".ic-play").hidden = isPlaying;
      btn.setAttribute("aria-label", isPlaying ? "pause" : "play");
    });
  }

  function togglePlay() {
    if (!player) return;
    if (isPlaying) player.pauseVideo(); else player.playVideo();
  }

  /* ---------------- data ---------------- */
  function fmtDur(sec) {
    if (!sec) return "";
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  function localThumb(v) {
    const t = v.thumb || "";
    return t.startsWith("/assets/") ? t : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  }
  function ytUrl(v) {
    return v.url || `https://www.youtube.com/watch?v=${v.id}`;
  }

  async function loadVideos() {
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
      grid.innerHTML = '<div class="grid-skeleton">nothing loaded yet. <a href="' + CHANNEL_URL + '" target="_blank" rel="noopener">open the channel</a></div>';
      return;
    }
    videos.forEach((v) => {
      const card = document.createElement("article");
      card.className = "vcard reveal in";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      const playingThis = current && current.id === v.id;
      const icon = playingThis ? (isPlaying ? "❚❚" : "▶") : (mode === "audio" ? "♪" : "▶");
      card.innerHTML = `
        <div class="vcard-thumb">
          <img src="${localThumb(v)}" alt="" loading="lazy"/>
          <div class="vcard-play"><span>${icon}</span></div>
        </div>
        <div class="vcard-body">
          <p class="vcard-title">${escapeHtml(v.title)}</p>
          <div class="vcard-meta">
            ${v.duration ? `<span>${fmtDur(v.duration)}</span>` : ""}
            ${v.views ? `<span>${v.views.toLocaleString()} plays</span>` : ""}
            ${v.published ? `<span>${fmtDate(v.published)}</span>` : ""}
          </div>
        </div>`;
      const open = () => playVideo(v, "full");
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      grid.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- player shell (full ⇄ mini) ---------------- */
  function setState(state) {
    root.dataset.state = state;
    root.hidden = state === "closed";
    document.body.classList.toggle("has-player", state !== "closed");
    document.body.classList.toggle("has-mini", state === "mini");
    document.body.classList.toggle("player-full", state === "full");
  }

  function applyVideoUI(v) {
    title.textContent = v.title;
    miniTitle.textContent = v.title;
    ytLink.href = ytUrl(v);
    thumb.src = localThumb(v);
    thumb.alt = v.title;
    document.title = `▶ ${v.title}`;
  }

  function playVideo(v, state) {
    const sameVideo = current && current.id === v.id;
    current = v;
    applyVideoUI(v);
    if (!sameVideo) ensurePlayer(v.id);
    const newState = state || (root.dataset.state === "mini" ? "mini" : "full");
    setState(newState);
    render();
  }

  function minimize() { if (current) setState("mini"); }
  function expand() { if (current) setState("full"); }

  function stopAll() {
    if (player && player.stopVideo) player.stopVideo();
    isPlaying = false;
    current = null;
    setState("closed");
    updatePlayIcons();
    document.title = "Zeikou · vocal covers & mixing";
    render();
  }

  function playNext() {
    if (!videos.length || !current) return;
    const i = videos.findIndex((v) => v.id === current.id);
    const next = videos[(i + 1) % videos.length];
    playVideo(next);
  }

  function shuffle() {
    if (!videos.length || !current) return;
    const pool = videos.filter((v) => v.id !== current.id);
    if (!pool.length) return;
    playVideo(pool[Math.floor(Math.random() * pool.length)]);
  }

  /* ---------------- wiring ---------------- */
  document.getElementById("ps-minimize").addEventListener("click", minimize);
  document.getElementById("ps-close").addEventListener("click", stopAll);
  document.getElementById("ps-play").addEventListener("click", togglePlay);
  document.getElementById("ps-shuffle").addEventListener("click", shuffle);
  document.getElementById("pm-close").addEventListener("click", stopAll);
  document.getElementById("pm-expand").addEventListener("click", expand);
  document.getElementById("pm-play").addEventListener("click", togglePlay);
  document.getElementById("pm-shuffle").addEventListener("click", shuffle);
  miniInfo.addEventListener("click", expand);
  audioUI.addEventListener("click", () => { if (root.dataset.state === "mini") expand(); });
  backdrop.addEventListener("click", minimize);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.dataset.state === "full") minimize();
  });

  /* ---------------- modes ---------------- */
  function applyModeUI() {
    stage.classList.toggle("audio-mode", mode === "audio");
    miniMode.textContent = mode === "audio" ? "♪ audio" : "▶ video";
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
      applyModeUI();
      render();
    });
  });

  /* ---------------- request form ---------------- */
  const form = document.getElementById("request-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const get = (k) => (fd.get(k) || "").toString().trim();
    const subject = `[mix request] from ${get("name") || "anonymous"}`;
    const body = [
      `name: ${get("name")}`,
      `contact: ${get("contact")}`,
      `deadline: ${get("deadline") || "flexible"}`,
      `references: ${get("refs") || "-"}`,
      ``,
      `brief:`,
      get("brief"),
      ``,
      `(sent from the zeikou site)`
    ].join("\n");
    window.location.href = `mailto:Zeikou@wyna.dev?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  document.querySelectorAll("[data-open-request]").forEach((b) => {
    b.addEventListener("click", () => {
      document.getElementById("request").scrollIntoView({ behavior: "smooth" });
    });
  });

  /* ---------------- scroll reveal ---------------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el, i) => {
    el.style.transitionDelay = (i % 3) * 60 + "ms";
    io.observe(el);
  });

  /* ---------------- cursor glow ---------------- */
  const glow = document.createElement("div");
  glow.className = "cursor-glow";
  document.body.appendChild(glow);
  let gx = -500, gy = -500, tx = -500, ty = -500;
  window.addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
  (function animGlow() {
    gx += (tx - gx) * 0.12;
    gy += (ty - gy) * 0.12;
    glow.style.transform = `translate(${gx - 160}px, ${gy - 160}px)`;
    requestAnimationFrame(animGlow);
  })();

  /* ---------------- hero parallax ---------------- */
  const heroAvatar = document.querySelector(".hero-avatar-wrap");
  window.addEventListener("scroll", () => {
    if (!heroAvatar) return;
    const y = window.scrollY;
    if (y < 700) heroAvatar.style.translate = `0 ${y * 0.12}px`;
  }, { passive: true });

  applyModeUI();
  loadVideos();
})();
