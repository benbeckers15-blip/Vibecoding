# Winery Sources — Audit Report

Generated: 2026-05-25T10:13:53.392Z
Source dir: `/Users/ben/Desktop/SipLocal/scripts/winery-sources`

## Headline numbers

- **Files audited:** 73
- **Total prose words:** 93,681
- **Total unique citations across the corpus:** 10
- **Word count per winery:** median 1272, range 0–2009
- **Unique citations per winery:** median 0, range 0–10
- **Files with at least one red flag:** 73 of 73 (100%)

## Word count distribution

| Range | Count | Bar |
|---|---:|---|
| 0–249 | 1 | █ |
| 250–499 | 0 |  |
| 500–999 | 12 | █████████ |
| 1000–1499 | 39 | ██████████████████████████████ |
| 1500–2499 | 21 | ████████████████ |
| 2500+ | 0 |  |

## Section coverage

How many wineries have populated content for each expected section. "Empty" means the section header exists but the body is "No reliable information found" or blank (model honestly reported having nothing) — not a failure, just signal.

| Section | Populated | Empty | Missing |
|---|---:|---:|---:|
| Founding & History | 72 | 0 | 1 |
| People | 71 | 1 | 1 |
| Vineyard & Site | 70 | 2 | 1 |
| Wines | 71 | 0 | 2 |
| Cellar Door Experience | 70 | 1 | 2 |
| Food & Hospitality | 55 | 16 | 2 |
| Awards & Recognition | 65 | 6 | 2 |
| Sustainability & Certifications | 48 | 23 | 2 |
| Visiting Practical Info | 69 | 2 | 2 |
| Notable / Distinctive | 71 | 0 | 2 |
| Sources | 70 | 0 | 3 |

## 🚩 Flagged files (73)

Flags are heuristics, not failures. Inspect manually before deciding to re-run. Common interpretations:
- `short:Nw` — file under 250 words. Either a tiny-presence winery (fine) OR a script failure (re-run with `--force --slugs <slug>`).
- `no-citations` / `no-sources-list` — grounding didn't fire; re-run.
- `duplicates:N` — Gemini wrote a section twice. The prompt fix should prevent this; re-run with `--force`.
- `missing-sections:N` — model skipped sections. Often fine for tiny wineries; problem if a well-known winery shows this.
- `mostly-empty:N` — many "No reliable information found" sections. Genuine signal that this winery has limited online presence.
- `truncated-cite` / `truncated-end` — model got cut off mid-sentence. Re-run with `--force`.

