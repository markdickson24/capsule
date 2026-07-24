# Brand & Category Collision — getcapsuleapp.com

This finding came out of running real searches rather than reading the site. It is not a page-level SEO defect, but it constrains what every other recommendation in this audit can achieve, so it is recorded separately.

## [CRITICAL — strategic] "Capsule" is a heavily contested brand name in this exact niche

A search for `getcapsuleapp.com Capsule time capsule photo app` does not return the site as the primary entity. It returns:

| Result | What it is | Overlap |
|---|---|---|
| **trycapsule.com** — "Capsule" | Wedding photo-sharing app / event photo collection platform, founded 2011 | **Same brand name, same wedding-photo niche.** Not time-locked (photos are immediately visible), so the products differ — but the name and the wedding use case collide exactly. |
| **TimeCapsules** (App Store `id6755395078`, by MWM) | Digital capsules with photos, video, audio, messages — **unlocked by time, by location (within 100 m), or by friends**; shared capsules that unlock together; templates for birthdays, travel, anniversaries | **Near-identical product.** Time unlock, group unlock, and a 100 m proximity radius — the same three unlock modes Capsule implements, including the same default radius. |
| SnapVault: Photo Time Capsule (`id6759066939`) | Photo time capsule app | Direct |
| Time Capsule – Memory Vault (`id6759179137`) | Photo time capsule app | Direct |
| TimeCaps (`id6448761672`), TimeLock (timelockapp.com), capstime.com | Digital time capsule apps | Direct |
| Capsule (website) — Wikipedia | Unrelated entity holding the "Capsule" name in Google's knowledge graph | Entity confusion |
| facebook.com/**getcapsuleapp** | A Facebook page on the exact handle, associated in search results with an older (c. 2014) app for "keeping track of a list of places" | Handle/domain-name association predates this product |

The search engine's own summary of the query conflated at least three different products and surfaced a 2014-era description for this domain name.

## Why this matters more than any on-page fix

Three compounding consequences:

1. **Branded search is not a safe harbour.** For most new products, ranking #1 for your own name is the one guaranteed win. Here, "Capsule", "Capsule app", and "capsule photo app" are all contested by an incumbent with 15 years of history (trycapsule.com) and a Wikipedia entity. Even perfect execution on the six landing pages leaves the brand query ambiguous.

2. **The category's App Store SERP is already occupied.** TimeCapsules matches Capsule's differentiators — group unlock, time unlock, 100 m proximity unlock — feature for feature. The audit's SXO findings identified "time capsule app for couples" and "how to make a digital time capsule" as the two winnable keywords; both of those SERPs contain these competitors. Winnable still, but against real products, not against thin affiliate content.

3. **Every AI answer engine inherits this ambiguity.** Entity disambiguation is the core of how LLM-based search decides what a brand *is*. With zero structured data, no `sameAs` links, no App Store listing, and no Wikipedia/Crunchbase presence, there is currently nothing anywhere on the web that tells a model that "Capsule at getcapsuleapp.com" is a distinct entity from "Capsule at trycapsule.com". See `geo.md`.

## Recommendations

**Do not rename** on the strength of an SEO audit — the name is embedded in the bundle ID (`com.markdickson.capsule`), the App Store submission, RevenueCat config, and the deep-link scheme. The cost is high and the audit does not justify it on its own. But **stop treating "Capsule" as the searchable brand token.**

1. **Adopt a consistent disambiguating descriptor everywhere.** Not a rename — a modifier that always travels with the name. "Capsule — the time-locked photo album" or "Capsule App". Use it in `<title>`, the App Store name field, the Organization schema `name`/`alternateName`, and all social bios. Consistency is what builds the entity.

2. **Fix the three dead social links immediately** (see below) — these are the cheapest `sameAs` signals available and they're currently `href="#"`.

3. **Optimize for the App Store listing as the canonical entity anchor** once it exists. For a consumer app in a category where the SERP is full of App Store results, the ASO listing will outrank the marketing site for most category queries. The website's realistic job is long-tail informational capture that funnels to the listing — which is exactly what the SXO analysis concluded independently.

4. **Target the differentiator, not the category.** Every competitor above does "time capsule". None of the listings emphasise *surprise mode* — the owner being locked out of their own album — or *superlatives/awards voting at unlock*. Those are genuinely unusual features and are far less contested as search phrases than "time capsule app".

### Immediate related fix: the footer's social links are dead

All three footer social links on **every page** are placeholders:

```html
<a href="#" style="color:var(--text-2)">Instagram</a>
<a href="#" style="color:var(--text-2)">TikTok</a>
<a href="#" style="color:var(--text-2)">X</a>
```

The real URLs **already exist in the codebase** at `src/lib/communityLinks.ts`:

```ts
export const DISCORD_URL  = 'https://discord.gg/rgf7dR7FK';
export const INSTAGRAM_URL = 'https://instagram.com/app.capsule';
export const TIKTOK_URL   = 'https://tiktok.com/@capsule.photo';
```

So the fix is copy-paste, not research. Note there is no X/Twitter URL in that file — either create the account or remove the link rather than shipping a third dead one. These URLs should also populate `sameAs` in the Organization schema (see `schema.md`), which is the single most direct entity-disambiguation signal available today.

**Falsifiability:** if, three months after adding `sameAs` + consistent descriptor + App Store listing, a search for "Capsule time capsule app" still returns trycapsule.com above getcapsuleapp.com, the entity work is not landing and the name itself is the constraint — at which point renaming deserves genuine reconsideration.
