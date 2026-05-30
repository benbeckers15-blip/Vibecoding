// components/articles/MagazineLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Magazine layout — image-forward feature spread. The hero photo sits clean
// on top, and the title page lives BELOW it on the paper background (the way
// a print feature opens onto a fold). Image galleries expand to a 2-up grid;
// pull quotes get top/bottom rules and big centered italic. Use this for
// hidden gems, pairings — visual pieces.
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

export default function MagazineLayout({ article }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleShare = async (): Promise<void> => {
    try {
      await Share.share({ message: `${article.title} — SipLocal Feature` });
    } catch {
      /* swallow */
    }
  };

  const renderSection = (section: ArticleSection, index: number) => {
    switch (section.type) {
      case "body": {
        const paragraphs = bodyParagraphs(section);
        return (
          <View key={index} style={styles.bodyBlock}>
            {paragraphs.map((para, i) => (
              <Text key={i} style={styles.bodyText}>
                {para}
              </Text>
            ))}
          </View>
        );
      }

      case "pullQuote": {
        const text = sectionText(section);
        const attribution = section.attribution ?? article.author ?? null;
        // Either render against a per-section backdrop photo, or fall back to
        // the article-wide pullQuoteBackgroundImage if either is set.
        const backdrop = section.backgroundImage ?? article.pullQuoteBackgroundImage;
        if (backdrop) {
          return (
            <View key={index} style={styles.pullQuoteWithImg}>
              <ImageBackground
                source={{ uri: backdrop }}
                style={styles.pullQuoteImg}
              >
                <LinearGradient
                  colors={[colors.photoOverlayMedium, colors.photoOverlayDeep]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.pullQuoteImgInner}>
                  <Text style={styles.pullQuoteTextOnImg}>{text}</Text>
                  {attribution && (
                    <Text style={styles.pullQuoteAttrOnImg}>{attribution}</Text>
                  )}
                </View>
              </ImageBackground>
            </View>
          );
        }
        return (
          <View key={index} style={styles.pullQuote}>
            <View style={styles.pullRule} />
            <Text style={styles.pullQuoteText}>{text}</Text>
            {attribution && (
              <Text style={styles.pullQuoteAttr}>{attribution}</Text>
            )}
            <View style={styles.pullRule} />
          </View>
        );
      }

      case "imageGallery": {
        const images = galleryImages(section);

        // 1 image → full-bleed; 2 → 2-up; 3+ → first big, rest in 2-up grid below
        if (images.length === 1) {
          return (
            <View key={index} style={styles.galleryStack}>
              <View style={styles.fullBleed}>
                <Image
                  source={{ uri: images[0].url }}
                  style={styles.fullBleedImg}
                  resizeMode="cover"
                  accessibilityLabel={images[0].alt ?? images[0].caption}
                />
              </View>
              {images[0].caption ? (
                <Text style={styles.imgCaption}>{images[0].caption}</Text>
              ) : null}
            </View>
          );
        }
        if (images.length === 2) {
          return (
            <View key={index} style={styles.twoUp}>
              {images.map((img, i) => (
                <Image
                  key={i}
                  source={{ uri: img.url }}
                  style={styles.twoUpImg}
                  resizeMode="cover"
                  accessibilityLabel={img.alt ?? img.caption}
                />
              ))}
            </View>
          );
        }
        return (
          <View key={index} style={styles.galleryStack}>
            <View style={styles.fullBleed}>
              <Image
                source={{ uri: images[0].url }}
                style={styles.fullBleedImg}
                resizeMode="cover"
                accessibilityLabel={images[0].alt ?? images[0].caption}
              />
            </View>
            {images[0].caption ? (
              <Text style={styles.imgCaption}>{images[0].caption}</Text>
            ) : null}
            <View style={styles.twoUp}>
              {images.slice(1).map((img, i) => (
                <Image
                  key={i}
                  source={{ uri: img.url }}
                  style={styles.twoUpImg}
                  resizeMode="cover"
                  accessibilityLabel={img.alt ?? img.caption}
                />
              ))}
            </View>
          </View>
        );
      }

      case "callout": {
        const text = sectionText(section);
        return (
          <View key={index} style={styles.callout}>
            <Text style={styles.calloutKicker}>
              {section.kicker ?? "FROM THE FIELD"}
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
      {/* ── Photographic hero ───────────────────────────────────────────── */}
      <View style={styles.hero}>
        <ImageBackground
          source={{ uri: article.heroImage }}
          style={styles.heroImg}
        >
          <LinearGradient
            colors={[colors.photoOverlayTop, "transparent"]}
            locations={[0, 0.5]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.headerRow, { paddingTop: insets.top + 10 }]}>
            <Pressable
              style={styles.backBtn}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back to home"
            >
              <Ionicons name="chevron-back" size={16} color={colors.textOnDark} />
              <Text style={styles.backBtnText}>Home</Text>
            </Pressable>
            <Text style={styles.headerKicker}>FEATURE</Text>
            <Pressable
              style={styles.iconBtn}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share this feature"
            >
              <Ionicons
                name="share-outline"
                size={15}
                color={colors.textOnDark}
              />
            </Pressable>
          </View>
        </ImageBackground>
      </View>

      {/* ── Title page (below hero, on paper) ───────────────────────────── */}
      <View style={styles.titlePage}>
        <View style={styles.kickerRow}>
          <View style={styles.kickerBar} />
          <Text style={styles.titleKicker}>SIPLOCAL FEATURE</Text>
        </View>
        <Text style={styles.bigTitle}>{article.title}</Text>
        {article.lede != null && (
          <Text style={styles.bigLede}>{article.lede}</Text>
        )}
        <View style={styles.bylineRow}>
          {article.author != null && (
            <Text style={styles.byline}>
              WORDS · {article.author.toUpperCase()}
            </Text>
          )}
          <Text style={styles.byline}>{article.publishDate}</Text>
        </View>
      </View>

      {/* ── Sections ────────────────────────────────────────────────────── */}
      <View style={styles.sectionStack}>
        {article.sections.map((section, i) => renderSection(section, i))}
      </View>

      {/* ── Closing rule ────────────────────────────────────────────────── */}
      <View style={styles.closeRule}>
        <View style={styles.closeBar} />
        <Text style={styles.closeMark}>FIN</Text>
        <View style={styles.closeBar} />
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const COLUMN = spacing.xxl; // 24

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 120,
  },

  // Hero
  hero: { height: 360 },
  heroImg: { flex: 1, justifyContent: "flex-start" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.photoChrome,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
    color: colors.textOnDark,
  },

  // Title page
  titlePage: {
    paddingHorizontal: COLUMN,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  kickerBar: {
    width: spacing.xxl,
    height: 1,
    backgroundColor: colors.accent,
  },
  titleKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 2.5,
  },
  bigTitle: {
    ...type.h1, // 36 italic Georgia
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  bigLede: {
    fontFamily: fonts.serif,
    fontSize: 18,
    fontStyle: "italic",
    fontWeight: weights.body,
    color: colors.textSecondary,
    lineHeight: 28,
    marginBottom: spacing.xl,
  },
  bylineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  byline: {
    ...type.kicker,
    color: colors.textMuted,
    letterSpacing: 1.6,
  },

  // Section stack
  sectionStack: {
    paddingTop: spacing.lg,
  },

  // Body
  bodyBlock: {
    paddingHorizontal: COLUMN,
    paddingVertical: spacing.lg,
  },
  bodyText: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 26,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },

  // Pull quote
  pullQuote: {
    paddingHorizontal: COLUMN,
    paddingVertical: spacing.xxxl,
    alignItems: "stretch",
    gap: spacing.xl,
  },
  pullRule: {
    width: 60,
    height: 1,
    backgroundColor: colors.accent,
    alignSelf: "center",
  },
  pullQuoteText: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.body,
    fontSize: 26,
    lineHeight: 36,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  pullQuoteAttr: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 1.8,
    textAlign: "center",
    marginTop: -spacing.md,
  },

  // Pull quote on top of a backdrop photo
  pullQuoteWithImg: {
    marginVertical: spacing.xl,
    width,
    height: 360,
  },
  pullQuoteImg: {
    flex: 1,
    justifyContent: "center",
  },
  pullQuoteImgInner: {
    paddingHorizontal: COLUMN,
    paddingVertical: spacing.xxxl,
    alignItems: "center",
  },
  pullQuoteTextOnImg: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.body,
    fontSize: 26,
    lineHeight: 36,
    color: colors.textOnDark,
    letterSpacing: -0.4,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  pullQuoteAttrOnImg: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 1.8,
    textAlign: "center",
  },

  // Galleries
  fullBleed: {
    width,
    height: 280,
    marginVertical: spacing.lg,
  },
  fullBleedImg: {
    width: "100%",
    height: "100%",
  },
  imgCaption: {
    ...type.caption,
    color: colors.textMuted,
    fontStyle: "italic",
    paddingHorizontal: COLUMN,
    paddingTop: spacing.sm,
  },
  twoUp: {
    flexDirection: "row",
    gap: 2,
    marginVertical: spacing.lg,
  },
  twoUpImg: {
    flex: 1,
    height: 200,
  },
  galleryStack: {
    gap: 0,
  },

  // Callout
  callout: {
    marginHorizontal: COLUMN,
    marginVertical: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  calloutKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.sm,
  },
  calloutText: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textPrimary,
    fontStyle: "italic",
  },

  // Closing
  closeRule: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.hero,
    paddingHorizontal: spacing.xxl,
  },
  closeBar: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  closeMark: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 3,
  },
});
