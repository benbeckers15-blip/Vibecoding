// app/(tabs)/home/articles/behind-the-cellar-door.tsx
// Behind the Cellar Door — interview layout. Body sections render as
// preamble; the qa array becomes the transcript.

import ArticleRenderer from "../../../../components/articles/ArticleRenderer";
import type { Article } from "../../../../components/articles/types";

const ARTICLE: Article = {
  id: "btcd-mira-tomic-may-2026",
  slug: "btcd-mira-tomic-may-2026",
  layout: "interview",
  active: true,
  title: "On dry farming, mistakes, and the patience that pinot demands.",
  subject: "Mira Tomić",
  publishDate: "May 2026",
  author: "Hugh Anders",
  heroImage:
    "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=1600&q=80",
  lede:
    "We spent a Wednesday morning at Tomić Estate's tasting room, drinking the unfiltered 2023 pinot off the barrel and talking about why she still farms a vineyard most of her contemporaries gave up on a decade ago.",
  sections: [
    {
      type: "body",
      content: [
        "Mira Tomić arrives in a wax jacket and gumboots, apologises for being five minutes late, and has poured the first glass before she has even taken her coat off. The cellar smells of damp wood and the previous night's rain. We sit at the long table near the window, where the light is good and you can see the vines climbing the slope.",
      ],
    },
    {
      type: "callout",
      content:
        "Mira Tomić took over Tomić Estate in 2014 from her father, who planted the first vines on the property in 1989. She is widely credited with the estate's shift toward dry-farmed, single-vineyard releases. The 2023 pinot is her tenth vintage as head winemaker.",
    },
    {
      type: "qa",
      content: "THE TRANSCRIPT",
    },
  ],
  qa: [
    {
      question:
        "Most growers in this valley irrigate. You don't. What changed your mind?",
      answer:
        "Honestly, a bad year. 2017. We had everything on drip and we still lost a third of the crop to a heatwave because the canopies were soft and unprepared. The vines that did best that year were the older blocks where we'd already let irrigation lapse. They had deeper roots, smaller berries, and the fruit just held. After that I stopped and never went back. The vines complain for two seasons and then they figure it out.",
    },
    {
      question:
        "What is the single hardest thing about pinot in this region?",
      answer:
        "Patience. Not in the cellar — pinot in the cellar is actually quite generous if you leave it alone. The patience is in the vineyard. You have to let the vines tell you when to pick, and most years they tell you a week later than the spreadsheet wants. Walking past ripe-looking fruit and not picking it is the hardest thing I do all year.",
    },
    {
      question: "What is a mistake from your early years that you're glad you made?",
      answer:
        "Putting too much new oak on the 2016 reserve. It was the first wine I made entirely on my own and I wanted it to feel important. I oaked the life out of it. We released it anyway — we had to — and people were polite, but it taught me that the wine is allowed to just be itself. I have not bought a new barrel since 2019.",
    },
    {
      question:
        "If someone is visiting the region for the first time, what would you tell them to drink?",
      answer:
        "Riesling. I know that's not what people expect from a pinot maker. But the rieslings coming out of this state right now are unlike anywhere else in the world, and they are still absurdly cheap. Drink as many as you can while no one is looking.",
    },
    {
      question: "What's exciting you about the 2026 vintage?",
      answer:
        "The acid. We picked late, slowly, and the natural acidity is just sitting at this beautiful tense level — it feels like the wines are going to age for fifteen years without trying. I have not been this excited about a vintage since 2018. Ask me again in three years and I will probably have changed my mind, but today, I'm certain.",
    },
  ],
};

export default function BehindTheCellarDoorScreen() {
  return <ArticleRenderer article={ARTICLE} />;
}
