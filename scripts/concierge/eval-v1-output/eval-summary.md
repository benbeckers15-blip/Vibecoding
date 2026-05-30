# V2 Concierge Eval — Structural Pass

URL: http://127.0.0.1:5001/winery-tourism-tasmania/us-central1/concierge
Run at: 2026-05-28T12:07:13.013Z

Each case below shows the routed intent, anchor, candidate
count, and emitted markers. This is the structural pass — it
answers "did the router route correctly?" but not "is the
reply good?". Claude reads the full eval-results.json and
writes the qualitative judgement separately.

---

## Case 1

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be bangor-vineyard-shed
- reply should only mention Bangor wines — NO neighbour winery
- should emit a winery_card for bangor-vineyard-shed only

### Turn 1: "Wines from Bangor Vineyard Shed"

- elapsed: 9629 ms
- intent: `specific_winery`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 32
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["bangor-vineyard-shed"]`

**Reply:**

> Bangor Vineyard Shed is a particularly interesting East Coast producer, family-owned and operated by the Dunbabins, seventh-generation farmers on the historic Bangor property. They've been recognised for both their wines and their tourism offerings, including a five-star Halliday rating and multiple Tasmanian Tourism Awards.
> 
> The vineyard itself was established in 2010, planted to pinot noir, pinot gris, and chardonnay, and it sits on well-drained clay-loam over ancient dolerite rock, with a northerly aspect overlooking Blackman Bay. The owners, Matt and Vanessa Dunbabin, both hold PhDs in plant ecology, and their commitment to environmental stewardship is notable, with over 2,000 hectares of conservation reserves and a carbon-positive operation.
> 
> If you visit, you might consider their 1830 Chardonnay, which is a bright, dry white with notes of citrus, white peach, and a touch of vanilla, built to be enjoyed now or cellared for several years. They're open every day until 5pm.

---

## Case 2

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS (wine name implicitly anchors)
- anchorWinerySlug should be bangor-vineyard-shed
- anchorWineId should match the Abel Tasman wine doc
- reply should describe Abel Tasman Pinot Noir using the actual tasting notes

### Turn 1: "abel tasman pinot noir"

- elapsed: 6436 ms
- intent: `specific_winery`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 4
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (2 slugs)
- card slugs: `["jansz-tasmania","apogee-tasmania"]`

**Reply:**

> You're likely thinking of Jansz Tasmania, which honours Abel Janszoon Tasman in its name. They're a dedicated sparkling house in Pipers River, in the island's north, and their focus is entirely on traditional-method sparkling wines from chardonnay and pinot noir. While they don't produce a still pinot noir, their sparkling wines are built on that grape, and they've been making them since 1986. The Hill-Smith family, who own Jansz, have invested significantly in vineyards across Tasmania, including their original Pipers River site and newer plantings in the Coal River Valley.
> 
> If you're interested in pinot noir from the Pipers River region, Apogee Tasmania, also in Pipers River, makes an Alto Pinot Noir from Burgundy clones. It's a full-bodied red with notes of red berry summer pudding and integrated oak, designed for current drinking or up to ten years of aging. Apogee is a by-appointment cellar door, so you'd need to ring ahead to arrange a tasting.

---

## Case 3

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be bangor-vineyard-shed (winery wins over wine)
- anchorWineId should be null (winery-name hit populated the anchor, not the wine)
- same answer as #2 in substance

### Turn 1: "abel tasman pinot noir bangor vineyard shed"

- elapsed: 5178 ms
- intent: `specific_winery`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 32
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["bangor-vineyard-shed"]`

**Reply:**

> The Abel Tasman Pinot Noir from Bangor Vineyard Shed is a vibrant red, dry, with a medium body and moderate oak, offering notes of strawberry, raspberry, cherry, fig, and olive. It's a wine that's already highly regarded, having earned 95 points from James Halliday and a Gold Medal at the Australian Pinot Noir Challenge. The winemakers suggest it will continue to evolve beautifully over the next 8–10 years.
> 
> Bangor Vineyard Shed itself is a remarkable place on the East Coast, about an hour from Hobart. It's situated on an historic 6,000-hectare property that has been farmed by the Dunbabin family since 1890, and owners Matt and Vanessa Dunbabin are 7th-generation farmers. The cellar door and restaurant are built from Tasmanian timbers and hand-gathered stone, with views over the vineyard and Blackman Bay, and they're recognised for their commitment to environmental stewardship, operating as a carbon-positive business.

