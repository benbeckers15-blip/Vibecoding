// components/HomeCover.tsx
//
// The opening "primer" screen of the home tab — a full-frame photo with the
// region title. Instead of a scroll cue, the reader slides a finger to the
// left and the page curls/folds away like turning a magazine page, revealing
// the home content page beneath.
//
// Page-curl mechanism (no native graphics deps):
//   The cover is split into two pieces driven by a 0→1 `progress` value:
//     • a FLAT panel showing the left part of the cover, [0 .. foldX], where
//       foldX = W·(1−progress) is the fold line travelling leftward; and
//     • a FOLDED FLAP — the strip to the right of the fold line, mirrored and
//       laid back over the flat panel (like grabbing the right edge and
//       folding the sheet across itself). Curved shading on the flap fakes the
//       bend of paper catching light; a crease shadow seats it on the page.
//   The area the flap vacates on the right reveals the content page beneath.
//   Releasing past the threshold (or with a leftward fling) springs the fold
//   the rest of the way and calls `onOpened()`; otherwise it springs flat.

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRegionConfig } from "../context/RegionContext";
import { colors, fonts, spacing, type, weights } from "../constants/theme";
import { db } from "../firebaseConfig";

const SCREEN_W = Dimensions.get("window").width;
const SCREEN_H = Dimensions.get("window").height;

const HERO_FALLBACK =
  "https://images.unsplash.com/photo-1734517648070-2e8d4ed686ac?q=80&w=1035&auto=format&fit=crop";

// How far (as a fraction of screen width) the reader must drag before the
// release commits to turning the page rather than springing flat.
const OPEN_THRESHOLD = 0.3;

type Props = {
  // Called once the page-turn animation finishes — dismisses the cover.
  onOpened: () => void;
};

