// app/(tabs)/wineries/index.tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
// Dark bg · glass search · gold chips · image cards · gold map markers

import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import { Image } from "expo-image";
import Slider from "@react-native-community/slider";
import MapView from "react-native-map-clustering";
import { Callout, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ErrorScreen } from "../../../components/ErrorScreen";
import { withScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { MAP_STYLE } from "../../../constants/mapStyle";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { reportError } from "../../../utils/errorReporting";
import { useActiveRegionId, useRegionConfig } from "../../../context/RegionContext";
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
  hasCharcuterie?: boolean;
  hasFireplace?: boolean;
  wheelchairAccessible?: boolean;
  rating?: number;
  userRatingsTotal?: number;
  latitude?: number;
  longitude?: number;
  featured?: boolean;
  region?: string;
  // Phone number used for tap-to-call. Surfaced on the card when
  // `walkinWelcome === false` so guests can ring ahead and book.
  phone?: string;
  // Optional: direct online booking URL for venues whose bookings are
  // taken via a web form (Tock, Resy, the winery's own booking page,
  // etc.) rather than by phone. When present and `walkinWelcome ===
  // false`, the card's CTA flips from "CALL TO BOOK" → tel: to "BOOK
  // ONLINE" → bookingUrl. House of Arras was the first venue to need
  // this; expect a small but growing subset.
  bookingUrl?: string;
};

type SortMode = "featured" | "nearMe" | "az";

// Filter pill / bottom-sheet identifiers. `null` means no sheet open.
// "all" opens a combined sheet stacking every category; the others scope
// the sheet to a single category.
type FilterSheetKind = "sort" | "region" | "features" | "rating" | "all";

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
  { key: "hasCharcuterie",       label: "Charcuterie",          icon: "fast-food-outline"    },
  { key: "hasWifi",              label: "Wi-Fi",                icon: "wifi-outline"         },
  { key: "hasFireplace",         label: "Fireplace",            icon: "flame-outline"        },
  { key: "wheelchairAccessible", label: "Wheelchair Accessible", icon: "accessibility-outline" },
];

const VALID_FILTER_KEYS: (keyof Winery)[] = [
  "dogFriendly",
  "hasRestaurant",
  "isOrganic",
  "isBiodynamic",
  "walkinWelcome",
  "awardWinning",
  "hasTours",
  "hasCharcuterie",
  "hasWifi",
  "hasFireplace",
  "wheelchairAccessible",
  "featured",
];

const RATING_OPTIONS = [
  { label: "All",  value: 0   },
  { label: "4.0+", value: 4.0 },
  { label: "4.3+", value: 4.3 },
  { label: "4.5+", value: 4.5 },
];

// Distance-from-me slider bounds (km, haversine). Tasmania's longest
// span is ~300 km but the wineries cluster heavily in the south + east,
// so 200 km comfortably covers every doc in the region. At 200 km we
// treat the slider as "no distance constraint" so it disappears from
// the filter logic — same intent as the old "Any" rating option.
const DISTANCE_MIN_KM = 1;
const DISTANCE_MAX_KM = 200;

