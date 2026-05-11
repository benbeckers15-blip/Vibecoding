// app/(tabs)/home/articles/hidden-gems.tsx
// Hidden Gems — magazine layout.
// Dummy article data, swap for a Firestore fetch when content is ready.

import ArticleRenderer from "../../../../components/articles/ArticleRenderer";
import type { Article } from "../../../../components/articles/types";

const ARTICLE: Article = {
  id: "hidden-gems-001",
  slug: "hidden-gems-001",
  layout: "magazine",
  active: true,
  title: "Down Quiet Lanes",
  publishDate: "May 2026",
  author: "Eliza Kerrison",
  heroImage:
    "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=1600&q=80",
  lede:
    "Five small-batch producers and tasting rooms most visitors never find — tucked at the end of dirt tracks, signposted only by a hand-painted board nailed to a gum tree.",
  sections: [
    {
      type: "body",
      content: [
        "Tasmania's wine country tends to telegraph itself in big sandstone gateways and curated lavender approach roads. The cellar doors in this piece do none of that. Most of them you find by overshooting twice, doubling back, and then finally noticing the painted sign. That is part of the romance, and most of the reward.",
        "We spent four days driving slowly between the Coal River Valley and the Tamar, mostly without an itinerary, asking the people we met where they would send their best friend on a Sunday afternoon. The answers had nothing in common except a kind of quiet — small rooms, small pours, and a long view of paddock.",
      ],
    },
    {
      type: "imageGallery",
      content: [
        "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&q=80",
        "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=1200&q=80",
      ],
    },
    {
      type: "pullQuote",
      content:
        "If you can hear the road from the tasting bench, you have probably gone to the wrong place.",
    },
    {
      type: "body",
      content: [
        "The first stop was a converted shearing shed run by a winemaker who poured straight from the barrel and refused to commit to a release date. The Riesling was bone dry and absurd. We bought what we could carry.",
        "Two valleys over, a husband-and-wife team are making nine barrels of pinot a year on a north-facing slope they cleared by hand. The tasting room is a card table on the verandah. They opened a bottle that should not have been opened on a Tuesday morning, and we drank it watching the wind move through the rows.",
      ],
    },
    {
      type: "callout",
      content:
        "All five cellar doors below operate by appointment only. A short text the day before is usually enough — but call ahead if you are bringing a group of more than four.",
    },
    {
      type: "imageGallery",
      content: [
        "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1600&q=80",
      ],
    },
    {
      type: "body",
      content: [
        "The last stop was the smallest. A single-row planting of a Jurassic-era Italian variety nobody else in the state grows, made into a wine that tasted like late-summer evenings and absolutely nothing else we had drunk that week. We left with the last two bottles and the winemaker's mobile number, scrawled on the back of a feed-store receipt.",
      ],
    },
  ],
};

export default function HiddenGemsScreen() {
  return <ArticleRenderer article={ARTICLE} />;
}
