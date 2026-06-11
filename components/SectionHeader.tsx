// components/SectionHeader.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Shared editorial section header — the masthead pattern used across the home
// screen's sections (Featured, The Pour, The Library) so spacing and type are
// defined once.
//
// Pattern: a small lime uppercase eyebrow over a Playfair serif title, with a
// short forest tick beneath. An optional right-aligned `meta` string (e.g.
// "6 STORIES") sits on the title row for sections that are countable lists.
// ─────────────────────────────────────────────────────────────────────────────

import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { colors, fonts, spacing, type } from "../constants/theme";

interface SectionHeaderProps {
  /** Small uppercase kicker above the title (e.g. "EDITORIAL"). */
  eyebrow: string;
  /** Serif section title in mixed case (e.g. "The Library"). */
  title: string;
  /** Optional right-aligned meta on the title row (e.g. "6 STORIES"). */
  meta?: string;
  /** Container override — used to inset sections that aren't already padded. */
  style?: StyleProp<ViewStyle>;
}

export default function SectionHeader({
  eyebrow,
  title,
  meta,
  style,
}: SectionHeaderProps) {
  return (
    <View style={[styles.root, style]}>
      <View style={styles.titleRow}>
        <View style={styles.titleCol}>
          <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        {meta ? <Text style={styles.meta}>{meta.toUpperCase()}</Text> : null}
      </View>
      <View style={styles.tick} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginBottom: spacing.lg,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  titleCol: {
    flex: 1,
  },
  eyebrow: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: 6,
  },
  title: {
    fontFamily: fonts.serif, // Playfair Display 700
    fontSize: 27,
    lineHeight: 30,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  meta: {
    ...type.kicker,
    letterSpacing: 1.5,
    color: colors.textMuted,
    marginLeft: spacing.md,
    paddingBottom: 4,
  },
  tick: {
    width: 34,
    height: 2,
    backgroundColor: colors.accent,
    marginTop: spacing.md,
  },
});
