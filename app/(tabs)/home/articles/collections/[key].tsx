// app/(tabs)/home/articles/collections/[key].tsx
//
// Dynamic "collection article" screen. Renders an editorial list of wineries
// matching a single boolean filter from Firestore (e.g. dogFriendly == true)
// styled like the Cinematic Dusk list-layout articles.
//
// Reached from the home screen's EXPLORE BY tiles. The route param `key`
// is one of the Firestore field names registered in FILTER_CONFIGS below.

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  fonts,
  spacing,
  type,
  weights,
} from "../../../../../constants/theme";
import { db } from "../../../../../firebaseConfig";

// ─── Filter configs ─────────────────────────────────────────────────────────
// One config per home-screen explore tile. Edit the kicker / title / lede /
// heroImage here to retune the editorial copy without touching layout code.

type FilterConfig = {
  kicker: string;
  title: string;
  lede: string;
  heroImage: string;
  author: string;
  publishDate: string;
};

const FILTER_CONFIGS: Record<string, FilterConfig> = {
  hasRestaurant: {
    kicker: "DINING",
    title: "A Long Table Under the Vines",
    lede:
      "Estates where you can sit, order properly, and let the afternoon take its time. The wineries below run kitchens that are as considered as the cellar.",
    heroImage:
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1600&q=80",
    author: "The SipLocal Editors",
    publishDate: "May 2026",
  },
  dogFriendly: {
    kicker: "OUTDOORS",
    title: "Bring the Whole Pack",
    lede:
      "Cellar doors where four legs are as welcome as two — open lawns, water bowls already out, and the kind of unhurried verandah that makes a tasting feel like a country walk.",
    heroImage:
      "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=1600&q=80",
    author: "The SipLocal Editors",
    publishDate: "May 2026",
  },
  walkinWelcome: {
    kicker: "CASUAL",
    title: "No Diary, No Problem",
    lede:
      "The Sunday-afternoon list. Estates that pour for whoever walks through the door — no reservation, no apology, just a stool at the bench and a glass in your hand.",
    heroImage:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1600&q=80",
    author: "The SipLocal Editors",
    publishDate: "May 2026",
  },
  isOrganic: {
    kicker: "SUSTAINABLE",
    title: "Farmed by Hand",
    lede:
      "Certified organic estates working without synthetic interventions in the vineyard. Wines that taste like the season they were grown in — and the soil they were grown on.",
    heroImage:
      "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1600&q=80",
    author: "The SipLocal Editors",
    publishDate: "May 2026",
  },
  isBiodynamic: {
    kicker: "NATURAL",
    title: "By the Calendar of the Moon",
    lede:
      "Estates farming to a biodynamic calendar — composts, preparations, and a quiet kind of attention. The wines below carry the singular signature of the practice.",
    heroImage:
      "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=1600&q=80",
    author: "The SipLocal Editors",
    publishDate: "May 2026",
  },
};

// ─── Types ──────────────────────────────────────────────────────────────────
type WineryEntry = {
  id: string;
  name: string;
  slug: string;
  description?: string[];
  rating?: number;
  userRatingsTotal?: number;
};

