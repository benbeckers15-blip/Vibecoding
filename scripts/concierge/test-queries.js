// scripts/concierge/test-queries.js
// ─────────────────────────────────────────────────────────────────────────────
// Curated query set for the SipLocal concierge A/B harness.
//
// Coverage by router intent — keep this balanced so the comparison
// surfaces voice/quality differences across the kinds of turns that
// actually happen in production:
//
//   specific_winery : 5 — "tell me about X" / "is X open?"
//   regional        : 4 — "what's good in <region>?"
//   feature         : 4 — tag-filter queries
//   itinerary       : 4 — multi-stop trip planning
//   general         : 4 — open-ended / curiosity
//   out_of_scope    : 2 — refusal calibration
//
// Total: 23 queries. Run time per provider: ~1-2 minutes (rate-limit
// permitting). Edit this file to add representative queries from your
// own production logs once you have them.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Representative Tasmanian wineries used as fake context for every
// turn. NOT pulled from Firestore — this is a quality probe, not a
// production replay. The shapes match what the real per-turn slice
// looks like (see functions/src/concierge/buildContext.ts).
//
// If you want to test with your real corpus, swap loadWineryContext()
// in ab-test-providers.js to read from Firestore via firebase-admin.
const WINERY_CONTEXT = `=== Tolpuddle Vineyard (id:tolpuddle) ===
region: Coal River Valley
rating: 4.7
hours: Mon: Closed, Tue: Closed, Wed: Closed, Thu: 11-4, Fri: 11-4, Sat: 11-4, Sun: 11-4
tags: by-appointment, award-winning
description:
Tolpuddle is one of Tasmania's most decorated single-vineyard sites — Halliday-rated, planted on the eastern slope of the Coal River Valley, and farmed for chardonnay and pinot noir that consistently rank among Australia's finest cool-climate examples. The cellar door is small and by-appointment; tastings are led personally, and visitors leave with a real sense of why this hillside has become a reference point for what Tasmania can do.

=== Frogmore Creek (id:frogmore-creek) ===
region: Coal River Valley
rating: 4.5
hours: Mon: 10-5, Tue: 10-5, Wed: 10-5, Thu: 10-5, Fri: 10-5, Sat: 10-5, Sun: 10-5
tags: walk-ins, restaurant, organic
description:
Frogmore Creek pairs serious cool-climate winemaking with one of the best winery kitchens in Tasmania. The estate is certified organic, the room overlooks the vines, and the restaurant — open daily for long lunches — is the reason most visitors stay longer than they planned. Their pinot noir program runs from approachable estate bottlings up to single-vineyard expressions worth seeking out.

=== Pooley Wines (id:pooley) ===
region: Coal River Valley
rating: 4.6
hours: Mon: Closed, Tue: Closed, Wed: 10-5, Thu: 10-5, Fri: 10-5, Sat: 10-5, Sun: 10-5
tags: walk-ins, restaurant, award-winning
description:
Three generations of the Pooley family have farmed this Coal River Valley estate, and the cellar door — set in a restored 1830s sandstone barn called Butcher's Hill — is one of Tasmania's most atmospheric. Their riesling and pinot noir are the headline acts; the kitchen runs platters and seasonal mains designed for unhurried lunches.

=== Stefano Lubiana (id:stefano-lubiana) ===
region: Derwent Valley
rating: 4.5
hours: Mon: Closed, Tue: Closed, Wed: Closed, Thu: 11-4, Fri: 11-4, Sat: 11-4, Sun: 11-4
tags: walk-ins, biodynamic, restaurant, organic
description:
Steve Lubiana's biodynamic estate above the Derwent River is one of Tasmania's quiet pioneers — the vines are certified, the philosophy is uncompromising, and the wines (especially the méthode traditionelle sparkling and the estate pinots) have a textural clarity you don't get from conventional farming. The osteria pours their wines alongside seasonal Italian-leaning plates.

=== Jansz Tasmania (id:jansz) ===
region: Pipers River
rating: 4.4
hours: Mon: 10-4:30, Tue: 10-4:30, Wed: 10-4:30, Thu: 10-4:30, Fri: 10-4:30, Sat: 10-4:30, Sun: 10-4:30
tags: walk-ins, featured
description:
Jansz is one of the foundational names of Tasmanian sparkling. Their Pipers River cellar door — a low-slung modern building overlooking the vines — pours the whole sparkling range, from the entry NV through to single-vineyard cuvées. Open daily and easy to combine with a Tamar Valley loop from Launceston.

=== Domaine A (id:domaine-a) ===
region: Coal River Valley
rating: 4.6
hours: Mon: Closed, Tue: Closed, Wed: Closed, Thu: Closed, Fri: 10-4, Sat: 10-4, Sun: 10-4
tags: by-appointment, award-winning, biodynamic
description:
Founded by the Althaus family, Domaine A built its reputation on Bordeaux-style cabernet — a varietal almost no one else in Tasmania attempts at scale — alongside chardonnay and pinot. The cellar door is by-appointment only; visits are intimate, often led by Peter or one of the team, and the back-vintage tastings are the kind of thing serious collectors fly down for.

=== Moorilla (id:moorilla) ===
region: Derwent Valley
rating: 4.3
hours: Mon: 10-5, Tue: 10-5, Wed: 10-5, Thu: 10-5, Fri: 10-5, Sat: 10-5, Sun: 10-5
tags: walk-ins, restaurant
description:
Moorilla is Tasmania's oldest winery and the cellar door is woven into the MONA museum site on a peninsula in the Derwent River — a 25-minute drive (or ferry) from central Hobart. The pairing is the appeal: art, architecture, and a credible cool-climate wine program in one half-day. Their riesling and pinot are the bottles to taste.`;

