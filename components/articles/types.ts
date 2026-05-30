// components/articles/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shape for a Library article. A single Firestore document in the
// `explore_articles` collection feeds both the home-page rail (thumbnail)
// and the article reader (full body) — the screens read the slug from the
// route and the layout components branch on `layout`.
//
// IMAGES are first-class, clearly labeled fields:
//   - `thumbnailImage` — shown on the home page card
//   - `heroImage`      — shown at the top of the article reader
//   - section.images   — gallery / inline images carried as { url, caption?, alt? }
//   - pullQuoteBackgroundImage — optional photo behind a featured pull quote
//
// Older Firestore docs used `image` for the thumbnail and string[] for image
// galleries. The normalizers below accept either shape so a partial migration
// is safe — no doc has to be touched in two places.
// ─────────────────────────────────────────────────────────────────────────────

export type ArticleLayout = "editorial" | "list" | "magazine" | "interview";

/** Single image with optional editorial metadata. Used inside galleries. */
export interface ArticleImage {
  url: string;
  caption?: string;
  alt?: string;
}

export type ArticleSectionType =
  | "body"
  | "pullQuote"
  | "imageGallery"
  | "callout"
  | "qa";

/**
 * A section in the article body. Fields used per `type`:
 *   body          — `paragraphs` (preferred) or legacy `content: string[]`
 *   pullQuote     — `text` (preferred), optional `attribution`,
 *                   optional `backgroundImage`; legacy `content: string`
 *   imageGallery  — `images: ArticleImage[]` (preferred) or legacy
 *                   `content: string[]` of bare URLs
 *   callout       — `text` (preferred), optional `kicker`;
 *                   legacy `content: string`
 *   qa            — `heading` (preferred); legacy `content: string`
 *
 * All "legacy" fields are still accepted so existing docs keep working.
 */
export interface ArticleSection {
  type: ArticleSectionType;

  // New, clearly labeled fields ──
  paragraphs?: string[];          // body
  text?: string;                  // pullQuote / callout
  attribution?: string;           // pullQuote
  backgroundImage?: string;       // pullQuote — optional photo behind the quote
  images?: ArticleImage[];        // imageGallery
  kicker?: string;                // callout — overrides the layout default
  heading?: string;               // qa — heading for the transcript intro

  // Legacy field ── kept so older Firestore docs render without re-seeding.
  content?: string | string[];
}

export interface QAPair {
  question: string;
  answer: string;
}

export interface Article {
  // Identity
  id: string;
  slug: string;
  title: string;
  active: boolean;
  layout: ArticleLayout;

  // ── Images (clearly labeled) ──
  /** Thumbnail shown on the home-page Library rail. */
  thumbnailImage?: string;
  /** Hero image shown at the top of the article reader. */
  heroImage: string;
  /** Optional photo backdrop for a featured pull quote on this article. */
  pullQuoteBackgroundImage?: string;

  // Editorial
  publishDate: string;
  author?: string;
  subject?: string;               // interview only — name of the person
  lede?: string;

  // Body
  sections: ArticleSection[];
  pullQuote?: string;             // legacy / convenience
  qa?: QAPair[];                  // interview only
}

// ─── Normalizers ─────────────────────────────────────────────────────────────
// Layout components call these to read sections without caring whether the
// Firestore doc uses the new labeled shape or the legacy `content` shape.

/** Read paragraphs from a `body` section. */
export function bodyParagraphs(section: ArticleSection): string[] {
  if (section.paragraphs && section.paragraphs.length > 0) return section.paragraphs;
  if (Array.isArray(section.content)) return section.content;
  if (typeof section.content === "string") return [section.content];
  return [];
}

/** Read plain text from a `pullQuote` or `callout` section. */
export function sectionText(section: ArticleSection): string {
  if (typeof section.text === "string") return section.text;
  if (Array.isArray(section.content)) return section.content.join(" ");
  if (typeof section.content === "string") return section.content;
  return "";
}

/** Read images from an `imageGallery` section as a normalized `ArticleImage[]`. */
export function galleryImages(section: ArticleSection): ArticleImage[] {
  if (section.images && section.images.length > 0) return section.images;
  if (Array.isArray(section.content)) {
    return section.content.map((url) => ({ url }));
  }
  if (typeof section.content === "string") return [{ url: section.content }];
  return [];
}

/** Read heading text from a `qa` section. */
export function qaHeading(section: ArticleSection): string {
  if (typeof section.heading === "string") return section.heading;
  if (typeof section.content === "string") return section.content;
  if (Array.isArray(section.content)) return section.content.join(" ");
  return "";
}
