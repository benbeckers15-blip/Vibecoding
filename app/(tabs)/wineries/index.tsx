// app/(tabs)/wineries/index.tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
// Dark bg · glass search · gold chips · image cards · gold map markers

import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView from "react-native-map-clustering";
import { Callout, Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME_UPPER } from "../../../constants/region";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { useSaved } from "../../../context/SavedContext";
import { db } from "../../../firebaseConfig";

// ─── Types ────────────────────────────────────────────────────────────────────
type Winery = {
  id: string;
  name: string;
  slug: string;
  description?: string[];
  images?: string[];
  hours?: string;
  dogFriendly?: boolean;
  hasRestaurant?: boolean;
  hasWifi?: boolean;
  isOrganic?: boolean;
  isBiodynamic?: boolean;
  walkinWelcome?: boolean;
  rating?: number;
  userRatingsTotal?: number;
  latitude?: number;
  longitude?: number;
  featured?: boolean;
};

// ─── Filter config ────────────────────────────────────────────────────────────
const BOOLEAN_FILTERS: {
  key: keyof Winery;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "dogFriendly",   label: "Dog Friendly", icon: "paw"                },
  { key: "hasRestaurant", label: "Restaurant",   icon: "restaurant-outline" },
  { key: "isOrganic",     label: "Organic",      icon: "leaf-outline"       },
  { key: "isBiodynamic",  label: "Biodynamic",   icon: "flower-outline"     },
  { key: "walkinWelcome", label: "Walk-ins",      icon: "walk-outline"       },
];

const VALID_FILTER_KEYS: (keyof Winery)[] = [
  "dogFriendly",
  "hasRestaurant",
  "isOrganic",
  "isBiodynamic",
  "walkinWelcome",
];

const RATING_OPTIONS = [
  { label: "All", value: 0   },
  { label: "4.0+", value: 4.0 },
  { label: "4.3+", value: 4.3 },
  { label: "4.5+", value: 4.5 },
];

const TASMANIA_REGION = {
  latitude: -42.0,
  longitude: 147.0,
  latitudeDelta: 3.0,
  longitudeDelta: 2.0,
};

