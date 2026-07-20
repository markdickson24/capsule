import type { Config, Context } from "@netlify/edge-functions";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { render as renderSvgToPng } from "https://deno.land/x/resvg_wasm@0.2.0/mod.ts";

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

async function fetchPreview(capsuleId: string): Promise<JoinPreview | null> {
  const supabase = createClient(
    Netlify.env.get("SUPABASE_URL")!,
    Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await supabase.rpc("capsule_join_preview", {
    p_capsule_id: capsuleId,
  });
  if (error || !data || !data[0]) return null;
  return data[0] as JoinPreview;
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
  const words = title.split(/\s+/).filter(Boolean);
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
    let last = lines[lastIndex];
    while (last.length > maxCharsPerLine - 1) last = last.slice(0, -1);
    lines[lastIndex] = last.replace(/\s+$/, "") + "…";
  }
  return lines;
}

// Best-effort: a slow or failing avatar fetch must never block the image
// response. Returns null on any failure, in which case buildCardSvg falls
// back to a plain initial-letter badge.
async function fetchAvatarDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${contentType};base64,${btoa(binary)}`;
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

function renderPage(capsuleId: string, preview: JoinPreview): string {
  const title = escapeHtml(preview.title);
  const owner = escapeHtml(preview.owner_name);
  const description = formatDescription(preview.member_count);
  const pageUrl = `https://getcapsuleapp.com/join/${capsuleId}`;
  const imageUrl = `https://getcapsuleapp.com/join/${capsuleId}/image`;
  const appUrl = `capsule://join/${capsuleId}`;
  const fallbackUrl = `https://getcapsuleapp.com/?invited_by=${encodeURIComponent(preview.owner_name)}&capsule=${encodeURIComponent(preview.title)}`;

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
<style>body{background:#0A0A0A;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style>
</head>
<body>
<p>Opening Capsule…</p>
<script>
  window.location.href = ${JSON.stringify(appUrl)};
  setTimeout(function () {
    window.location.href = ${JSON.stringify(fallbackUrl)};
  }, 1200);
</script>
</body>
</html>`;
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["join", "<id>"] or ["join", "<id>", "image"]
  const capsuleId = parts[1];
  const isImage = parts[2] === "image";

  if (!capsuleId) {
    return new Response("Not found", { status: 404 });
  }

  const preview = await fetchPreview(capsuleId);
  if (!preview) {
    return new Response("This capsule doesn't exist or the invite has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (isImage) {
    const avatarDataUri = await fetchAvatarDataUri(preview.owner_avatar);
    const svg = buildCardSvg(preview, avatarDataUri);
    const png = await renderSvgToPng(svg);
    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  return new Response(renderPage(capsuleId, preview), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};

export const config: Config = {
  path: "/join/*",
};
