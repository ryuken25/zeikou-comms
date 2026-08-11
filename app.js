/* Zeikou — comms site logic
   - videos: /api/videos (serverless YouTube RSS proxy) + /data/videos.json fallback
   - player: YT IFrame API, full modal ⇄ mini player (bottom-right), video & audio-only
*/
(() => {
  "use strict";

  const CHANNEL_URL = "https://www.youtube.com/@zeikouch";
  const grid = document.getElementById("video-grid");
  const feedNote = document.getElementById("feed-note");
  const overlay = document.getElementById("player-overlay");
  const stage = document.getElementById("player-stage");
  const modalWrap = document.getElementById("player-frame-wrap");
  const audioUI = document.getElementById("player-audio-ui");
  const playerThumb = document.getElementById("player-thumb");
  const playerTitle = document.getElementById("player-title");
  const playerYt = document.getElementById("player-yt");
  const playerClose = document.getElementById("player-close");

  const mini = document.getElementById("mini-player");
  const miniFrame = document.getElementById("mini-frame");
  const miniAudioBtn = document.getElementById("mini-audio");
  const miniThumb = document.getElementById("mini-thumb");
  const miniInfo = document.getElementById("mini-info");
  const miniTitle = document.getElementById("mini-title");
  const miniMode = document.getElementById("mini-mode");
  const miniPlay = document.getElementById("mini-play");
  const miniExpand = document.getElementById("mini-expand");
  const miniClose = document.getElementById("mini-close");

  /* ---------------- state ---------------- */
  let mode = localStorage.getItem("zeikou-mode") || "video";
  let videos = [];
  let current = null;          // current video object
  let player = null;
  let apiReady = false;
  let pendingId = null;
  let isPlaying = false;
  let shell = null;            // #yt-shell wrapper (moving it never reloads the iframe)

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

  function getShell() {
    if (shell) return shell;
    shell = document.createElement("div");
    shell.id = "yt-shell";
    const holder = document.createElement("div");
    holder.id = "yt-player";
    shell.appendChild(holder);
    modalWrap.appendChild(shell);
    return shell;
  }

  function ensurePlayer(videoId) {
    if (!apiReady) { pendingId = videoId; return; }
    if (player) {
      player.loadVideoById(videoId);
      player.playVideo();
      return;
    }
    getShell();
    player = new YT.Player("yt-player", {
      videoId,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
      events: {
        onReady: (e) => e.target.playVideo(),
        onStateChange: (e) => {
          isPlaying = e.data === YT.PlayerState.PLAYING;
          updatePlayBtn();
        },
      },
    });
  }
  function flushPending() {
    if (pendingId) { const id = pendingId; pendingId = null; ensurePlayer(id); }
  }
  function updatePlayBtn() {
    miniPlay.textContent = isPlaying ? "❚❚" : "▶";
    miniPlay.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
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
      grid.innerHTML = '<div class="grid-skeleton">No covers loaded — <a href="' + CHANNEL_URL + '" target="_blank" rel="noopener">open the channel</a>.</div>';
      return;
    }
    videos.forEach((v) => {
      const card = document.createElement("article");
      card.className = "vcard reveal in";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      const playingThis = current && current.id === v.id;
      card.innerHTML = `
        <div class="vcard-thumb">
          <img src="${localThumb(v)}" alt="" loading="lazy"/>
          <div class="vcard-play"><span>${playingThis ? (mode === "audio" ? "♪" : "❚❚") : (mode === "audio" ? "♪" : "▶")}</span></div>
        </div>
        <div class="vcard-body">
          <p class="vcard-title">${escapeHtml(v.title)}</p>
          <div class="vcard-meta">
            ${v.duration ? `<span>${fmtDur(v.duration)}</span>` : ""}
            ${v.views ? `<span>${v.views.toLocaleString()} plays</span>` : ""}
            ${v.published ? `<span>${fmtDate(v.published)}</span>` : ""}
          </div>
        </div>`;
      const open = () => openFull(v);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      grid.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- player: full ⇄ mini ---------------- */
  function mountShell(container) {
    const sh = getShell();
    if (sh.parentElement !== container) container.appendChild(sh);
  }

  function openFull(v) {
    current = v;
    playerTitle.textContent = v.title;
    playerYt.href = v.url || `https://www.youtube.com/watch?v=${v.id}`;
    playerThumb.src = localThumb(v);
    playerThumb.alt = v.title;
    applyModeUI();
    mountShell(modalWrap);
    overlay.hidden = false;
    setMini(false);
    document.body.classList.add("player-open");
    ensurePlayer(v.id);
    render();
  }

  function minimize() {
    if (!current) return;
    overlay.hidden = true;
    document.body.classList.remove("player-open");
    mountShell(miniFrame);
    miniTitle.textContent = current.title;
    miniThumb.src = localThumb(current);
    miniYt();
    setMini(true);
    applyModeUI();
  }

  function expand() {
    if (!current) return;
    mountShell(modalWrap);
    overlay.hidden = false;
    document.body.classList.add("player-open");
    setMini(false);
  }

  function stopAll() {
    if (player && player.stopVideo) player.stopVideo();
    isPlaying = false;
    current = null;
    overlay.hidden = true;
    document.body.classList.remove("player-open");
    setMini(false);
    updatePlayBtn();
    render();
  }

  function setMini(on) {
    mini.hidden = !on;
    document.body.classList.toggle("has-mini", on);
  }

  function miniYt() {
    if (!current) return;
    playerYt.href = current.url || `https://www.youtube.com/watch?v=${current.id}`;
  }

  playerClose.addEventListener("click", minimize);
  miniExpand.addEventListener("click", expand);
  miniInfo.addEventListener("click", expand);
  miniAudioBtn.addEventListener("click", expand);
  miniClose.addEventListener("click", stopAll);
  miniPlay.addEventListener("click", () => {
    if (!player) return;
    if (isPlaying) player.pauseVideo(); else player.playVideo();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) minimize(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) minimize();
  });

  /* ---------------- modes ---------------- */
  function applyModeUI() {
    stage.classList.toggle("audio-mode", mode === "audio");
    mini.classList.toggle("audio-mode", mode === "audio");
    audioUI.hidden = mode !== "audio";
    miniMode.textContent = mode === "audio" ? "♪ audio only" : "▶ video";
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