| Slug | Words | Citations | Sources | Sections (pop/empty/missing) | Flags |
|---|---:|---:|---:|---|---|
| `bangor-vineyard-shed` | 1146 | 0 (0 unique) | 0 | 3/0/8 | no-citations, no-sources-list, duplicates:2, missing-sections:8, truncated-cite |
| `bruny-island-premium-wines` | 0 | 0 (0 unique) | 0 | 0/0/11 | short:0w, no-citations, no-sources-list, missing-sections:11 |
| `bellebonne` | 2009 | 29 (10 unique) | 0 | 9/1/1 | no-sources-list, duplicates:9 |
| `darlington-vineyard` | 749 | 0 (0 unique) | 15 | 8/3/0 | no-citations |
| `uplands-vineyard` | 776 | 0 (0 unique) | 12 | 10/1/0 | no-citations |
| `coal-valley-vineyard` | 795 | 0 (0 unique) | 13 | 10/1/0 | no-citations |
| `every-man--his-dog-vineyard` | 827 | 0 (0 unique) | 10 | 9/2/0 | no-citations |
| `cathedral-rock-winery-cellar-door` | 830 | 0 (0 unique) | 34 | 9/2/0 | no-citations |
| `highclare-estate-wine-room` | 878 | 0 (0 unique) | 20 | 11/0/0 | no-citations |
| `heriots-point-vineyard-and-boutique-accommodation` | 884 | 0 (0 unique) | 24 | 10/1/0 | no-citations |
| `brinktop-vineyard` | 886 | 0 (0 unique) | 9 | 9/2/0 | no-citations |
| `bundaleera-vineyard` | 890 | 0 (0 unique) | 11 | 10/1/0 | no-citations |
| `freycinet-vineyards` | 909 | 0 (0 unique) | 12 | 8/3/0 | no-citations |
| `velo-wines` | 972 | 0 (0 unique) | 11 | 9/2/0 | no-citations |
| `marions-vineyard` | 984 | 0 (0 unique) | 13 | 11/0/0 | no-citations |
| `eastford-creek-vineyard` | 1029 | 0 (0 unique) | 17 | 11/0/0 | no-citations |
| `hartzview-vineyard` | 1034 | 0 (0 unique) | 24 | 10/1/0 | no-citations |
| `nandroya-vineyard` | 1037 | 0 (0 unique) | 18 | 10/1/0 | no-citations |
| `viridian-wines` | 1039 | 0 (0 unique) | 32 | 10/1/0 | no-citations |
| `sisu-wines` | 1042 | 0 (0 unique) | 11 | 11/0/0 | no-citations |
| `iron-pot-bay-vineyard` | 1056 | 0 (0 unique) | 21 | 9/2/0 | no-citations |
| `mayfield-estate` | 1057 | 0 (0 unique) | 29 | 11/0/0 | no-citations |
| `riversdale-estate-winery-cellar-door--french-bistro` | 1061 | 0 (0 unique) | 15 | 10/1/0 | no-citations |
| `broad-acres-vineyard` | 1076 | 0 (0 unique) | 30 | 9/2/0 | no-citations |
| `leven-valley-vineyard` | 1084 | 0 (0 unique) | 25 | 10/1/0 | no-citations |
| `roslyn-1823` | 1090 | 0 (0 unique) | 15 | 11/0/0 | no-citations |
| `apogee-tasmania` | 1116 | 0 (0 unique) | 13 | 10/1/0 | no-citations |
| `moorilla-winery` | 1131 | 0 (0 unique) | 17 | 11/0/0 | no-citations |
| `loira-vines` | 1136 | 0 (0 unique) | 27 | 10/1/0 | no-citations |
| `domaine-a-stoney-vineyard` | 1156 | 0 (0 unique) | 13 | 10/1/0 | no-citations |
| `craigow-vineyard` | 1167 | 0 (0 unique) | 28 | 10/1/0 | no-citations |
| `clover-hill-wines` | 1175 | 0 (0 unique) | 23 | 10/1/0 | no-citations |
| `puddleduck-wines` | 1185 | 0 (0 unique) | 18 | 11/0/0 | no-citations |
| `bream-creek-vineyard` | 1201 | 0 (0 unique) | 2 | 9/2/0 | no-citations |
| `meander-valley-vineyard` | 1201 | 0 (0 unique) | 28 | 11/0/0 | no-citations |
| `glendale-vineyard` | 1218 | 0 (0 unique) | 29 | 11/0/0 | no-citations |
| `brook-eden-vineyard` | 1248 | 0 (0 unique) | 17 | 11/0/0 | no-citations |
| `pooley-wines` | 1272 | 0 (0 unique) | 13 | 11/0/0 | no-citations |
| `glaetzer-dixon-family-winemakers` | 1288 | 0 (0 unique) | 27 | 9/2/0 | no-citations |
| `kate-hill-wines` | 1288 | 0 (0 unique) | 22 | 10/1/0 | no-citations |
| `mewstone-wines` | 1302 | 0 (0 unique) | 13 | 11/0/0 | no-citations |
| `sen-vineyard` | 1307 | 0 (0 unique) | 22 | 10/1/0 | no-citations |
| `dalrymple-vineyards` | 1319 | 0 (0 unique) | 28 | 10/1/0 | no-citations |
| `westella-vineyard` | 1346 | 0 (0 unique) | 28 | 11/0/0 | no-citations |
| `grey-sands-vineyard` | 1347 | 0 (0 unique) | 23 | 9/2/0 | no-citations |
| `pipers-brook-winery` | 1369 | 0 (0 unique) | 17 | 11/0/0 | no-citations |
| `craigie-knowe-vineyard--floras-restaurant` | 1378 | 0 (0 unique) | 27 | 11/0/0 | no-citations |
| `derwent-estate-vineyard` | 1398 | 0 (0 unique) | 24 | 11/0/0 | no-citations |
| `jansz-tasmania` | 1424 | 0 (0 unique) | 30 | 11/0/0 | no-citations |
| `utzinger-wines` | 1428 | 0 (0 unique) | 11 | 11/0/0 | no-citations |
| `moores-hill-estate` | 1447 | 0 (0 unique) | 34 | 11/0/0 | no-citations |
| `delamere-vineyard` | 1470 | 0 (0 unique) | 22 | 10/1/0 | no-citations |
| `charles-reuben-estate` | 1475 | 0 (0 unique) | 24 | 11/0/0 | no-citations |
| `home-hill-winery` | 1502 | 0 (0 unique) | 33 | 10/1/0 | no-citations |
| `evenfall-winery-and-restaurant` | 1505 | 0 (0 unique) | 33 | 11/0/0 | no-citations |
| `stoney-rise-wine-company` | 1509 | 0 (0 unique) | 29 | 11/0/0 | no-citations |
| `ghost-rock-wines-tasmania` | 1569 | 0 (0 unique) | 34 | 11/0/0 | no-citations |
| `swinging-gate-vineyard` | 1570 | 0 (0 unique) | 34 | 11/0/0 | no-citations |
| `small-wonder-wines` | 1572 | 0 (0 unique) | 22 | 11/0/0 | no-citations |
| `sailor-seeks-horse` | 1573 | 0 (0 unique) | 24 | 10/1/0 | no-citations |
| `stefano-lubiana-wines` | 1637 | 0 (0 unique) | 33 | 11/0/0 | no-citations |
| `frogmore-creek-cellar-door--restaurant` | 1677 | 0 (0 unique) | 37 | 11/0/0 | no-citations |
| `caledon-estate` | 1680 | 0 (0 unique) | 31 | 11/0/0 | no-citations |
| `tolpuddle-vineyard` | 1682 | 0 (0 unique) | 29 | 10/1/0 | no-citations |
| `house-of-arras` | 1720 | 0 (0 unique) | 33 | 10/1/0 | no-citations |
| `sinapius-wines` | 1720 | 0 (0 unique) | 25 | 10/1/0 | no-citations |
| `josef-chromy-wines` | 1724 | 0 (0 unique) | 36 | 11/0/0 | no-citations |
| `handpicked-wines` | 1737 | 0 (0 unique) | 39 | 10/1/0 | no-citations |
| `devils-corner-cellar-door` | 1748 | 0 (0 unique) | 35 | 11/0/0 | no-citations |
| `stargazer-wine` | 1793 | 0 (0 unique) | 30 | 10/1/0 | no-citations |
| `pressing-matters-cellar-door` | 1906 | 0 (0 unique) | 32 | 10/1/0 | no-citations |
| `tamar-ridge-cellar-door` | 1933 | 0 (0 unique) | 28 | 11/0/0 | no-citations |
| `holm-oak-vineyards` | 1992 | 0 (0 unique) | 31 | 11/0/0 | no-citations |

