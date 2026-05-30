// app/(tabs)/home/articles/sommelier-recommendations.tsx
// Article content (text, hero, in-article images, pull quotes, callouts) is
// loaded from Firestore `explore_articles/sommelier-recommendations` — edit
// the doc to change anything, no app release required.

import ArticleFetcher from "../../../../components/articles/ArticleFetcher";

export default function SommelierRecommendationsScreen() {
  return <ArticleFetcher slug="sommelier-recommendations" />;
}
