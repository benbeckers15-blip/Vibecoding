# V2 Concierge Eval — Structural Pass

URL: http://127.0.0.1:5001/winery-tourism-tasmania/us-central1/concierge
Run at: 2026-05-28T12:35:01.864Z

Each case below shows the routed intent, anchor, candidate
count, and emitted markers. This is the structural pass — it
answers "did the router route correctly?" but not "is the
reply good?". Claude reads the full eval-results.json and
writes the qualitative judgement separately.

---

## Case 14

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- clarifyingQuestion should be null (NARROWED rule per stipulation #12)
- reply should give a confident default recommendation

### Turn 1: "What's good?"

- elapsed: 5656 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Tamar Valley"]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 8
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (6 slugs)
- card slugs: `["highclare-estate-wine-room","westella-vineyard","swinging-gate-vineyard","utzinger-wines","bundaleera-vineyard","grey-sands-vineyard"]`

**Reply:**

> The Tamar Valley has a wonderful array of cellar doors, and it depends on what you're looking for today, Thursday.
> 
> If you prefer to simply drop in, Highclare Estate Wine Room is open until 6:30 PM, offering a chance to taste wines from a property cleared and planted by the owners themselves. Westella Vineyard is also open until 5 PM, a small operation near the Tamar River known for its focused approach. Swinging Gate Vineyard, with its relaxed cellar door in a converted machinery shed, is open until 5 PM and welcomes walk-ins. Utzinger Wines, on the western edge of the valley, is open until 4 PM today, though I'd recommend calling ahead as tastings are by appointment.
> 
> For those who prefer a more intimate, planned experience, Bundaleera Vineyard and Grey Sands Vineyard both offer tastings by appointment. You'd want to ring ahead to arrange a visit.

---
