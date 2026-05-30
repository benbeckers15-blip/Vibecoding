# V2 Concierge Eval — Structural Pass

URL: http://127.0.0.1:5001/winery-tourism-tasmania/us-central1/concierge
Run at: 2026-05-28T12:34:29.368Z

Each case below shows the routed intent, anchor, candidate
count, and emitted markers. This is the structural pass — it
answers "did the router route correctly?" but not "is the
reply good?". Claude reads the full eval-results.json and
writes the qualitative judgement separately.

---

## Case 13

**Expected branch:** TRIP

**Expectations:**
- intent should be TRIP
- clarifyingQuestion should be populated (no day, no preferences, region is broad)
- reply should ask one focused follow-up before recommending
- no winery_card, no trip_plan

### Turn 1: "Plan a day from Hobart"

- elapsed: 7060 ms
- intent: `TRIP`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Coal River Valley","Derwent Valley","Huon Valley"]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (4 slugs)
- emitted WINERY_CARD: true (6 slugs)
- trip slugs: `["charles-reuben-estate","sisu-wines","caledon-estate","pressing-matters-cellar-door"]`
- card slugs: `["charles-reuben-estate","sisu-wines","caledon-estate","pressing-matters-cellar-door","uplands-vineyard","craigow-vineyard"]`

**Reply:**

> For a day trip from Hobart, the Coal River Valley is a wonderful choice with a range of excellent cellar doors. Today, Thursday, you could begin your day at Charles Reuben Estate, open until 3pm, where you can enjoy their wines and perhaps even take a tour. Just a short drive away is Sisu Wines, open until 4:30pm, known for their thoughtful approach to farming and winemaking.
> 
> For lunch and further tasting, Caledon Estate is open until 5pm and offers stunning views of the valley from their architecturally designed cellar door and restaurant. Afterwards, Pressing Matters Cellar Door, open until 5pm, provides a unique experience with its tasting room set right within the vineyard.
> 
> If you prefer a more intimate, by-appointment experience, Uplands Vineyard is also in the Coal River Valley, though you'd need to ring ahead to book a tasting. Another excellent option, also by appointment, is Craigow Vineyard, an award-winning estate with deep roots in the valley.
> 
> This itinerary focuses on the Coal River Valley, which is easily accessible from Hobart. It allows for a relaxed pace with a mix of walk-in and by-appointment options, though for the latter, do remember to call ahead.

---

## Case 14

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- clarifyingQuestion should be null (NARROWED rule per stipulation #12)
- reply should give a confident default recommendation

### Turn 1: "What's good?"

- elapsed: 6042 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `Where in Tasmania are you based or starting from?`
- candidateCount: 0
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> To give you the best recommendations, could you tell me where in Tasmania you're based or starting from?

---

## Case 16 (multi-turn)

**Expected branch:** TRIP

**Expectations:**
- turn 2 selfContainedQuery should be a coref rewrite (e.g. "Plan a sparkling-focused Coal River day instead of pinot")
- turn 2 should emit a fresh trip plan with sparkling producers

### Turn 1: "Suggest a Coal River pinot day"

- elapsed: 6152 ms
- intent: `TRIP`
- anchorWinerySlug: `coal-valley-vineyard`
- anchorWineId: `null`
- regions: `["Coal River Valley"]`
- tags: `[]`
- wineWords: `["pinot"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (3 slugs)
- emitted WINERY_CARD: true (3 slugs)
- trip slugs: `["pressing-matters-cellar-door","caledon-estate","craigow-vineyard"]`
- card slugs: `["pressing-matters-cellar-door","caledon-estate","craigow-vineyard"]`

**Reply:**

> The Coal River Valley is an excellent choice for a pinot day, offering a range of styles and cellar door experiences.
> 
> I would suggest beginning your day at Pressing Matters Cellar Door, which is open until 5pm today. Their tasting room is uniquely situated right within the vineyard, offering a direct connection to the wines you're enjoying. From there, you could move on to Caledon Estate, also open until 5pm, where you'll find a striking sandstone entrance and architecturally designed space with beautiful views. Their Reserve Pinot Noir from 2022 is a powerful expression of dark cherry and raspberry with subtle spice and toasty oak.
> 
> If you are keen to try another award-winning pinot, you might consider Craigow Vineyard. Their pinot noir offers classic spice and black cherry notes, with French oak tannins enhancing a full-flavoured palate. Just remember to ring ahead, as Craigow is by appointment.

### Turn 2: "actually let's do sparkling"

- elapsed: 7213 ms
- intent: `TRIP`
- anchorWinerySlug: `coal-valley-vineyard`
- anchorWineId: `null`
- regions: `["Coal River Valley"]`
- tags: `[]`
- wineWords: `["sparkling"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> Certainly, if it's sparkling you're after, the Coal River Valley still has some lovely options, though it's less known for it than, say, Pipers River.
> 
> You could visit Frogmore Creek Cellar Door & Restaurant, which is open until 5pm today. They're an acclaimed producer in the valley and often have a sparkling wine among their offerings. Their cellar door and restaurant provide a beautiful setting with views over the vineyard.
> 
> Another option, though you'd need to arrange an appointment, is Uplands Vineyard. Their homestead, dating back to 1823, carries a sense of history that makes for a unique visit. They produce a range of wines, and while I don't have specific notes on a sparkling from them right now, it's worth inquiring directly if you're looking for something off the beaten path and enjoy a more intimate, by-appointment experience.

---
