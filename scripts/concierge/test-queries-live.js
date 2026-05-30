// scripts/concierge/test-queries-live.js
// ─────────────────────────────────────────────────────────────────────────────
// Curated query set for live end-to-end testing against the deployed
// concierge URL. Designed specifically to exercise:
//
//   • Database accuracy — hours, tags, ratings, descriptions sourced
//     from Firestore + the retrieval pipeline.
//   • Prose quality — voice, length discipline, no markdown leak,
//     by-appointment handling.
//   • Resolver behaviour — multi-turn sequences with referential
//     follow-ups ("how about their kitchen?", "what do they make?")
//   • Edge cases — typos, vague queries, out-of-scope, multi-question
//     turns, queries about producers not in the SipLocal corpus.
//
// CATEGORIES:
//   - hours        : factual hours / open-today queries
//   - tags         : tag-filter queries (dog-friendly, biodynamic, etc.)
//   - specific     : single-winery questions ("tell me about X")
//   - regional     : sub-region browsing
//   - itinerary    : multi-stop trip planning
//   - prose        : general / curiosity / vibe queries
//   - edge         : typos, vague queries, weird phrasings
//   - oos          : out-of-scope (weather, other regions)
//   - followup     : multi-turn sequences (exercises resolver)
//
// Each query has `today` baked in only for documentation — the deployed
// concierge computes "today" itself from the region's timezone. The
// `today` field here is informational so a reviewer reading the report
// can tell which day the query implies.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Single-turn queries. Each runs in a fresh session with empty history.
const SINGLE_TURN_QUERIES = [
  // ── hours: pulls per-day data from Firestore hoursStructured ──
  { id: 'h1', category: 'hours', query: 'What are Frogmore Creek\'s hours today?' },
  { id: 'h2', category: 'hours', query: 'Is Tolpuddle open on Sunday?' },
  { id: 'h3', category: 'hours', query: 'Which Coal River Valley wineries are open on Monday?' },
  { id: 'h4', category: 'hours', query: 'Anywhere open right now in the Tamar Valley?' },
  { id: 'h5', category: 'hours', query: 'I\'m here on a Wednesday — what cellar doors will be open?' },

  // ── tags: boolean filter accuracy ──
  { id: 't1', category: 'tags', query: 'Which wineries are dog-friendly?' },
  { id: 't2', category: 'tags', query: 'Show me the biodynamic producers in Tasmania.' },
  { id: 't3', category: 'tags', query: 'Anywhere with a restaurant on site that\'s also dog-friendly?' },
  { id: 't4', category: 'tags', query: 'Which wineries are award-winning?' },
  { id: 't5', category: 'tags', query: 'Walk-in welcome only — no bookings needed.' },

  // ── specific: named winery questions ──
  { id: 's1', category: 'specific', query: 'Tell me about Frogmore Creek.' },
  { id: 's2', category: 'specific', query: 'What\'s the vibe at Pooley Wines?' },
  { id: 's3', category: 'specific', query: 'Is Domaine A worth visiting?' },
  { id: 's4', category: 'specific', query: 'What varietals does Tolpuddle make?' },

  // ── regional: sub-region browsing ──
  { id: 'r1', category: 'regional', query: 'What\'s good in the Coal River Valley?' },
  { id: 'r2', category: 'regional', query: 'We just got into Launceston — where should we go?' },
  { id: 'r3', category: 'regional', query: 'Best of Pipers River for sparkling?' },

  // ── itinerary: trip planning ──
  { id: 'i1', category: 'itinerary', query: 'Plan a Saturday from Hobart, pinot-focused, long lunch.' },
  { id: 'i2', category: 'itinerary', query: 'Two days in the north, sparkling and pinot, base us somewhere.' },
  { id: 'i3', category: 'itinerary', query: 'We\'re cruise-ship passengers with six hours in port at Hobart.' },

  // ── prose: vibe / curiosity / non-trip ──
  { id: 'p1', category: 'prose', query: 'Why is Tasmania good for sparkling wine?' },
  { id: 'p2', category: 'prose', query: 'Difference between Coal River Valley and Tamar Valley?' },
  { id: 'p3', category: 'prose', query: 'What grape varieties does Tasmania do best, and why?' },

  // ── edge: typos, vague, weird ──
  { id: 'e1', category: 'edge', query: 'frogmore creak hours today?' },   // typo: creak vs creek
  { id: 'e2', category: 'edge', query: 'Where should we go?' },             // vague
  { id: 'e3', category: 'edge', query: 'Hours for Tolpuddle and is Pooley walk-in?' }, // two questions
  { id: 'e4', category: 'edge', query: 'Tell me about House of Arras.' },   // producer NOT in SipLocal cellar doors
  { id: 'e5', category: 'edge', query: 'recomendations near hoabrt'  },    // typos + sloppy

  // ── oos: out-of-scope ──
  { id: 'o1', category: 'oos', query: 'What\'s the weather in Hobart tomorrow?' },
  { id: 'o2', category: 'oos', query: 'Can you recommend a Margaret River winery?' },

  // ── hallucination probes ──
  // These queries ask for facts the dataset almost certainly does NOT
  // contain. A well-grounded sommelier should refuse the specific fact
  // and redirect the user to the cellar door's website. If the model
  // confidently answers with specific years / hectares / dollar prices
  // / vintage scores / owner names, that's a hallucination.
  //
  // Read each response in the report and ask: "is this specific fact
  // anywhere in the per-turn winery data or the knowledge base?" If
  // not, it's a fabricated detail and the prompt's GROUNDING DISCIPLINE
  // rule isn't holding. The auto-flag detector catches the common
  // shapes (specific years, hectare/acre counts, dollar amounts) but
  // human review is the final word.
  { id: 'hal1', category: 'hallucination', query: 'When was Frogmore Creek founded?' },
  { id: 'hal2', category: 'hallucination', query: 'Who owns Pooley Wines, and how many generations?' },
  { id: 'hal3', category: 'hallucination', query: 'What\'s the vineyard size at Tolpuddle in hectares?' },
  { id: 'hal4', category: 'hallucination', query: 'What\'s the best Frogmore Creek vintage from the last five years?' },
  { id: 'hal5', category: 'hallucination', query: 'How much does a bottle of Pooley pinot cost at the cellar door?' },
  { id: 'hal6', category: 'hallucination', query: 'When does Domaine A typically harvest?' },
  { id: 'hal7', category: 'hallucination', query: 'What elevation is the Tolpuddle vineyard at?' },
];