## All files (sorted by word count, ascending)

Shortest first — that's where script failures or genuinely-thin-presence wineries surface.

| Slug | Words | Citations | Sources | Sections (pop/empty/missing) | Flags |
|---|---:|---:|---:|---|---|
| `bruny-island-premium-wines` | 0 | 0 (0 unique) | 0 | 0/0/11 | 🚩 short:0w, no-citations, no-sources-list, missing-sections:11 |
| `darlington-vineyard` | 749 | 0 (0 unique) | 15 | 8/3/0 | 🚩 no-citations |
| `uplands-vineyard` | 776 | 0 (0 unique) | 12 | 10/1/0 | 🚩 no-citations |
| `coal-valley-vineyard` | 795 | 0 (0 unique) | 13 | 10/1/0 | 🚩 no-citations |
| `every-man--his-dog-vineyard` | 827 | 0 (0 unique) | 10 | 9/2/0 | 🚩 no-citations |
| `cathedral-rock-winery-cellar-door` | 830 | 0 (0 unique) | 34 | 9/2/0 | 🚩 no-citations |
| `highclare-estate-wine-room` | 878 | 0 (0 unique) | 20 | 11/0/0 | 🚩 no-citations |
| `heriots-point-vineyard-and-boutique-accommodation` | 884 | 0 (0 unique) | 24 | 10/1/0 | 🚩 no-citations |
| `brinktop-vineyard` | 886 | 0 (0 unique) | 9 | 9/2/0 | 🚩 no-citations |
| `bundaleera-vineyard` | 890 | 0 (0 unique) | 11 | 10/1/0 | 🚩 no-citations |
| `freycinet-vineyards` | 909 | 0 (0 unique) | 12 | 8/3/0 | 🚩 no-citations |
| `velo-wines` | 972 | 0 (0 unique) | 11 | 9/2/0 | 🚩 no-citations |
| `marions-vineyard` | 984 | 0 (0 unique) | 13 | 11/0/0 | 🚩 no-citations |
| `eastford-creek-vineyard` | 1029 | 0 (0 unique) | 17 | 11/0/0 | 🚩 no-citations |
| `hartzview-vineyard` | 1034 | 0 (0 unique) | 24 | 10/1/0 | 🚩 no-citations |
| `nandroya-vineyard` | 1037 | 0 (0 unique) | 18 | 10/1/0 | 🚩 no-citations |
| `viridian-wines` | 1039 | 0 (0 unique) | 32 | 10/1/0 | 🚩 no-citations |
| `sisu-wines` | 1042 | 0 (0 unique) | 11 | 11/0/0 | 🚩 no-citations |
| `iron-pot-bay-vineyard` | 1056 | 0 (0 unique) | 21 | 9/2/0 | 🚩 no-citations |
| `mayfield-estate` | 1057 | 0 (0 unique) | 29 | 11/0/0 | 🚩 no-citations |
| `riversdale-estate-winery-cellar-door--french-bistro` | 1061 | 0 (0 unique) | 15 | 10/1/0 | 🚩 no-citations |
| `broad-acres-vineyard` | 1076 | 0 (0 unique) | 30 | 9/2/0 | 🚩 no-citations |
| `leven-valley-vineyard` | 1084 | 0 (0 unique) | 25 | 10/1/0 | 🚩 no-citations |
| `roslyn-1823` | 1090 | 0 (0 unique) | 15 | 11/0/0 | 🚩 no-citations |
| `apogee-tasmania` | 1116 | 0 (0 unique) | 13 | 10/1/0 | 🚩 no-citations |
| `moorilla-winery` | 1131 | 0 (0 unique) | 17 | 11/0/0 | 🚩 no-citations |
| `loira-vines` | 1136 | 0 (0 unique) | 27 | 10/1/0 | 🚩 no-citations |
| `bangor-vineyard-shed` | 1146 | 0 (0 unique) | 0 | 3/0/8 | 🚩 no-citations, no-sources-list, duplicates:2, missing-sections:8, truncated-cite |
| `domaine-a-stoney-vineyard` | 1156 | 0 (0 unique) | 13 | 10/1/0 | 🚩 no-citations |
| `craigow-vineyard` | 1167 | 0 (0 unique) | 28 | 10/1/0 | 🚩 no-citations |
| `clover-hill-wines` | 1175 | 0 (0 unique) | 23 | 10/1/0 | 🚩 no-citations |
| `puddleduck-wines` | 1185 | 0 (0 unique) | 18 | 11/0/0 | 🚩 no-citations |
| `bream-creek-vineyard` | 1201 | 0 (0 unique) | 2 | 9/2/0 | 🚩 no-citations |
| `meander-valley-vineyard` | 1201 | 0 (0 unique) | 28 | 11/0/0 | 🚩 no-citations |
| `glendale-vineyard` | 1218 | 0 (0 unique) | 29 | 11/0/0 | 🚩 no-citations |
| `brook-eden-vineyard` | 1248 | 0 (0 unique) | 17 | 11/0/0 | 🚩 no-citations |
| `pooley-wines` | 1272 | 0 (0 unique) | 13 | 11/0/0 | 🚩 no-citations |
| `glaetzer-dixon-family-winemakers` | 1288 | 0 (0 unique) | 27 | 9/2/0 | 🚩 no-citations |
| `kate-hill-wines` | 1288 | 0 (0 unique) | 22 | 10/1/0 | 🚩 no-citations |
| `mewstone-wines` | 1302 | 0 (0 unique) | 13 | 11/0/0 | 🚩 no-citations |
| `sen-vineyard` | 1307 | 0 (0 unique) | 22 | 10/1/0 | 🚩 no-citations |
| `dalrymple-vineyards` | 1319 | 0 (0 unique) | 28 | 10/1/0 | 🚩 no-citations |
| `westella-vineyard` | 1346 | 0 (0 unique) | 28 | 11/0/0 | 🚩 no-citations |
| `grey-sands-vineyard` | 1347 | 0 (0 unique) | 23 | 9/2/0 | 🚩 no-citations |
| `pipers-brook-winery` | 1369 | 0 (0 unique) | 17 | 11/0/0 | 🚩 no-citations |
| `craigie-knowe-vineyard--floras-restaurant` | 1378 | 0 (0 unique) | 27 | 11/0/0 | 🚩 no-citations |
| `derwent-estate-vineyard` | 1398 | 0 (0 unique) | 24 | 11/0/0 | 🚩 no-citations |
| `jansz-tasmania` | 1424 | 0 (0 unique) | 30 | 11/0/0 | 🚩 no-citations |
| `utzinger-wines` | 1428 | 0 (0 unique) | 11 | 11/0/0 | 🚩 no-citations |
| `moores-hill-estate` | 1447 | 0 (0 unique) | 34 | 11/0/0 | 🚩 no-citations |
| `delamere-vineyard` | 1470 | 0 (0 unique) | 22 | 10/1/0 | 🚩 no-citations |
| `charles-reuben-estate` | 1475 | 0 (0 unique) | 24 | 11/0/0 | 🚩 no-citations |
| `home-hill-winery` | 1502 | 0 (0 unique) | 33 | 10/1/0 | 🚩 no-citations |
| `evenfall-winery-and-restaurant` | 1505 | 0 (0 unique) | 33 | 11/0/0 | 🚩 no-citations |
| `stoney-rise-wine-company` | 1509 | 0 (0 unique) | 29 | 11/0/0 | 🚩 no-citations |
| `ghost-rock-wines-tasmania` | 1569 | 0 (0 unique) | 34 | 11/0/0 | 🚩 no-citations |
| `swinging-gate-vineyard` | 1570 | 0 (0 unique) | 34 | 11/0/0 | 🚩 no-citations |
| `small-wonder-wines` | 1572 | 0 (0 unique) | 22 | 11/0/0 | 🚩 no-citations |
| `sailor-seeks-horse` | 1573 | 0 (0 unique) | 24 | 10/1/0 | 🚩 no-citations |
| `stefano-lubiana-wines` | 1637 | 0 (0 unique) | 33 | 11/0/0 | 🚩 no-citations |
| `frogmore-creek-cellar-door--restaurant` | 1677 | 0 (0 unique) | 37 | 11/0/0 | 🚩 no-citations |
| `caledon-estate` | 1680 | 0 (0 unique) | 31 | 11/0/0 | 🚩 no-citations |
| `tolpuddle-vineyard` | 1682 | 0 (0 unique) | 29 | 10/1/0 | 🚩 no-citations |
| `house-of-arras` | 1720 | 0 (0 unique) | 33 | 10/1/0 | 🚩 no-citations |
| `sinapius-wines` | 1720 | 0 (0 unique) | 25 | 10/1/0 | 🚩 no-citations |
| `josef-chromy-wines` | 1724 | 0 (0 unique) | 36 | 11/0/0 | 🚩 no-citations |
| `handpicked-wines` | 1737 | 0 (0 unique) | 39 | 10/1/0 | 🚩 no-citations |
| `devils-corner-cellar-door` | 1748 | 0 (0 unique) | 35 | 11/0/0 | 🚩 no-citations |
| `stargazer-wine` | 1793 | 0 (0 unique) | 30 | 10/1/0 | 🚩 no-citations |
| `pressing-matters-cellar-door` | 1906 | 0 (0 unique) | 32 | 10/1/0 | 🚩 no-citations |
| `tamar-ridge-cellar-door` | 1933 | 0 (0 unique) | 28 | 11/0/0 | 🚩 no-citations |
| `holm-oak-vineyards` | 1992 | 0 (0 unique) | 31 | 11/0/0 | 🚩 no-citations |
| `bellebonne` | 2009 | 29 (10 unique) | 0 | 9/1/1 | 🚩 no-sources-list, duplicates:9 |

## What to do next

1. **Look at the flagged-files table.** For each, decide: is this a tiny winery with genuinely thin online presence (leave it), or is it a script failure (re-run with `node --env-file=.env scripts/collect-winery-sources.js --slugs <slug> --force`)?
2. **Spot-check 3-5 healthy files** manually for prose quality, citation accuracy, and editorial texture. The audit can't judge prose; only you can.
3. **Note any sections with low population rates** in the section-coverage table. If "Awards & Recognition" is empty in 60+ files, you might want to drop it from the expected list OR enrich those wineries with manual research.
4. **When you're satisfied with the corpus quality, the next pipeline step is chunking + embedding** into a new Upstash namespace. That's the next script to build.