---

## Case 4

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be tolpuddle-vineyard
- reply should answer from hours data — no fabrication
- winery_card for Tolpuddle

### Turn 1: "Is Tolpuddle open Sunday?"

- elapsed: 4417 ms
- intent: `specific_winery`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `Sun`
- clarifyingQuestion: `null`
- candidateCount: 3
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["tolpuddle-vineyard"]`

**Reply:**

> Yes, Tolpuddle Vineyard is open on Sunday from 11am to 5pm. Keep in mind that tastings are by appointment only, so it's best to book ahead. They're known for their single-vineyard Chardonnay and Pinot Noir, both from vines planted in 1988, and the tasting room offers a guided experience overlooking the vines.

---

## Case 5

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be null (off-corpus)
- diagnostics.offCorpusWineryNamed should be true
- reply should be encyclopedic about House of Arras
- reply should include one short "not a SipLocal cellar door" line
- no winery_card (House of Arras not in corpus)

### Turn 1: "Tell me about House of Arras"

- elapsed: 5748 ms
- intent: `specific_winery`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 4
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["house-of-arras"]`

**Reply:**

> House of Arras, in Pipers River, is Australia's most awarded traditional-method sparkling producer, known for its commitment to extended lees aging. Chief winemaker Ed Carr has led the brand since its inception in 1995, and his work has earned him a Lifetime Achievement Award from the Champagne & Sparkling Wine World Championships. He sources chardonnay, pinot noir, and pinot meunier from across Tasmania's coolest sites.
> 
> The cellar door on Baxters Road is open today until 5pm, but tastings are by appointment, so you'll want to ring ahead. They offer unique experiences like a "Twilight Wine and Wildlife Tour" and "Vineyard Safari" for those who want to explore the natural surroundings.

---

## Case 6

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be null
- reply should speak about Tasmanian Riesling style generically
- reply should NOT invent a fake winery card or tasting notes

### Turn 1: "Tell me about Velvet & Willow Riesling"

- elapsed: 5198 ms
- intent: `general`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 6
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> I don't have a record of a winery or a specific wine called Velvet & Willow Riesling. It isn't one of the producers I have in my guide to Tasmania.
> 
> Could you tell me where you heard about it? I'd be happy to help you find something similar from a Tasmanian producer if you have a particular style in mind.

---

## Case 7

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- tags should include dog-friendly and restaurant
- wineWords should be empty
- no tasting_notes block in envelope
- reply should name multiple wineries that match both filters
- winery_card should include every named corpus winery

### Turn 1: "Dog-friendly cellar doors with a restaurant"

- elapsed: 6148 ms
- intent: `feature`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `["dog-friendly","restaurant"]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 6
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (3 slugs)
- card slugs: `["mayfield-estate","frogmore-creek-cellar-door--restaurant","devils-corner-cellar-door"]`

**Reply:**

> For a dog-friendly cellar door with a restaurant experience today, Thursday, you have a few excellent options.
> 
> Mayfield Estate on the East Coast is open until 5pm and welcomes dogs. They offer charcuterie platters on weekdays, and on weekends, they fire up the pizza oven. The kitchen is open from 12pm to 3pm. The cellar door looks directly out over Great Oyster Bay, providing a stunning backdrop.
> 
> In the Coal River Valley, Frogmore Creek Cellar Door & Restaurant is open until 5pm. They have a modern Australian menu showcasing local produce, with captivating vineyard views. Reservations are recommended for the restaurant. While they don't explicitly mention being dog-friendly in their primary description, the general tags confirm they do welcome dogs.
> 
> Another option on the East Coast, Devil's Corner Cellar Door, is open until 5pm and is very dog-friendly, with a wide deck overlooking Moulting Lagoon. They have restaurant offerings that make the most of that view.

---

## Case 8

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- wineWords should include skin-contact and riesling
- tasting_notes retrieval runs against the WHOLE wines namespace
- returned wines anchor to specific wineries which get cards

### Turn 1: "Skin-contact riesling producers in Tasmania"

- elapsed: 4872 ms
- intent: `feature`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 8
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["bream-creek-vineyard"]`

**Reply:**

