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
  const playbackToggle = document.getElementById("playback-toggle");

  const root = document.getElementById("player-root");
  const backdrop = document.getElementById("player-backdrop");
  const stage = document.getElementById("ps-stage");
  const frameBox = document.getElementById("ps-frame");
  const thumb = document.getElementById("ps-thumb");
  const title = document.getElementById("ps-title");
  const miniTitle = document.getElementById("ps-mini-title");
  const miniMode = document.getElementById("ps-mini-mode");
  const miniInfo = document.getElementById("ps-mini-info");

  const psCur = document.getElementById("ps-cur");
  const psDur = document.getElementById("ps-dur");
  const psTrack = document.getElementById("ps-track");
  const psFill = document.getElementById("ps-fill");
  const psKnob = document.getElementById("ps-knob");

  /* ---------------- state ---------------- */
  let mode = localStorage.getItem("zeikou-mode") || "video";
  let category = localStorage.getItem("zeikou-category") || "covers";
  let shuffleOn = localStorage.getItem("zeikou-shuffle") === "1";
  let videos = [];
  let allVideos = [];
  let current = null;
  let player = null;
  let apiReady = false;
  let pendingId = null;
  let isPlaying = false;
  let shellBuilt = false;
  let duration = 0;
  let seekTimer = null;
  let dragging = false;

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

  /* ---------------- yt iframe api ----------------
     Do not load YouTube's widget on page load. The player is opt-in, so keep
     the initial page free of the iframe API and its compositor work. */
  let ytRequested = false;
  function requestYouTubeApi() {
    if (ytRequested || apiReady) return;
    ytRequested = true;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
  }
  window.onYouTubeIframeAPIReady = () => { apiReady = true; flushPending(); };

  function buildShell() {
    if (shellBuilt) return;
    shellBuilt = true;
    const holder = document.createElement("div");
    holder.id = "yt-player";
    frameBox.appendChild(holder);
  }

  function ensurePlayer(videoId) {
    if (!apiReady) {
      pendingId = videoId;
      requestYouTubeApi();
      return;
    }
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
        onReady: (e) => { e.target.playVideo(); startSeekLoop(); },
        onStateChange: (e) => {
          isPlaying = e.data === YT.PlayerState.PLAYING;
          updatePlayIcons();
          if (e.data === YT.PlayerState.ENDED) playNext();
          if (e.data === YT.PlayerState.PLAYING) duration = e.target.getDuration() || duration;
        },
      },
    });
  }
  function flushPending() {
    if (pendingId) { const id = pendingId; pendingId = null; ensurePlayer(id); }
  }

  /* ---------------- seek / progress ---------------- */
  function fmtTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function paintProgress(cur, dur) {
    const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
    psFill.style.width = pct + "%";
    psKnob.style.left = pct + "%";
    psCur.textContent = fmtTime(cur);
    psDur.textContent = fmtTime(dur);
  }

  function startSeekLoop() {
    if (seekTimer) return;
    seekTimer = setInterval(() => {
      if (!player || !player.getCurrentTime) return;
      if (dragging) return;
      try {
        const cur = player.getCurrentTime() || 0;
        duration = player.getDuration() || duration;
        paintProgress(cur, duration);
      } catch (e) { /* iframe not ready */ }
    }, 500);
  }

  /* drag / click to seek */
  function seekFromEvent(e) {
    const rect = psTrack.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const ratio = Math.min(1, Math.max(0, x / rect.width));
    return ratio;
  }
  function applySeek(ratio) {
    if (!duration) return;
    const t = ratio * duration;
    paintProgress(t, duration);
    if (player && player.seekTo) player.seekTo(t, true);
  }
  function onSeekStart(e) {
    if (!player) return;
    dragging = true;
    psTrack.classList.add("is-active");
    const move = (ev) => { applySeekPreview(seekFromEvent(ev)); };
    const up = (ev) => {
      dragging = false;
      psTrack.classList.remove("is-active");
      applySeek(seekFromEvent(ev.changedTouches ? ev.changedTouches[0] : ev));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
  }
  function applySeekPreview(ratio) {
    if (!duration) return;
    paintProgress(ratio * duration, duration);
  }
  psTrack.addEventListener("pointerdown", onSeekStart);
  psTrack.addEventListener("touchstart", onSeekStart, { passive: true });

  /* ---------------- transport ---------------- */
  function updatePlayIcons() {
    [document.getElementById("ps-play"), document.getElementById("pm-play")].forEach((btn) => {
      if (!btn) return;
      const icon = btn.querySelector(".play-toggle path");
      if (icon) icon.setAttribute("d", isPlaying
        ? "M4 2h3v12H4zM9 2h3v12H9z"
        : "M5.2 3.05v9.9c0 .55.6.88 1.05.6l7.2-4.95a.72.72 0 0 0 0-1.2l-7.2-4.95a.72.72 0 0 0-1.05.6z");
      btn.setAttribute("aria-label", isPlaying ? "pause" : "play");
    });
  }

  function togglePlay() {
    if (!player) return;
    if (isPlaying) player.pauseVideo(); else player.playVideo();
  }

  function idx() { return videos.findIndex((v) => current && v.id === current.id); }

  function playNext() {
    if (!videos.length || !current) return;
    if (shuffleOn && videos.length > 1) {
      const pool = videos.filter((v) => v.id !== current.id);
      playVideo(pool[Math.floor(Math.random() * pool.length)]);
    } else {
      playVideo(videos[(idx() + 1) % videos.length]);
    }
  }
  function playPrev() {
    if (!videos.length || !current) return;
    if (player && player.getCurrentTime && player.getCurrentTime() > 4) {
      player.seekTo(0, true);
      return;
    }
    if (shuffleOn && videos.length > 1) {
      const pool = videos.filter((v) => v.id !== current.id);
      playVideo(pool[Math.floor(Math.random() * pool.length)]);
    } else {
      playVideo(videos[(idx() - 1 + videos.length) % videos.length]);
    }
  }

  function toggleShuffle() {
    shuffleOn = !shuffleOn;
    localStorage.setItem("zeikou-shuffle", shuffleOn ? "1" : "0");
    [document.getElementById("ps-shuffle")].forEach((b) => b && b.classList.toggle("is-active", shuffleOn));
  }
  const shuffleBtn = document.getElementById("ps-shuffle");
  if (shuffleBtn) shuffleBtn.classList.toggle("is-active", shuffleOn);

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
      const r2 = await fetch("/data/videos.json", { cache: "default" });
      if (r2.ok) fallback = await r2.json();
    } catch (e) { /* ignore */ }
    const fb = {};
    (Array.isArray(fallback) ? fallback : []).forEach((v) => { fb[v.id] = v; });

    let data = null, live = false;
    try {
      const r = await fetch("/api/videos", { cache: "default" });
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
    allVideos = Array.isArray(data) ? data : [];
    applyCategory();
  }

  function applyCategory() {
    videos = allVideos.filter((v) => (v.category || "covers") === category);
    document.querySelectorAll("[data-category]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.category === category);
    });
    const hasCards = grid.querySelector(".vcard");
    if (!hasCards) { render(); return; }
    grid.classList.add("is-switching");
    window.setTimeout(() => {
      render();
      requestAnimationFrame(() => grid.classList.remove("is-switching"));
    }, 150);
  }

  function render() {
    grid.innerHTML = "";
    if (!videos.length) {
      grid.innerHTML = '<div class="grid-skeleton">nothing here yet. <a href="' + CHANNEL_URL + '" target="_blank" rel="noopener">open the channel</a></div>';
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
    const previous = root.dataset.state;
    const motion = state === "full" && previous !== "full" ? "is-expanding" : state === "mini" && previous === "full" ? "is-minimizing" : "";
    root.classList.remove("is-expanding", "is-minimizing");
    root.dataset.state = state;
    root.hidden = state === "closed";
    document.body.classList.toggle("has-player", state !== "closed");
    document.body.classList.toggle("has-mini", state === "mini");
    document.body.classList.toggle("player-full", state === "full");
    if (motion) {
      root.classList.add(motion);
      const shell = root.querySelector(".player-shell");
      shell?.addEventListener("animationend", () => root.classList.remove(motion), { once: true });
    }
    const inFull = state === "full";
    const inMini = state === "mini";
    // mac lights: yellow(min) only works from full, green(max) only from mini
    document.getElementById("ps-minimize").classList.toggle("is-disabled", !inFull);
    document.getElementById("ps-maximize").classList.toggle("is-disabled", !inMini);
  }

  function applyVideoUI(v) {
    title.textContent = v.title;
    miniTitle.textContent = v.title;
    thumb.src = localThumb(v);
    thumb.alt = v.title;
    duration = v.duration || 0;
    paintProgress(0, duration);
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

  function minimize() { if (current && root.dataset.state === "full") setState("mini"); }
  function expand() { if (current && root.dataset.state === "mini") setState("full"); }

  function stopAll() {
    if (player && player.stopVideo) player.stopVideo();
    isPlaying = false;
    current = null;
    setState("closed");
    updatePlayIcons();
    document.title = "Zeikou · vocal covers & mixing";
    render();
  }

  /* ---------------- wiring ---------------- */
  document.getElementById("ps-minimize").addEventListener("click", minimize);
  document.getElementById("ps-maximize").addEventListener("click", expand);
  document.getElementById("ps-close").addEventListener("click", stopAll);
  document.getElementById("ps-play").addEventListener("click", togglePlay);
  document.getElementById("ps-prev").addEventListener("click", playPrev);
  document.getElementById("ps-next").addEventListener("click", playNext);
  document.getElementById("ps-shuffle").addEventListener("click", toggleShuffle);
  document.getElementById("pm-play").addEventListener("click", togglePlay);
  document.getElementById("pm-next").addEventListener("click", playNext);
  miniInfo.addEventListener("click", expand);
  backdrop.addEventListener("click", minimize);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.dataset.state === "full") minimize();
  });

  /* ---------------- modes ---------------- */
  function applyModeUI() {
    const audio = mode === "audio";
    stage.classList.toggle("audio-mode", audio);
    miniMode.textContent = audio ? "audio only" : "video";
    if (playbackToggle) {
      playbackToggle.dataset.mode = audio ? "audio" : "video";
      playbackToggle.setAttribute("aria-pressed", String(audio));
      playbackToggle.setAttribute("aria-label", audio ? "switch to video" : "switch to audio only");
      playbackToggle.title = audio ? "switch to video" : "switch to audio only";
    }
    document.querySelectorAll(".mode-toggle").forEach((g) => {
      g.querySelectorAll(".chip").forEach((c) => {
        const m = c.dataset.mode || c.dataset.pmode;
        c.classList.toggle("is-on", m === mode);
      });
    });
  }
  if (playbackToggle) playbackToggle.addEventListener("click", () => {
    mode = mode === "audio" ? "video" : "audio";
    localStorage.setItem("zeikou-mode", mode);
    applyModeUI();
    render();
  });
  document.querySelectorAll("[data-category]").forEach((b) => {
    b.addEventListener("click", () => {
      category = b.dataset.category;
      localStorage.setItem("zeikou-category", category);
      applyCategory();
    });
  });

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

  /* ---------------- cursor glow ----------------
     Animate only while the pointer is moving. A permanent RAF here used to
     consume a frame budget even when the glow was invisible on touch devices. */
  const glow = document.createElement("div");
  glow.className = "cursor-glow";
  document.body.appendChild(glow);
  let gx = -500, gy = -500, tx = -500, ty = -500;
  let glowRaf = 0;
  let glowActive = false;
  const animateGlow = () => {
    gx += (tx - gx) * 0.12;
    gy += (ty - gy) * 0.12;
    glow.style.transform = `translate(${gx - 160}px, ${gy - 160}px)`;
    const settled = Math.abs(tx - gx) < 0.5 && Math.abs(ty - gy) < 0.5;
    if (!settled && !document.hidden && !document.body.classList.contains("player-full")) {
      glowRaf = requestAnimationFrame(animateGlow);
    } else {
      glowRaf = 0;
      glowActive = false;
    }
  };
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    tx = e.clientX; ty = e.clientY;
    if (!glowActive && !document.hidden && !document.body.classList.contains("player-full")) {
      glowActive = true;
      if (!glowRaf) glowRaf = requestAnimationFrame(animateGlow);
    }
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && glowRaf) cancelAnimationFrame(glowRaf);
    glowRaf = 0;
    glowActive = false;
  });

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
