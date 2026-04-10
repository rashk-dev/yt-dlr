/**
 * VORTEX — YouTube Downloader
 * Uses the cobalt.tools open API — no backend or API key needed.
 * Just push to GitHub Pages and it works immediately.
 */

// ── cobalt.tools public API ──────────────────────────────────
// Multiple instances for reliability (cobalt is open source, self-hostable)
const COBALT_INSTANCES = [
  "https://api.cobalt.tools",
  "https://cobalt.api.timelessnesses.me",
];

// ── State ────────────────────────────────────────────────────
let currentUrl   = "";
let selectedQ    = "1080";

// ── DOM helpers ──────────────────────────────────────────────
const $   = id => document.getElementById(id);
const urlInput = $("url");

function setStatus(type, msg) {
  const box = $("status");
  box.className = type;
  $("status-msg").textContent = msg;
  $("spin").style.display = type === "info" ? "block" : "none";
  if (!type) box.style.display = "none";
}

function fmtDur(s) {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
    : `${m}:${String(sec).padStart(2,"0")}`;
}

function fmtViews(n) {
  if (!n) return "";
  if (n >= 1e9) return (n/1e9).toFixed(1)+"B views";
  if (n >= 1e6) return (n/1e6).toFixed(1)+"M views";
  if (n >= 1e3) return (n/1e3).toFixed(1)+"K views";
  return n+" views";
}

// ── Extract video ID ─────────────────────────────────────────
function extractId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("?")[0];
    return u.searchParams.get("v") || "";
  } catch { return ""; }
}

// ── Fetch video metadata via YouTube oEmbed (no key needed) ──
async function fetchInfo() {
  const raw = urlInput.value.trim();
  if (!raw) { urlInput.focus(); return; }

  const id = extractId(raw);
  if (!id) {
    setStatus("error", "Couldn't parse a YouTube video ID from that URL. Try: https://youtube.com/watch?v=...");
    return;
  }

  currentUrl = raw;

  $("btn-fetch").disabled = true;
  $("btn-fetch").textContent = "Loading…";
  $("preview").style.display = "none";
  setStatus("info", "Fetching video info…");

  try {
    // oEmbed gives us title + author for free, no API key
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(raw)}&format=json`
    ).then(r => r.json());

    // Thumbnail — use maxresdefault, fallback to hqdefault
    $("thumb").src       = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    $("dur").textContent = "";           // oEmbed doesn't give duration
    $("vid-title").textContent = oembed.title  || "Unknown title";
    $("author").textContent    = oembed.author_name || "";
    $("views").textContent     = "";             // not in oEmbed

    $("preview").style.display = "block";
    setStatus("", "");

  } catch (err) {
    setStatus("error", "Could not load video info. Check the URL and try again.");
  } finally {
    $("btn-fetch").disabled = false;
    $("btn-fetch").textContent = "Fetch";
  }
}

// ── Quality pill selection ───────────────────────────────────
function pick(el) {
  document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
  el.classList.add("active");
  selectedQ = el.dataset.q;
}

// ── Build cobalt request body ────────────────────────────────
function cobaltBody(url, q) {
  if (q === "audio") {
    return {
      url,
      downloadMode: "audio",
      audioFormat: "mp3",
      audioBitrate: "320",
    };
  }
  return {
    url,
    videoQuality: q,         // "1080" | "720" | "480" | "360"
    downloadMode: "auto",
    filenameStyle: "pretty",
  };
}

// ── Try each cobalt instance until one works ─────────────────
async function callCobalt(url, q) {
  const body = cobaltBody(url, q);
  let lastErr = "";

  for (const base of COBALT_INSTANCES) {
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        lastErr = `Server returned ${res.status}`;
        continue;
      }

      const data = await res.json();
      return data;   // success
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error("All cobalt instances failed: " + lastErr);
}

// ── Trigger browser download from a URL ─────────────────────
function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href     = href;
  a.download = filename || "download";
  a.target   = "_blank";
  a.rel      = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 500);
}

// ── Main download handler ────────────────────────────────────
async function doDownload() {
  if (!currentUrl) { setStatus("error", "Please fetch a video first."); return; }

  $("btn-dl").disabled = true;
  setStatus("info", "Contacting download server…");

  try {
    const data = await callCobalt(currentUrl, selectedQ);

    // cobalt response statuses: "stream", "redirect", "tunnel", "picker", "error"
    switch (data.status) {
      case "stream":
      case "redirect":
      case "tunnel": {
        const ext = selectedQ === "audio" ? "mp3" : "mp4";
        const title = $("vid-title").textContent.replace(/[\\/*?:"<>|]/g, "_");
        const filename = `${title}.${ext}`;
        setStatus("success", `✓ Download starting — check your downloads folder.`);
        triggerDownload(data.url, filename);
        break;
      }

      case "picker": {
        // cobalt returns multiple streams (e.g. video + audio separate) — pick video
        if (data.picker && data.picker.length > 0) {
          const item = data.picker[0];
          const title = $("vid-title").textContent.replace(/[\\/*?:"<>|]/g, "_");
          triggerDownload(item.url, title + ".mp4");
          setStatus("success", "✓ Download starting — check your downloads folder.");
        } else {
          setStatus("error", "No downloadable streams found for this video.");
        }
        break;
      }

      case "error": {
        const msg = data.error?.code || "Unknown error from download server.";
        setStatus("error", `Download failed: ${msg}`);
        break;
      }

      default:
        setStatus("error", `Unexpected response from server: ${data.status}`);
    }
  } catch (err) {
    setStatus("error",
      "Download failed. The video may be age-restricted, private, or unavailable. " +
      "Try a different quality or try again. (" + err.message + ")"
    );
  } finally {
    $("btn-dl").disabled = false;
  }
}

// ── Enter key & auto-fetch on paste ─────────────────────────
urlInput.addEventListener("keydown", e => { if (e.key === "Enter") fetchInfo(); });

urlInput.addEventListener("paste", () => {
  setTimeout(() => {
    const v = urlInput.value.trim();
    if (v.includes("youtube.com/") || v.includes("youtu.be/")) fetchInfo();
  }, 60);
});
