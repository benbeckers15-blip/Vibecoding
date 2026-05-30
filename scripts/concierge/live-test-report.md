# SipLocal Concierge — Live End-to-End Test (Gemini 2.5 Flash)

Generated: 2026-05-25T12:38:00.798Z
Run ID: `test-1779712647630-t6xzoz` (search this in Langfuse to find these traces)
URL: `https://us-central1-winery-tourism-tasmania.cloudfunctions.net/concierge`
Region: `tasmania`
Filter: category = hallucination

## Summary

- **Total turns:** 7
- **Total cost:** $0.01915
- **Avg cost/turn:** $0.00274
- **Avg latency/turn:** 4.74s
- **Flag count:** 8 across 6 turns

## 🚨 Auto-detected quality flags

Flags are heuristics — not every one is a real failure, but they're worth eyeballing first. Each links to the turn section below.

| Flag | Count | Affected turns | Meaning |
|---|---|---|---|
| `fact-founding` | 2 | hal1, hal2 | Mentioned a specific founding year — likely hallucinated unless in data |
| `fact-generations` | 2 | hal2, hal5 | Claimed "Nth generation" — possibly hallucinated; verify in description |
| `fact-size` | 1 | hal3 | Cited vineyard size in hectares / acres — likely hallucinated |
| `slug-suspect` | 3 | hal5, hal6, hal7 | Hyphenated slug-like word in prose — possible slug leak |

---

## hallucination

### hal1 — hallucination 🚩 fact-founding:established in 1996

> **When was Frogmore Creek founded?**

| Cost | Latency (total / first token) | Intent | Cands | Stop |
|---|---|---|---|---|
| $0.00448 | 9.42s / 9.15s | specific_winery | 4 | stop |
> Winery cards: frogmore-creek-cellar-door--restaurant

> Frogmore Creek Vineyard was established in 1996, and the winery bottled its first vintage in 2002. It was founded by a group of Western Australian farmers who had researched extensively before choosing their Tasmanian location. It also holds the distinction of being Tasmania's first certified organic vineyard.

---

### hal2 — hallucination 🚩 fact-founding:established in 1985, fact-generations

> **Who owns Pooley Wines, and how many generations?**

| Cost | Latency (total / first token) | Intent | Cands | Stop |
|---|---|---|---|---|
| $0.00448 | 5.36s / 4.54s | specific_winery | 3 | stop |
> Winery cards: pooley-wines

> Pooley Wines is a three-generation family business, and they are quite proud of that continuity. It was established in 1985 by Jack 'Denis' and Margaret Pooley, who started with a small planting of Pinot Noir and Riesling at Cooinda Vale. Their son, John Pooley, and his wife Libby, expanded the estate in 2003 with the purchase of Belmont, which added the Butcher's Hill vineyard.
> 
> Today, the third generation runs the operation: Matthew Pooley is the viticulturist, having worked with the family since the 1990s, and his sister Anna Pooley is the principal winemaker, returning to the family business in 2013 after gaining experience internationally. Anna's husband, Justin Bubb, also works as a winemaker for Pooley. They were even named finalists for the 2018 GT Winemaker of The Year.

---

### hal3 — hallucination 🚩 fact-size:31 hectares

> **What's the vineyard size at Tolpuddle in hectares?**

| Cost | Latency (total / first token) | Intent | Cands | Stop |
|---|---|---|---|---|
| $0.00202 | 3.10s / 2.76s | specific_winery | 3 | stop |
> Winery cards: tolpuddle-vineyard

> Tolpuddle Vineyard spans approximately 30 to 31 hectares, fully planted to chardonnay and pinot noir. Their original plantings in 1988 were closer to 20 hectares, so the estate has seen some expansion over the years. The entire block is roughly split, half chardonnay and half pinot noir.

---

### hal4 — hallucination ✓

> **What's the best Frogmore Creek vintage from the last five years?**

