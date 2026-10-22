// components/articles/ListLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// List layout — numbered editorial list. Each `body` section becomes one
// entry: first paragraph is the entry title, the rest are the entry body.
// Pull quotes / galleries / callouts render between entries as standalone
// breaks. Use this for vintage reports, sommelier picks, "10 bottles…" style.
// ─────────────────────────────────────────────────────────────────────────────

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
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
import { colors, fonts, spacing, type, weights } from "../../constants/theme";
import {
  bodyParagraphs,
  galleryImages,
  sectionText,
} from "./types";
import type { Article, ArticleSection } from "./types";
import { goBackOr } from "../../utils/navigation";

interface Props {
  article: Article;
}

export default function ListLayout({ article }: Props) {
  const insets = useSafeAreaInsets();

  const handleShare = async (): Promise<void> => {
    try {
      await Share.share({ message: `${article.title} — SipLocal` });
    } catch {
      /* swallow */
    }
  };

  // Running entry index — only `body` sections receive a number. Reset for
  // each render pass so re-renders re-number from the top.
  let entryIndex = 0;

  // Total entries for the hero badge.
  const totalEntries = article.sections.filter((s) => s.type === "body").length;

  const renderSection = (section: ArticleSection, index: number) => {
    switch (section.type) {
      case "body": {
        const paragraphs = bodyParagraphs(section);
        const [entryTitle, ...entryBody] = paragraphs;
        entryIndex += 1;
        const numLabel = entryIndex.toString().padStart(2, "0");

        return (
          <View key={index} style={styles.entry}>
            <View style={styles.entryHead}>
              <Text style={styles.entryNumeral}>Nº {numLabel}</Text>
              <View style={styles.entryRule} />
            </View>
            <Text style={styles.entryTitle}>{entryTitle}</Text>
            {entryBody.map((para, i) => (
              <Text key={i} style={styles.entryBody}>
                {para}
              </Text>
            ))}
          </View>
        );
      }

      case "pullQuote": {
        const text = sectionText(section);
        const attribution =
          section.attribution ?? (article.author != null ? `— ${article.author}` : null);
        return (
          <View key={index} style={styles.pullQuote}>
            <Text style={styles.pullMark}>&ldquo;</Text>
            <Text style={styles.pullQuoteText}>{text}</Text>
            {attribution && (
              <Text style={styles.pullQuoteAttr}>{attribution}</Text>
            )}
          </View>
        );
      }

      case "imageGallery": {
        const images = galleryImages(section);
        return (
          <View key={index} style={styles.gallery}>
            {images.map((img, i) => (
              <Image
                key={i}
                source={{ uri: img.url }}
                style={styles.galleryImg}
                resizeMode="cover"
                accessibilityLabel={img.alt ?? img.caption}
              />
            ))}
          </View>
        );
      }

      case "callout": {
        const text = sectionText(section);
        return (
          <View key={index} style={styles.callout}>
            <Text style={styles.calloutKicker}>
              {section.kicker ?? "EDITOR’S NOTE"}
            </Text>
            <Text style={styles.calloutText}>{text}</Text>
          </View>
        );
      }

      case "qa":
      default:
        return null;
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Black header bar — back button + label, above the hero photo ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.topBarSide}>
          <Pressable
            style={styles.backBtn}
            onPress={() => goBackOr("/(tabs)/home")}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
          >
            <Ionicons name="chevron-back" size={18} color={colors.textOnDark} />
            <Text style={styles.backBtnText}>Home</Text>
          </Pressable>
        </View>
        <Text style={styles.headerKicker}>THE LIST</Text>
        <View style={[styles.topBarSide, styles.topBarSideRight]}>
          <Pressable
            style={styles.iconBtn}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Share this list"
          >
            <Ionicons name="share-outline" size={16} color={colors.textOnDark} />
          </Pressable>
        </View>
      </View>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <ImageBackground
          source={{ uri: article.heroImage }}
          style={styles.heroImg}
        >
          <LinearGradient
            colors={[
              colors.photoOverlayTop,
              "transparent",
              colors.photoOverlayDeep,
            ]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.heroCopy}>
            <View style={styles.entryCountBadge}>
              <Text style={styles.entryCountText}>
                {totalEntries.toString().padStart(2, "0")} ENTRIES
              </Text>
            </View>
            <Text style={styles.heroHeadline}>{article.title}</Text>
          </View>
        </ImageBackground>
      </View>

      {/* ── Intro ───────────────────────────────────────────────────────── */}
      <View style={styles.introBlock}>
        {article.author != null && (
          <Text style={styles.byline}>
            BY {article.author.toUpperCase()} · {article.publishDate}
          </Text>
        )}
        {article.lede != null && <Text style={styles.lede}>{article.lede}</Text>}
      </View>

      {/* ── Entries ─────────────────────────────────────────────────────── */}
      <View style={styles.list}>
        {article.sections.map((section, i) => renderSection(section, i))}
      </View>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <View style={styles.footerRule}>
        <View style={styles.footerLine} />
        <Text style={styles.footerMark}>END OF LIST</Text>
        <View style={styles.footerLine} />
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 120,
  },

  // Hero
  hero: { height: 320 },
  heroImg: { flex: 1, justifyContent: "flex-end" },
  // Black header bar that sits above the hero photo.
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceDeep,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  // Equal-width side columns so the centered label is dead-center on screen
  // regardless of the back-button / share-button widths.
  topBarSide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  topBarSideRight: {
    justifyContent: "flex-end",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: spacing.hitTarget,
  },
  backBtnText: {
    color: colors.textOnDark,
    fontSize: type.body.fontSize,
    fontWeight: weights.body,
    letterSpacing: 0.2,
  },
  iconBtn: {
    width: spacing.hitTarget,
    height: spacing.hitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  headerKicker: {
    ...type.kicker,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.accentSoft,
    textAlign: "center",
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
  heroHeadline: {
    ...type.h2,
    fontStyle: "italic",
    fontWeight: weights.body,
    color: colors.textOnDark,
    letterSpacing: -0.5,
  },

  // Intro block
  introBlock: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
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

  // List
  list: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
  },
  entry: {
    paddingVertical: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    fontSize: 24,
    fontWeight: weights.emphasis,
    fontStyle: "italic",
    color: colors.textPrimary,
    lineHeight: 30,
    letterSpacing: -0.3,
    marginBottom: spacing.md,
  },
  entryBody: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 25,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  // Pull quote
  pullQuote: {
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderBottomColor: colors.border,
    marginVertical: spacing.lg,
  },
  pullMark: {
    fontFamily: fonts.serif,
    fontSize: 56,
    lineHeight: 56,
    color: colors.accentSoft,
    marginBottom: -spacing.sm,
  },
  pullQuoteText: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.body,
    fontSize: 20,
    lineHeight: 30,
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  pullQuoteAttr: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 1.8,
  },

  // Gallery
  gallery: {
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: -spacing.xxl,
    paddingHorizontal: spacing.xxl,
    marginVertical: spacing.lg,
  },
  galleryImg: {
    flex: 1,
    height: 160,
  },

  // Callout
  callout: {
    marginVertical: spacing.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderLeftWidth: 2,
    borderLeftColor: colors.accentSoft,
  },
  calloutKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.sm,
  },
  calloutText: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textPrimary,
  },

  // Footer
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
});
