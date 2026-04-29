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
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../../firebaseConfig";
import { colors, fonts } from "../../../constants/theme";

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
};

// ─── Static directory ─────────────────────────────────────────────────────────
// The Pour is rendered separately as a featured hero. Everything else is
// pulled from this list — easy to extend or migrate to Firestore later.
const ARTICLES: ArticleEntry[] = [
  {
    key:     "sommelier-recommendations",
    kicker:  "TASTING NOTES",
    title:   "Sommelier Recommendations",
    blurb:   "Hand-picked bottles from the region's leading wine professionals.",
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80",
    cadence: "Monthly",
  },
  {
    key:     "hidden-gems",
    kicker:  "DISCOVERY",
    title:   "Hidden Gems",
    blurb:   "Small-batch producers and tasting rooms most visitors never find.",
    image:
      "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=900&q=80",
    cadence: "Series",
  },
  {
    key:     "vintage-reports",
    kicker:  "REGION",
    title:   "Vintage Reports",
    blurb:   "How the season shaped this year's release — variety by variety.",
    image:
      "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=900&q=80",
    cadence: "Annual",
  },
  {
    key:     "behind-the-cellar-door",
    kicker:  "INTERVIEW",
    title:   "Behind the Cellar Door",
    blurb:   "Conversations with the winemakers, growers and sommeliers behind the bottle.",
    image:
      "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=900&q=80",
    cadence: "Series",
  },
  {
    key:     "pairings",
    kicker:  "AT THE TABLE",
    title:   "Food & Wine Pairings",
    blurb:   "Local kitchens and cellars on what pours best with what plate.",
    image:
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=80",
    cadence: "Monthly",
  },
];

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pour, setPour] = useState<FeaturedPour | null>(null);
  const [loadingPour, setLoadingPour] = useState(true);

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
            <ImageBackground
              source={{ uri: pour.heroImage }}
              style={styles.featuredImg}
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
                    <Ionicons name="arrow-forward" size={12} color={colors.background} />
                  </View>
                </View>
              </View>
            </ImageBackground>
          </Pressable>
        ) : (
          // Fallback card if Firestore is unreachable — still routes to reader
          <Pressable
            style={styles.featuredCard}
            onPress={() => router.push("/(tabs)/home/pour" as any)}
          >
            <ImageBackground
              source={{
                uri: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=900&q=80",
              }}
              style={styles.featuredImg}
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
              <View style={styles.featuredOverlay}>
                <Text style={styles.featuredIssue}>THE POUR · WEEKLY</Text>
                <Text style={styles.featuredHeadline}>
                  A weekly taste of local vineyards, vintages, and voices.
                </Text>
                <View style={styles.featuredMetaRow}>
                  <Text style={styles.featuredMeta}>Read the latest issue</Text>
                  <View style={styles.readBtn}>
                    <Text style={styles.readBtnText}>READ</Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.background} />
                  </View>
                </View>
              </View>
            </ImageBackground>
          </Pressable>
        )}
      </View>

      {/* ── Article directory ─────────────────────────────────────────────── */}
      <View style={styles.directorySection}>
        <View style={styles.sectionHead}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionKicker}>THE LIBRARY</Text>
        </View>

        {ARTICLES.map((item, i) => (
          <Pressable
            key={item.key}
            style={[styles.articleRow, i === 0 && styles.articleRowFirst]}
            onPress={() => {
              if (item.href) {
                router.push(item.href as any);
              }
              // No-op for placeholders. Swap for navigation when each
              // article's detail screen / collection is ready.
            }}
          >
            <Image source={{ uri: item.image }} style={styles.articleImg} />
            <View style={styles.articleText}>
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
              {!item.href && (
                <Text style={styles.comingSoon}>COMING SOON</Text>
              )}
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
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 24,
  },
  kicker: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.accentSoft,
    marginBottom: 10,
  },
  title: {
    fontFamily: "Georgia",
    fontSize: 38,
    fontStyle: "italic",
    fontWeight: "500",
    color: colors.textPrimary,
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  subtitle: {
    fontFamily: "Georgia",
    fontSize: 15,
    fontStyle: "italic",
    color: colors.textSecondary,
    marginTop: 12,
    lineHeight: 22,
    maxWidth: 320,
  },

  // ── Section heads ────────────────────────────────────────────────────────
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 24,
  },
  goldLine: {
    width: 24,
    height: 1,
    backgroundColor: colors.accent,
  },
  sectionKicker: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.accentSoft,
  },

  // ── Featured (The Pour) ───────────────────────────────────────────────────
  featuredSection: {
    marginTop: 8,
  },
  featuredLoading: {
    height: 280,
    marginHorizontal: 20,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredCard: {
    marginHorizontal: 20,
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
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  featuredIssue: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: 10,
  },
  featuredHeadline: {
    fontFamily: "Georgia",
    fontSize: 24,
    fontStyle: "italic",
    fontWeight: "500",
    color: colors.textOnDark,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  featuredMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  featuredMeta: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.4,
    color: colors.textOnDarkSubtle,
    flex: 1,
  },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  readBtnText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: "700",
    color: colors.background,
  },

  // ── Directory rows ───────────────────────────────────────────────────────
  directorySection: {
    marginTop: 40,
  },
  articleRow: {
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  articleRowFirst: {
    borderTopWidth: 0,
    paddingTop: 4,
  },
  articleImg: {
    width: 92,
    height: 92,
    borderRadius: 4,
    backgroundColor: colors.surfaceDeep,
  },
  articleText: {
    flex: 1,
  },
  articleKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  articleKicker: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    letterSpacing: 1.8,
    color: colors.accentSoft,
  },
  articleCadence: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: colors.textMuted,
  },
  articleTitle: {
    fontFamily: "Georgia",
    fontSize: 17,
    fontWeight: "500",
    color: colors.textPrimary,
    lineHeight: 22,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  articleBlurb: {
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  comingSoon: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    color: colors.textMuted,
    marginTop: 6,
  },
});