// ─── Screen ─────────────────────────────────────────────────────────────────
export default function CollectionArticleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ key: string }>();
  const filterKey = (params.key ?? "") as string;
  const cfg = FILTER_CONFIGS[filterKey];

  const [wineries, setWineries] = useState<WineryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!cfg) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, "wineries"),
          where(filterKey, "==", true),
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        const list: WineryEntry[] = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<WineryEntry, "id">),
          }))
          .filter((w) => !!w.name && !!w.slug);

        list.sort((a, b) => a.name.localeCompare(b.name));
        setWineries(list);
      } catch {
        // Silently fail — empty state will render.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filterKey, cfg]);

  const handleShare = async () => {
    if (!cfg) return;
    try {
      await Share.share({
        title: cfg.title,
        message: `${cfg.title} — ${cfg.lede}`,
      });
    } catch {
      // User cancelled or share unavailable — no-op.
    }
  };

  // Unknown filter key — show a graceful fallback.
  if (!cfg) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.fallbackTitle}>Collection not found.</Text>
        <Pressable
          onPress={() => router.back()}
          style={styles.fallbackBack}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={14} color={colors.accentSoft} />
          <Text style={styles.fallbackBackText}>BACK</Text>
        </Pressable>
      </View>
    );
  }

  const entryCountLabel = loading
    ? "—"
    : `${wineries.length} ESTATE${wineries.length === 1 ? "" : "S"}`;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <ImageBackground
          source={{ uri: cfg.heroImage }}
          style={styles.heroImg}
        >
          <LinearGradient
            colors={[
              colors.photoOverlayTop,
              "transparent",
              colors.photoOverlayDeep,
            ]}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.headerRow, { paddingTop: insets.top + 10 }]}>
            <Pressable
              style={styles.iconBtn}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons
                name="chevron-back"
                size={20}
                color={colors.textOnDark}
              />
            </Pressable>
            <Text style={styles.headerKicker}>THE COLLECTION</Text>
            <Pressable
              style={styles.iconBtn}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share"
            >
              <Ionicons
                name="share-outline"
                size={18}
                color={colors.textOnDark}
              />
            </Pressable>
          </View>

          <View style={styles.heroCopy}>
            <View style={styles.entryCountBadge}>
              <Text style={styles.entryCountText}>{entryCountLabel}</Text>
            </View>
            <Text style={styles.heroKicker}>{cfg.kicker}</Text>
            <Text style={styles.heroHeadline}>{cfg.title}</Text>
          </View>
        </ImageBackground>
      </View>

      {/* ── Intro: byline + lede ─────────────────────────────────────────── */}
      <View style={styles.introBlock}>
        <Text style={styles.byline}>
          BY {cfg.author.toUpperCase()} · {cfg.publishDate.toUpperCase()}
        </Text>
        <Text style={styles.lede}>{cfg.lede}</Text>
      </View>

      {/* ── List body ────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={colors.accentSoft} size="small" />
        </View>
      ) : wineries.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.emptyText}>
            No estates match this collection yet.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {wineries.map((w, i) => {
            const numeral = String(i + 1).padStart(2, "0");
            const blurb = w.description?.[0];
            return (
              <Pressable
                key={w.id}
                style={({ pressed }) => [
                  styles.entry,
                  pressed && styles.entryPressed,
                ]}
                onPress={() => router.push(`/wineries/${w.slug}` as any)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${w.name}`}
              >
                <View style={styles.entryHead}>
                  <Text style={styles.entryNumeral}>Nº {numeral}</Text>
                  <View style={styles.entryRule} />
                </View>
                <Text style={styles.entryTitle}>{w.name}</Text>
                {w.rating != null && (
                  <Text style={styles.entryRating}>
                    ★ {w.rating.toFixed(1)}
                    {w.userRatingsTotal != null
                      ? `  ·  ${w.userRatingsTotal.toLocaleString()} reviews`
                      : ""}
                  </Text>
                )}
                {blurb && <Text style={styles.entryBody}>{blurb}</Text>}
                <View style={styles.entryFooter}>
                  <Text style={styles.visitText}>VISIT CELLAR DOOR</Text>
                  <Ionicons
                    name="arrow-forward"
                    size={12}
                    color={colors.accent}
                  />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ── Footer mark ──────────────────────────────────────────────────── */}
      {!loading && wineries.length > 0 && (
        <View style={styles.footerRule}>
          <View style={styles.footerLine} />
          <Text style={styles.footerMark}>END OF LIST</Text>
          <View style={styles.footerLine} />
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 120,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },

  // ── Hero ────────────────────────────────────────────────────────────────
  hero: { height: 360 },
  heroImg: { flex: 1, justifyContent: "space-between" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
  },
  iconBtn: {
    width: spacing.hitTarget,
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.photoChrome,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  headerKicker: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.accentSoft,
  },
  heroCopy: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  entryCountBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    marginBottom: spacing.md,
  },
  entryCountText: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.textOnDark,
  },
  heroKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  heroHeadline: {
    ...type.h1,
    fontStyle: "italic",
    fontWeight: weights.body,
    color: colors.textOnDark,
    letterSpacing: -0.5,
  },

  // ── Intro ───────────────────────────────────────────────────────────────
  introBlock: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  byline: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.md,
    letterSpacing: 1.8,
  },
  lede: {
    ...type.lede,
    color: colors.textPrimary,
  },

  // ── States ──────────────────────────────────────────────────────────────
  stateBlock: {
    paddingTop: spacing.hero,
    paddingBottom: spacing.hero,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.xxl,
  },

  // ── Entries ─────────────────────────────────────────────────────────────
  list: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
  },
  entry: {
    paddingVertical: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  entryPressed: {
    opacity: 0.85,
  },
  entryHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  entryNumeral: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.body,
    fontSize: 18,
    color: colors.accentSoft,
    letterSpacing: 1,
  },
  entryRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  entryTitle: {
    fontFamily: fonts.serif,
    fontSize: 26,
    fontWeight: weights.emphasis,
    fontStyle: "italic",
    color: colors.textPrimary,
    lineHeight: 32,
    letterSpacing: -0.3,
    marginBottom: spacing.sm,
  },
  entryRating: {
    ...type.caption,
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  entryBody: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 25,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  entryFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  visitText: {
    ...type.kicker,
    fontWeight: weights.emphasis,
    color: colors.accent,
    letterSpacing: 1.8,
  },

  // ── Footer ──────────────────────────────────────────────────────────────
  footerRule: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.hero,
    paddingHorizontal: spacing.xxl,
  },
  footerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  footerMark: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 2.5,
  },

  // ── Fallback ────────────────────────────────────────────────────────────
  fallbackTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    fontStyle: "italic",
    color: colors.textPrimary,
    textAlign: "center",
  },
  fallbackBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  fallbackBackText: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 1.8,
  },
});
