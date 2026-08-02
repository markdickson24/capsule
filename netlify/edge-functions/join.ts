import type { Config, Context } from "@netlify/edge-functions";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// NOT a top-level import. resvg_wasm fetches and instantiates a .wasm module at
// import time; if that fails in the edge runtime the failure happens before any
// handler code runs, so no amount of try/catch inside the handler can contain it
// — every /join/* request 500s, including the HTML page that never rasterises
// anything. Loaded lazily inside the /image branch instead, so a rasteriser
// problem can only ever cost the preview card, never the invite itself.
type RenderSvg = (svg: string) => Promise<Uint8Array>;
async function loadRenderer(): Promise<RenderSvg> {
  const mod = await import("https://deno.land/x/resvg_wasm@0.2.0/mod.ts");
  return (mod as { render: RenderSvg }).render;
}

interface JoinPreview {
  id: string;
  title: string;
  owner_name: string;
  owner_avatar: string | null;
  member_count: number;
  already_member: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * "unavailable" = we could not ask (missing config, network, bad key).
 * "missing"     = we asked and the capsule genuinely isn't there.
 *
 * The distinction matters: the redirect into the app needs no data at all —
 * the capsule id is in the URL — so an infrastructure failure must NOT take
 * the invite down. Only a genuine miss should 404.
 */
type PreviewResult =
  | { kind: "ok"; preview: JoinPreview }
  | { kind: "missing" }
  | { kind: "unavailable"; reason: string };

// Single read site for the project's own Supabase URL — reused by
// fetchPreview (to build the client) and by the avatar SSRF guard below, so
// the guard doesn't need a second `Netlify.env.get` call site.
function getSupabaseUrl(): string | undefined {
  return Netlify.env.get("SUPABASE_URL");
}

async function fetchPreview(capsuleId: string): Promise<PreviewResult> {
  const url = getSupabaseUrl();
  // Service role is preferred, but the anon key is enough: capsule_join_preview
  // is SECURITY DEFINER and returns only fields this public page already shows.
  const key =
    Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Netlify.env.get("SUPABASE_ANON_KEY");

  // Previously these were non-null-asserted straight into createClient, so an
  // unset (or wrongly-scoped) variable threw before any error handling and every
  // /join/* request returned a raw 500 — taking out the QR code, the
  // CapsuleDetail share sheet and the Onboarding share all at once.
  if (!url || !key) {
    // Name exactly what's missing: these are set in the Netlify dashboard, and
    // Edge Functions read a different scope than Functions — a variable can be
    // present in the UI and still be invisible here. Spelling that out in the
    // log saves rediscovering it.
    const missing = [
      !url ? "SUPABASE_URL" : null,
      !key ? "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)" : null,
    ].filter(Boolean).join(" + ");
    return {
      kind: "unavailable",
      reason: `missing ${missing} — set them in Netlify env vars with the Edge Functions scope enabled`,
    };
  }

  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.rpc("capsule_join_preview", {
      p_capsule_id: capsuleId,
    });
    if (error) return { kind: "unavailable", reason: error.message };
    if (!data || !data[0]) return { kind: "missing" };
    return { kind: "ok", preview: data[0] as JoinPreview };
  } catch (e) {
    return { kind: "unavailable", reason: String(e) };
  }
}

function formatDescription(memberCount: number): string {
  const subject = memberCount === 1 ? "1 person is" : `${memberCount} people are`;
  return `${subject} already in. Add your photos before it locks.`;
}

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const ACCENT = "#FC6A5B"; // must match landing/styles.css --accent

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Greedy word-wrap into at most `maxLines` lines of at most `maxCharsPerLine`
// characters each. SVG <text> has no auto-wrap, so this runs before the SVG
// is built. If words remain after filling maxLines, the last line is
// truncated with an ellipsis rather than overflowing the card.
function wrapTitle(title: string, maxCharsPerLine: number, maxLines: number): string[] {
  // capsules.title has no server-side length cap (the 100-char limit is
  // client-side only), so an adversarial title could be arbitrarily long.
  // Clamp up front — well past anything this card could ever render — so the
  // shrink step below is bounded regardless of input size.
  const clampedTitle = title.slice(0, 200);
  const words = clampedTitle.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let wordIndex = 0;

  while (wordIndex < words.length && lines.length < maxLines) {
    const word = words[wordIndex];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = "";
      continue; // retry this word on a new line
    }
    current = candidate;
    wordIndex++;
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  const consumedAllWords = wordIndex >= words.length;
  if (!consumedAllWords && lines.length === maxLines) {
    const lastIndex = lines.length - 1;
    const last = lines[lastIndex].slice(0, maxCharsPerLine - 1);
    lines[lastIndex] = last.replace(/\s+$/, "") + "…";
  }
  return lines;
}

