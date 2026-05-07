// components/articles/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared shape for the article system. A single Firestore document feeds any
// of the four layouts (`editorial`, `list`, `magazine`, `interview`); the
// `layout` field decides which component renders.
//
// Section content is intentionally a tagged-union-by-string so Firestore stays
// JSON-friendly. Layouts narrow `content: string | string[]` based on `type`
// at the call site — never trust the field, always check.
// ─────────────────────────────────────────────────────────────────────────────

export type ArticleLayout = "editorial" | "list" | "magazine" | "interview";

export type ArticleSectionType =
  | "body"
  | "pullQuote"
  | "imageGallery"
  | "callout"
  | "qa";

export interface ArticleSection {
  type: ArticleSectionType;
  /**
   * Shape per `type`:
   *   body         — string[]  (paragraphs)
   *   pullQuote    — string
   *   imageGallery — string[]  (image URLs)
   *   callout      — string
   *   qa           — string    (a heading/intro for the qa block; pairs live on `Article.qa`)
   */
  content: string | string[];
}

export interface QAPair {
  question: string;
  answer: string;
}

export interface Article {
  id: string;
  title: string;
  slug: string;
  heroImage: string;          // URL
  publishDate: string;        // "YYYY-MM-DD"
  layout: ArticleLayout;
  active: boolean;
  sections: ArticleSection[];
  pullQuote?: string;
  lede?: string;
  author?: string;
  subject?: string;           // interview only — name of the person
  qa?: QAPair[];
}