export default function HomeCover({ onOpened }: Props) {
  const insets = useSafeAreaInsets();
  const region = useRegionConfig();

  // Hero photo + crop anchor, fetched from config/homepage so it can be
  // re-positioned without an app-store release (same source the old hero used).
  const [heroImageUrl, setHeroImageUrl] = useState<string>(HERO_FALLBACK);
  const [heroImagePosition, setHeroImagePosition] = useState<{
    top: string;
    left: string;
  }>({ top: "70%", left: "50%" });
  const [heroImageZoom, setHeroImageZoom] = useState<number>(1);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "config", "homepage"));
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.heroImageUrl) setHeroImageUrl(data.heroImageUrl as string);
        const x = data.heroImagePositionX;
        const y = data.heroImagePositionY;
        if (typeof x === "string" || typeof y === "string") {
          setHeroImagePosition({
            top: typeof y === "string" ? y : "50%",
            left: typeof x === "string" ? x : "50%",
          });
        }
        const z = data.heroImageZoom;
        if (typeof z === "number" && Number.isFinite(z)) {
          setHeroImageZoom(Math.min(Math.max(z, 1), 4));
        }
      } catch {}
    })();
  }, []);

  // 0 = closed (cover flat), 1 = fully turned.
  const progress = useSharedValue(0);

  const pan = Gesture.Pan()
    // Only take over once there's clear horizontal intent.
    .activeOffsetX([-14, 14])
    .failOffsetY([-22, 22])
    .onUpdate((e) => {
      // Drag to the left (negative translationX) curls the page back.
      progress.value = Math.min(Math.max(-e.translationX / SCREEN_W, 0), 1);
    })
    .onEnd((e) => {
      const shouldOpen = progress.value > OPEN_THRESHOLD || e.velocityX < -800;
      // Carry the fling's momentum into the spring so the page keeps the
      // reader's velocity — paper continuing its arc, not a motorised hinge.
      const velocity = -e.velocityX / SCREEN_W;
      if (shouldOpen) {
        progress.value = withSpring(
          1,
          { velocity, damping: 16, stiffness: 90, mass: 0.9 },
          (finished) => {
            if (finished) runOnJS(onOpened)();
          }
        );
      } else {
        progress.value = withSpring(0, {
          velocity,
          damping: 18,
          stiffness: 130,
          mass: 0.8,
        });
      }
    });

  // ── Animated geometry ─────────────────────────────────────────────────────
  // Flat panel: shows cover columns [0 .. foldX]; its width shrinks as the
  // fold line travels left.
  const flatStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [SCREEN_W, 0], Extrapolation.CLAMP),
  }));

  // Crease shadow pinned to the right edge of the flat panel — the flap casts
  // a shadow onto the page along the fold, deepening as the fold tightens.
  const creaseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.08, 1], [0, 0.5, 0.8], Extrapolation.CLAMP),
  }));

  // Folded flap window: spans [foldX − flapW .. foldX] where flapW = progress·W.
  // left = W·(1 − 2·progress) carries it from off-right to off-left.
  const flapStyle = useAnimatedStyle(() => ({
    left: interpolate(progress.value, [0, 1], [SCREEN_W, -SCREEN_W], Extrapolation.CLAMP),
    width: interpolate(progress.value, [0, 1], [0, SCREEN_W], Extrapolation.CLAMP),
  }));

  // Slide-to-open cue: an arrow that nudges left on a gentle loop, fading as
  // soon as the drag begins.
  const cue = useSharedValue(0);
  useEffect(() => {
    cue.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 850, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [cue]);
  const cueStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(cue.value, [0, 1], [0, -10]) }],
    opacity: interpolate(progress.value, [0, 0.2], [1, 0], Extrapolation.CLAMP),
  }));

  // The full cover artwork, sized to the whole screen. Rendered inside both
  // the flat panel and the (mirrored) flap, each clipping to its own window so
  // the photo and title line up across the fold seam.
  const renderFace = () => (
    <View style={styles.face}>
      <Image
        source={{ uri: heroImageUrl }}
        style={{
          width: "100%",
          height: "100%",
          opacity: 0.96,
          transform: [{ scale: heroImageZoom }],
          transformOrigin: `${heroImagePosition.left} ${heroImagePosition.top}`,
        }}
        contentFit="cover"
        contentPosition={heroImagePosition}
        transition={200}
      />
      <LinearGradient
        colors={["rgba(0,0,0,0.68)", "rgba(0,0,0,0)"]}
        style={styles.topGradient}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.82)"]}
        style={styles.bottomGradient}
        pointerEvents="none"
      />
      <View
        style={[styles.header, { paddingTop: insets.top + spacing.xxxl * 2 }]}
        pointerEvents="none"
      >
        <Text style={styles.title}>{region.displayNameUpper}</Text>
        <View style={styles.titleDivider} />
        <Text style={styles.subtitle}>WELCOME TO WINE COUNTRY</Text>
      </View>
      <Animated.View style={[styles.cue, cueStyle]} pointerEvents="none">
        <View style={styles.cueArrow}>
          <Ionicons name="chevron-forward" size={20} color={colors.textOnDark} />
        </View>
        <Text style={styles.cueLabel}>SLIDE TO OPEN</Text>
      </Animated.View>
    </View>
  );

  return (
    <GestureDetector gesture={pan}>
      {/* Transparent full-screen gesture surface. Only the panels paint, so
          wherever the flap has folded away the content page shows through. */}
      <View style={styles.root}>
        {/* Flat (unfolded) part of the page */}
        <Animated.View style={[styles.flat, flatStyle]}>
          {renderFace()}
          {/* Crease shadow along the fold line (right edge of the flat panel) */}
          <Animated.View style={[styles.crease, creaseStyle]} pointerEvents="none">
            <LinearGradient
              colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </Animated.View>

        {/* Folded-back flap — the blank back of the page. Filled with the app
            background color (matching the content page beneath) rather than a
            reflection of the cover, so it reads as the plain reverse of the
            sheet folding across itself. */}
        <Animated.View style={[styles.flap, flapStyle]}>
          {/* Curved-paper shading across the flap: a soft sheen near the
              outer fold edge (left) easing to a deep shadow at the crease
              (right) — this is what makes the strip look bent rather than
              flat-folded. */}
          <LinearGradient
            colors={[
              "rgba(255,255,255,0.06)", // light catching the bend (outer edge)
              "rgba(0,0,0,0.10)",
              "rgba(0,0,0,0.28)",
              "rgba(0,0,0,0.55)",       // deep shadow into the crease
            ]}
            locations={[0, 0.4, 0.75, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: "transparent",
    zIndex: 50,
  },
  // Flat panel: pinned to the left, clips the cover to [0 .. foldX].
  flat: {
    position: "absolute",
    top: 0,
    left: 0,
    height: SCREEN_H,
    overflow: "hidden",
    backgroundColor: colors.surfaceDeep,
  },
  // Folded flap window: the blank reverse of the page, a warm paper white so
  // it reads as the back of a printed magazine cover.
  flap: {
    position: "absolute",
    top: 0,
    height: SCREEN_H,
    overflow: "hidden",
    backgroundColor: "#F4EFE6",
  },
  // Full-screen artwork; placed at the window's left so each window shows its
  // slice of the same layout (seam alignment).
  face: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  // Narrow shadow strip seated at the fold line on the flat panel.
  crease: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 48,
  },
  topGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: Math.round(SCREEN_H * 0.28),
  },
  bottomGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: Math.round(SCREEN_H * 0.34),
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 76,
    lineHeight: 76,
    color: colors.textOnDark,
    letterSpacing: 2,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 12,
  },
  titleDivider: {
    width: 56,
    height: 1,
    backgroundColor: colors.textOnDark,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  subtitle: {
    fontFamily: fonts.sansBold,
    fontSize: type.body.fontSize,
    letterSpacing: 5,
    color: colors.textOnDark,
    textAlign: "center",
    marginTop: spacing.xs,
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cue: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 90,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  cueArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.textOnDark,
    backgroundColor: colors.photoChrome,
    alignItems: "center",
    justifyContent: "center",
  },
  cueLabel: {
    ...type.kicker,
    fontSize: 13,
    fontWeight: weights.emphasis,
    letterSpacing: 3,
    color: colors.textOnDark,
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
