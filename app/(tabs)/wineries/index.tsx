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
import { colors, fonts } from "../../../constants/theme";
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
const BOOLEAN_FILTERS: { key: keyof Winery; label: string }[] = [
  { key: "dogFriendly",   label: "Dog Friendly" },
  { key: "hasRestaurant", label: "Restaurant"   },
  { key: "isOrganic",     label: "Organic"      },
  { key: "isBiodynamic",  label: "Biodynamic"   },
  { key: "walkinWelcome", label: "Walk-ins"      },
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
              {/* Bookmark button */}
              <View style={styles.bookmarkBtn}>
                <Ionicons name="bookmark-outline" size={13} color={colors.textOnDark} />
              </View>
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
        {BOOLEAN_FILTERS.map(({ key, label }) => {
          const active = activeFilters.has(key);
          return (
            <Pressable
              key={String(key)}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => toggleFilter(key)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {label}
              </Text>
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
              pinColor={colors.accent}
            >
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
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.textMuted,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  headerKicker: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.accentSoft,
    marginBottom: 6,
  },
  headerTitle: {
    fontFamily: "Georgia",
    fontSize: 32,
    fontStyle: "italic",
    fontWeight: "400",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },

  // ── Search ──────────────────────────────────────────────────────────────
  searchWrap: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  // ── Chips ───────────────────────────────────────────────────────────────
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 12,
  },
  chipsRow: {
    paddingHorizontal: 20,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "500",
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
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 14,
  },
  ratingLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.textMuted,
    marginRight: 4,
  },
  ratingBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ratingBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  ratingBtnText: {
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.textMuted,
    fontWeight: "500",
  },
  ratingBtnTextActive: {
    color: colors.background,
  },

  // ── Results row ──────────────────────────────────────────────────────────
  resultsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  resultsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  goldLine: {
    width: 20,
    height: 1,
    backgroundColor: colors.accent,
  },
  resultsCount: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.accentSoft,
  },
  viewToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  viewToggleText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.textMuted,
  },
  viewToggleActive: {
    color: colors.accentSoft,
  },
  viewToggleSep: {
    fontSize: 12,
    color: colors.border,
  },

  // ── Cards ────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  card: {
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  cardSep: {
    height: 14,
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
    top: 12,
    left: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
  },
  partnerText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.background,
    fontWeight: "700",
  },
  bookmarkBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.photoChromeAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: 16,
  },
  // Applied when there's no image — adds left gold accent
  cardBodyAccent: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 14,
  },
  cardRegion: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.textMuted,
    marginBottom: 4,
  },
  cardName: {
    fontFamily: "Georgia",
    fontSize: 21,
    fontWeight: "500",
    color: colors.textPrimary,
    lineHeight: 25,
    letterSpacing: -0.2,
  },
  cardBlurb: {
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 6,
    lineHeight: 18,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  cardRating: {
    fontSize: 12,
    color: colors.accentSoft,
    fontWeight: "600",
  },
  cardReviews: {
    fontSize: 11,
    color: colors.textMuted,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.textMuted,
  },

  // ── Empty state ──────────────────────────────────────────────────────────
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 8,
  },
  emptyLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 3,
    color: colors.textMuted,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
  },

  // ── Map ──────────────────────────────────────────────────────────────────
  map: {
    flex: 1,
    width: "100%",
  },
  callout: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 160,
    alignItems: "center",
  },
  calloutName: {
    fontFamily: "Georgia",
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 3,
    textAlign: "center",
  },
  calloutRating: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: "600",
    marginBottom: 5,
  },
  calloutCta: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.textMuted,
  },
});