const QUERIES = [
  // ── specific_winery (5) ──
  {
    id: 'sw1',
    intent: 'specific_winery',
    query: 'Is Tolpuddle open on Sunday?',
    today: 'Wednesday',
  },
  {
    id: 'sw2',
    intent: 'specific_winery',
    query: 'Tell me about Stefano Lubiana.',
    today: 'Wednesday',
  },
  {
    id: 'sw3',
    intent: 'specific_winery',
    query: "What's the kitchen like at Frogmore Creek? Worth booking for lunch?",
    today: 'Friday',
  },
  {
    id: 'sw4',
    intent: 'specific_winery',
    query: 'Pooley vs Frogmore — which one would you pick for a date afternoon?',
    today: 'Saturday',
  },
  {
    id: 'sw5',
    intent: 'specific_winery',
    query: 'Is Domaine A actually worth the drive out for a tasting?',
    today: 'Saturday',
  },

  // ── regional (4) ──
  {
    id: 'r1',
    intent: 'regional',
    query: "What's good in the Coal River Valley?",
    today: 'Saturday',
  },
  {
    id: 'r2',
    intent: 'regional',
    query: 'We just got into Launceston. Any cellar doors worth a Sunday stop?',
    today: 'Sunday',
  },
  {
    id: 'r3',
    intent: 'regional',
    query: "Where should we taste sparkling in Pipers River?",
    today: 'Wednesday',
  },
  {
    id: 'r4',
    intent: 'regional',
    query: 'Anywhere in the Derwent Valley with an actual restaurant on site?',
    today: 'Friday',
  },

  // ── feature (4) ──
  {
    id: 'f1',
    intent: 'feature',
    query: 'Award-winning wineries we should prioritise?',
    today: 'Saturday',
  },
  {
    id: 'f2',
    intent: 'feature',
    query: 'Which places do biodynamic farming?',
    today: 'Friday',
  },
  {
    id: 'f3',
    intent: 'feature',
    query: 'Need a winery with a proper lunch — we have time for one long meal today.',
    today: 'Sunday',
  },
  {
    id: 'f4',
    intent: 'feature',
    query: "Anywhere we can walk in without a booking on a Wednesday?",
    today: 'Wednesday',
  },

  // ── itinerary (4) ──
  {
    id: 'i1',
    intent: 'itinerary',
    query: "Saturday, my partner and I, love pinot, hate stuffy places, want a long lunch. Driving from Hobart.",
    today: 'Saturday',
  },
  {
    id: 'i2',
    intent: 'itinerary',
    query: "We've got Sunday in Launceston. Want to do sparkling and be back by 5pm. Help us plan a day.",
    today: 'Sunday',
  },
  {
    id: 'i3',
    intent: 'itinerary',
    query: "Plan us a chill Friday — two stops, one with food, ideally Coal River Valley. We're up for biodynamic.",
    today: 'Friday',
  },
  {
    id: 'i4',
    intent: 'itinerary',
    query: "Anniversary weekend, just the two of us, no rush. Pick three wineries that aren't going to feel like a busy room.",
    today: 'Friday',
  },

  // ── general (4) ──
  {
    id: 'g1',
    intent: 'general',
    query: "Why is Tasmania good for sparkling wine?",
    today: 'Tuesday',
  },
  {
    id: 'g2',
    intent: 'general',
    query: "Difference between Coal River Valley and Tamar Valley as wine regions?",
    today: 'Wednesday',
  },
  {
    id: 'g3',
    intent: 'general',
    query: "We just got here, never been before. Where do we start?",
    today: 'Friday',
  },
  {
    id: 'g4',
    intent: 'general',
    query: "What grape varieties does Tasmania do best, and why?",
    today: 'Monday',
  },

  // ── out_of_scope (2) ──
  {
    id: 'o1',
    intent: 'out_of_scope',
    query: "What's the weather in Hobart tomorrow?",
    today: 'Saturday',
  },
  {
    id: 'o2',
    intent: 'out_of_scope',
    query: "Can you recommend a Margaret River winery?",
    today: 'Sunday',
  },
];

module.exports = { QUERIES, WINERY_CONTEXT };