> While skin-contact riesling is a fascinating style that's gaining traction, it's not a prominent offering at many Tasmanian cellar doors just yet. The traditional focus here leans towards crisp, aromatic expressions of riesling, often with beautiful acidity and a long, dry finish.
> 
> However, if you're curious about a producer that truly showcases the depth and potential of Tasmanian riesling, Bream Creek Vineyard on the East Coast is a pioneer. Their Bream Creek Vineyard Riesling, with vines over 40 years old, is a prime example of the classic style — lifted with notes of lime blossom and green apple, a vibrant palate, and a precise finish. While not a skin-contact wine, it offers a deep dive into the varietal's character from one of Tasmania's oldest commercial vineyards. Fred Peacock, the owner and viticulturist, is a highly regarded figure in the industry.

---

## Case 9

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- wineWords should include chardonnay
- top chardonnays from notes; their wineries get cards

### Turn 1: "Who makes the best Tasmanian chardonnay?"

- elapsed: 6717 ms
- intent: `general`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 6
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> That's a question with many good answers, as Tasmania produces some truly excellent cool-climate chardonnay. Much depends on what style you prefer, but I can certainly point to a few producers consistently making exceptional examples.
> 
> In the Coal River Valley, Tolpuddle Vineyard is widely acclaimed for their chardonnay, known for its precision and elegance. While they operate by appointment, their reputation for chardonnay is formidable. Pooley Wines, also in the Coal River Valley, makes a chardonnay with great texture and balance.
> 
> Further north, in the Tamar Valley, Josef Chromy Wines produces a chardonnay that is both rich and vibrant, often showing lovely stone fruit and citrus notes. Stoney Rise Wine Company, another Tamar Valley producer, also crafts a chardonnay that's worth seeking out for its modern, expressive style.
> 
> If you enjoy sparkling wine, chardonnay is a key component, and Tasmania excels there. Bellebonne in Pipers River, for instance, focuses exclusively on sparkling, with their wines showing the characteristic acidity and finesse that cool-climate chardonnay brings to the blend.
> 
> Many of these wineries also offer excellent food pairings, which can elevate the chardonnay tasting experience.

---

## Case 10

**Expected branch:** KNOWLEDGE

**Expectations:**
- intent should be KNOWLEDGE
- knowledge_base block populated
- reply should explain the climate/region answer in prose
- no winery cards UNLESS the model names a specific corpus winery

### Turn 1: "Why is Tasmania so good for sparkling?"

- elapsed: 5785 ms
- intent: `general`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 6
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> Tasmania's reputation for sparkling wine comes down to its cool climate and long, slow ripening season. The island sits far enough south that chardonnay and pinot noir, the two main grapes for traditional method sparkling, can hang on the vine well into autumn. This extended hang time allows them to develop complex flavours while retaining the high acidity that is crucial for a lively, structured sparkling wine.
> 
> The Pipers River region, northeast of Launceston, is particularly renowned for its sparkling wines. The soils there, often influenced by limestone, impart a distinct chalky minerality that contributes to the wines' precision and elegance. Producers like Bellebonne, for instance, focus entirely on sparkling, showcasing the region's capability. The Tamar Valley also produces excellent sparkling, and you'll find quality examples from other regions too.

---

## Case 11

**Expected branch:** TRIP

**Expectations:**
- intent should be TRIP
- regions should include Coal River Valley, Derwent Valley, or Huon Valley
- wineWords should include pinot
- dayOfWeek should be Sat
- reply should sketch a 3-4 stop itinerary
- should emit <<TRIP_PLAN>> with valid slugs and 2-4 stops

### Turn 1: "Plan a Saturday from Hobart, partner and I, love pinot"

- elapsed: 6797 ms
- intent: `itinerary`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Coal River Valley","Derwent Valley","Huon Valley"]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `Sat`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (3 slugs)
- emitted WINERY_CARD: true (3 slugs)
- trip slugs: `["sisu-wines","charles-reuben-estate","caledon-estate"]`
- card slugs: `["sisu-wines","charles-reuben-estate","caledon-estate"]`

**Reply:**

> For a Saturday focused on pinot noir from Hobart, the Coal River Valley is your best bet — it's just a 25-minute drive east, and you can easily visit three excellent cellar doors without feeling rushed.
> 
> I'd suggest starting your day at Sisu Wines, which opens at 10:30am on Saturdays. They have 25 hectares planted to vine, including a strong pinot program, and their approach to farming is deeply mindful of the land. From there, it's a short drive to Charles Reuben Estate, one of the oldest vineyards in the valley. They're open from 11am for tastings of their wines and spirits, and it's worth ringing ahead as they're by appointment. They even make a Tasmanian version of Pisco.
> 
> For lunch, Caledon Estate is an excellent choice, with its architecturally designed space offering uninterrupted views across the valley. They also open at 10am, so you could even start there if you prefer. Their Reserve Pinot Noir from the 2022 vintage is a powerful, full-bodied wine with dark cherry and raspberry notes, and fine-grained tannins.
> 
> Remember to have a designated driver, as tastings add up quickly.