// Hard cap on the avatar response body. Keeps a single request from OOMing
// the edge isolate (which would take out co-tenant /join/* requests too).
const MAX_AVATAR_BYTES = 512 * 1024;

// users.avatar_url is client-writable to an arbitrary string — it is NOT
// trusted to point at Supabase storage. Only fetch it if it resolves to
// https on the project's own Supabase host; everything else (including a
// redirect target we haven't validated) falls back to the initial-letter
// badge instead of being fetched from Netlify's egress.
function allowedAvatarHost(): string | null {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
}

function isAllowedAvatarUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const allowedHost = allowedAvatarHost();
  return !!allowedHost && parsed.hostname === allowedHost;
}

// Base64-encodes in fixed-size chunks instead of building a per-character
// string rope (which multiplies memory ~24x for large inputs before btoa
// even runs).
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

// Reads the body through a size-limited streaming reader rather than
// trusting content-length alone — a hostile server can lie about or omit
// that header, so the cap has to be enforced on the bytes actually received.
async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    return buf.byteLength > maxBytes ? null : new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore — we're already discarding this response
      }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// Best-effort: a slow, failing, or oversized avatar fetch must never block
// the image response. Returns null on any failure, in which case
// buildCardSvg falls back to a plain initial-letter badge.
async function fetchAvatarDataUri(url: string | null): Promise<string | null> {
  if (!url || !isAllowedAvatarUrl(url)) return null;
  try {
    // redirect: "manual" so an allowed origin can't 30x us to an
    // unvalidated (e.g. private/internal) address — a manual redirect comes
    // back as an opaque, non-ok response, which the check below discards.
    const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    if (!res.ok) return null;
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_AVATAR_BYTES) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(contentType)) return null;
    const bytes = await readBodyWithLimit(res, MAX_AVATAR_BYTES);
    if (!bytes) return null;
    return `data:${contentType};base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  }
}

function buildCardSvg(preview: JoinPreview, avatarDataUri: string | null): string {
  const titleLines = wrapTitle(preview.title, 22, 2);
  const titleSvg = titleLines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 64}">${escapeXml(line)}</tspan>`)
    .join("");

  const memberWord = preview.member_count === 1 ? "person" : "people";
  const subtitle = `${preview.member_count} ${memberWord} already in`;

  const avatarMarkup = avatarDataUri
    ? `<clipPath id="avatarClip"><circle cx="120" cy="120" r="40"/></clipPath>
       <image href="${avatarDataUri}" x="80" y="80" width="80" height="80" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="120" cy="120" r="40" fill="${ACCENT}" fill-opacity="0.2"/>
       <text x="120" y="132" font-size="32" font-weight="700" fill="${ACCENT}" text-anchor="middle">${escapeXml(preview.owner_name.charAt(0).toUpperCase())}</text>`;

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#0A0A0A"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>
  <g transform="translate(80,220)" stroke="${ACCENT}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <rect x="0" y="28" width="64" height="48" rx="8"/>
    <path d="M12 28V16a20 20 0 0 1 40 0v12"/>
  </g>
  <text x="80" y="400" font-size="56" font-weight="700" fill="#FFFFFF">${titleSvg}</text>
  ${avatarMarkup}
  <text x="176" y="112" font-size="28" font-weight="600" fill="${ACCENT}">${escapeXml(preview.owner_name)} invited you</text>
  <text x="176" y="146" font-size="24" fill="#888888">${escapeXml(subtitle)}</text>
