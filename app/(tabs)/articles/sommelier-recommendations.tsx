// app/(tabs)/articles/sommelier-recommendations.tsx
// Sommelier Recommendations — list layout. One numbered entry per bottle.

import ArticleRenderer from "../../../components/articles/ArticleRenderer";
import type { Article } from "../../../components/articles/types";

const ARTICLE: Article = {
  id: "somm-picks-may-2026",
  slug: "somm-picks-may-2026",
  layout: "list",
  active: true,
  title: "Six Bottles for the Cool Months",
  publishDate: "May 2026",
  author: "Marisol Vega",
  heroImage:
    "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1600&q=80",
  lede:
    "Six bottles our team is reaching for as the evenings get longer — chosen with autumn cooking, fireside drinking, and the long Tasmanian dusk in mind.",
  sections: [
    {
      type: "body",
      content: [
        "Domaine Brisbois 2023 Pinot Noir",
        "An understated bottling from one of the Tamar's most thoughtful producers. The 2023 is darker and broader than the lifted, perfumed 2022 — black cherry, smoked thyme, and a long, soft tannin. Drinks beautifully now, will be even better in two years. Around $58 cellar door.",
      ],
    },
    {
      type: "body",
      content: [
        "Wellesley Estate 2024 Riesling",
        "Bone-dry, knife-edged, smelling like a cut nashi pear in a stone room. This is the bottle to hand to anyone who thinks they don't like riesling. Pours mean and finishes long. Ten years of cellar life ahead of it. Around $38.",
      ],
    },
    {
      type: "imageGallery",
      content: [
        "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=1200&q=80",
        "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=1200&q=80",
      ],
    },
    {
      type: "body",
      content: [
        "Coal River Cellars 2022 Méthode Traditionnelle Brut",
        "Four years on lees and it shows — brioche, cool apple skin, that fine, persistent thread of bubble that makes a great Tasmanian sparkling almost telepathic with food. Uncork before the salt-and-vinegar chips emerge. Around $52.",
      ],
    },
    {
      type: "body",
      content: [
        "Strathlyn Old Vines 2023 Chardonnay",
        "Made by hand from a single vineyard planted in 1986. Restrained, salty, with citrus rind and a finish that keeps unwinding. The kind of chardonnay that converts skeptics. Around $64.",
      ],
    },
    {
      type: "pullQuote",
      content:
        "If a wine doesn't taste like the place it came from, I am not interested in pouring it.",
    },
    {
      type: "body",
      content: [
        "Hartford Lane 2022 Pinot Gris",
        "More skin contact than a typical Tassie pinot gris — it pours a soft amber and tastes of pear skin and quince paste. An autumn bottle if there ever was one. Sits beautifully next to a cheese board with anything aged. Around $34.",
      ],
    },
    {
      type: "body",
      content: [
        "Maker's Bench NV \"Field\" Red",
        "An across-vintages blend the Maker's Bench team release once a year, fortuitously when the weather turns. Mostly pinot, a splash of syrah, and something a little wild in the background. Drinks like a story. Around $46.",
      ],
    },
  ],
};

export default function SommelierRecommendationsScreen() {
  return <ArticleRenderer article={ARTICLE} />;
}
