// app/(tabs)/home/articles/vintage-reports.tsx
// Vintage Reports — list layout. Each `body` section is one numbered entry:
// the first paragraph becomes the entry title, the rest the body.

import ArticleRenderer from "../../../../components/articles/ArticleRenderer";
import type { Article } from "../../../../components/articles/types";

const ARTICLE: Article = {
  id: "vintage-2026",
  slug: "vintage-2026",
  layout: "list",
  active: true,
  title: "The 2026 Vintage, Variety by Variety",
  publishDate: "May 2026",
  author: "Hugh Anders",
  heroImage:
    "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1600&q=80",
  lede:
    "A cool, dry summer with a generous late-March stretch produced the kind of vintage growers will talk about for a decade. Variety by variety, here is how the season landed.",
  sections: [
    {
      type: "body",
      content: [
        "Riesling",
        "The standout. A late, slow ripening window held acid high while still letting the aromatics open up — winemakers across the Tamar are reporting their best fruit in five years. Expect tightly wound, high-citrus releases that will reward two or three years in bottle. Yields were down by about 12 percent on the long-term average, but quality more than compensates.",
      ],
    },
    {
      type: "body",
      content: [
        "Chardonnay",
        "A patient vintage rewarded patient producers. Growers who held nerve through a slow February saw flavours catch up to sugars in the final fortnight. The wines coming off ferment now are textural, mineral, and notably less tropical than the warm 2024 set. Several producers are talking about doing less in the cellar — less new oak, less battonage — and letting the fruit lead.",
      ],
    },
    {
      type: "pullQuote",
      content:
        "I have not seen acid like this since 2018. We were filling barrels and laughing — it was almost too good.",
    },
    {
      type: "body",
      content: [
        "Pinot Noir",
        "Smaller berries, thicker skins, deep colour, real grip. Early ferments are showing dark cherry and a savoury herbal lift that often takes pinot a year in barrel to develop. The challenge will be in the cellar, not the vineyard — extraction needs a light touch on this fruit, and the wines that nail it will be benchmark.",
      ],
    },
    {
      type: "body",
      content: [
        "Sauvignon Blanc",
        "Quietly excellent. Without the heat spikes that flatten the variety in warmer years, this vintage's sauvignon is showing the herbal, fennel-and-lime register Tasmania does best. Expect linear, restrained wines — not a vintage for the tropical-fruit camp, but a great one for everyone else.",
      ],
    },
    {
      type: "callout",
      content:
        "Yields across the state were down 8 to 15 percent on the five-year average, with the largest reductions in the Coal River Valley. Cellar door pricing will reflect this — release prices on premium tiers are expected to lift 5 to 10 percent.",
    },
    {
      type: "body",
      content: [
        "Sparkling base",
        "The headline good news. Cool nights through January preserved the high natural acid that traditional-method winemakers live for, and base wines are coming off press with the structure to carry serious time on lees. Houses making tirage decisions now are talking about extended ageing windows — meaning the 2026 sparklings probably will not appear on shelf until 2031 or later, and you will want to be in line for them.",
      ],
    },
  ],
};

export default function VintageReportsScreen() {
  return <ArticleRenderer article={ARTICLE} />;
}
