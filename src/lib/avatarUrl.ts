// Converts a Supabase Storage public avatar URL to a size-appropriate
// transformed URL using Supabase's built-in image resizing API.
// Non-Supabase URLs (local file:///, external URLs) pass through unchanged.
export function transformAvatarUrl(
  url: string | null | undefined,
  displayPx: number,
): string | null {
  if (!url) return null;
  if (!url.includes('/storage/v1/object/public/')) return url;
  const [base] = url.split('?');
  const renderBase = base.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  );
  // 2× pixel density for retina displays; cap at 400 (the upload ceiling).
  // Must pass both width AND height — Supabase's render endpoint only scales
  // the dimension(s) given, so a width-only request leaves height at the
  // source size and returns a squashed, non-square image. resize=cover
  // center-crops to that exact box, matching the square avatar frame.
  const px = Math.min(Math.ceil(displayPx * 2), 400);
  return `${renderBase}?width=${px}&height=${px}&resize=cover&quality=75`;
}
