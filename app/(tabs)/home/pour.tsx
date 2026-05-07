// app/(tabs)/home/pour.tsx
// "The Tassie Pour" — weekly editorial article reader
// Fetches the latest active article from Firestore `pour_articles` collection.

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { db } from "../../../firebaseConfig";

const { width } = Dimensions.get("window");

// ─── Firestore data types ─────────────────────────────────────────────────────
interface ParagraphBlock {
  type: "paragraph";
  text: string;
  dropCap?: boolean;
}

interface PullquoteBlock {
  type: "pullquote";
  text: string;
  attribution: string;
}

interface ImageBlock {
  type: "image";
  url: string;
  caption: string;
}

type Block = ParagraphBlock | PullquoteBlock | ImageBlock;

interface SponsorBlock {
  label: string;
  title: string;
  subtitle: string;
  image: string;
}

interface ContinueItem {
  kicker: string;
  title: string;
  image: string;
}

interface PourArticle {
  issueNumber: number;
  issueLabel: string;
  kicker: string;
  headline: string;
  author: string;
  authorInitials: string;
  date: string;
  readTime: string;
  heroImage: string;
  active: boolean;
  body: Block[];
  sponsor: SponsorBlock | null;
  continueReading: ContinueItem[];
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function PourScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [article, setArticle] = useState<PourArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchLatest() {
      try {
        // First try ordered query (requires issueNumber field on all docs)
        let docs: any[] = [];
        try {
          const q = query(
            collection(db, "pour_articles"),
            orderBy("issueNumber", "desc"),
            limit(10)
          );
          const snap = await getDocs(q);
          docs = snap.docs;
        } catch {
          // Fallback: unordered fetch — works even if issueNumber is missing
          const snap = await getDocs(collection(db, "pour_articles"));
          docs = snap.docs.sort((a, b) => {
            const aNum = (a.data().issueNumber as number) ?? 0;
            const bNum = (b.data().issueNumber as number) ?? 0;
            return bNum - aNum;
          });
        }

        if (!cancelled && docs.length > 0) {
          // Pick the first active article (active field missing = treated as active)
          const active = docs.find((d) => d.data().active !== false);
          if (active) setArticle(active.data() as PourArticle);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLatest();
    return () => { cancelled = true; };
  }, []);

  const handleShare = async () => {
    if (!article) return;
    try {
      await Share.share({
        message: `${article.headline} — ${article.issueLabel}`,
      });
    } catch {}
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accentSoft} size="small" />
        <Text style={styles.loadingText}>Loading article…</Text>
      </View>
    );
  }

  // ── Error / empty ────────────────────────────────────────────────────────
  if (error || !article) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
        <Text style={styles.loadingText}>Issue unavailable</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  // ── Block renderer ───────────────────────────────────────────────────────
  const renderBlock = (block: Block, index: number) => {
    switch (block.type) {
      case "paragraph":
        return (
          <Text key={index} style={styles.bodyText}>
            {block.dropCap ? (
              <>
                <Text style={styles.dropCap}>{block.text.charAt(0).toUpperCase()}</Text>
                {block.text}
              </>
            ) : (
              block.text
            )}
          </Text>
        );

      case "pullquote":
        return (
          <View key={index} style={styles.pullQuote}>
            <View style={styles.pullQuoteBar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pullQuoteText}>{block.text}</Text>
              <Text style={styles.pullQuoteAttr}>{block.attribution}</Text>
            </View>
          </View>
        );

      case "image":
        return (
          <View key={index} style={styles.inlineImgWrap}>
            <Image
              source={{ uri: block.url }}
              style={styles.inlineImg}
              contentFit="cover"
              transition={150}
            />
            <Text style={styles.imgCaption}>{block.caption}</Text>
          </View>
        );

      default:
        return null;
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Cinematic hero ─────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <View style={styles.heroImg}>
          <Image
            source={{ uri: article.heroImage }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={150}
          />
          <LinearGradient
            colors={[
              colors.photoOverlayTop,
              "transparent",
              colors.photoOverlayStrong,
              colors.photoOverlayDeep,
            ]}
            locations={[0, 0.25, 0.72, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Header: back · issue label · share */}
          <View style={[styles.headerRow, { paddingTop: insets.top + 10 }]}>
            <Pressable style={styles.iconBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={16} color={colors.textOnDark} />
            </Pressable>

            <Text style={styles.headerKicker}>{article.issueLabel}</Text>

            <Pressable style={styles.iconBtn} onPress={handleShare}>
              <Ionicons name="share-outline" size={15} color={colors.textOnDark} />
            </Pressable>
          </View>

          {/* Article title overlaid at bottom of hero */}
          <View style={styles.heroCopy}>
            <Text style={styles.heroArticleKicker}>{article.kicker}</Text>
            <Text style={styles.heroHeadline}>{article.headline}</Text>
          </View>
        </View>
      </View>

      {/* ── Author row ─────────────────────────────────────────────────── */}
      <View style={styles.authorRow}>
        <View style={styles.authorLeft}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{article.authorInitials}</Text>
          </View>
          <View>
            <Text style={styles.authorName}>{article.author}</Text>
            <Text style={styles.authorMeta}>
              {article.date} · {article.readTime}
            </Text>
          </View>
        </View>
        <View style={styles.authorActions}>
          <Pressable style={styles.actionBtn}>
            <Ionicons name="heart-outline" size={14} color={colors.textSecondary} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={handleShare}>
            <Ionicons name="share-outline" size={14} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* ── Article body ───────────────────────────────────────────────── */}
      <View style={styles.body}>
        {article.body.map((block, i) => renderBlock(block, i))}
      </View>

      {/* ── Sponsored card ─────────────────────────────────────────────── */}
      {article.sponsor != null && (
        <View style={styles.sponsorCard}>
          <Text style={styles.sponsorLabel}>{article.sponsor.label}</Text>
          <View style={styles.sponsorInner}>
            <Image
              source={{ uri: article.sponsor.image }}
              style={styles.sponsorImg}
              contentFit="cover"
              transition={150}
            />
            <View style={styles.sponsorText}>
              <Text style={styles.sponsorTitle}>{article.sponsor.title}</Text>
              <Text style={styles.sponsorSub}>{article.sponsor.subtitle}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Continue reading ───────────────────────────────────────────── */}
      {article.continueReading.length > 0 && (
        <View style={styles.continueSection}>
          <Text style={styles.continueKicker}>CONTINUE READING</Text>
          {article.continueReading.map((item, i) => (
            <View
              key={i}
              style={[
                styles.continueRow,
                i === 0 && styles.continueRowFirst,
              ]}
            >
              <Image
                source={{ uri: item.image }}
                style={styles.continueImg}
                contentFit="cover"
                transition={150}
              />
              <View style={styles.continueText}>
                <Text style={styles.continueItemKicker}>{item.kicker}</Text>
                <Text style={styles.continueItemTitle}>{item.title}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
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
    paddingBottom: 120,
  },

  // ── Loading / error ──────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.textMuted,
  },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
  },
  backBtnText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.textSecondary,
  },

  // ── Hero ────────────────────────────────────────────────────────────────
  hero: {
    height: 400,
  },
  heroImg: {
    flex: 1,
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24
  },
  iconBtn: {
    width: spacing.hitTarget,                 // 44pt — Apple HIG
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.photoChrome,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  headerKicker: {
    ...type.kicker,                           // bumped 9.5 → 10 (kicker minimum)
    letterSpacing: 2,
    color: colors.accentSoft,
  },
  heroCopy: {
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
    paddingBottom: spacing.xxl,
  },
  heroArticleKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.md,
  },
  heroHeadline: {
    ...type.h2,                               // 28 / Georgia / bold
    fontStyle: "italic",
    fontWeight: weights.body,                 // override h2's emphasis — italic + body weight reads as editorial
    color: colors.textOnDark,
    letterSpacing: -0.5,
  },

  // ── Author row ──────────────────────────────────────────────────────────
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  authorLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.serif,
    fontSize: type.body.fontSize,             // 13 → 14
    fontWeight: weights.emphasis,             // 600 → 700 (Fix 4)
    color: colors.accentSoft,
  },
  authorName: {
    ...type.body,                             // 13 → 14
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
  },
  authorMeta: {
    ...type.caption,                          // 11 → 12
    color: colors.textMuted,
    marginTop: 1,
  },
  authorActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionBtn: {
    width: spacing.hitTarget,                 // bumped 32 → 44 (Apple HIG)
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Body ────────────────────────────────────────────────────────────────
  body: {
    paddingHorizontal: spacing.xxl,           // 24
    paddingTop: spacing.xxxl,                 // bumped 26 → 32 for editorial breathing
  },
  bodyText: {
    ...type.lede,                             // 17 / italic / 400 / Georgia
    fontStyle: "normal" as const,             // body uses upright Georgia
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  dropCap: {
    fontFamily: fonts.serif,
    fontSize: 58,
    lineHeight: 50,
    color: colors.accentSoft,
    fontWeight: weights.body,
  },
  pullQuote: {
    flexDirection: "row",
    alignItems: "stretch",
    marginVertical: spacing.xxxl,             // bumped 28 → 32
    marginHorizontal: -spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  pullQuoteBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
    marginRight: spacing.xl,
  },
  pullQuoteText: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.body,                  // explicit 400 (Fix 4)
    fontSize: type.h3.fontSize,                // 22
    lineHeight: 32,
    color: colors.textPrimary,
    letterSpacing: -0.3,
    marginBottom: spacing.md,
  },
  pullQuoteAttr: {
    ...type.kicker,
    letterSpacing: 1.8,
    color: colors.accentSoft,
  },

  // Inline image
  inlineImgWrap: {
    marginHorizontal: -spacing.xxl,
    marginBottom: spacing.md,
  },
  inlineImg: {
    width,
    height: 220,
  },
  imgCaption: {
    fontFamily: fonts.mono,
    fontSize: type.caption.fontSize,           // 11 → 12
    color: colors.textMuted,
    letterSpacing: 0.2,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    marginBottom: spacing.sm,
  },

  // ── Sponsored card ───────────────────────────────────────────────────────
  sponsorCard: {
    marginHorizontal: spacing.xxl,            // standardised 22 → 24
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.xl,                      // card body padding 20 (Fix 3) — was 14
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sponsorLabel: {
    ...type.kicker,                           // bumped 9 → 10 (kicker minimum)
    letterSpacing: 2,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  sponsorInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  sponsorImg: {
    width: 60,
    height: 60,
    borderRadius: 3,
  },
  sponsorText: {
    flex: 1,
  },
  sponsorTitle: {
    fontFamily: fonts.serif,
    fontSize: type.lede.fontSize,             // bumped 16 → 17
    fontWeight: weights.emphasis,             // 500 → 700 (Fix 4)
    color: colors.textPrimary,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  sponsorSub: {
    ...type.caption,                          // 11.5 → 12 (token-aligned)
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // ── Continue reading ─────────────────────────────────────────────────────
  continueSection: {
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
    paddingTop: spacing.hero,                  // bumped 32 → 40 (Fix 5 — new section)
  },
  continueKicker: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  continueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,                          // bumped 14 → 16
    paddingVertical: spacing.lg,              // 16 row gutter
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueRowFirst: {
    marginTop: spacing.md,
  },
  continueImg: {
    width: 70,
    height: 70,
    borderRadius: 3,
    flexShrink: 0,
  },
  continueText: {
    flex: 1,
  },
  continueItemKicker: {
    ...type.kicker,                           // bumped 9.5 → 10
    letterSpacing: 1.6,
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  continueItemTitle: {
    fontFamily: fonts.serif,
    fontSize: type.lede.fontSize,             // bumped 16 → 17
    fontWeight: weights.emphasis,             // 500 → 700 (Fix 4)
    color: colors.textPrimary,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
});