// REGION_OPTIONS and TASMANIA_REGION used to be hardcoded here. They now
// come from the active region's config doc (region.subRegions + region.mapBounds),
// loaded by RegionContext from `regions/{regionId}` in Firestore.

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
function WineriesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    search?: string;
    filter?: string;
    sort?: string;
    near?: string;
    lat?: string;
    lng?: string;
    t?: string;
  }>();
  const insets = useSafeAreaInsets();
  const regionId = useActiveRegionId();
  const region = useRegionConfig();
  // Derive sub-region names + map bounds from the active region config.
  // When subRegions is empty (flat region), regionOptions === [] and the
  // chip row will be hidden below.
  const regionOptions = (region.subRegions ?? []).map((s) => s.name);
  const mapBounds = region.mapBounds;

  const { isSaved, toggle: toggleSaved } = useSaved();

  // ── Save-confirmation toast ────────────────────────────────────────────────
  // Brief pill that fades in above the tab bar when a heart is tapped, then
  // auto-dismisses. Re-tapping resets the timer so rapid toggles don't stack.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSaveToast = useCallback(
    (message: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToastMessage(message);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 240,
          useNativeDriver: true,
        }).start(() => setToastMessage(null));
      }, 2200);
    },
    [toastOpacity]
  );

  // Clear any pending dismiss timer on unmount.
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const [wineries, setWineries] = useState<Winery[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  // Bumped by the retry handler to force the load effect to rerun.
  const [retryToken, setRetryToken] = useState(0);
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
  // Distance-from-me cutoff in km. DISTANCE_MAX_KM = "no constraint";
  // any value strictly less than that filters the list.
  const [maxDistanceKm, setMaxDistanceKm] = useState(DISTANCE_MAX_KM);
  // Which filter bottom-sheet is currently open. `null` = none.
  const [activeSheet, setActiveSheet] = useState<FilterSheetKind | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

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
      // Deep-link support for sort mode (e.g. ?sort=nearMe from the home
      // "Near Me" tile). For nearMe we also kick off the location request
      // so the list actually sorts by distance once permission is granted.
      if (params.sort === "nearMe") {
        setSortBy("nearMe");
        ensureUserLocation();
      } else if (params.sort === "featured" || params.sort === "az") {
        setSortBy(params.sort);
      }
    }, [params.search, params.filter, params.sort, params.t, ensureUserLocation])
  );

  // Fetch all wineries in the active region. Reruns on retry.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const q = query(
          collection(db, "wineries"),
          where("regionId", "==", regionId)
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Winery, "id">) }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setWineries(data);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        reportError(
          error,
          { source: "wineries/index.loadCorpus", region_id: regionId },
          "error"
        );
        setLoadError(error);
      } finally {
        setLoading(false);
      }
    })();
  }, [regionId, retryToken]);

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
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      // Match if the winery name STARTS WITH the query (existing behaviour),
      // OR if the winery's region INCLUDES the query as a substring. This
      // lets users type a region name like "coal river valley" or "east
      // coast" and see every winery in that region, in addition to typing a
      // winery name prefix like "stef" → Stefano Lubiana.
      const nameMatch = w.name?.toLowerCase().startsWith(q) ?? false;
      const regionMatch = w.region?.toLowerCase().includes(q) ?? false;
      if (!nameMatch && !regionMatch) return false;
    }
    for (const key of activeFilters) {
      if (!w[key]) return false;
    }
    if (minRating > 0 && (!w.rating || w.rating < minRating)) return false;
    if (selectedRegions.size > 0) {
      if (!w.region || !selectedRegions.has(w.region)) return false;
    }
    // Distance-from-me filter. Only active when the user has set the
    // slider below its max AND we have a usable reference location.
    // Wineries without finite coords are excluded — we can't verify
    // they're within range and the user explicitly asked for one.
    if (maxDistanceKm < DISTANCE_MAX_KM && hasRefLoc) {
      if (!Number.isFinite(w.latitude) || !Number.isFinite(w.longitude)) {
        return false;
      }
      const d = distanceKm(refLat, refLng, w.latitude as number, w.longitude as number);
      if (d > maxDistanceKm) return false;
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

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading wineries…</Text>
      </View>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  // Firestore query threw. Most common cause: no internet, transient
  // backend hiccup, or stale auth token. ErrorScreen with a retry that
  // bumps the token to re-trigger the load effect.
  if (loadError) {
    return (
      <ErrorScreen
        kicker="COULDN'T LOAD WINERIES"
        title="We couldn't fetch the wineries list."
        message="Check your connection and tap below to try again."
        onRetry={() => setRetryToken((t) => t + 1)}
      />
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
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}${item.rating != null ? `, rated ${item.rating.toFixed(1)} stars` : ""}`}
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
                    const willSave = !isSaved(item.id);
                    toggleSaved(item.id, {
                      name: item.name,
                      image: item.images?.[0] ?? "",
                      rating: item.rating,
                      region: item.region ?? region.displayName,
                    });
                    showSaveToast(
                      willSave
                        ? `${item.name} added to your saved wineries`
                        : `${item.name} removed from your saved wineries`
                    );
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isSaved(item.id)
                      ? `Remove ${item.name} from saved`
                      : `Save ${item.name}`
                  }
                  accessibilityState={{ selected: isSaved(item.id) }}
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

              {/*
                ── Booking-required call-to-action ─────────────────────
                Walk-ins not welcome → surface a CTA so the guest can
                actually book without having to drill into the detail
                screen. Two channels are supported:

                  • `bookingUrl` set → "BOOK ONLINE" → opens the
                    booking page in the system browser. Used for
                    venues like House of Arras whose bookings flow
                    through their website, not their phone.
                  • Otherwise, falls back to "CALL TO BOOK" → tel:
                    using `phone`. The phone-first path remains the
                    default since most small Tasmanian producers take
                    bookings by phone.

                Only render the block when we have at least ONE of the
                two channels — without either, the button has nothing
                to do.
              */}
              {item.walkinWelcome === false &&
                (item.bookingUrl || item.phone) && (
                <View style={styles.bookingBlock}>
                  <View style={styles.bookingNoticeRow}>
                    <Ionicons
                      name="information-circle-outline"
                      size={12}
                      color={colors.accentSoft}
                      style={styles.bookingNoticeIcon}
                    />
                    <Text style={styles.bookingNoticeText}>
                      Bookings required — walk-ins not accepted.
                    </Text>
                  </View>
                  {item.bookingUrl ? (
                    <Pressable
                      // Nested Pressables: stop the press so the outer
                      // card Link doesn't also fire and navigate into
                      // the detail screen on every CTA tap.
                      onPress={(e) => {
                        e.stopPropagation();
                        const raw = item.bookingUrl!.trim();
                        const withProtocol =
                          raw.startsWith("http://") ||
                          raw.startsWith("https://")
                            ? raw
                            : `https://${raw}`;
                        Linking.openURL(withProtocol).catch(() =>
                          console.warn("Could not open booking URL")
                        );
                      }}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.bookingCallBtn,
                        pressed && styles.bookingCallBtnPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Book ${item.name} online`}
                    >
                      <Ionicons
                        name="open-outline"
                        size={14}
                        color={colors.onAccent}
                      />
                      <Text style={styles.bookingCallBtnText}>BOOK ONLINE</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        const tel = item.phone!.replace(/\s/g, "");
                        Linking.openURL(`tel:${tel}`).catch(() =>
                          console.warn("Could not open phone link")
                        );
                      }}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.bookingCallBtn,
                        pressed && styles.bookingCallBtnPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${item.name} to book`}
                    >
                      <Ionicons
                        name="call"
                        size={14}
                        color={colors.onAccent}
                      />
                      <Text style={styles.bookingCallBtnText}>CALL TO BOOK</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          </Pressable>
        </Link>
      </View>
    );
  };

  // ── Filter pills ────────────────────────────────────────────────────────
  // Per-category active flags. Treated as booleans rather than counts —
  // the pill UI only cares "is this category contributing to the filter
  // or not?" (active = accent fill).
  // Sort pill is "active" when sort mode != default OR the distance
  // slider is below its max (the slider lives inside the Sort sheet).
  const distanceConstrained = maxDistanceKm < DISTANCE_MAX_KM;
  const sortActive     = sortBy !== "featured" || distanceConstrained;
  const regionActive   = selectedRegions.size > 0;
  const featuresActive = activeFilters.size > 0;
  const ratingActive   = minRating > 0;
  const anyActive      = sortActive || regionActive || featuresActive || ratingActive;

  // Pill definitions, rendered in declared order. Skipping the REGION
  // pill when the active region has no sub-regions (flat regions like
  // a single-AVA setup) — otherwise it opens a useless empty sheet.
  type PillDef = {
    kind: FilterSheetKind;
    label: string;
    active: boolean;
    skip?: boolean;
    // Optional leading icon rendered inside the pill, to the left of the
    // label. Currently only the "All" pill uses one (the same options
    // glyph that used to sit on the search bar).
    icon?: keyof typeof Ionicons.glyphMap;
  };
  const pillDefs: PillDef[] = [
    // "All" leads the row so it's the first pill the eye lands on when
    // reading the row left-to-right — frames the category pills that
    // follow as drill-downs from the master filter.
    { kind: "all",      label: "All",      active: anyActive, icon: "options-outline" },
    { kind: "sort",     label: "Sort by",  active: sortActive    },
    { kind: "region",   label: "Region",   active: regionActive, skip: regionOptions.length === 0 },
    { kind: "features", label: "Features", active: featuresActive },
    { kind: "rating",   label: "Rating",   active: ratingActive, icon: "logo-google" },
  ];

  const openSheet = (kind: FilterSheetKind) =>
    setActiveSheet((prev) => (prev === kind ? null : kind));
  const closeSheet = () => setActiveSheet(null);

  const filterPillsRow = (
    <View style={styles.pillsWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsRow}
      >
        {pillDefs
          .filter((p) => !p.skip)
          .map(({ kind, label, active, icon }) => (
            <Pressable
              key={kind}
              onPress={() => openSheet(kind)}
              style={[styles.pill, active && styles.pillActive]}
              accessibilityRole="button"
              accessibilityLabel={
                active ? `${label} filter — active. Tap to edit.` : `Open ${label} filter`
              }
              accessibilityState={{ selected: active, expanded: activeSheet === kind }}
            >
              {icon && (
                <Ionicons
                  name={icon}
                  size={13}
                  color={active ? colors.onAccent : colors.textSecondary}
                  style={styles.pillLeadingIcon}
                />
              )}
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {label}
              </Text>
              <Ionicons
                name="chevron-down"
                size={12}
                color={active ? colors.onAccent : colors.textSecondary}
                style={styles.pillCaret}
              />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );

  // ── Filter sheet content blocks ─────────────────────────────────────────
  // Each block renders one category's controls. They're reused across the
  // category-specific sheets AND stacked together inside the "All" sheet.
  // Inside individual category sheets the green title at the top already
  // tells the user which category they're in, so the inner gray
  // category label would just repeat itself. Show the inner label only
  // when we're rendering inside the "All" sheet, where the labels act
  // as section dividers between stacked blocks.
  const showCategoryLabels = activeSheet === "all";

  const sortBlock = (
    <View style={styles.sheetCategoryBlock}>
      {showCategoryLabels && (
        <Text style={styles.categoryLabel}>SORT BY</Text>
      )}
      <View style={styles.sortRow}>
        {(["featured", "nearMe", "az"] as const).map((mode) => {
          const sortLabel =
            mode === "featured" ? "Featured" : mode === "nearMe" ? "Near Me" : "A to Z";
          return (
            <Pressable
              key={mode}
              style={[styles.sortBtn, sortBy === mode && styles.sortBtnActive]}
              onPress={() => handleSortBy(mode)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${sortLabel}`}
              accessibilityState={{ selected: sortBy === mode }}
            >
              <Text
                style={[
                  styles.sortBtnText,
                  sortBy === mode && styles.sortBtnTextActive,
                ]}
              >
                {mode === "featured" ? "Featured" : mode === "nearMe" ? "Near Me" : "A–Z"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {sortBy === "nearMe" && locationDenied && (
        <Text style={styles.locationHint}>
          Location access is off — enable it in Settings.
        </Text>
      )}
      {sortBy === "nearMe" && !hasRefLoc && !locationDenied && (
        <Text style={styles.locationHint}>Fetching your location…</Text>
      )}

      {/* ── Distance-from-me slider ───────────────────────────────
          Lives below the sort buttons since it's the same family of
          location-aware controls. Works independently of sort mode
          (you can constrain distance while still sorting Featured),
          but touching it kicks off the same location request as the
          Near Me sort if it hasn't been granted yet. */}
      <View style={styles.distanceSliderBlock}>
        <View style={styles.distanceSliderHeader}>
          <Text style={styles.distanceSliderLabel}>DISTANCE FROM ME</Text>
          <Text style={styles.distanceSliderValue}>
            {distanceConstrained ? `Within ${maxDistanceKm} km` : "Any distance"}
          </Text>
        </View>
        <Slider
          style={styles.distanceSlider}
          minimumValue={DISTANCE_MIN_KM}
          maximumValue={DISTANCE_MAX_KM}
          step={1}
          value={maxDistanceKm}
          onValueChange={(v: number) => {
            // Request location lazily — the first time the user
            // actually touches the slider. Avoids prompting on
            // mount for users who never use this control.
            if (!userLocation && !locationDenied) ensureUserLocation();
            setMaxDistanceKm(Math.round(v));
          }}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.accentSoft}
          accessibilityLabel="Maximum distance from me, in kilometres"
        />
        {distanceConstrained && !hasRefLoc && !locationDenied && (
          <Text style={styles.locationHint}>
            Waiting for your location to apply distance filter…
          </Text>
        )}
        {distanceConstrained && locationDenied && (
          <Text style={styles.locationHint}>
            Location is off — enable it in Settings to filter by distance.
          </Text>
        )}
      </View>
    </View>
  );

  const regionBlock = regionOptions.length > 0 && (
    <View style={styles.sheetCategoryBlock}>
      {showCategoryLabels && (
        <Text style={styles.categoryLabel}>REGION</Text>
      )}
      <View style={styles.sheetWrappingChips}>
        {regionOptions.map((subRegion) => {
          const active = selectedRegions.has(subRegion);
          return (
            <Pressable
              key={subRegion}
              style={[styles.regionChip, active && styles.regionChipActive]}
              onPress={() => toggleRegion(subRegion)}
              accessibilityRole="button"
              accessibilityLabel={
                active
                  ? `Remove region filter: ${subRegion}`
                  : `Filter by region: ${subRegion}`
              }
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.regionChipText,
                  active && styles.regionChipTextActive,
                ]}
              >
                {subRegion}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const featuresBlock = (
    <View style={styles.sheetCategoryBlock}>
      {showCategoryLabels && (
        <Text style={styles.categoryLabel}>FEATURES</Text>
      )}
      <View style={styles.sheetWrappingChips}>
        {BOOLEAN_FILTERS.map(({ key, label, icon }) => {
          const active = activeFilters.has(key);
          return (
            <Pressable
              key={String(key)}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => toggleFilter(key)}
              accessibilityRole="button"
              accessibilityLabel={
                active ? `Remove filter: ${label}` : `Filter by ${label}`
              }
              accessibilityState={{ selected: active }}
            >
              <View style={styles.chipInner}>
                <Ionicons
                  name={icon}
                  size={13}
                  color={active ? colors.onAccent : colors.textSecondary}
                  style={styles.chipIcon}
                />
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const ratingBlock = (
    <View style={styles.sheetCategoryBlock}>
      {/* Inside the All sheet the RATING section keeps its own G + label
          header so the rating block reads as a distinct, Google-sourced
          section. Inside the single Rating sheet the green title at the
          top already plays that role (and gets its own G via
          `sheetTitleIcon`), so this header would just duplicate. */}
      {showCategoryLabels && (
        <View style={styles.sheetCategoryHeader}>
          <Ionicons
            name="logo-google"
            size={12}
            color={colors.textMuted}
            style={styles.sheetCategoryHeaderIcon}
          />
          <Text style={styles.categoryLabel}>RATING</Text>
        </View>
      )}
      <View style={styles.ratingBtnsRow}>
        {RATING_OPTIONS.map(({ label, value }) => (
          <Pressable
            key={value}
            style={[
              styles.ratingBtn,
              minRating === value && styles.ratingBtnActive,
            ]}
            onPress={() => setMinRating(minRating === value ? 0 : value)}
            accessibilityRole="button"
            accessibilityLabel={
              minRating === value
                ? `Remove minimum rating filter: ${label}`
                : `Filter by minimum rating: ${label}`
            }
            accessibilityState={{ selected: minRating === value }}
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
  );

  // Reset every category to defaults. Used by the "Clear all" affordance
  // inside the All-filters sheet.
  const clearAllFilters = () => {
    setSortBy("featured");
    setSelectedRegions(new Set());
    setActiveFilters(new Set());
    setMinRating(0);
    setMaxDistanceKm(DISTANCE_MAX_KM);
  };

  // Map sheet kind → title + body. `all` stacks every block; the others
  // show a single block. Region is skipped from `all` for flat regions.
  const sheetTitle =
    activeSheet === "sort"     ? "SORT BY"  :
    activeSheet === "region"   ? "REGION"   :
    activeSheet === "features" ? "FEATURES" :
    activeSheet === "rating"   ? "RATING"   :
    activeSheet === "all"      ? "ALL FILTERS" :
    "";

  // Optional icon shown next to the sheet title. Mirrors the leading
  // icon on each pill so the source/category cue stays consistent
  // between the pill (entry point) and the sheet (the controls).
  const sheetTitleIcon: keyof typeof Ionicons.glyphMap | null =
    activeSheet === "rating" ? "logo-google"     :
    activeSheet === "all"    ? "options-outline" :
    null;

  const sheetBody =
    activeSheet === "sort"     ? sortBlock     :
    activeSheet === "region"   ? regionBlock   :
    activeSheet === "features" ? featuresBlock :
    activeSheet === "rating"   ? ratingBlock   :
    activeSheet === "all" ? (
      <>
        {sortBlock}
        {regionBlock}
        {featuresBlock}
        {ratingBlock}
      </>
    ) : null;

  const filterSheet = (
    <Modal
      visible={activeSheet !== null}
      transparent
      animationType="slide"
      onRequestClose={closeSheet}
    >
      <Pressable
        style={styles.sheetBackdrop}
        onPress={closeSheet}
        accessibilityRole="button"
        accessibilityLabel="Close filters"
      >
        {/* Inner pressable swallows taps so they don't bubble to the
            backdrop and dismiss the sheet while the user is interacting
            with controls inside it. */}
        <Pressable style={styles.sheet} onPress={() => {}} accessible={false}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              {sheetTitleIcon && (
                <Ionicons
                  name={sheetTitleIcon}
                  size={15}
                  color={colors.accentSoft}
                  style={styles.sheetTitleIcon}
                />
              )}
              <Text style={styles.sheetTitle}>{sheetTitle}</Text>
            </View>
            {activeSheet === "all" && anyActive && (
              <Pressable
                onPress={clearAllFilters}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
              >
                <Text style={styles.sheetClearText}>Clear all</Text>
              </Pressable>
            )}
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {sheetBody}
          </ScrollView>

          <Pressable
            style={styles.sheetDoneBtn}
            onPress={closeSheet}
            accessibilityRole="button"
            accessibilityLabel="Apply filters and close"
          >
            <Text style={styles.sheetDoneBtnText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );

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
        <Pressable
          onPress={() => setView("list")}
          accessibilityRole="button"
          accessibilityLabel="Show wineries as a list"
          accessibilityState={{ selected: view === "list" }}
        >
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
        <Pressable
          onPress={() => setView("map")}
          accessibilityRole="button"
          accessibilityLabel="Show wineries on a map"
          accessibilityState={{ selected: view === "map" }}
        >
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
        <Text style={styles.headerKicker}>{region.displayNameUpper}</Text>
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
            <Pressable
              onPress={() => setSearch("")}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/*
        ── Filter pills + bottom-sheet system ─────────────────────────────
        Replaces the old collapsible drop-down panel. Each pill targets a
        single filter category (or "All" for everything); tapping a pill
        opens a bottom sheet with that category's controls. Tapping the
        same pill again, or the backdrop, dismisses the sheet.

        Pill states are simple — "active" (any filter set in that
        category) just swaps to an accent fill so the row reads at a
        glance. No labels mutate.
      */}
      {filterPillsRow}
      {filterSheet}

      {/* ── List ──────────────────────────────────────────────────────────── */}
      {view === "list" && (
        <FlatList
          data={displayed}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          renderItem={renderCard}
          ItemSeparatorComponent={() => <View style={styles.cardSep} />}
          ListHeaderComponent={resultsRow}
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
            initialRegion={mapBounds}
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

      {/* ── Save-confirmation toast ─────────────────────────────────────────── */}
      {toastMessage !== null && (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            { bottom: insets.bottom + 92, opacity: toastOpacity },
          ]}
        >
          <Ionicons name="heart" size={14} color={colors.accentSoft} />
          <Text style={styles.toastText} numberOfLines={2}>
            {toastMessage}
          </Text>
        </Animated.View>
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

  // ── Filter pills (below the search bar) ─────────────────────────────────
  // Horizontal scrollable row of small oval pills, one per filter
  // category plus an "All" entry. Tapping a pill opens a bottom sheet.
  // Active pills swap to an accent fill so the row reads at a glance
  // without changing labels.
  pillsWrap: {
    marginBottom: spacing.md,
  },
  pillsRow: {
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pillText: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: weights.body,
    letterSpacing: 0.2,
  },
  pillTextActive: {
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },
  pillCaret: {
    marginLeft: 6,
  },
  pillLeadingIcon: {
    marginRight: 6,
  },

  // ── Filter bottom sheet (Modal) ─────────────────────────────────────────
  // Slides up from the bottom over a dimmed backdrop. Body is one of the
  // category blocks (or all of them stacked for the "All" pill). Reuses
  // the existing sort/region/feature/rating control styles below so the
  // controls themselves match the rest of the app.
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: spacing.xl,
    borderTopRightRadius: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.md,
    paddingBottom: spacing.hero,
    paddingHorizontal: spacing.xxl,
    // Cap the sheet so it never eats the whole screen — keeps the
    // backdrop tappable and the list peeking behind for context.
    maxHeight: "85%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  // Row that wraps the optional icon + title text inside the sheet header.
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  sheetTitleIcon: {
    marginRight: 8,
  },
  // Bumped from kicker (10pt) to a more substantial section-header size
  // so it reads as the primary header of the sheet rather than a small
  // overline. Keeps uppercase + tracking for editorial consistency.
  sheetTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 2.5,
    color: colors.accentSoft,
    textTransform: "uppercase",
  },
  sheetClearText: {
    ...type.caption,
    color: colors.textSecondary,
    fontWeight: weights.emphasis,
    letterSpacing: 0.3,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingBottom: spacing.lg,
  },
  // Each category block inside the sheet. No horizontal padding (the
  // sheet itself provides it) — separated by a bottom margin only.
  sheetCategoryBlock: {
    marginBottom: spacing.xl,
  },
  // Used for category headers that need an icon next to the label
  // (currently just RATING with the Google "G"). The label keeps its
  // own marginBottom for spacing to the controls below.
  sheetCategoryHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  sheetCategoryHeaderIcon: {
    marginRight: 6,
    // Lift the icon a tiny bit so the optical baseline sits closer to
    // the kicker text (kicker has a small x-height; without this nudge
    // the icon reads as floating high).
    marginBottom: spacing.sm,
  },
  // Region + feature chips inside the sheet wrap onto multiple rows
  // (instead of the horizontal ScrollView used in the old panel). Inside
  // a sheet the user expects to see everything at once.
  sheetWrappingChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  sheetDoneBtn: {
    marginTop: spacing.lg,
    alignSelf: "stretch",
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    minHeight: spacing.hitTarget,
  },
  sheetDoneBtnText: {
    ...type.kicker,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },

  // ── Category labels (used inside each sheet block) ──────────────────────
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

  // ── Distance-from-me slider ─────────────────────────────────────────────
  distanceSliderBlock: {
    marginTop: spacing.lg,
  },
  distanceSliderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  distanceSliderLabel: {
    ...type.kicker,
    color: colors.textMuted,
  },
  // The live numeric value sits right of the label so the user sees
  // exactly what the slider's pointing at while they drag. Accent-soft
  // matches the thumb so the eye links the two.
  distanceSliderValue: {
    ...type.caption,
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
    letterSpacing: 0.3,
  },
  distanceSlider: {
    // Slight horizontal "pull-in" so the thumb's edge stays inside the
    // sheet's padded content area at both extremes.
    width: "100%",
    height: 32,
  },

  // ── Region ──────────────────────────────────────────────────────────────
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

  // ── Booking-required CTA (walk-ins not welcome) ──────────────────────────
  // A small notice + accent CTA pinned beneath the feature pills. Visually
  // separated by a top hairline so it reads as a distinct "action required"
  // affordance rather than just another pill in the row above.
  bookingBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  bookingNoticeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  bookingNoticeIcon: {
    marginRight: 6,
  },
  bookingNoticeText: {
    ...type.caption,
    fontStyle: "italic",
    color: colors.accentSoft,
    flex: 1,
  },
  bookingCallBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    minHeight: spacing.hitTarget,
    alignSelf: "flex-start",
  },
  bookingCallBtnPressed: {
    opacity: 0.85,
  },
  bookingCallBtnText: {
    ...type.kicker,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
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
    // Matches the lime logo-pin.png aspect (36×48 → 0.75). The asset's
    // tip is at the bottom-center, so `anchor={{ x: 0.5, y: 1 }}` on the
    // Marker drops the tip exactly on the coordinate.
    width: 36,
    height: 48,
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

  // ── Save-confirmation toast ──────────────────────────────────────────────
  toast: {
    position: "absolute",
    left: spacing.xxl,
    right: spacing.xxl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.cardLg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  toastText: {
    ...type.caption,
    color: colors.textPrimary,
    flex: 1,
  },
});

// Wrapped default export — any uncaught render error inside WineriesScreen
// is caught here and shown as an inline ErrorScreen instead of taking down
// the whole app.
export default withScreenErrorBoundary(WineriesScreen, "wineries/index");
