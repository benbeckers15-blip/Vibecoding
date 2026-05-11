// app/(tabs)/wineries/index.tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
// Dark bg · glass search · gold chips · image cards · gold map markers

import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import { Image } from "expo-image";
import MapView from "react-native-map-clustering";
import { Callout, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAP_STYLE } from "../../../constants/mapStyle";
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
  awardWinning?: boolean;
  hasTours?: boolean;
  rating?: number;
  userRatingsTotal?: number;
  latitude?: number;
  longitude?: number;
  featured?: boolean;
  region?: string;
};

type SortMode = "featured" | "nearMe" | "az";

// ─── Filter config ────────────────────────────────────────────────────────────
const BOOLEAN_FILTERS: {
  key: keyof Winery;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "walkinWelcome", label: "Walk-ins",      icon: "walk-outline"       },
  { key: "awardWinning",  label: "Award-Winning", icon: "trophy-outline"     },
  { key: "hasTours",      label: "Tours Offered", icon: "map-outline"        },
  { key: "isOrganic",     label: "Organic",       icon: "leaf-outline"       },
  { key: "isBiodynamic",  label: "Biodynamic",    icon: "flower-outline"     },
  { key: "hasRestaurant", label: "Restaurant",    icon: "restaurant-outline" },
  { key: "dogFriendly",   label: "Dog Friendly",  icon: "paw"                },
];

const VALID_FILTER_KEYS: (keyof Winery)[] = [
  "dogFriendly",
  "hasRestaurant",
  "isOrganic",
  "isBiodynamic",
  "walkinWelcome",
  "awardWinning",
  "hasTours",
];

const RATING_OPTIONS = [
  { label: "All",  value: 0   },
  { label: "4.0+", value: 4.0 },
  { label: "4.3+", value: 4.3 },
  { label: "4.5+", value: 4.5 },
];

const REGION_OPTIONS: string[] = [
  "Tamar Valley",
  "Pipers River",
  "North West",
  "East Coast",
  "Coal River Valley",
  "Derwent Valley",
  "Huon Valley",
];