// Multi-turn sequences. Each sequence runs in a single session so the
// server sees real history; tests the coreference resolver and history
// trimming. Each turn after the first should reference the prior turn.
const FOLLOW_UP_SEQUENCES = [
  {
    id: 'fu1',
    category: 'followup',
    label: 'Specific winery → drill into wines → operational',
    turns: [
      'Tell me about Pooley Wines.',
      'What do they make?',
      'Worth booking for lunch?',
    ],
  },
  {
    id: 'fu2',
    category: 'followup',
    label: 'Itinerary → modification → operational',
    turns: [
      'Plan a Saturday from Hobart, pinot, long lunch.',
      'Can we add Stefano Lubiana?',
      'Will we be back by 6pm?',
    ],
  },
  {
    id: 'fu3',
    category: 'followup',
    label: 'Regional browse → narrow → tag filter',
    turns: [
      'What\'s good in the Tamar Valley?',
      'Of those, which are dog-friendly?',
      'And which take walk-ins on Sunday?',
    ],
  },
  {
    id: 'fu4',
    category: 'followup',
    label: 'General curiosity → narrow to producer',
    turns: [
      'Why is Tasmania good for sparkling?',
      'Where can I taste the best?',
      'Are they appointment-only?',
    ],
  },
];

module.exports = { SINGLE_TURN_QUERIES, FOLLOW_UP_SEQUENCES };
