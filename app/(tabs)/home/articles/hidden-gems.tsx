// app/(tabs)/home/articles/hidden-gems.tsx
// Article content loaded from Firestore `explore_articles/hidden-gems`.

import ArticleFetcher from "../../../../components/articles/ArticleFetcher";

export default function HiddenGemsScreen() {
  return <ArticleFetcher slug="hidden-gems" />;
}
