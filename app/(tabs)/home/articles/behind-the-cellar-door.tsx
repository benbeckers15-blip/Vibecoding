// app/(tabs)/home/articles/behind-the-cellar-door.tsx
// Article content loaded from Firestore `explore_articles/behind-the-cellar-door`.

import ArticleFetcher from "../../../../components/articles/ArticleFetcher";

export default function BehindTheCellarDoorScreen() {
  return <ArticleFetcher slug="behind-the-cellar-door" />;
}