---

## Case 12

**Expected branch:** TRIP

**Expectations:**
- intent should be TRIP
- reply should propose 5-6 stops across multiple regions
- reply should include a prose note about splitting across days
- single <<TRIP_PLAN>> block (multi-day handled in prose, not the marker)

### Turn 1: "Plan a 3-day Tasmania wine trip"

- elapsed: 11405 ms
- intent: `itinerary`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (9 slugs)
- emitted WINERY_CARD: true (9 slugs)
- trip slugs: `["highclare-estate-wine-room","utzinger-wines","iron-pot-bay-vineyard","josef-chromy-wines","jansz-tasmania","bellebonne","devils-corner-cellar-door","freycinet-vineyards","bream-creek-vineyard"]`
- card slugs: `["highclare-estate-wine-room","utzinger-wines","iron-pot-bay-vineyard","josef-chromy-wines","jansz-tasmania","bellebonne","devils-corner-cellar-door","freycinet-vineyards","bream-creek-vineyard"]`

**Reply:**

> Three days is a good amount of time to get a real feel for one or two of Tasmania's wine regions. Since you haven't mentioned where you're starting from, or what sort of wines you prefer, I'll suggest a potential three-day itinerary focusing on the north, based out of Launceston, hitting the Tamar Valley and Pipers River, with an eye for variety and good food.
> 
> Day 1: Tamar Valley West
> Start your day at Highclare Estate Wine Room in Launceston itself, right opposite City Park. They're open from midday, and it's a relaxed spot to begin, showcasing wines from a vineyard the owners planted themselves. From there, it's a scenic drive west into the Tamar Valley. Visit Utzinger Wines, where they focus on high-density plantings and offer a seated wine flight; remember to book ahead, as they're by appointment. Finish your day at Iron Pot Bay Vineyard, which offers a lovely setting and often has good food options.
> 
> Day 2: Tamar Valley East and Pipers River Sparkling
> Head east of Launceston today. Josef Chromy Wines is a great starting point, with a restaurant and a range of wines. From there, it's a short drive to Jansz Tasmania, where you can taste some of the island's most iconic sparkling wines. Continue north into the Pipers River region, Tasmania's heartland for traditional method sparkling. Bellebonne, operating out of Evenfall Wines, offers a dedicated sparkling experience and is open until 4pm.
> 
> Day 3: East Coast Exploration
> Today, you could head out to the East Coast, which is about a two-hour drive from Launceston, offering stunning views and a different terroir. Devil's Corner Cellar Door is a popular choice with sweeping views and food options. Just a little further south, Freycinet Vineyards is a foundational East Coast producer. If you're looking for something by appointment with a strong reputation, Bream Creek Vineyard is worth the drive.
> 
> This itinerary is designed to give you a good mix of styles and experiences, but remember to call ahead, especially for lunch bookings and any by-appointment cellar doors. A designated driver is essential for enjoying the tastings responsibly.

---

## Case 13

**Expected branch:** TRIP

**Expectations:**
- intent should be TRIP
- clarifyingQuestion should be populated (no day, no preferences, region is broad)
- reply should ask one focused follow-up before recommending
- no winery_card, no trip_plan

### Turn 1: "Plan a day from Hobart"

- elapsed: 9963 ms
- intent: `itinerary`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Coal River Valley","Derwent Valley","Huon Valley"]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (3 slugs)
- emitted WINERY_CARD: true (3 slugs)
- trip slugs: `["pressing-matters-cellar-door","caledon-estate","sisu-wines"]`
- card slugs: `["pressing-matters-cellar-door","caledon-estate","sisu-wines"]`

**Reply:**