// Tasmania extents (approx):
//   lat   -40.6 (north)  →  -43.65 (south)   span ~3.05°
//   lng  144.6 (west)    →  148.4  (east)    span ~3.8°
// We center slightly south of the geographic mid-point and use generous
// deltas so the whole island fits with breathing room on every aspect ratio.
const TASMANIA_REGION = {
  latitude: -42.2,
  longitude: 146.8,
  latitudeDelta: 5.0,
  longitudeDelta: 4.5,
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
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortMode>("featured");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersAnim = useRef(new Animated.Value(0)).current;
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  // Animate the collapsible filter panel open/closed
  useEffect(() => {
    Animated.timing(filtersAnim, {
      toValue: filtersOpen ? 1 : 0,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [filtersOpen, filtersAnim]);

  // Request location — called when the user selects "Near Me" sort
  const ensureUserLocation = useCallback(async () => {
    if (userLocation || locationDenied) return;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLocationDenied(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
    } catch {
      setLocationDenied(true);
    }
  }, [userLocation, locationDenied]);

  // Handle sort mode changes — requests location when "Near Me" is selected
  const handleSortBy = useCallback(
    (mode: SortMode) => {
      setSortBy(mode);
      if (mode === "nearMe") {
        ensureUserLocation();
      }
    },
    [ensureUserLocation]
  );

  // ── Map transition ────────────────────────────────────────────────────────
  const computedMapKey = `map-${minRating}-${[...activeFilters].sort().join(",")}-${[...selectedRegions].sort().join(",")}`;
  const [activeMapKey, setActiveMapKey] = useState(computedMapKey);
  const activeMapKeyRef = useRef(computedMapKey);
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (computedMapKey === activeMapKeyRef.current) return;
    if (view !== "map") {
      activeMapKeyRef.current = computedMapKey;
      setActiveMapKey(computedMapKey);
      return;
    }
    Animated.timing(overlayAnim, { toValue: 1, duration: 120, useNativeDriver: true }).start(() => {
      activeMapKeyRef.current = computedMapKey;
      setActiveMapKey(computedMapKey);
      Animated.timing(overlayAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  }, [computedMapKey, view]);

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

        // Demo: if no winery in Firestore has featured:true yet, mark the
        // first alphabetical one so the Featured sort is demonstrable.
        // Remove this block once you've set featured:true on the correct
        // winery document(s) in Firestore.
        if (data.length > 0 && !data.some((w) => w.featured)) {
          data[0] = { ...data[0], featured: true };
        }

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

  const toggleRegion = (region: string) => {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      next.has(region) ? next.delete(region) : next.add(region);
      return next;
    });
  };

  // Resolve reference location for Near Me sort
  const paramLat =
    typeof params.lat === "string" ? parseFloat(params.lat) : NaN;
  const paramLng =
    typeof params.lng === "string" ? parseFloat(params.lng) : NaN;
  const hasParamLoc =
    params.near === "1" && !isNaN(paramLat) && !isNaN(paramLng);
  const refLat = hasParamLoc ? paramLat : userLocation?.lat ?? NaN;
  const refLng = hasParamLoc ? paramLng : userLocation?.lng ?? NaN;
  const hasRefLoc = !isNaN(refLat) && !isNaN(refLng);

  const nearActive = sortBy === "nearMe";

  // Filter logic
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
    if (selectedRegions.size > 0) {
      if (!w.region || !selectedRegions.has(w.region)) return false;
    }
    return true;
  });

  // Sort logic based on sortBy mode
  const displayed = (() => {
    const list = [...filtered];
    if (sortBy === "featured") {
      // Featured wineries first (alphabetical within group), then rest alphabetically
      return list.sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return a.name.localeCompare(b.name);
      });
    } else if (sortBy === "nearMe" && hasRefLoc) {
      return list.sort((a, b) => {
        // Number.isFinite — `typeof NaN === "number"` is true, so the looser
        // check would let NaN-coord wineries (from failed geocoding) through
        // and produce a NaN distance, which sorts unpredictably.
        const aHas =
          Number.isFinite(a.latitude) && Number.isFinite(a.longitude);
        const bHas =
          Number.isFinite(b.latitude) && Number.isFinite(b.longitude);
        if (!aHas && !bHas) return 0;
        if (!aHas) return 1;
        if (!bHas) return -1;
        return (
          distanceKm(refLat, refLng, a.latitude!, a.longitude!) -
          distanceKm(refLat, refLng, b.latitude!, b.longitude!)
        );
      });
    } else {
      // "az" or nearMe without location — pure alphabetical
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
  })();

  const mappableWineries = filtered.filter(
    (w) => Number.isFinite(w.latitude) && Number.isFinite(w.longitude)
  );

  // Count active filters for the badge on the filter button
  const activeFilterCount =
    activeFilters.size +
    selectedRegions.size +
    (minRating > 0 ? 1 : 0);

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

    // Distance chip — only when Near Me is active AND winery has finite coords.
    // `typeof NaN === "number"` is true, so the looser check here would render
    // a "NaN km" distance chip on any winery whose lat/lng was stored as NaN.
    const showDistance =
      nearActive &&
      hasRefLoc &&
      Number.isFinite(item.latitude) &&
      Number.isFinite(item.longitude);
    const distance = showDistance
      ? distanceKm(refLat, refLng, item.latitude as number, item.longitude as number)
      : null;
    const distanceLabel =
      distance == null
        ? null
        : distance < 10
        ? `${distance.toFixed(1)} km`
        : `${Math.round(distance)} km`;

    // Feature pills — all boolean attributes that are true on this winery
    const featurePills = BOOLEAN_FILTERS.filter((f) => Boolean(item[f.key]));

    return (
      <View style={styles.cardShadow}>
        <Link href={`/wineries/${item.slug}?from=wineries`} asChild>
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            {/* Hero image */}
            {hasImage && (
              <View style={styles.cardImgWrap}>
                <Image
                  source={{ uri: item.images![0] }}
                  style={styles.cardImg}
                  contentFit="cover"
                  transition={150}
                />
                {/* Featured badge overlay */}
                {item.featured && (
                  <View style={styles.featuredBadge}>
                    <View style={styles.featuredDot} />
                    <Text style={styles.featuredBadgeText}>FEATURED</Text>
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
              {/* Featured chip in card body (for cards without an image) */}
              {item.featured && !hasImage && (
                <View style={styles.featuredChip}>
                  <View style={styles.featuredDot} />
                  <Text style={styles.featuredChipText}>FEATURED</Text>
                </View>
              )}

              <Text style={styles.cardRegion}>{REGION_NAME_UPPER}</Text>
              <Text style={styles.cardName} numberOfLines={2}>
                {item.name}
              </Text>

              {item.description && item.description.length > 0 && (
                <Text style={styles.cardBlurb} numberOfLines={2}>
                  {item.description[0]}
                </Text>
              )}

              {/* Rating + distance row */}
              {(item.rating != null || distanceLabel) && (
                <View style={styles.cardMeta}>
                  {item.rating != null && (
                    <View style={styles.metaItem}>
                      <Ionicons name="star" size={11} color={colors.accentSoft} />
                      <Text style={styles.cardRating}>
                        {item.rating.toFixed(1)}
                      </Text>
                      {item.userRatingsTotal != null && (
                        <Text style={styles.cardReviews}>
                          ({item.userRatingsTotal.toLocaleString()})
                        </Text>
                      )}
                    </View>
                  )}
                  {item.rating != null && distanceLabel && (
                    <View style={styles.metaDot} />
                  )}
                  {distanceLabel && (
                    <View style={styles.metaItem}>
                      <Ionicons name="location" size={11} color={colors.accent} />
                      <Text style={styles.distanceText}>{distanceLabel}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Feature pills — all booleans true on this winery */}
              {featurePills.length > 0 && (
                <View style={styles.featurePillsRow}>
                  {featurePills.map(({ key, label, icon }) => (
                    <View key={String(key)} style={styles.featurePill}>
                      <Ionicons
                        name={icon}
                        size={10}
                        color={colors.textSecondary}
                        style={styles.featurePillIcon}
                      />
                      <Text style={styles.featurePillText}>{label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </Pressable>
        </Link>
      </View>
    );
  };

  // Results count + List/Map toggle. Hoisted out of the conditional view
  // branches so TypeScript doesn't narrow `view` to a single literal inside
  // them — and so we don't duplicate this JSX between the list and map paths.
  const resultsRow = (
    <View style={styles.resultsRow}>
      <View style={styles.resultsLeft}>
        <View style={styles.goldLine} />
        <Text style={styles.resultsCount}>
          {nearActive && hasRefLoc ? "NEAREST · " : ""}
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
  );

  return (
    <View style={styles.container}>

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.headerKicker}>{REGION_NAME_UPPER}</Text>
        <Text style={styles.headerTitle}>Our Wineries</Text>
      </View>

      {/* ── Glass search bar + filter button ──────────────────────────────────── */}
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
            <Pressable onPress={() => setSearch("")} style={{ marginRight: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
          <Pressable
            onPress={() => setFiltersOpen((v) => !v)}
            style={[styles.filterBtn, filtersOpen && styles.filterBtnActive]}
            hitSlop={6}
          >
            <Ionicons
              name="options-outline"
              size={14}
              color={colors.onAccent}
            />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
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
          ListHeaderComponent={
            <>
              {/* ── Collapsible filter panel ──────────────────────────────── */}
              {filtersOpen && (
                <Animated.View
                  style={[
                    styles.filterPanel,
                    {
                      opacity: filtersAnim,
                      transform: [
                        {
                          translateY: filtersAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-8, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  {/* ── Panel header + close button ────────────────────── */}
                  <View style={styles.filterHeader}>
                    <Text style={styles.filterHeaderLabel}>FILTERS</Text>
                    <Pressable
                      onPress={() => setFiltersOpen(false)}
                      style={styles.filterCloseBtn}
                      hitSlop={10}
                    >
                      <Text style={styles.filterCloseText}>Close</Text>
                      <Ionicons name="chevron-up" size={15} color={colors.textSecondary} />
                    </Pressable>
                  </View>

                  {/* ── Sort By ───────────────────────────────────────── */}
                  <View style={styles.categoryBlock}>
                    <Text style={styles.categoryLabel}>SORT BY</Text>
                    <View style={styles.sortRow}>
                      {(["featured", "nearMe", "az"] as const).map((mode) => (
                        <Pressable
                          key={mode}
                          style={[styles.sortBtn, sortBy === mode && styles.sortBtnActive]}
                          onPress={() => handleSortBy(mode)}
                        >
                          <Text
                            style={[
                              styles.sortBtnText,
                              sortBy === mode && styles.sortBtnTextActive,
                            ]}
                          >
                            {mode === "featured"
                              ? "Featured"
                              : mode === "nearMe"
                              ? "Near Me"
                              : "A–Z"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {sortBy === "nearMe" && locationDenied && (
                      <Text style={styles.locationHint}>
                        Location access is off — enable it in Settings.
                      </Text>
                    )}
                    {sortBy === "nearMe" && !hasRefLoc && !locationDenied && (
                      <Text style={styles.locationHint}>
                        Fetching your location…
                      </Text>
                    )}
                  </View>

                  {/* ── Region ────────────────────────────────────────── */}
                  <View style={styles.categoryBlock}>
                    <Text style={styles.categoryLabel}>REGION</Text>
                    <View style={styles.regionRow}>
                      {REGION_OPTIONS.map((region) => {
                        const active = selectedRegions.has(region);
                        return (
                          <Pressable
                            key={region}
                            style={[
                              styles.regionChip,
                              active && styles.regionChipActive,
                            ]}
                            onPress={() => toggleRegion(region)}
                          >
                            <Text
                              style={[
                                styles.regionChipText,
                                active && styles.regionChipTextActive,
                              ]}
                            >
                              {region}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* ── Features (boolean chips) ──────────────────────── */}
                  <View style={styles.categoryBlock}>
                    <Text style={styles.categoryLabel}>FEATURES</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chipsRow}
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
                                color={active ? colors.onAccent : colors.textSecondary}
                                style={styles.chipIcon}
                              />
                              <Text
                                style={[
                                  styles.chipText,
                                  active && styles.chipTextActive,
                                ]}
                              >
                                {label}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* ── Rating ────────────────────────────────────────── */}
                  <View style={styles.categoryBlock}>
                    <Text style={styles.categoryLabel}>RATING</Text>
                    <View style={styles.ratingBtnsRow}>
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
                  </View>
                </Animated.View>
              )}

              {/* ── Results count + List/Map toggle ──────────────────── */}
              {resultsRow}
            </>
          }
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyLabel}>NO RESULTS</Text>
              <Text style={styles.emptyText}>Try adjusting your filters.</Text>
            </View>
          )}
        />
      )}

      {/* ── Map view results header (only shown in map mode) ──────────────────── */}
      {view === "map" && resultsRow}

      {/* ── Map ───────────────────────────────────────────────────────────────── */}
      {view === "map" && (
        <View style={{ flex: 1 }}>
          <MapView
            key={activeMapKey}
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            customMapStyle={MAP_STYLE}
            initialRegion={TASMANIA_REGION}
            showsUserLocation
            showsMyLocationButton
            clusterColor={colors.accent}
            clusterTextColor={colors.onAccent}
            clusterFontFamily={fonts.serif}
            radius={40}
            // Match the load splash to the dark theme so we don't flash a
            // bright white panel before the tiles paint in.
            loadingEnabled
            loadingBackgroundColor={colors.surface}
            loadingIndicatorColor={colors.accent}
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
                  contentFit="contain"
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
          {/* Overlay that briefly covers the MapView remount — eliminates white flash */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { opacity: overlayAnim, backgroundColor: colors.background }]}
          />
        </View>
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
    fontSize: type.caption.fontSize,
    letterSpacing: 2,
    color: colors.textMuted,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  headerKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  headerTitle: {
    ...type.h1,
    color: colors.textPrimary,
  },

  // ── Search ──────────────────────────────────────────────────────────────
  searchWrap: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputSurface,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    minHeight: spacing.hitTarget,
  },
  searchInput: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  // ── Filter button ────────────────────────────────────────────────────────
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBtnActive: {
    backgroundColor: colors.accentSoft ?? colors.accent,
  },
  filterBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.error ?? "#c0392b",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  filterBadgeText: {
    color: colors.onAccent,
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 12,
  },

  // ── Collapsible filter panel ────────────────────────────────────────────
  filterPanel: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  // ── Filter panel header ─────────────────────────────────────────────────
  filterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
  filterHeaderLabel: {
    ...type.kicker,
    color: colors.textMuted,
    letterSpacing: 2,
  },
  filterCloseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md,
  },
  filterCloseText: {
    ...type.caption,
    color: colors.textSecondary,
    fontWeight: weights.emphasis,
  },

  // ── Category blocks ─────────────────────────────────────────────────────
  categoryBlock: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  categoryLabel: {
    ...type.kicker,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },

  // ── Sort By ─────────────────────────────────────────────────────────────
  sortRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  sortBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: spacing.hitTarget,
  },
  sortBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  sortBtnText: {
    ...type.caption,
    color: colors.textMuted,
    fontWeight: weights.emphasis,
    letterSpacing: 0.3,
  },
  sortBtnTextActive: {
    color: colors.onAccent,
  },
  locationHint: {
    ...type.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: "italic",
    marginTop: spacing.xs,
  },

  // ── Region ──────────────────────────────────────────────────────────────
  regionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  regionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputSurface,
    minHeight: spacing.hitTarget,
    justifyContent: "center",
  },
  regionChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  regionChipText: {
    ...type.caption,
    fontWeight: weights.body,
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  regionChipTextActive: {
    color: colors.onAccent,
  },

  // ── Feature chips ────────────────────────────────────────────────────────
  chipsRow: {
    gap: spacing.sm,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.inputSurface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: spacing.hitTarget,
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
    color: colors.onAccent,
  },

  // ── Rating ───────────────────────────────────────────────────────────────
  ratingBtnsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  ratingBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: spacing.hitTarget,
    justifyContent: "center",
    alignItems: "center",
  },
  ratingBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  ratingBtnText: {
    fontSize: type.caption.fontSize,
    letterSpacing: 0.5,
    color: colors.textMuted,
    fontWeight: weights.body,
  },
  ratingBtnTextActive: {
    color: colors.onAccent,
  },

  // ── Results row ──────────────────────────────────────────────────────────
  resultsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
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
    paddingTop: spacing.xs,
    paddingBottom: 120,
  },
  cardShadow: {
    marginHorizontal: spacing.xxl,
    borderRadius: radius.cardLg,
    backgroundColor: colors.surfaceElevated,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 4,
  },
  card: {
    borderRadius: radius.cardLg,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.92,
  },
  cardSep: {
    height: spacing.md,
  },
  cardImgWrap: {
    height: 150,
    position: "relative",
    backgroundColor: colors.surfaceDeep,
    borderTopLeftRadius: radius.cardLg,
    borderTopRightRadius: radius.cardLg,
    overflow: "hidden",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },

  // Featured badge — overlaid on card image (top-left)
  featuredBadge: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50,50,50,0.72)",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: 5,
  },
  featuredBadgeText: {
    ...type.kicker,
    fontSize: 10,
    letterSpacing: 1.5,
    color: "#fff",
    fontWeight: weights.emphasis,
  },

  // Featured chip — shown in card body when there is no image
  featuredChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e8e8e8",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
    gap: 5,
  },
  featuredChipText: {
    ...type.kicker,
    fontSize: 10,
    letterSpacing: 1.5,
    color: "#444",
    fontWeight: weights.emphasis,
  },

  // Red dot used inside featured badge and chip
  featuredDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#c0392b",
  },

  heartBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: spacing.hitTarget,
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.photoChromeAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: spacing.xl,
  },
  cardBodyAccent: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.lg,
  },
  cardRegion: {
    ...type.kicker,
    letterSpacing: 1.8,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  cardName: {
    ...type.h3,
    color: colors.textPrimary,
  },
  cardBlurb: {
    ...type.caption,
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
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
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
  distanceText: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: weights.emphasis,
  },
  featurePillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  featurePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featurePillIcon: {
    marginRight: spacing.xs,
  },
  featurePillText: {
    ...type.caption,
    color: colors.textSecondary,
    fontWeight: weights.body,
    letterSpacing: 0.2,
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
    fontSize: type.body.fontSize,
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
