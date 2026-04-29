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
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "../../../constants/theme";
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
        const q = query(
          collection(db, "pour_articles"),
          orderBy("issueNumber", "desc"),
          limit(10)
        );
        const snap = await getDocs(q);
        if (!cancelled && !snap.empty) {
          // Pick the first active article (avoids needing a composite index)
          const active = snap.docs.find((d) => d.data().active !== false);
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
              resizeMode="cover"
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
        <ImageBackground
          source={{ uri: article.heroImage }}
          style={styles.heroImg}
        >
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
        </ImageBackground>
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
              resizeMode="cover"
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
                resizeMode="cover"
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
    paddingHorizontal: 20,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.photoChrome,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  headerKicker: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    letterSpacing: 2,
    color: colors.accentSoft,
  },
  heroCopy: {
    paddingHorizontal: 22,
    paddingBottom: 24,
  },
  heroArticleKicker: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.accentSoft,
    marginBottom: 10,
  },
  heroHeadline: {
    fontFamily: "Georgia",
    fontSize: 28,
    fontStyle: "italic",
    fontWeight: "500",
    color: colors.textOnDark,
    lineHeight: 34,
    letterSpacing: -0.5,
  },

  // ── Author row ──────────────────────────────────────────────────────────
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  authorLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
    fontFamily: "Georgia",
    fontSize: 13,
    fontWeight: "600",
    color: colors.accentSoft,
  },
  authorName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  authorMeta: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  authorActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Body ────────────────────────────────────────────────────────────────
  body: {
    paddingHorizontal: 24,
    paddingTop: 26,
  },
  bodyText: {
    fontFamily: "Georgia",
    fontSize: 17,
    lineHeight: 29,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  dropCap: {
    fontFamily: "Georgia",
    fontSize: 58,
    lineHeight: 50,
    color: colors.accentSoft,
    fontWeight: "500",
  },
  pullQuote: {
    flexDirection: "row",
    alignItems: "stretch",
    marginVertical: 28,
    marginHorizontal: -4,
    paddingHorizontal: 4,
  },
  pullQuoteBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
    marginRight: 20,
  },
  pullQuoteText: {
    fontFamily: "Georgia",
    fontStyle: "italic",
    fontSize: 22,
    lineHeight: 32,
    color: colors.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  pullQuoteAttr: {
    fontFamily: fonts.mono,
    fontStyle: "normal",
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.accentSoft,
  },

  // Inline image
  inlineImgWrap: {
    marginHorizontal: -24,
    marginBottom: 12,
  },
  inlineImg: {
    width,
    height: 220,
  },
  imgCaption: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.2,
    paddingHorizontal: 24,
    paddingTop: 10,
    marginBottom: 8,
  },

  // ── Sponsored card ───────────────────────────────────────────────────────
  sponsorCard: {
    marginHorizontal: 22,
    marginTop: 8,
    marginBottom: 4,
    padding: 14,
    backgroundColor: colors.surfaceDeep,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sponsorLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.textMuted,
    marginBottom: 10,
  },
  sponsorInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
    fontFamily: "Georgia",
    fontSize: 16,
    fontWeight: "500",
    color: colors.textPrimary,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  sponsorSub: {
    fontSize: 11.5,
    color: colors.textMuted,
    marginTop: 4,
  },

  // ── Continue reading ─────────────────────────────────────────────────────
  continueSection: {
    paddingHorizontal: 22,
    paddingTop: 32,
  },
  continueKicker: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: 4,
  },
  continueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueRowFirst: {
    marginTop: 10,
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
    fontFamily: fonts.mono,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.accentSoft,
    marginBottom: 5,
  },
  continueItemTitle: {
    fontFamily: "Georgia",
    fontSize: 16,
    fontWeight: "500",
    color: colors.textPrimary,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
});
