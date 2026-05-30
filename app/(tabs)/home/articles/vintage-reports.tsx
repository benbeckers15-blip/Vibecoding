// app/(tabs)/home/articles/vintage-reports.tsx
// Article content loaded from Firestore `explore_articles/vintage-reports`.

import ArticleFetcher from "../../../../components/articles/ArticleFetcher";

export default function VintageReportsScreen() {
  return <ArticleFetcher slug="vintage-reports" />;
}
