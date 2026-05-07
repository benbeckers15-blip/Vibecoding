// components/articles/ArticleRenderer.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Switch on `article.layout` and render the matching layout component.
// Add a new layout in three steps:
//   1. add a value to ArticleLayout in ./types.ts
//   2. build the new <FooLayout article={article} /> component in this folder
//   3. add a case below
//
// Defaults to EditorialLayout if a Firestore document arrives with an
// unrecognised `layout` value — fail safe rather than crash.
// ─────────────────────────────────────────────────────────────────────────────

import EditorialLayout from "./EditorialLayout";
import InterviewLayout from "./InterviewLayout";
import ListLayout from "./ListLayout";
import MagazineLayout from "./MagazineLayout";
import type { Article } from "./types";

interface Props {
  article: Article;
}

export default function ArticleRenderer({ article }: Props) {
  switch (article.layout) {
    case "editorial":
      return <EditorialLayout article={article} />;
    case "list":
      return <ListLayout article={article} />;
    case "magazine":
      return <MagazineLayout article={article} />;
    case "interview":
      return <InterviewLayout article={article} />;
    default:
      // Exhaustiveness check — keeps TS strict mode honest if a new layout
      // is added to the union without a case here.
      return <EditorialLayout article={article} />;
  }
}