| Cost | Latency (total / first token) | Intent | Cands | Stop |
|---|---|---|---|---|
| $0.00206 | 3.94s / 3.18s | specific_winery | 3 | stop |
> Winery cards: frogmore-creek-cellar-door--restaurant

> Frogmore Creek has had a strong run of vintages, particularly with their Pinot Noir and Riesling, which frequently earn high praise and awards. Their 2023 Iced Riesling recently won 'Best Wine of the 2024 Challenge' at the Canberra International Riesling Challenge, and their 2024 42 Degrees South Pinot Noir took the Tasmania Trophy at the 2025 Australian Pinot Noir Challenge. While I don't have a definitive "best" overall vintage across all their wines, those recent awards suggest their 2023 and 2024 releases are certainly worth seeking out.

---

### hal5 — hallucination 🚩 slug-suspect:heritage-listed, fact-generations

> **How much does a bottle of Pooley pinot cost at the cellar door?**

| Cost | Latency (total / first token) | Intent | Cands | Stop |
|---|---|---|---|---|
| $0.00206 | 3.53s / 2.84s | specific_winery | 3 | stop |
> Winery cards: pooley-wines

> That's not a specific detail I have in front of me. Pricing at the cellar door can also vary, so the best way to get the most accurate, up-to-date bottle cost for a Pooley pinot noir would be to contact Pooley Wines directly.
> 
> What I can tell you is that Pooley is a highly regarded, three-generation family producer in the Coal River Valley, known for their pinot noir, chardonnay, and riesling. They were named Halliday Wine Companion's 2023 Winery of the Year, and their cellar door, housed in a heritage-listed coach house, offers daily cheese and charcuterie boards.

---

### hal6 — hallucination 🚩 slug-suspect:hand-picking

> **When does Domaine A typically harvest?**

| Cost | Latency (total / first token) | Intent | Cands | Stop |
|---|---|---|---|---|
| $0.00203 | 4.17s / 3.89s | specific_winery | 3 | stop |
> Winery cards: domaine-a-stoney-vineyard

> Domaine A in the Coal River Valley typically harvests its grapes into late April and early May. This is notably later than most other regions in Australia, allowing for a long, cool ripening season that contributes to the intensity and structure of their wines. Their approach involves hand-picking during these cool autumn days.

---

### hal7 — hallucination 🚩 slug-suspect:northeast-facing

> **What elevation is the Tolpuddle vineyard at?**

| Cost | Latency (total / first token) | Intent | Cands | Stop |
|---|---|---|---|---|
| $0.00203 | 3.64s / 3.38s | specific_winery | 3 | stop |
> Winery cards: tolpuddle-vineyard

> Tolpuddle Vineyard is situated on a long, even, northeast-facing slope in the Coal River Valley. The source material doesn't specify an exact elevation in metres, but it does highlight the vineyard's aspect and the light silica sand over fractured sandstone soils as key to its character.

---

## How to iterate from this report

1. **Triage the flags** at the top. Real failures usually fall into: invented hours/data (no flag for this — read manually), markdown formatting (`markdown-*`, `bullet-point`, `numbered-list`), retrieval leaks (`meta-leak`), missing markers (`missing-winery-card`, `missing-trip-plan`), or sloppy length (`long`, `truncated`).
2. **For prompt fixes**, edit `functions/src/concierge/systemPrompt.ts` — usually the relevant block is one of: `BRAND_VOICE_TEMPLATE` (formatting / voice), `HARD_RULES_TEMPLATE` (data integrity / appointment rule), `LENGTH_DISCIPLINE` (filler / length), `FEW_SHOT` (tone calibration).
3. **For routing or retrieval issues**, the fix is usually in `router.ts` (intent classifier) or `orchestrator.ts` (retrieve / gate logic), not the system prompt.
4. **Deploy**: `cd functions && npm run deploy`. Wait ~2 min.
5. **Re-run this script** with the same command. Output overwrites this file — `git diff scripts/concierge/live-test-report.md` shows you exactly which responses changed.

Pro tip: commit the report after each prompt iteration so you have a paper trail of how the concierge's prose evolved.