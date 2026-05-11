// app/(tabs)/home/articles/pairings.tsx
// Food & Wine Pairings — magazine layout.

import ArticleRenderer from "../../../../components/articles/ArticleRenderer";
import type { Article } from "../../../../components/articles/types";

const ARTICLE: Article = {
  id: "pairings-may-2026",
  slug: "pairings-may-2026",
  layout: "magazine",
  active: true,
  title: "What the Cooks Are Pouring",
  publishDate: "May 2026",
  author: "Sage Lindholm",
  heroImage:
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1600&q=80",
  lede:
    "We asked four kitchens around the state what they are pouring with the dish that defines their winter menu. The answers were surprising, occasionally contrarian, and made us hungry.",
  sections: [
    {
      type: "body",
      content: [
        "There is a certain kind of conversation that happens when you ask a chef what wine they would pour with their own food. It tends to be slower than the conversation about the food itself, more hesitant, and often more interesting. The dish is the chef's; the wine is a collaboration with whoever sourced the bottle, whoever made it, and whoever is going to drink it. The pairings below are the ones we kept coming back to long after the meals were over.",
      ],
    },
    {
      type: "imageGallery",
      content: [
        "https://images.unsplash.com/photo-1547573854-74d2a71d0826?w=1600&q=80",
      ],
    },
    {
      type: "body",
      content: [
        "Slow-roasted lamb shoulder · Norfolk Inn, Hobart",
        "Chef Reed Avila has been cooking lamb shoulder the same way for eight years and changing the wine pairing roughly every six months. This winter he is pouring a five-year-old pinot from a single Coal River vineyard. \"The lamb has so much fat and savoury depth — you need a wine with structure, but also with some lift, otherwise it just sits on top of the meat. The bottle we're pouring right now has a really long finish, almost herbal, and it cuts through.\"",
      ],
    },
    {
      type: "pullQuote",
      content:
        "I'd rather pour a bottle that argues with the food than one that just agrees with it.",
    },
    {
      type: "body",
      content: [
        "Smoked trout with horseradish cream · Pier 9, Devonport",
        "Trout from the Tamar, smoked over manuka in the kitchen, plated with a shocking amount of fresh horseradish. Sommelier Jess Park is uncompromising about the pour: bone-dry off-dry riesling with a touch of bottle age. \"The horseradish is the test. It will absolutely flatten a wine that doesn't have enough acid. I want a wine that says hello back when the horseradish hits.\"",
      ],
    },
    {
      type: "imageGallery",
      content: [
        "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
        "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1200&q=80",
      ],
    },
    {
      type: "body",
      content: [
        "Wood-fired mushrooms on toast · The Stillroom, Launceston",
        "Maybe the most-ordered dish in the state — black trumpet, pine, and oyster mushrooms cooked over apple wood, finished with cultured butter and a heap of black pepper. Co-owner Bea Marrone pours an aged white blend made from old-vine semillon and chardonnay. \"Mushrooms want something that smells like the forest, not like fruit. The wine has this nutty, slightly oxidative thing going that locks in with the mushrooms in a way I don't think a younger wine ever could.\"",
      ],
    },
    {
      type: "callout",
      content:
        "Three of the four bottles in this piece are available by the glass at the kitchens we visited. Call ahead to confirm — winter pairing menus rotate quickly.",
    },
    {
      type: "body",
      content: [
        "Salt-baked celeriac, brown butter · Glenmorvan, Coles Bay",
        "Chef Olufemi Awe finishes his most photographed dish with a slick of brown butter and a fistful of crisp sage. The wine is a deliberate provocation: a skin-contact pinot gris from a tiny producer he visited on a day off two summers ago. \"It's a weird pairing on paper. But the wine has texture and grip and a little bit of bite, and the celeriac is essentially silk. They balance each other out. Everyone who orders the dish ends up ordering a second glass.\"",
      ],
    },
  ],
};

export default function PairingsScreen() {
  return <ArticleRenderer article={ARTICLE} />;
}
