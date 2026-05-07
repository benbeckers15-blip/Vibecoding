// components/articles/InterviewLayout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Interview layout — Q&A transcript. Hero introduces the subject; body
// sections render as preamble; the `article.qa` array renders as a clearly
// marked back-and-forth (Q · question in italic / A · answer upright).
// Use this for "Behind the Cellar Door" — winemaker conversations.
// ─────────────────────────────────────────────────────────────────────────────

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
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
import type { Article, ArticleSection } from "./types";

interface Props {
  article: Article;
}

export default function InterviewLayout({ article }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleShare = async (): Promise<void> => {
    try {
      await Share.share({
        message: `In conversation with ${article.subject ?? article.title} — SipLocal`,
      });
    } catch {
      /* swallow */
    }
  };

  const renderSection = (section: ArticleSection, index: number) => {
    switch (section.type) {
      case "body": {
        const paragraphs = Array.isArray(section.content)
          ? section.content
          : [section.content];
        return (
          <View key={index} style={styles.preambleBlock}>
            {paragraphs.map((para, i) => (
              <Text key={i} style={styles.preambleText}>
                {para}
              </Text>
            ))}
          </View>
        );
      }

      case "pullQuote": {
        const text = Array.isArray(section.content)
          ? section.content.join(" ")
          : section.content;
        return (
          <View key={index} style={styles.pullQuote}>
            <Text style={styles.pullQuoteText}>&ldquo;{text}&rdquo;</Text>
            {article.subject != null && (
              <Text style={styles.pullQuoteAttr}>{article.subject}</Text>
            )}
          </View>
        );
      }

      case "imageGallery": {
        const urls = Array.isArray(section.content)
          ? section.content
          : [section.content];
        return (
          <View key={index} style={styles.imageRow}>
            {urls.map((url, i) => (
              <Image
                key={i}
                source={{ uri: url }}
                style={styles.imageRowImg}
                resizeMode="cover"
              />
            ))}
          </View>
        );
      }

      case "callout": {
        const text = Array.isArray(section.content)
          ? section.content.join(" ")
          : section.content;
        return (
          <View key={index} style={styles.callout}>
            <Text style={styles.calloutKicker}>BIO</Text>
            <Text style={styles.calloutText}>{text}</Text>
          </View>
        );
      }

      case "qa": {
        // The qa section type is an intro/heading for the transcript itself.
        const heading = Array.isArray(section.content)
          ? section.content.join(" ")
          : section.content;
        return (
          <View key={index} style={styles.transcriptIntro}>
            <View style={styles.transcriptRule} />
            <Text style={styles.transcriptKicker}>{heading}</Text>
            <View style={styles.transcriptRule} />
          </View>
        );
      }

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
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={[styles.headerRow, { paddingTop: insets.top + 10 }]}>
            <Pressable style={styles.iconBtn} onPress={() => router.back()}>
              <Ionicons
                name="chevron-back"
                size={16}
                color={colors.textOnDark}
              />
            </Pressable>
            <Text style={styles.headerKicker}>INTERVIEW</Text>
            <Pressable style={styles.iconBtn} onPress={handleShare}>
              <Ionicons
                name="share-outline"
                size={15}
                color={colors.textOnDark}
              />
            </Pressable>
          </View>

          <View style={styles.heroCopy}>
            <Text style={styles.heroKicker}>IN CONVERSATION WITH</Text>
            <Text style={styles.heroSubject}>
              {article.subject ?? article.title}
            </Text>
          </View>
        </ImageBackground>
      </View>

      {/* ── Title / framing ─────────────────────────────────────────────── */}
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{article.title}</Text>
        {article.lede != null && (
          <Text style={styles.lede}>{article.lede}</Text>
        )}
        <View style={styles.bylineRow}>
          {article.author != null && (
            <Text style={styles.byline}>
              INTERVIEW BY {article.author.toUpperCase()}
            </Text>
          )}
          <Text style={styles.byline}>{article.publishDate}</Text>
        </View>
      </View>

      {/* ── Preamble + transcript intro from sections ───────────────────── */}
      <View style={styles.sectionStack}>
        {article.sections.map((section, i) => renderSection(section, i))}
      </View>

      {/* ── Q&A pairs ───────────────────────────────────────────────────── */}
      {article.qa != null && article.qa.length > 0 && (
        <View style={styles.qaList}>
          {article.qa.map((pair, i) => (
            <View key={i} style={[styles.qaPair, i === 0 && styles.qaPairFirst]}>
              <View style={styles.qaRow}>
                <Text style={styles.qMark}>Q.</Text>
                <Text style={styles.qText}>{pair.question}</Text>
              </View>
              <View style={styles.qaRow}>
                <Text style={styles.aMark}>A.</Text>
                <Text style={styles.aText}>{pair.answer}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <View style={styles.footerRule}>
        <View style={styles.footerLine} />
        <Text style={styles.footerMark}>
          {article.subject != null
            ? `· ${article.subject.toUpperCase()} ·`
            : "· END ·"}
        </Text>
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
  hero: { height: 460 },
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
  heroKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 2.5,
    marginBottom: spacing.md,
  },
  heroSubject: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.body,
    fontSize: 40,
    lineHeight: 46,
    color: colors.textOnDark,
    letterSpacing: -0.5,
  },

  // Title block
  titleBlock: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 22,
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
    lineHeight: 30,
    letterSpacing: -0.3,
    marginBottom: spacing.md,
  },
  lede: {
    ...type.lede,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  bylineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: spacing.md,
  },
  byline: {
    ...type.kicker,
    color: colors.textMuted,
    letterSpacing: 1.6,
  },

  // Sections
  sectionStack: {
    paddingTop: spacing.xl,
  },

  preambleBlock: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  preambleText: {
    fontFamily: fonts.serif,
    fontSize: 16,
    fontStyle: "italic",
    lineHeight: 26,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  // Pull quote (between sections)
  pullQuote: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
    alignItems: "center",
  },
  pullQuoteText: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.body,
    fontSize: 24,
    lineHeight: 34,
    color: colors.textPrimary,
    textAlign: "center",
    letterSpacing: -0.3,
    marginBottom: spacing.lg,
  },
  pullQuoteAttr: {
    ...type.kicker,
    color: colors.accentSoft,
    letterSpacing: 1.8,
  },

  imageRow: {
    flexDirection: "row",
    gap: 2,
    marginVertical: spacing.lg,
  },
  imageRowImg: {
    flex: 1,
    height: 220,
  },

  callout: {
    marginHorizontal: spacing.xxl,
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
    fontSize: 14,
    lineHeight: 22,
    color: colors.textPrimary,
  },

  // Transcript intro divider
  transcriptIntro: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
  },
  transcriptRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  transcriptKicker: {
    ...type.kicker,
    color: colors.accent,
    letterSpacing: 2.5,
  },

  // Q&A
  qaList: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
  },
  qaPair: {
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.lg,
  },
  qaPairFirst: {
    borderTopWidth: 0,
    paddingTop: spacing.md,
  },
  qaRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  qMark: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontWeight: weights.emphasis,
    fontSize: 18,
    lineHeight: 26,
    color: colors.accentSoft,
    width: 22,
  },
  qText: {
    flex: 1,
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 17,
    lineHeight: 26,
    color: colors.textPrimary,
    fontWeight: weights.emphasis,
    letterSpacing: -0.2,
  },
  aMark: {
    fontFamily: fonts.serif,
    fontWeight: weights.emphasis,
    fontSize: 18,
    lineHeight: 26,
    color: colors.accent,
    width: 22,
  },
  aText: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 26,
    color: colors.textSecondary,
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
