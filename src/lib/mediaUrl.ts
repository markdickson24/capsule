// Converts a signed capsule-media URL to a size-appropriate transformed URL
// using Supabase's image resizing API, for the private capsule-media bucket.
// Mirrors avatarUrl.ts's approach for the public avatars bucket, but the
// private-bucket render path is /render/image/sign/ (not /render/image/public/)
// and the existing ?token= signing param must be preserved, not dropped.
// Non-Supabase URLs (local file:///, external URLs) pass through unchanged.
export function transformMediaUrl(
  url: string | null | undefined,
  displayPx: number,
): string | null {
  if (!url) return null;
  if (!url.includes('/storage/v1/object/sign/')) return url;
  const renderUrl = url.replace(
    '/storage/v1/object/sign/',
    '/storage/v1/render/image/sign/',
  );
  // 2x pixel density for retina displays; no fixed upload ceiling for media
  // (unlike avatars' 400px cap), so cap at a sensible grid-thumbnail size.
  const px = Math.min(Math.ceil(displayPx * 2), 800);
  const separator = renderUrl.includes('?') ? '&' : '?';
  return `${renderUrl}${separator}width=${px}&height=${px}&resize=cover&quality=75`;
}
