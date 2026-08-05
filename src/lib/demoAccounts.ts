// Demo/fixture accounts live in production alongside real users: the 12
// `facade00-` landing-page marketing accounts and the `facade01-` App Store
// reviewer fixtures ("Maya Chen", "Diego Ramos", …). The `users` SELECT policy
// is USING (true), so a plain `ilike` people search returns them to every real
// user — ~39% of the searchable directory is fabricated.
//
// The fixture UUIDs deliberately share the hex prefix "facade", which is what
// this predicate keys on. A real random v4 UUID colliding with that 6-hex
// prefix is a 1-in-16.7-million event, so this cannot practically hide a real
// account.
//
// ⚠️ SEARCH SURFACES ONLY. Fixtures must still render everywhere they
// legitimately appear — capsule member lists, the reviewer's own demo
// capsules, notifications, reactions — or the App Store reviewer's seeded
// capsules come back half-empty. Do not apply this to a member/capsule fetch.
export function isDemoAccountId(id: string | null | undefined): boolean {
  return !!id && id.toLowerCase().startsWith('facade');
}