> Given that you're starting from Hobart today, Thursday, the Coal River Valley is your best option for a relaxed day of tastings. It's just a short drive east of the city, and many of its cellar doors are open.
> 
> I'd suggest starting at Pressing Matters Cellar Door, open until 5pm. Their tasting room is set right within the vineyard, offering a unique sense of place, and they're known for their riesling and pinot noir. From there, it's a short drive to Caledon Estate, also open until 5pm, where you'll find a striking sandstone entrance and a cellar door with uninterrupted views across the valley, perfect for a tasting. For lunch, Caledon has a restaurant on site.
> 
> If you're looking for a third stop, Sisu Wines is also open until 4:30pm today. They're a small-scale producer focused on sustainable practices, with much of their 95-hectare farm left open to native plantings and sheep.
> 
> That gives you three distinct cellar door experiences in one compact area, and you'll be back in Hobart well before dinner. Remember that tastings can add up, so be sure to have a designated driver.

---

## Case 14

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- clarifyingQuestion should be null (NARROWED rule per stipulation #12)
- reply should give a confident default recommendation

### Turn 1: "What's good?"

- elapsed: 4434 ms
- intent: `general`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 6
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> "What's good?" is a wonderfully open question, and Tasmania has so much to offer. To give you the best recommendation, could you tell me a little more about what you're looking for? Are you interested in a particular style of wine, like sparkling or pinot noir, or a specific region? Knowing if you're planning a visit, or just curious, would help too.

---

## Case 15

**Expected branch:** OUT_OF_SCOPE

**Expectations:**
- intent should be OUT_OF_SCOPE
- reply should be a warm deflection
- no cards, no trip plan

### Turn 1: "Help me write an email"

- elapsed: 2720 ms
- intent: `out_of_scope`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 0
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> I can certainly help you with the content of an email, but I can't actually write or send emails myself. What kind of email are you looking to write? Perhaps something about a Tasmanian wine experience?

---

## Case 16 (multi-turn)

**Expected branch:** TRIP

**Expectations:**
- turn 2 selfContainedQuery should be a coref rewrite (e.g. "Plan a sparkling-focused Coal River day instead of pinot")
- turn 2 should emit a fresh trip plan with sparkling producers

### Turn 1: "Suggest a Coal River pinot day"

- elapsed: 7767 ms
- intent: `itinerary`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Coal River Valley"]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (3 slugs)
- emitted WINERY_CARD: true (3 slugs)
- trip slugs: `["pressing-matters-cellar-door","caledon-estate","charles-reuben-estate"]`
- card slugs: `["pressing-matters-cellar-door","caledon-estate","charles-reuben-estate"]`

**Reply:**

> For a day focused on Coal River Valley pinot noir, you have some excellent options, and it's a beautiful region to explore. Since you're looking for a pinot day, we can build a route that highlights the valley's strengths in that varietal.
> 
> You could begin your day at Pressing Matters Cellar Door, which is open until 5pm today. They offer a strong range of single-site wines, and you can truly see the vines you're tasting from their unique cellar door location. From there, it's a short drive to Caledon Estate, where you could settle in for lunch. Their kitchen serves a wine bar-inspired menu with local produce, and their Reserve Pinot Noir received 93 points from Halliday. They're open until 5pm today. If you're keen for a third stop, Charles Reuben Estate is open until 3pm today and offers a relaxed tasting experience with their pinot. Remember that for any by-appointment wineries, like Uplands Vineyard or Craigow, you'd need to ring ahead.
> 
> That gives you three distinct experiences, all with a focus on Coal River Valley pinot. Tastings can add up, so consider a designated driver.

### Turn 2: "actually let's do sparkling"

- elapsed: 8353 ms
- intent: `itinerary`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Coal River Valley"]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> Certainly, a day for Tasmanian sparkling in the Coal River Valley is a great idea. While Pipers River is often considered the heartland of sparkling, the Coal River Valley also produces some excellent examples, often with a lovely richness from its slightly warmer aspect.
> 
> Since today is Thursday, you could start your day at Pressing Matters Cellar Door, open until 5pm. While they are renowned for their riesling, they also produce sparkling wines. From there, you could head to Sisu Wines, open until 4:30pm today. They have a focus on sustainable farming and offer a small, seasonal food selection to pair with their wines. While they don't have a dedicated sparkling on the current tasting notes, they plant a wide range of varietals, including those used in sparkling wine.
> 
> For a third option, Derwent Estate Vineyard in the nearby Derwent Valley is open until 5pm today and is known for its award-winning wines, including sparkling. It's about a 20-minute drive from Sisu Wines, offering a scenic change of pace along the Derwent River.
> 
> Remember to confirm opening hours and perhaps ring ahead for Sisu Wines if you're keen on specific tastings.

---
