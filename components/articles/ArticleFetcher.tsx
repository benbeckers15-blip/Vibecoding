// components/articles/ArticleFetcher.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Thin Firestore loader for a single Library article.
//
// Each article screen under /app/(tabs)/home/articles/* is now just a one-line
// wrapper that calls <ArticleFetcher slug="…" />. The full content (text,
// images, pull quotes, callouts, Q&A) lives in the `explore_articles`
// Firestore document keyed by slug — change a field there, restart the app,
// and the screen reflects the new content. No release required.
// ─────────────────────────────────────────────────────────────────────────────


import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing, type, weights } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import ArticleRenderer from "./ArticleRenderer";
import type { Article } from "./types";
import { goBackOr } from "../../utils/navigation";

interface Props {
  /** Document ID in the `explore_articles` collection. */
  slug: string;
}

export default function ArticleFetcher({ slug }: Props) {
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "explore_articles", slug));
        if (cancelled) return;

        if (!snap.exists()) {
          setError("Article not found.");
          setArticle(null);
          return;
        }

        const data = snap.data() as Partial<Article> & {
          // Accept the legacy thumbnail field name as a fallback so the rail
          // and the article reader can be migrated independently.
          image?: string;
          articleTitle?: string;
          thumbnailTitle?: string;
        };

        // The home-page rail uses `thumbnailTitle`; the article reader needs
        // the full `articleTitle`. Fall through to whichever is set.
        const title =
          data.articleTitle ??
          data.title ??
          data.thumbnailTitle ??
          "";

        const next: Article = {
          id: snap.id,
          slug: snap.id,
          title,
          active: data.active ?? true,
          layout: (data.layout ?? "editorial") as Article["layout"],
          thumbnailImage: data.thumbnailImage ?? data.image,
          heroImage: data.heroImage ?? "",
          pullQuoteBackgroundImage: data.pullQuoteBackgroundImage,
          publishDate: data.publishDate ?? "",
          author: data.author,
          subject: data.subject,
          lede: data.lede,
          sections: Array.isArray(data.sections) ? data.sections : [],
          pullQuote: data.pullQuote,
          qa: Array.isArray(data.qa) ? data.qa : undefined,
        };

        setArticle(next);
      } catch (e) {
        if (!cancelled) {
          setError("Could not load this article.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentSoft} size="small" />
      </View>
    );
  }

  if (error || !article) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "Article unavailable."}</Text>
        <Pressable
          onPress={() => goBackOr("/(tabs)/home")}
          style={styles.backBtn}
          accessibilityRole="button"
        >
          <Text style={styles.backBtnText}>BACK</Text>
        </Pressable>
      </View>
    );
  }

  return <ArticleRenderer article={article} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    gap: spacing.lg,
  },
  errorText: {
    fontFamily: fonts.serifItalic,
    fontSize: 18,
    color: colors.textSecondary,
    textAlign: "center",
  },
  backBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
  },
  backBtnText: {
    ...type.kicker,
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
    letterSpacing: 1.8,
  },
});