// ─── Haversine distance ───────────────────────────────────────────────────────
function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function WineriesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    search?: string;
    filter?: string;
    near?: string;
    lat?: string;
    lng?: string;
    t?: string;
  }>();
  const insets = useSafeAreaInsets();

  const { isSaved, toggle: toggleSaved } = useSaved();

  const [wineries, setWineries] = useState<Winery[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "map">("list");
  const [search, setSearch] = useState(() =>
    typeof params.search === "string" ? params.search : ""
  );
  const [activeFilters, setActiveFilters] = useState<Set<keyof Winery>>(() => {
    const set = new Set<keyof Winery>();
    if (
      typeof params.filter === "string" &&
      VALID_FILTER_KEYS.includes(params.filter as keyof Winery)
    ) {
      set.add(params.filter as keyof Winery);
    }
    return set;
  });
  const [minRating, setMinRating] = useState(0);

  // Sync URL params on focus (e.g. deep-linked from home screen chips)
  useFocusEffect(
    useCallback(() => {
      if (typeof params.search === "string") setSearch(params.search);
      if (
        typeof params.filter === "string" &&
        VALID_FILTER_KEYS.includes(params.filter as keyof Winery)
      ) {
        setActiveFilters(new Set([params.filter as keyof Winery]));
      }
    }, [params.search, params.filter, params.t])
  );

  // Fetch all wineries once
  useEffect(() => {
    (async () => {
      try {
        const snapshot = await getDocs(collection(db, "wineries"));
        const data = snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Winery, "id">) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setWineries(data);
      } catch (err) {
        console.error("Error fetching wineries:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleFilter = (key: keyof Winery) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Filter logic (unchanged from original)
  const filtered = wineries.filter((w) => {
    if (
      search.trim() &&
      !w.name?.toLowerCase().startsWith(search.trim().toLowerCase())
    ) {
      return false;
    }
    for (const key of activeFilters) {
      if (!w[key]) return false;
    }
    if (minRating > 0 && (!w.rating || w.rating < minRating)) return false;
    return true;
  });

  // Near-me sort
  const nearLat =
    typeof params.lat === "string" ? parseFloat(params.lat) : NaN;
  const nearLng =
    typeof params.lng === "string" ? parseFloat(params.lng) : NaN;
  const nearActive =
    params.near === "1" && !isNaN(nearLat) && !isNaN(nearLng);

  const displayed = nearActive
    ? [...filtered].sort((a, b) => {
        const aHas =
          typeof a.latitude === "number" && typeof a.longitude === "number";
        const bHas =
          typeof b.latitude === "number" && typeof b.longitude === "number";
        if (!aHas && !bHas) return 0;
        if (!aHas) return 1;
        if (!bHas) return -1;
        return (
          distanceKm(nearLat, nearLng, a.latitude!, a.longitude!) -
          distanceKm(nearLat, nearLng, b.latitude!, b.longitude!)
        );
      })
    : filtered;

  const mappableWineries = filtered.filter(
    (w) => typeof w.latitude === "number" && typeof w.longitude === "number"
  );

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading wineries…</Text>
      </View>
    );
  }

  // ── Winery card ────────────────────────────────────────────────────────────
  const renderCard = ({ item }: { item: Winery }) => {
    const hasImage = item.images && item.images.length > 0;
    return (
      <Link href={`/wineries/${item.slug}?from=wineries`} asChild>
        <Pressable style={styles.card}>
          {/* Hero image */}
          {hasImage && (
            <View style={styles.cardImgWrap}>
              <Image
                source={{ uri: item.images![0] }}
                style={styles.cardImg}
                resizeMode="cover"
              />
              {/* Partner badge */}
              {item.featured && (
                <View style={styles.partnerBadge}>
                  <Text style={styles.partnerText}>★ PARTNER</Text>
                </View>
              )}
              {/* Save / heart button */}
              <Pressable
                style={styles.heartBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  toggleSaved(item.id);
                }}
                hitSlop={8}
              >
                <Ionicons
                  name={isSaved(item.id) ? "heart" : "heart-outline"}
                  size={14}
                  color={isSaved(item.id) ? colors.error : colors.textOnDark}
                />
              </Pressable>
            </View>
          )}

          {/* Card body */}
          <View style={[styles.cardBody, !hasImage && styles.cardBodyAccent]}>
            <Text style={styles.cardRegion}>{REGION_NAME_UPPER}</Text>
            <Text style={styles.cardName}>{item.name}</Text>

            {item.description && item.description.length > 0 && (
              <Text style={styles.cardBlurb} numberOfLines={2}>
                {item.description[0]}
              </Text>
            )}

            <View style={styles.cardMeta}>
              {item.rating != null && (
                <Text style={styles.cardRating}>
                  ★ {item.rating.toFixed(1)}
                </Text>
              )}
              {item.rating != null && item.userRatingsTotal != null && (
                <Text style={styles.cardReviews}>
                  ({item.userRatingsTotal.toLocaleString()})
                </Text>
              )}
              {item.dogFriendly && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Dog OK</Text>
                </View>
              )}
              {item.hasRestaurant && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Restaurant</Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </Link>
    );
  };

  return (
    <View style={styles.container}>

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.headerKicker}>{REGION_NAME_UPPER}</Text>
        <Text style={styles.headerTitle}>Our Wineries</Text>
      </View>

      {/* ── Glass search bar ──────────────────────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons
            name="search"
            size={15}
            color={colors.textSecondary}
            style={{ marginRight: 10 }}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search wineries…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Boolean filter chips ──────────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        style={styles.chipsScroll}
      >
        {BOOLEAN_FILTERS.map(({ key, label, icon }) => {
          const active = activeFilters.has(key);
          return (
            <Pressable
              key={String(key)}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => toggleFilter(key)}
            >
              <View style={styles.chipInner}>
                <Ionicons
                  name={icon}
                  size={13}
                  color={active ? colors.background : colors.textSecondary}
                  style={styles.chipIcon}
                />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── Rating filter ─────────────────────────────────────────────────────── */}
      <View style={styles.ratingRow}>
        <Text style={styles.ratingLabel}>RATING</Text>
        {RATING_OPTIONS.map(({ label, value }) => (
          <Pressable
            key={value}
            style={[
              styles.ratingBtn,
              minRating === value && styles.ratingBtnActive,
            ]}
            onPress={() => setMinRating(minRating === value ? 0 : value)}
          >
            <Text
              style={[
                styles.ratingBtnText,
                minRating === value && styles.ratingBtnTextActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Results count + List/Map toggle ──────────────────────────────────── */}
      <View style={styles.resultsRow}>
        <View style={styles.resultsLeft}>
          <View style={styles.goldLine} />
          <Text style={styles.resultsCount}>
            {nearActive ? "NEAREST · " : ""}
            {displayed.length}{" "}
            {displayed.length === 1 ? "WINERY" : "WINERIES"}
          </Text>
        </View>
        <View style={styles.viewToggle}>
          <Pressable onPress={() => setView("list")}>
            <Text
              style={[
                styles.viewToggleText,
                view === "list" && styles.viewToggleActive,
              ]}
            >
              List
            </Text>
          </Pressable>
          <Text style={styles.viewToggleSep}>·</Text>
          <Pressable onPress={() => setView("map")}>
            <Text
              style={[
                styles.viewToggleText,
                view === "map" && styles.viewToggleActive,
              ]}
            >
              Map
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ── List ──────────────────────────────────────────────────────────────── */}
      {view === "list" && (
        <FlatList
          data={displayed}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          renderItem={renderCard}
          ItemSeparatorComponent={() => <View style={styles.cardSep} />}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyLabel}>NO RESULTS</Text>
              <Text style={styles.emptyText}>Try adjusting your filters.</Text>
            </View>
          )}
        />
      )}

      {/* ── Map ───────────────────────────────────────────────────────────────── */}
      {view === "map" && (
        <MapView
          style={styles.map}
          initialRegion={TASMANIA_REGION}
          showsUserLocation
          showsMyLocationButton
          clusterColor={colors.accent}
          clusterTextColor={colors.background}
          clusterFontFamily="Georgia"
          radius={40}
        >
          {mappableWineries.map((winery) => (
            <Marker
              key={winery.id}
              coordinate={{
                latitude: winery.latitude!,
                longitude: winery.longitude!,
              }}
              anchor={{ x: 0.5, y: 1 }}
            >
              <Image
                source={require("../../../assets/images/logo-pin.png")}
                style={styles.markerPin}
                resizeMode="contain"
              />
              <Callout
                tooltip
                onPress={() => router.push(`/wineries/${winery.slug}`)}
              >
                <View style={styles.callout}>
                  <Text style={styles.calloutName}>{winery.name}</Text>
                  {winery.rating != null && (
                    <Text style={styles.calloutRating}>
                      ★ {winery.rating.toFixed(1)}
                    </Text>
                  )}
                  <Text style={styles.calloutCta}>TAP TO VIEW ›</Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
    gap: 12,
  },
  loadingText: {
    ...type.kicker,
    fontSize: type.caption.fontSize,           // bumped 11 → 12 (caption token)
    letterSpacing: 2,
    color: colors.textMuted,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: spacing.xxl,           // already 24 — token-ised
    paddingBottom: spacing.lg,
  },
  headerKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  headerTitle: {
    ...type.h1,                               // 36 / italic / 400 / -0.5
    color: colors.textPrimary,
  },

  // ── Search ──────────────────────────────────────────────────────────────
  searchWrap: {
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24
    marginBottom: spacing.md,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    minHeight: spacing.hitTarget,             // 44pt floor
  },
  searchInput: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  // ── Chips ───────────────────────────────────────────────────────────────
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: spacing.md,
  },
  chipsRow: {
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24
    gap: spacing.sm,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: spacing.lg,            // bumped 14 → 16
    paddingVertical: 11,                      // bumped 7 → 11 (Fix 4)
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: spacing.hitTarget,             // 44pt floor (Apple HIG)
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  chipIcon: {
    marginRight: 5,
  },
  chipText: {
    ...type.caption,
    fontWeight: weights.body,
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  chipTextActive: {
    color: colors.background,
  },

  // ── Rating filter ────────────────────────────────────────────────────────
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  ratingLabel: {
    ...type.kicker,                           // bumped 9 → 10
    color: colors.textMuted,
    marginRight: spacing.xs,
  },
  ratingBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,                      // bumped 6 → 10 (toward 44pt)
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: spacing.hitTarget,             // 44pt floor
    justifyContent: "center",
  },
  ratingBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  ratingBtnText: {
    fontSize: type.caption.fontSize,           // bumped 11 → 12
    letterSpacing: 0.5,
    color: colors.textMuted,
    fontWeight: weights.body,
  },
  ratingBtnTextActive: {
    color: colors.background,
  },

  // ── Results row ──────────────────────────────────────────────────────────
  resultsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24
    marginBottom: spacing.lg,
  },
  resultsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  goldLine: {
    width: spacing.xl,
    height: 1,
    backgroundColor: colors.accent,
  },
  resultsCount: {
    ...type.kicker,
    color: colors.accentSoft,
  },
  viewToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  viewToggleText: {
    ...type.caption,
    fontWeight: weights.body,
    color: colors.textMuted,
  },
  viewToggleActive: {
    color: colors.accentSoft,
  },
  viewToggleSep: {
    fontSize: type.caption.fontSize,
    color: colors.border,
  },

  // ── Cards ────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24
    paddingBottom: 120,
  },
  card: {
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  cardSep: {
    height: spacing.lg,                       // bumped 14 → 16
  },
  cardImgWrap: {
    height: 160,
    position: "relative",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
  partnerBadge: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 2,
  },
  partnerText: {
    ...type.kicker,                           // bumped 9 → 10 (kicker minimum)
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.background,
    fontWeight: weights.emphasis,
  },
  heartBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: spacing.hitTarget,                 // 44pt — Apple HIG
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.photoChromeAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: spacing.xl,                      // card body padding 20 (Fix 3)
  },
  // Applied when there's no image — adds left forest accent
  cardBodyAccent: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.lg,
  },
  cardRegion: {
    ...type.kicker,                           // bumped 9 → 10
    letterSpacing: 1.8,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  cardName: {
    ...type.h3,                               // 22 / bold / Georgia
    color: colors.textPrimary,
  },
  cardBlurb: {
    ...type.caption,                          // 12 / 16 line-height
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cardRating: {
    ...type.caption,
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
  },
  cardReviews: {
    ...type.caption,
    color: colors.textMuted,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    ...type.kicker,
    letterSpacing: 1,
    color: colors.textMuted,
  },

  // ── Empty state ──────────────────────────────────────────────────────────
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: spacing.sm,
  },
  emptyLabel: {
    ...type.kicker,
    letterSpacing: 3,
    color: colors.textMuted,
  },
  emptyText: {
    ...type.body,
    color: colors.textMuted,
  },

  // ── Map ──────────────────────────────────────────────────────────────────
  map: {
    flex: 1,
    width: "100%",
  },
  markerPin: {
    width: 36,
    height: 42,
  },
  callout: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 160,
    alignItems: "center",
  },
  calloutName: {
    fontFamily: fonts.serif,
    fontSize: type.body.fontSize,             // 13 → 14 (body)
    color: colors.textPrimary,
    marginBottom: 3,
    textAlign: "center",
  },
  calloutRating: {
    ...type.caption,
    color: colors.accent,
    fontWeight: weights.emphasis,
    marginBottom: spacing.xs,
  },
  calloutCta: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.textMuted,
  },
});
