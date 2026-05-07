// app/(tabs)/explore/index.tsx
// Explore — editorial directory.
//
// This screen is the gateway into long-form content. The latest issue of
// "The Pour" is fetched live from Firestore (`pour_articles`, ordered by
// issueNumber desc). The remaining article cards are static placeholders
// for now — wire each one up to its own Firestore collection or detail
// route as the editorial line expands.

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../../firebaseConfig";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";

// ─── Types ────────────────────────────────────────────────────────────────────
interface FeaturedPour {
  issueLabel: string;
  kicker: string;
  headline: string;
  author: string;
  date: string;
  readTime: string;
  heroImage: string;
}

type ArticleEntry = {
  key: string;
  kicker: string;
  title: string;
  blurb: string;
  image: string;
  cadence: string;            // e.g. "Weekly", "Monthly", "Series"
  href?: string;              // tap target — undefined ⇒ shows "Coming soon"
  order: number;
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pour, setPour] = useState<FeaturedPour | null>(null);
  const [loadingPour, setLoadingPour] = useState(true);
  const [articles, setArticles] = useState<ArticleEntry[]>([]);

  // Fetch explore_articles directory
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const q = query(
          collection(db, "explore_articles"),
          orderBy("order", "asc")
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        setArticles(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => ({ key: d.id, ...(d.data() as Omit<ArticleEntry, "key">) }))
        );
      } catch {
        // Silently fail — article list stays empty.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Fetch latest active Pour issue
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const q = query(
          collection(db, "pour_articles"),
          orderBy("issueNumber", "desc"),
          limit(10)
        );
        const snap = await getDocs(q);
        if (cancelled || snap.empty) return;

        const active = snap.docs.find((d) => d.data().active !== false);
        if (active) {
          const d = active.data() as FeaturedPour;
          setPour({
            issueLabel: d.issueLabel,
            kicker:     d.kicker,
            headline:   d.headline,
            author:     d.author,
            date:       d.date,
            readTime:   d.readTime,
            heroImage:  d.heroImage,
          });
        }
      } catch {
        // Silently fail — featured card just won't render.
      } finally {
        if (!cancelled) setLoadingPour(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.kicker}>EDITORIAL</Text>
        <Text style={styles.title}>Explore</Text>
        <Text style={styles.subtitle}>
          Long-form pieces, tasting notes, and conversations from the region.
        </Text>
      </View>

      {/* ── Featured: The Pour (live from Firestore) ──────────────────────── */}
      <View style={styles.featuredSection}>
        <View style={styles.sectionHead}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionKicker}>THIS WEEK</Text>
        </View>

        {loadingPour ? (
          <View style={styles.featuredLoading}>
            <ActivityIndicator color={colors.accentSoft} size="small" />
          </View>
        ) : pour ? (
          <Pressable
            style={styles.featuredCard}
            onPress={() => router.push("/(tabs)/home/pour" as any)}
          >
            <View style={styles.featuredImg}>
              <Image
                source={{ uri: pour.heroImage }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={150}
              />
              <LinearGradient
                colors={[
                  colors.photoOverlayTop,
                  "transparent",
                  colors.photoOverlayDeep,
                ]}
                locations={[0, 0.4, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.featuredOverlay}>
                <Text style={styles.featuredIssue}>
                  {pour.issueLabel} · {pour.kicker}
                </Text>
                <Text style={styles.featuredHeadline} numberOfLines={3}>
                  {pour.headline}
                </Text>
                <View style={styles.featuredMetaRow}>
                  <Text style={styles.featuredMeta}>
                    {pour.author} · {pour.readTime}
                  </Text>
                  <View style={styles.readBtn}>
                    <Text style={styles.readBtnText}>READ</Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.onAccent} />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        ) : (
          // Fallback card if Firestore is unreachable — still routes to reader
          <Pressable
            style={styles.featuredCard}
            onPress={() => router.push("/(tabs)/home/pour" as any)}
          >
            <View style={styles.featuredImg}>
              <Image
                source={{
                  uri: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=900&q=80",
                }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={150}
              />
              <LinearGradient
                colors={[
                  colors.photoOverlayTop,
                  "transparent",
                  colors.photoOverlayDeep,
                ]}
                locations={[0, 0.4, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.featuredOverlay}>
                <Text style={styles.featuredIssue}>THE POUR · WEEKLY</Text>
                <Text style={styles.featuredHeadline}>
                  A weekly taste of local vineyards, vintages, and voices.
                </Text>
                <View style={styles.featuredMetaRow}>
                  <Text style={styles.featuredMeta}>Read the latest issue</Text>
                  <View style={styles.readBtn}>
                    <Text style={styles.readBtnText}>READ</Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.onAccent} />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        )}
      </View>

      {/* ── Article directory ─────────────────────────────────────────────── */}
      <View style={styles.directorySection}>
        <View style={styles.sectionHead}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionKicker}>THE LIBRARY</Text>
        </View>

        {articles.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [
              styles.articleCard,
              pressed && styles.articleCardPressed,
            ]}
            onPress={() => {
              if (item.href) {
                router.push(item.href as any);
              }
              // No-op for placeholders. Swap for navigation when each
              // article's detail screen / collection is ready.
            }}
          >
            <Image source={{ uri: item.image }} style={styles.articleCardImg} contentFit="cover" transition={150} />
            <View style={styles.articleCardBody}>
              <View style={styles.articleKickerRow}>
                <Text style={styles.articleKicker}>{item.kicker}</Text>
                <Text style={styles.articleCadence}>· {item.cadence}</Text>
              </View>
              <Text style={styles.articleTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.articleBlurb} numberOfLines={2}>
                {item.blurb}
              </Text>
              <View style={styles.articleFooter}>
                {item.href ? (
                  <View style={styles.readMore}>
                    <Text style={styles.readMoreText}>READ</Text>
                    <Ionicons
                      name="arrow-forward"
                      size={11}
                      color={colors.accent}
                    />
                  </View>
                ) : (
                  <Text style={styles.comingSoon}>COMING SOON</Text>
                )}
              </View>
            </View>
          </Pressable>
        ))}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 40,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: spacing.xxl,           // 24
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  kicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.md,
  },
  title: {
    ...type.h1,                               // 36 / italic / 400 / Georgia
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.serif,
    fontSize: 15,
    fontStyle: "italic",
    fontWeight: weights.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
    lineHeight: 22,
    maxWidth: 320,
  },

  // ── Section heads ────────────────────────────────────────────────────────
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xxl,
  },
  goldLine: {
    width: spacing.xxl,
    height: 1,
    backgroundColor: colors.accent,
  },
  sectionKicker: {
    ...type.kicker,
    color: colors.accentSoft,
  },

  // ── Featured (The Pour) ───────────────────────────────────────────────────
  featuredSection: {
    marginTop: spacing.sm,
  },
  featuredLoading: {
    height: 280,
    marginHorizontal: spacing.xxl,            // standardised 20 → 24
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredCard: {
    marginHorizontal: spacing.xxl,            // standardised 20 → 24
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  featuredImg: {
    height: 320,
    justifyContent: "flex-end",
  },
  featuredOverlay: {
    paddingHorizontal: spacing.xl,            // card body padding 20 (Fix 3)
    paddingBottom: spacing.xl,
  },
  featuredIssue: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: spacing.md,
  },
  featuredHeadline: {
    fontFamily: fonts.serif,
    fontSize: 24,
    fontStyle: "italic",
    fontWeight: weights.body,                 // 500 → 400 (Fix 4 weights)
    color: colors.textOnDark,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  featuredMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  featuredMeta: {
    ...type.kicker,                           // bumped 10.5 → 10 (matched to scale)
    letterSpacing: 1.4,
    color: colors.textOnDarkSubtle,
    flex: 1,
  },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,                      // bumped toward 44pt floor
    borderRadius: radius.pill,
    minHeight: spacing.hitTarget,
  },
  readBtnText: {
    ...type.kicker,
    letterSpacing: 1.8,
    fontWeight: weights.emphasis,
    color: colors.onAccent,
  },

  // ── Directory cards ──────────────────────────────────────────────────────
  // Full-width image-on-top cards. Sit on the same paper as the Pour card
  // above and share its border/radius treatment, but at smaller scale so the
  // hierarchy reads featured → directory.
  directorySection: {
    marginTop: spacing.hero,                  // 40 — new section rhythm (Fix 5)
  },
  // Smaller, lifted cards on warm paper. Lighter fill + softer shadow gives
  // a sleek, floating feel; generous internal padding preserves whitespace.
  articleCard: {
    marginHorizontal: spacing.xxl,            // 24 — matches featured card
    marginBottom: spacing.md,                  // tighter rhythm than wineries
    borderRadius: radius.cardLg,
    overflow: "hidden",
    backgroundColor: colors.surfaceElevated,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 4,
  },
  articleCardPressed: {
    opacity: 0.92,
  },
  articleCardImg: {
    width: "100%",
    height: 150,                               // shorter — keeps card compact
    backgroundColor: colors.surfaceDeep,
  },
  articleCardBody: {
    padding: spacing.xl,                      // 20 — generous interior whitespace
  },
  articleKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  articleKicker: {
    ...type.kicker,
    letterSpacing: 1.8,
    color: colors.accentSoft,
  },
  articleCadence: {
    ...type.kicker,
    letterSpacing: 1.4,
    color: colors.textMuted,
  },
  articleTitle: {
    fontFamily: fonts.serif,
    fontSize: type.lede.fontSize,             // 17
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
    lineHeight: 23,
    letterSpacing: -0.2,
    marginBottom: spacing.sm,
  },
  articleBlurb: {
    ...type.caption,                          // 12 / 16
    color: colors.textSecondary,
    lineHeight: 18,
  },
  articleFooter: {
    marginTop: spacing.md,
  },
  readMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  readMoreText: {
    ...type.kicker,
    letterSpacing: 1.8,
    fontWeight: weights.emphasis,
    color: colors.accent,
  },
  comingSoon: {
    ...type.kicker,
    letterSpacing: 1.6,
    color: colors.textMuted,
  },
});
