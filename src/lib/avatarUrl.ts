// Avatars are already resized to <=400px square and compressed at upload
// time (ProfileScreen/OnboardingScreen's ImageManipulator step), so routing
// them through Supabase's render/image endpoint bought negligible byte
// savings while still billing a full "origin image" transform per unique
// avatar seen each cycle (Storage Image Transformations bills per distinct
// origin image, not per request or per size variant) — avatars alone were
// enough to blow through the 100/month Pro quota. Serve the public URL as-is;
// displayPx is kept in the signature so call sites don't need to change.
export function transformAvatarUrl(
  url: string | null | undefined,
  displayPx: number,
): string | null {
  return url ?? null;
}
