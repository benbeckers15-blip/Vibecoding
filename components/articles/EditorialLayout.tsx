// components/articles/EditorialLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Editorial layout — long-form prose, cinematic hero, drop cap on the lede,
// pull-quotes with the forest accent bar, full-bleed inline images.
// Closest cousin to `app/(tabs)/home/pour.tsx` — use this for essay-style
// pieces where the writing carries the page.
// ─────────────────────────────────────────────────────────────────────────────

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
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
import { colors, fonts, spacing, type, weights } from "../../constants/theme";
import {
  bodyParagraphs,
  galleryImages,
  sectionText,
} from "./types";
import type { Article, ArticleSection } from "./types";

const { width } = Dimensions.get("window");

interface Props {
  article: Article;
}

export default function EditorialLayout({ article }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleShare = async (): Promise<void> => {
    try {
      await Share.share({ message: `${article.title} — The Tassie Pour` });
    } catch {
      /* swallow — Share.share rejects on cancel on some platforms */
    }
  };

  // Find the first body section so we can render the lede with a drop cap
  // and treat subsequent paragraphs/blocks normally.
  let firstBodyRendered = false;

  const renderSection = (section: ArticleSection, index: number) => {
    switch (section.type) {
      case "body": {
        const paragraphs = bodyParagraphs(section);

        return (
          <View key={index}>
            {paragraphs.map((para, pIdx) => {
              const isFirstBody = !firstBodyRendered && pIdx === 0;
              if (isFirstBody) firstBodyRendered = true;

              return (
                <Text key={pIdx} style={styles.bodyText}>
                  {isFirstBody ? (
                    <>
                      <Text style={styles.dropCap}>
                        {para.charAt(0).toUpperCase()}
                      </Text>
                      {para.slice(1)}
                    </>
                  ) : (
                    para
                  )}
                </Text>
              );
            })}
          </View>
        );
      }

      case "pullQuote": {
        const text = sectionText(section);
        const attribution =
          section.attribution ?? (article.author != null ? `— ${article.author}` : null);
        return (
          <View key={index} style={styles.pullQuote}>
            <View style={styles.pullQuoteBar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pullQuoteText}>{text}</Text>
              {attribution && (
                <Text style={styles.pullQuoteAttr}>{attribution}</Text>
              )}
            </View>
          </View>
        );
      }

      case "imageGallery": {
        const images = galleryImages(section);
        return (
          <View key={index} style={styles.galleryWrap}>
            {images.map((img, i) => (
              <View key={i} style={styles.inlineImgWrap}>
                <Image
                  source={{ uri: img.url }}
                  style={styles.inlineImg}
                  resizeMode="cover"
                  accessibilityLabel={img.alt ?? img.caption}
                />
                {img.caption ? (
                  <Text style={styles.imgCaption}>{img.caption}</Text>
                ) : null}
              </View>
            ))}
          </View>
        );
      }

      case "callout": {
        const text = sectionText(section);
        return (
          <View key={index} style={styles.callout}>
            <Text style={styles.calloutKicker}>{section.kicker ?? "NOTE"}</Text>
            <Text style={styles.calloutText}>{text}</Text>
          </View>
        );
      }

      // `qa` blocks are not part of the editorial register — silently skip.
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
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
          >
            <Ionicons name="chevron-back" size={18} color={colors.textOnDark} />
            <Text style={styles.backBtnText}>Home</Text>
          </Pressable>
        </View>
        <Text style={styles.headerKicker}>ESSAY</Text>
        <View style={[styles.topBarSide, styles.topBarSideRight]}>
          <Pressable
            style={styles.iconBtn}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Share this article"
          >
            <Ionicons name="share-outline" size={16} color={colors.textOnDark} />
          </Pressable>
        </View>
      </View>

      {/* ── Cinematic hero ──────────────────────────────────────────────── */}
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

          <View style={styles.heroCopy}>
            <Text style={styles.heroHeadline}>{article.title}</Text>
            {article.lede != null && (
              <Text style={styles.heroLede}>{article.lede}</Text>
            )}
          </View>
        </ImageBackground>
      </View>

      {/* ── Author / meta row ───────────────────────────────────────────── */}
      <View style={styles.authorRow}>
        <View style={styles.authorLeft}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(article.author ?? "??")
                .split(" ")
                .map((s) => s.charAt(0).toUpperCase())
                .join("")
                .slice(0, 2)}
            </Text>
          </View>
          <View>
            <Text style={styles.authorName}>{article.author ?? "Staff"}</Text>
            <Text style={styles.authorMeta}>{article.publishDate}</Text>
          </View>
        </View>
        <Pressable
          style={styles.actionBtn}
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel="Share this article"
        >
          <Ionicons
            name="share-outline"
            size={14}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>

      {/* ── Article body ────────────────────────────────────────────────── */}
      <View style={styles.body}>
        {article.sections.map((section, i) => renderSection(section, i))}
      </View>

      {/* ── Footer rule ─────────────────────────────────────────────────── */}
      <View style={styles.footerRule}>
        <View style={styles.footerLine} />
        <Text style={styles.footerMark}>SL</Text>
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
  hero: { height: 420 },
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
  heroHeadline: {
    ...type.h2,
    fontStyle: "italic",
    fontWeight: weights.body,
    color: colors.textOnDark,
    letterSpacing: -0.5,
  },
  heroLede: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 15,
    fontWeight: weights.body,
    color: colors.textOnDarkMuted,
    lineHeight: 22,
    marginTop: spacing.md,
    maxWidth: 320,
  },

  // Author row
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
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
    fontSize: type.body.fontSize,
    fontWeight: weights.emphasis,
    color: colors.accentSoft,
  },
  authorName: {
    ...type.body,
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
  },
  authorMeta: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: 1,
  },
  actionBtn: {
    width: spacing.hitTarget,
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // Body
  body: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
  },
  bodyText: {
    ...type.lede,
    fontStyle: "normal",
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

  // Pull quote
  pullQuote: {
    flexDirection: "row",
    alignItems: "stretch",
    marginVertical: spacing.xxxl,
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
    fontWeight: weights.body,
    fontSize: type.h3.fontSize,
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

  // Inline images
  galleryWrap: {
    marginBottom: spacing.xl,
  },
  inlineImgWrap: {
    marginHorizontal: -spacing.xxl,
    marginBottom: spacing.md,
  },
  inlineImg: {
    width,
    height: 240,
  },
  imgCaption: {
    ...type.caption,
    color: colors.textMuted,
    fontStyle: "italic",
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
  },

  // Callout
  callout: {
    marginVertical: spacing.xxl,
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

  // Footer rule
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
    letterSpacing: 3,
  },
});
