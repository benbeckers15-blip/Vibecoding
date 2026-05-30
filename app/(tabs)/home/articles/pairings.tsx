// app/(tabs)/home/articles/pairings.tsx
// Article content loaded from Firestore `explore_articles/pairings`.

import ArticleFetcher from "../../../../components/articles/ArticleFetcher";

export default function PairingsScreen() {
  return <ArticleFetcher slug="pairings" />;
}
