# SipLocal — Monetization & Referral Roadmap

> Created 2026-06-11. Covers the work needed across both repos (app: `/Users/ben/Desktop/SipLocal`, website: `/Users/ben/Desktop/Siplocal Website`) to ship the tiered winery listing model and the in-person QR referral program.
>
> Legend: ⚡ = blocks revenue · 🍎 = blocks or risks App Store approval

## Business model summary

- **Winery listings, 3 tiers.** Free: basic listing, hours/location/contact control, 2 photos, 1 wine, no booking link. Tier 2 (paid): full profile control (except tasting-note reviews), unlimited photos, events, booking link, concierge boost, analytics dashboard. Tier 3 (premium): higher boost cap, monthly IG promo, sponsored editorial inclusion, deeper analytics. **Decision made: all wineries remain retrievable in the concierge; paid tiers get a capped, disclosed ranking boost — free wineries are never excluded** (excluding them degrades answer quality and the consumer product).
- **Referral program (in-person).** QR codes distributed to wine-country businesses; $1 per *activated* referred user (not per install). Deferred deep linking for attribution + manual code fallback. Deal with the **business**, not individual employees (channel-conflict risk with winery customers). Capped per referrer, delayed payouts, fraud-withholding clause.

---

## Foundation (do first — everything depends on these)

1. **Entitlements model** ⚡ — Add `tier` + subscription state to the winery schema in `types/` (both repos, coordinated — Firestore fields are shared). Define per-tier limits in one shared config: photo count, wine count, events on/off, booking link on/off, boost weight.
2. **Telemetry** ⚡ — No analytics exists in the app today. Add event tracking (Firebase Analytics or PostHog): profile views, card clicks, directions taps, booking-link taps, concierge card impressions, saves. Tier-2 analytics cannot be sold without this; baseline data should accumulate *before* charging.
3. **Privacy policy + terms pages on the website** 🍎 — Do not exist yet. The app links out for these, and the attribution SDK changes what the policy must disclose.
4. **Deploy the website** ⚡ — No hosting config exists. Portal, referrer dashboard, and Stripe webhooks all need a production URL.

## Website — winery portal (monetization)

5. **Stripe subscriptions** ⚡ — Checkout, customer portal, webhook handler updating the winery's tier in Firestore, dunning, proration.
6. **Tier enforcement in portal API** ⚡ — `/api/portal/submit` and `/api/portal/upload` enforce nothing tier-related today. Enforce limits server-side, not just in UI.
7. **Downgrade rules** — Define what happens to excess photos/wines/events on lapse: hide, don't delete; grace period before hiding.
8. **Auto-approve policy** — Decide which edits skip the `pending_changes` review queue for paid tiers (e.g., hours/photos auto-publish; descriptions/events still reviewed). Without this, "complete control" makes the founder the bottleneck for every edit.
9. **Analytics dashboard in portal** — Tier 2: views/clicks/regional MAU. Tier 3: deeper cuts + concierge query insights. Requires an aggregation job (scheduled Cloud Function writing daily rollups).
10. **Tier 3 ops tooling** — Hard cap on tier-3 slots per region (scarcity justifies the premium and bounds the manual IG/editorial workload). Track IG posts + editorial inclusions in `/admin`. Label editorial inclusions as **sponsored** — protects The Pour's credibility and ACL compliance.
11. **Self-serve upgrade path** — Portal is invite-only today. Add a public pricing page + upgrade flow so wineries can convert without manual invoicing.

## Website — referrer portal (new surface)

12. **Referrer accounts** — Signup (invite/approval-based), referral agreement acceptance with fraud-withholding clause, PayID details collection.
13. **Referrer dashboard** — Their QR code/link, scan → install → activation funnel counts, accrued earnings, payout history. (A monthly count email is an acceptable v1.)
14. **Redirect layer we own** — `go.siplocal.app/r/CODE` → attribution-provider link. QR codes never need reprinting if the provider changes.
15. **Admin referral tooling** — Create referrers, generate printable QR assets, fraud review queue, batch payout approval (minimum payout threshold + per-referrer caps + total program budget cap).

## App (consumer side)

16. **Attribution SDK** 🍎 — Deferred deep-linking provider (ChottuLink free to 25k MAU; Branch ~$199/mo if its free tier excludes deferred deep linking — confirm with them directly, published info conflicts). Expo config plugin, dev-build config, privacy-preserving mode (avoid ATT), updated privacy nutrition label. Note: providers meter **total app MAU**, not just referred users.
17. **Referral code fallback field at signup** — Catches deferred-deep-link attribution misses (they are not 100%); writes to a `referrals` collection. Undercounting referrers burns the face-to-face relationships the program depends on.
18. **Activation tracking** — Define "active" (e.g., 2 sessions in 14 days, or one save/trip created), scheduled function marks referrals payable. Pay on activation, never on install. Delay payouts ~30 days for fraud review.
19. **Tier-aware rendering** — Winery detail respects entitlements: photo limits, wines shown, events tab, booking-link CTA for tier 2+.
20. **Concierge boost changes** — In `functions/src/concierge/`: tier-aware rerank weight with a hard cap; boost reorders among *relevant* results only, never injects irrelevant wineries; all tiers remain retrievable; disclosure decision documented. Log card impressions per winery for analytics.
21. **Finish App Store submission** 🍎 — Enrollment, builds, screenshots (see `docs/app-store-submission.md`). Do this *after* #16 so the privacy label is right the first time. Paying referrers (not users) largely sidesteps Apple 3.2.2 incentivized-install concerns.
22. **Crashlytics + App Check** — Wire `reportError()` (see `docs/setup-crashlytics.md`), then enable `CONCIERGE_ENFORCE_APP_CHECK`. Matters more once users cost $1 each — bots hitting the concierge cost money twice.

---

## Sequence

```
Foundation (#1–4)
  → App Store launch build (#16–18, 21)
  → telemetry baseline accumulates (~1–2 months)
  → billing + tier enforcement (#5–8, 19–20)
  → analytics dashboards (#9)
  → referrer portal + payouts (#12–15)
  → tier 3 ops (#10–11)
```

Rationale: referrals before launch is pointless; selling analytics before telemetry exists is impossible — but the attribution SDK and code fallback must ship **in the launch build** so the earliest QR codes attribute correctly.

## Open decisions

- Tier pricing (validate willingness-to-pay with actual cellar doors; ~73 wineries in Tasmania caps single-region revenue — model pricing on multi-region expansion).
- Boost disclosure wording (ACL / ACCC — get legal review; not legal advice).
- Auto-approve scope per tier (#8).
- "Cut of in-app purchase profit" clause for referrers: **cut or defer** — no consumer in-app purchases exist in the current model.
- Tier-3 slot cap per region.
- Activation definition + payout threshold/caps (final numbers).
