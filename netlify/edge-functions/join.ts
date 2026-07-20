import type { Config, Context } from "@netlify/edge-functions";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    // Task 2 replaces this stub with a real generated PNG.
    return Response.redirect("https://getcapsuleapp.com/logo.png", 302);
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
