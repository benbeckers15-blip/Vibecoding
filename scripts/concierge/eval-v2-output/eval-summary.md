# V2 Concierge Eval — Structural Pass

URL: http://127.0.0.1:5001/winery-tourism-tasmania/us-central1/concierge
Run at: 2026-05-28T12:11:10.747Z

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

- elapsed: 8205 ms
- intent: `WINERY_FOCUS`
- anchorWinerySlug: `bangor-vineyard-shed`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 1
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["bangor-vineyard-shed"]`

**Reply:**

> Bangor Vineyard Shed, on the East Coast about an hour from Hobart, is a working farm that happens to make wine. It's run by the Dunbabin family, who are seventh-generation farmers on the property, and their approach to winemaking reflects that deep connection to the land.
> 
> They focus on cool-climate varietals, and the 2023 1830 Chardonnay offers bright citrus and white peach, with a touch of vanilla and cashew, making it lovely with seafood or creamy pasta. Their 2024 Abel Tasman Pinot Noir is vibrant with strawberry and raspberry, underpinned by savoury fig and olive notes, and is built to age beautifully.
> 
> The cellar door is open every day until 5pm, and they offer various tasting experiences, including wine and food pairings, as well as vineyard tours. It's a five-star Halliday-rated winery and has won multiple Tasmanian Tourism Awards.

---

## Case 2

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS (wine name implicitly anchors)
- anchorWinerySlug should be bangor-vineyard-shed
- anchorWineId should match the Abel Tasman wine doc
- reply should describe Abel Tasman Pinot Noir using the actual tasting notes

### Turn 1: "abel tasman pinot noir"

- elapsed: 4705 ms
- intent: `WINERY_FOCUS`
- anchorWinerySlug: `bangor-vineyard-shed`
- anchorWineId: `bangor-vineyard-shed__abel-tasman-pinot-noir-2024`
- regions: `[]`
- tags: `[]`
- wineWords: `["pinot","noir"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 1
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["bangor-vineyard-shed"]`

**Reply:**

> The Abel Tasman Pinot Noir from Bangor Vineyard Shed is a vibrant red, displaying notes of strawberry, raspberry, and cherry, with deeper undertones of fig and olive. It's a structured wine with a savoury edge that suggests it will evolve beautifully over the next 8–10 years. James Halliday awarded the 2024 vintage 95 points, and it also earned a Gold Medal at the Australian Pinot Noir Challenge.
> 
> Bangor Vineyard Shed is an award-winning cellar door on the East Coast, open today until 5pm, and they offer tours if you'd like to explore the property.

---

## Case 3

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be bangor-vineyard-shed (winery wins over wine)
- anchorWineId should be null (winery-name hit populated the anchor, not the wine)
- same answer as #2 in substance

### Turn 1: "abel tasman pinot noir bangor vineyard shed"

- elapsed: 4519 ms
- intent: `WINERY_FOCUS`
- anchorWinerySlug: `bangor-vineyard-shed`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `["pinot","noir"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 1
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["bangor-vineyard-shed"]`

**Reply:**

> The Abel Tasman Pinot Noir from Bangor Vineyard Shed is a vibrant expression of the East Coast's cool maritime climate. The 2024 vintage, a gold medalist and 95-point Halliday wine, opens with bright red fruit notes of strawberry, raspberry, and cherry, layered with fig, olive, and subtle savoury undertones that hint at its aging potential. It's a wine crafted for longevity, expected to develop more depth and complexity over the next eight to ten years.
> 
> Bangor Vineyard Shed itself is an award-winning cellar door on an historic farming estate, open today until 5pm. They also produce an excellent 1830 Chardonnay, a refined wine with citrus, white peach, and vanilla notes that pairs beautifully with seafood or creamy pasta.

---

## Case 4

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be tolpuddle-vineyard
- reply should answer from hours data — no fabrication
- winery_card for Tolpuddle

### Turn 1: "Is Tolpuddle open Sunday?"

- elapsed: 6174 ms
- intent: `WINERY_FOCUS`
- anchorWinerySlug: `tolpuddle-vineyard`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `Sun`
- clarifyingQuestion: `null`
- candidateCount: 1
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["tolpuddle-vineyard"]`

**Reply:**

> Yes, Tolpuddle is open on Sunday from 11am to 5pm. Do remember that tastings are by appointment only, so it's best to book in advance.

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

- elapsed: 6653 ms
- intent: `WINERY_FOCUS`
- anchorWinerySlug: `house-of-arras`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 1
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["house-of-arras"]`

**Reply:**

> House of Arras is truly a benchmark for Australian sparkling wine, and a visit to their cellar door in Pipers River offers a deep dive into what makes them so acclaimed. They focus entirely on traditional-method sparkling wines crafted from Chardonnay and Pinot Noir, drawing fruit from Tasmania's coolest sites.
> 
> Winemaker Ed Carr, often called Australia's most awarded sparkling winemaker, has been the driving force since the winery's founding in 1995. His vision centers on extended lees aging, with some of their prestige cuvées spending a decade or more on lees, which builds incredible depth and textural complexity. This approach has earned them a remarkable collection of accolades, including numerous international trophies and even a 100-point rating from Robert Parker Wine Advocate for their E.J. Carr Late Disgorged 1998 Magnum.
> 
> The cellar door, nestled amidst woodlands along the Pipers River, is open today until 5pm. They offer a range of luxurious and informative tasting experiences, from seated tastings exploring their regional terroir to masterclasses. It’s important to remember that tastings are by appointment, so do ring ahead to book your visit.

---

## Case 6

**Expected branch:** WINERY_FOCUS

**Expectations:**
- intent should be WINERY_FOCUS
- anchorWinerySlug should be null
- reply should speak about Tasmanian Riesling style generically
- reply should NOT invent a fake winery card or tasting notes

### Turn 1: "Tell me about Velvet & Willow Riesling"

- elapsed: 3057 ms
- intent: `WINERY_FOCUS`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `["riesling"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 0
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> I don't have a record of a Tasmanian producer called Velvet & Willow. It might be a smaller, newer label I haven't come across yet, or perhaps from another region.
> 
> Tasmanian Riesling, generally speaking, is known for its elegant, often dry style, with vibrant citrus notes and a crisp minerality. It's a varietal that truly expresses our cool climate, offering wines with excellent aging potential that develop complex toasty notes over time.
> 
> If you're looking to explore some excellent Tasmanian Riesling, I could certainly point you to a few acclaimed producers.

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

- elapsed: 5962 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `["dog-friendly","restaurant"]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 3
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (3 slugs)
- card slugs: `["mayfield-estate","every-man--his-dog-vineyard","devils-corner-cellar-door"]`

**Reply:**

> For dog-friendly cellar doors with a restaurant, I'd suggest two excellent options, both open today until 5pm.
> 
> Mayfield Estate on the East Coast offers stunning views of Great Oyster Bay, and their cellar door and restaurant are designed to make the most of the maritime setting. They focus on Pinot Noir and Chardonnay, with some newer plantings of Pinot Gris and Shiraz. The Dunbabin family has a long history on this land, and their winemaking venture, though relatively young, is already producing compelling wines.
> 
> Every Man & His Dog Vineyard in the Coal River Valley takes a slightly different approach, pairing their wines with handcrafted chocolates made on-site. They're known for their distinctive Siegerrebe and Ehrenfelser, two rare German white varieties that thrive in Tasmania's cool climate, alongside their well-regarded Cabernet Sauvignon. It's a unique experience that goes beyond a standard wine tasting.
> 
> Devil's Corner Cellar Door, also on the East Coast, is another strong contender. It's built right on the water with expansive views over Moulting Lagoon. They offer a full kitchen that runs until 4pm, making it a great spot for lunch. Their focus is on cool-climate varieties like Pinot Noir, Syrah, Riesling, Pinot Gris, and Chardonnay, all reflecting the fresh, fruit-driven style of the East Coast.

---

## Case 8

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- wineWords should include skin-contact and riesling
- tasting_notes retrieval runs against the WHOLE wines namespace
- returned wines anchor to specific wineries which get cards

### Turn 1: "Skin-contact riesling producers in Tasmania"

- elapsed: 6557 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `["skin-contact","riesling"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 11
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (3 slugs)
- card slugs: `["bream-creek-vineyard","derwent-estate-vineyard","broad-acres-vineyard"]`

**Reply:**

> I don't have any specific skin-contact rieslings in my notes right now, but I can certainly speak to some excellent Tasmanian producers known for their dry, aromatic rieslings that often show lovely texture and complexity.
> 
> Bream Creek Vineyard on the East Coast makes a highly-regarded Riesling. Their 2025 vintage, for example, offers lifted aromas of lime blossom and green apple, with a crisp, vibrant palate and a saline streak. It's a precise and focused wine with bright acidity. Just remember to ring ahead, as Bream Creek is by appointment.
> 
> In the Derwent Valley, Derwent Estate Vineyard produces a 2022 Riesling that presents mandarin, lime, and honeysuckle on the nose, with a palate of citrus, sherbet, and bright acid. They operate out of the historic Rathbone Cottage and are open until 5pm today.
> 
> Broad Acres Vineyard in the North West also has a 2023 Riesling with delicate flavours; you'll find notes of white flowers, apricot, and lemon zest, with a lively palate and zippy acidity. Their on-site cafe, Windows on Westella, is open until 3:30pm today.
> 
> While these aren't explicitly skin-contact, they represent the quality and style of dry Tasmanian riesling that might appeal to you.

---

## Case 9

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- wineWords should include chardonnay
- top chardonnays from notes; their wineries get cards

### Turn 1: "Who makes the best Tasmanian chardonnay?"

- elapsed: 6235 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `["chardonnay"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (4 slugs)
- card slugs: `["broad-acres-vineyard","bangor-vineyard-shed","darlington-vineyard","charles-reuben-estate"]`

**Reply:**

> Tasmania offers some excellent cool-climate chardonnays, and a few producers stand out.
> 
> In the North West, Broad Acres Vineyard crafts a 2022 Chardonnay that's a fine expression of the region, showing floral, citrus, and stone fruit notes with integrated toasted oak.
> 
> From the East Coast, Bangor Vineyard Shed's 1830 Chardonnay, the 2023 vintage, presents brilliant acidity and a refined structure with notes of citrus and white peach, while Darlington Vineyard's 2024 Chardonnay offers elegance with stone fruit and a subtle touch of oak.
> 
> Closer to Hobart in the Coal River Valley, Charles Reuben Estate's 2022 Chardonnay provides a crisp, elegant palate with classic buttery notes, citrus, and tropical fruit.
> 
> All of these are highly regarded, and each offers a slightly different take on Tasmanian chardonnay. It often comes down to personal preference for oak influence and fruit profile.

---

## Case 10

**Expected branch:** KNOWLEDGE

**Expectations:**
- intent should be KNOWLEDGE
- knowledge_base block populated
- reply should explain the climate/region answer in prose
- no winery cards UNLESS the model names a specific corpus winery

### Turn 1: "Why is Tasmania so good for sparkling?"

- elapsed: 5955 ms
- intent: `KNOWLEDGE`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `["sparkling"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 0
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (1 slugs)
- card slugs: `["house-of-arras"]`

**Reply:**

> Tasmania's climate is ideal for sparkling wine production, particularly for traditional method wines made from Chardonnay and Pinot Noir. The island's cool temperatures, long daylight hours during the growing season, and significant diurnal temperature shifts allow the grapes to ripen slowly and fully, developing complex flavours while retaining the high acidity crucial for sparkling wines.
> 
> The Pipers River region in the north is particularly renowned for its sparkling wines, with producers like House of Arras crafting world-class examples. Their EJ Carr Late Disgorged 2004, for instance, showcases the remarkable autolytic complexity that comes from extended lees aging — notes of toasted brioche, browned butter, and hazelnut, all lifted by a bright citrus core. This kind of depth and structure is a direct result of Tasmania's unique cool-climate conditions. Many of the island's most acclaimed sparkling wines come from this region, benefiting from the maritime influence and well-drained soils.

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

- elapsed: 5641 ms
- intent: `TRIP`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `["Coal River Valley","Derwent Valley","Huon Valley"]`
- tags: `[]`
- wineWords: `["pinot"]`
- dayOfWeek: `Sat`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (4 slugs)
- emitted WINERY_CARD: true (4 slugs)
- trip slugs: `["pooley-wines","pressing-matters-cellar-door","caledon-estate","charles-reuben-estate"]`
- card slugs: `["pooley-wines","pressing-matters-cellar-door","caledon-estate","charles-reuben-estate"]`

**Reply:**

> For a Saturday tasting from Hobart with a focus on Pinot Noir, the Coal River Valley is an ideal choice, offering a blend of acclaimed vineyards and a relaxed atmosphere.
> 
> I'd suggest starting at Pooley Wines, which opens at 10am. They're known for their elegant Pinot Noirs, and the cellar door offers a warm welcome. From there, you could head to Pressing Matters Cellar Door, open until 5pm today, where you can taste their wines, including Pinot, right within the vineyard itself. For lunch, Caledon Estate offers a beautiful setting with impressive views and their Reserve Pinot Noir is a fine example of the region's style, with notes of dark cherry and raspberry.
> 
> If you'd like another stop, Charles Reuben Estate is open until 4pm on Saturdays and offers tours, which can be a nice way to learn more about the winemaking process.

---

## Case 12

**Expected branch:** TRIP

**Expectations:**
- intent should be TRIP
- reply should propose 5-6 stops across multiple regions
- reply should include a prose note about splitting across days
- single <<TRIP_PLAN>> block (multi-day handled in prose, not the marker)

### Turn 1: "Plan a 3-day Tasmania wine trip"

- elapsed: 5753 ms
- intent: `TRIP`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: true (5 slugs)
- emitted WINERY_CARD: true (9 slugs)
- trip slugs: `["pressing-matters-cellar-door","highclare-estate-wine-room","bellebonne","utzinger-wines","bream-creek-vineyard"]`
- card slugs: `["pressing-matters-cellar-door","highclare-estate-wine-room","brinktop-vineyard","stargazer-wine","bellebonne","utzinger-wines","bundaleera-vineyard","bream-creek-vineyard","sailor-seeks-horse"]`

**Reply:**

> A three-day trip through Tasmania's wine regions offers a wonderful immersion into the island's diverse terroirs. Here’s a possible itinerary, focusing on different regions each day to give you a broad experience.
> 
> Day One: The Coal River Valley
> Start your journey in the Coal River Valley, just a short drive from Hobart. This region is known for its elegant cool-climate wines. Begin your day at Pressing Matters Cellar Door, open until 5pm today, where you can taste their acclaimed Riesling and Pinot Noir right within the vineyard rows. Afterward, head to Highclare Estate Wine Room, open until 6:30pm, for a tasting at a property lovingly developed by its owners. For a more intimate experience, consider booking a tasting at Brinktop Vineyard, which offers hands-on winemaking experiences, or Stargazer Wine, which focuses on small-batch, artisanal wines (Stargazer is closed today, but open Friday through Monday).
> 
> Day Two: Tamar Valley and Pipers River
> Head north towards Launceston for your second day, exploring the Tamar Valley and the sparkling wine heartland of Pipers River. Begin in Pipers River at Bellebonne, open until 4pm, for a dedicated sparkling wine tasting experience. Then, make your way to the Tamar Valley. Utzinger Wines, open until 4pm today, offers tours and tastings by appointment, showcasing high-density plantings. Also in the Tamar Valley, Bundaleera Vineyard is an appointment-only cellar door, and while their cellar door typically opens on Sundays, it's worth ringing ahead to see if they can accommodate a tasting.
> 
> Day Three: East Coast or Huon Valley
> For your final day, you have a choice depending on your preference. If you enjoy dramatic coastal scenery and a slightly warmer climate, head to the East Coast. Bream Creek Vineyard, open until 5pm today, is an award-winning by-appointment cellar door with stunning views over Marion Bay. If you prefer the cooler, more secluded charm of the south, the Huon Valley is an excellent choice. Sailor Seeks Horse is a beautiful, by-appointment vineyard that produces elegant wines from a site they painstakingly restored.
> 
> This itinerary covers diverse regions, but remember to call ahead, especially for the by-appointment cellar doors, to ensure they can welcome you.

---

## Case 13

**Expected branch:** TRIP

**Expectations:**
- intent should be TRIP
- clarifyingQuestion should be populated (no day, no preferences, region is broad)
- reply should ask one focused follow-up before recommending
- no winery_card, no trip_plan

### Turn 1: "Plan a day from Hobart"

- elapsed: 4189 ms
- intent: `TRIP`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `When are you thinking, and what kind of day do you want from Hobart?`
- candidateCount: 0
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> For a day trip from Hobart, the Coal River Valley is your best bet; it's just a short drive east of the city, making it easy to fit in a few cellar doors. Today, Thursday, offers some excellent choices.
> 
> I'd suggest starting at Pooley Wines, where you can enjoy their award-winning single-vineyard wines in a beautiful setting. They're open until 5pm today.

---

## Case 14

**Expected branch:** DISCOVERY

**Expectations:**
- intent should be DISCOVERY
- clarifyingQuestion should be null (NARROWED rule per stipulation #12)
- reply should give a confident default recommendation

### Turn 1: "What's good?"

- elapsed: 2524 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `[]`
- dayOfWeek: `null`
- clarifyingQuestion: `Anything you're looking for — pinot focus, lunch, somewhere with a view?`
- candidateCount: 0
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> Tasmania offers such a range, it truly depends on what you're in the mood for. Are you hoping for a focused tasting experience, perhaps a lovely lunch with a view, or something specific like a cellar door known for its pinot noir? Knowing a little more about what you're looking for will help me guide you to the perfect spot.

---

## Case 15

**Expected branch:** OUT_OF_SCOPE

**Expectations:**
- intent should be OUT_OF_SCOPE
- reply should be a warm deflection
- no cards, no trip plan

### Turn 1: "Help me write an email"

- elapsed: 2604 ms
- intent: `OUT_OF_SCOPE`
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

> I can certainly help you with questions about Tasmanian wine and cellar doors, but I'm not able to write emails or perform other general-purpose tasks. How can I help you with wine today?

---

## Case 16 (multi-turn)

**Expected branch:** TRIP

**Expectations:**
- turn 2 selfContainedQuery should be a coref rewrite (e.g. "Plan a sparkling-focused Coal River day instead of pinot")
- turn 2 should emit a fresh trip plan with sparkling producers

### Turn 1: "Suggest a Coal River pinot day"

- elapsed: 6450 ms
- intent: `TRIP`
- anchorWinerySlug: `coal-valley-vineyard`
- anchorWineId: `null`
- regions: `["Coal River Valley"]`
- tags: `[]`
- wineWords: `["pinot"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 12
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: true (6 slugs)
- card slugs: `["pressing-matters-cellar-door","caledon-estate","craigow-vineyard","uplands-vineyard","charles-reuben-estate","sisu-wines"]`

**Reply:**

> The Coal River Valley is an excellent choice for a pinot-focused day, offering a range of styles and cellar door experiences, and it's conveniently close to Hobart. Today, Thursday, you have several wonderful options.
> 
> You could begin at Pressing Matters Cellar Door, open until 5pm, where the tasting room is uniquely situated right within the vineyard, offering a direct connection to the wines you're enjoying. Their pinot noir is known for its clarity and expression of the site.
> 
> Just a short drive away is Caledon Estate, also open until 5pm. Their Reserve Pinot Noir from 2022 is a beautiful example of the region, with deep ruby colour, concentrated red fruits, and subtle spice from oak. The cellar door itself is architecturally striking, with expansive views.
> 
> For a more intimate experience, consider Craigow Vineyard. They are an award-winning producer, and while their cellar door is by appointment, a call ahead can often secure you a tasting of their classic pinot noir, which showcases black cherry and spice notes. Similarly, Uplands Vineyard is an older property with a rich history, offering tastings by appointment.
> 
> Charles Reuben Estate is open until 3pm today and offers tours, which could add another dimension to your visit. Their self-contained cottage among the vines speaks to the peaceful setting. Sisu Wines, open until 4:30pm, is another good option, known for its thoughtful approach to farming and winemaking on a larger estate.
> 
> Remember to ring ahead for any by-appointment cellar doors to ensure they can accommodate you.

### Turn 2: "actually let's do sparkling"

- elapsed: 7624 ms
- intent: `DISCOVERY`
- anchorWinerySlug: `null`
- anchorWineId: `null`
- regions: `[]`
- tags: `[]`
- wineWords: `["sparkling"]`
- dayOfWeek: `null`
- clarifyingQuestion: `null`
- candidateCount: 10
- emitted TRIP_PLAN: false
- emitted WINERY_CARD: false

**Reply:**

> Certainly, let's shift to sparkling wine. Tasmania, particularly the northern regions, is renowned for its traditional method sparkling, drawing comparisons to Champagne.
> 
> For today, Thursday, Pipers River is your best bet for a focused sparkling experience. Bellebonne, open until 4pm, is dedicated entirely to sparkling wine, and they craft some truly exquisite examples. Their Bis Non Vintage Rose, made from Pinot Noir, offers a melody of strawberry, Turkish delight, and rose petal, with a long, elegant finish.
> 
> Clover Hill Wines, also in Pipers River and open until 4:30pm, is another excellent choice. Their cellar door is quite impressive, and they are award-winning producers. I'd particularly recommend their Blanc de Blancs MV, a Chardonnay-driven sparkling with notes of citrus, white peach, and green apple, layered with hints of sea spray and toasted bread. Do keep in mind that Clover Hill operates by appointment, so it's best to call ahead.
> 
> Delamere Vineyard, open until 4:30pm today, is another Pipers River gem. Their NV Rose, crafted from 100% Pinot Noir, is a benchmark Tasmanian sparkling. It displays a pale salmon colour with fresh strawberry and musk aromas, complexed by hints of lanolin and toast.
> 
> If you find yourself in the Tamar Valley, Highclare Estate Wine Room is open until 6:30pm. While they offer a range of wines, it's a welcoming spot if you're exploring that region.
> 
> Keep in mind that Brinktop Vineyard in the Coal River Valley and Loira Vines in the Tamar Valley are not open today, Thursday. Bundaleera Vineyard, also in the Tamar Valley, is by appointment, but their Sparkling shows notes of citrus and red apple with a toasted biscuit aroma and fine creamy texture.
> 
> Enjoy your sparkling day!

---