</svg>`;
}

function renderPage(capsuleId: string, preview: JoinPreview | null): string {
  // Degraded mode: generic copy, but the redirect below is identical, so the
  // invite still works. Only the unfurl preview is less pretty.
  const title = escapeHtml(preview?.title ?? "a Capsule");
  const owner = escapeHtml(preview?.owner_name ?? "Someone");
  const description = preview
    ? formatDescription(preview.member_count)
    : "Add your photos before it locks.";
  const pageUrl = `https://getcapsuleapp.com/join/${capsuleId}`;
  const imageUrl = preview
    ? `https://getcapsuleapp.com/join/${capsuleId}/image`
    : "https://getcapsuleapp.com/og-image.jpg";
  const appUrl = `capsule://join/${capsuleId}`;
  const fallbackUrl = preview
    ? `https://getcapsuleapp.com/?invited_by=${encodeURIComponent(preview.owner_name)}&capsule=${encodeURIComponent(preview.title)}`
    : "https://getcapsuleapp.com/";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${owner} invited you to "${title}" — Capsule</title>
<meta name="robots" content="noindex" />
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:title" content="${owner} invited you to &quot;${title}&quot;" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<style>body{background:#0A0A0A;color:#fff;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:0 24px;}p{margin:0 0 20px;color:#888;}button{background:${ACCENT};color:#fff;border:none;border-radius:12px;padding:14px 28px;font-size:17px;font-weight:600;font-family:inherit;cursor:pointer;}</style>
</head>
<body>
<p>${owner} invited you to &quot;${title}&quot;</p>
<button id="joinBtn" type="button">Join ${title}</button>
<script>
  // A capsule:// deep link performs a real membership write on open — it
  // must only ever fire from an explicit user gesture, never automatically
  // on page load (that would let any cross-origin navigation to this page
  // silently enroll a signed-in visitor).
  document.getElementById('joinBtn').addEventListener('click', function () {
    window.location.href = ${JSON.stringify(appUrl)};
    setTimeout(function () {
      window.location.href = ${JSON.stringify(fallbackUrl)};
    }, 1200);
  });
</script>
</body>
</html>`;
}

// Every real capsule id is a server-generated UUID (Postgres
// create_capsule_with_owner RPC) — anything else can't be a genuine invite.
// Validated up front so a malformed/malicious id never reaches fetchPreview
// or gets interpolated into the HTML/SVG response below.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["join", "<id>"] or ["join", "<id>", "image"]
  const capsuleId = parts[1];
  const isImage = parts[2] === "image";

  if (!capsuleId || !UUID_RE.test(capsuleId)) {
    return new Response("Not found", { status: 404 });
  }

  const result = await fetchPreview(capsuleId);

  if (result.kind === "missing") {
    return new Response("This capsule doesn't exist or the invite has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (result.kind === "unavailable") {
    // Surfaces in Netlify function logs without breaking the user's invite.
    console.error(`[join] preview unavailable for ${capsuleId}: ${result.reason}`);
  }
  const preview = result.kind === "ok" ? result.preview : null;

  if (isImage) {
    // No data means no card to draw. Hand back the static site OG image rather
    // than erroring, so unfurls still show something on-brand.
    if (!preview) {
      return Response.redirect("https://getcapsuleapp.com/og-image.jpg", 302);
    }
    try {
      const avatarDataUri = await fetchAvatarDataUri(preview.owner_avatar);
      const svg = buildCardSvg(preview, avatarDataUri);
      const renderSvgToPng = await loadRenderer();
      const png = await renderSvgToPng(svg);
      // Deno's BodyInit accepts a Uint8Array (BufferSource); the repo's tsconfig
      // uses the DOM lib, whose BodyInit does not. Runtime is fine — this cast
      // just stops a false positive in `tsc --noEmit`.
      return new Response(png as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (e) {
      // resvg_wasm is a remote wasm dependency; a rasterise failure must not
      // 500 the OG image and poison the unfurl.
      console.error(`[join] card render failed for ${capsuleId}: ${e}`);
      return Response.redirect("https://getcapsuleapp.com/og-image.jpg", 302);
    }
  }

  return new Response(renderPage(capsuleId, preview), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Join-Fn": preview ? "ok" : "degraded",
      // Don't cache a degraded page for 5 minutes at the edge — once the data
      // source is healthy again the next request should get the rich version.
      "Cache-Control": preview ? "public, max-age=300" : "no-store",
      // Defense in depth: this page has exactly one inline <script> and one
      // inline <style>, both required for the redirect-into-app flow. No
      // external resources are ever loaded except images (og:image).
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https:",
    },
  });
};

export const config: Config = {
  path: "/join/*",
};
