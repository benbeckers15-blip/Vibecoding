# V2 Concierge Eval — Structural Pass

URL: http://127.0.0.1:5001/winery-tourism-tasmania/us-central1/concierge
Run at: 2026-05-28T12:34:40.753Z

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

- elapsed: 5605 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Coal River Valley"]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 8
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (4 slugs)
- card slugs: `["pressing-matters-cellar-door","caledon-estate","sisu-wines","charles-reuben-estate"]`

**Reply:**

> The Coal River Valley is a wonderful choice for a tasting today, Thursday. It's close to Hobart and offers a range of styles.
> 
> For a relaxed, award-winning experience, Pressing Matters Cellar Door is open until 5pm. Their tasting room is nestled right within the vineyard, offering a true sense of place with every sip.
> 
> If you appreciate a grander setting with stunning views, Caledon Estate is also open until 5pm and boasts an architecturally striking cellar door with views toward kunanyi. They also have a restaurant for lunch.
> 
> For something a little more intimate, Sisu Wines is open until 4:30pm. They're part of a larger farm where a significant portion is left wild, which speaks to their thoughtful approach to winemaking.
> 
> Charles Reuben Estate is another good option, open until 3pm today, and they also offer tours if you're interested in seeing behind the scenes.

---
