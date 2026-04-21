import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import MapView from "react-native-map-clustering";
import { Callout, Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME_UPPER } from "../../../constants/region";
import { db } from "../../../firebaseConfig";

type Winery = {
  id: string;
  name: string;
  slug: string;
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
};

const BOOLEAN_FILTERS: { key: keyof Winery; label: string }[] = [
  { key: "dogFriendly", label: "Dog Friendly" },
  { key: "hasRestaurant", label: "Restaurant" },
  { key: "isOrganic", label: "Organic" },
  { key: "isBiodynamic", label: "Biodynamic" },
  { key: "walkinWelcome", label: "Walk-ins Welcome" },
];

// Filter keys accepted via ?filter=<key> URL param (from home screen)
const VALID_FILTER_KEYS: (keyof Winery)[] = [
  "dogFriendly",
  "hasRestaurant",
  "isOrganic",
  "isBiodynamic",
  "walkinWelcome",
];

const RATING_OPTIONS = [
  { label: "All", value: 0 },
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

// Haversine distance in kilometers between two lat/lng pairs
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
  const [wineries, setWineries] = useState<Winery[]>([]);
  const [search, setSearch] = useState(() =>
    typeof params.search === "string" ? params.search : ""
  );
  const [loading, setLoading] = useState(true);
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
  const [view, setView] = useState<"list" | "map">("list");
  const insets = useSafeAreaInsets();

  // Sync state with URL params whenever screen is focused with new params
  // (e.g. when the home screen pushes to /wineries?filter=dogFriendly)
  useFocusEffect(
    useCallback(() => {
      if (typeof params.search === "string") {
        setSearch(params.search);
      }
      if (
        typeof params.filter === "string" &&
        VALID_FILTER_KEYS.includes(params.filter as keyof Winery)
      ) {
        setActiveFilters(new Set([params.filter as keyof Winery]));
      }
    }, [params.search, params.filter, params.t])
  );

  useEffect(() => {
    const fetchWineries = async () => {
      try {
        const snapshot = await getDocs(collection(db, "wineries"));
        const data: Winery[] = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Winery, "id">) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setWineries(data);
      } catch (err) {
        console.error("Error fetching wineries:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchWineries();
  }, []);

  const toggleFilter = (key: keyof Winery) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const filtered = wineries.filter((w) => {
    if (search.trim() && !w.name?.toLowerCase().startsWith(search.trim().toLowerCase())) {
      return false;
    }
    for (const key of activeFilters) {
      if (!w[key]) return false;
    }
    if (minRating > 0 && (!w.rating || w.rating < minRating)) {
      return false;
    }
    return true;
  });

  // Near-me distance sort — activated by ?near=1&lat=<x>&lng=<y> from home
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a1a" />
        <Text style={styles.loadingText}>Loading wineries...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerLabel}>{REGION_NAME_UPPER}</Text>
        <Text style={styles.headerTitle}>Our Wineries</Text>
      </View>

      {/* LIST / MAP Toggle */}
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleBtn, view === "list" && styles.toggleActive]}
          onPress={() => setView("list")}
        >
          <Text style={[styles.toggleText, view === "list" && styles.toggleTextActive]}>
            LIST
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, view === "map" && styles.toggleActive]}
          onPress={() => setView("map")}
        >
          <Text style={[styles.toggleText, view === "map" && styles.toggleTextActive]}>
            MAP
          </Text>
        </Pressable>
      </View>

      {/* Filters — list view only */}
      {view === "list" && (
        <>
          {/* Search */}
          <View style={styles.searchWrapper}>
            <TextInput
              style={styles.search}
              placeholder="Search wineries..."
              placeholderTextColor="#aaa"
              value={search}
              onChangeText={setSearch}
            />
          </View>

          {/* Boolean Filter Chips */}
          <Text style={styles.filterSectionLabel}>FILTER</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filtersScroll}
            contentContainerStyle={styles.filtersRow}
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

          {/* Rating Filter */}
          <View style={styles.ratingBlock}>
            <Text style={styles.ratingLabel}>RATING</Text>
            <View style={styles.ratingOptions}>
              {RATING_OPTIONS.map(({ label, value }) => (
                <Pressable
                  key={value}
                  style={[styles.ratingBtn, minRating === value && styles.ratingBtnActive]}
                  onPress={() => setMinRating(minRating === value ? 0 : value)}
                >
                  <Text style={[styles.ratingBtnText, minRating === value && styles.ratingBtnTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>
              {nearActive ? "NEAREST · " : ""}
              {displayed.length}{" "}
              {displayed.length === 1 ? "WINERY" : "WINERIES"}
            </Text>
            <View style={styles.dividerLine} />
          </View>

          {/* List */}
          <FlatList
            data={displayed}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
              <Link href={`/wineries/${item.slug}?from=wineries`} asChild>
                <Pressable style={styles.row}>
                  <Text style={styles.rowIndex}>
                    {String(index + 1).padStart(2, "0")}
                  </Text>
                  <View style={styles.rowMiddle}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    {item.rating ? (
                      <View style={styles.ratingRow}>
                        <Ionicons name="star" size={11} color="#C8860A" />
                        <Text style={styles.rowRating}>
                          {item.rating.toFixed(1)} ({item.userRatingsTotal?.toLocaleString()})
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowArrow}>›</Text>
                </Pressable>
              </Link>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={() => (
              <View style={styles.empty}>
                <Text style={styles.emptyLabel}>NO RESULTS</Text>
                <Text style={styles.emptyText}>Try adjusting your filters.</Text>
              </View>
            )}
          />
        </>
      )}

      {/* Map */}
      {view === "map" && (
        <MapView
          style={styles.map}
          initialRegion={TASMANIA_REGION}
          showsUserLocation
          showsMyLocationButton
          clusterColor="#1a1a1a"
          clusterTextColor="#fff"
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
              pinColor="#1a1a1a"
            >
              <Callout tooltip onPress={() => router.push(`/wineries/${winery.slug}`)}>
                <View style={styles.callout}>
                  <Text style={styles.calloutName}>{winery.name}</Text>
                  {winery.rating ? (
                    <Text style={styles.calloutRating}>⭐ {winery.rating.toFixed(1)}</Text>
                  ) : null}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    gap: 12,
  },
  loadingText: {
    fontSize: 11,
    letterSpacing: 2,
    color: "#999",
  },

  // Header
  header: {
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  headerLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#1a1a1a",
  },

  // Toggle
  toggleRow: {
    flexDirection: "row",
    marginHorizontal: 24,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#1a1a1a",
    borderRadius: 2,
    overflow: "hidden",
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  toggleActive: {
    backgroundColor: "#1a1a1a",
  },
  toggleText: {
    fontSize: 11,
    letterSpacing: 2.5,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  toggleTextActive: {
    color: "#faf9f6",
  },

  // Search
  searchWrapper: {
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  search: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 12,
    fontSize: 14,
    color: "#1a1a1a",
    letterSpacing: 0.3,
  },

  filterSectionLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    fontWeight: "500",
    paddingHorizontal: 24,
    marginBottom: 8,
  },

  // Boolean chips
  filtersScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 12,
  },
  filtersRow: {
    paddingHorizontal: 24,
    paddingVertical: 2,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: "#1a1a1a",
    borderColor: "#1a1a1a",
  },
  chipText: {
    fontSize: 11,
    letterSpacing: 1,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  chipTextActive: {
    color: "#fff",
  },

  // Rating filter
  ratingBlock: {
    paddingHorizontal: 24,
    marginBottom: 14,
    gap: 8,
  },
  ratingLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    fontWeight: "500",
  },
  ratingOptions: {
    flexDirection: "row",
    gap: 6,
  },
  ratingBtn: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ratingBtnActive: {
    backgroundColor: "#1a1a1a",
    borderColor: "#1a1a1a",
  },
  ratingBtnText: {
    fontSize: 11,
    letterSpacing: 0.5,
    color: "#666",
    fontWeight: "500",
  },
  ratingBtnTextActive: {
    color: "#fff",
  },

  // Divider
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    marginTop: 6,
    marginBottom: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e0e0",
  },
  dividerLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginHorizontal: 12,
  },

  // List
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 120,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  rowIndex: {
    fontSize: 11,
    color: "#ccc",
    letterSpacing: 1,
    width: 32,
    fontFamily: "Georgia",
  },
  rowMiddle: {
    flex: 1,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Georgia",
    color: "#1a1a1a",
    marginBottom: 2,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowRating: {
    fontSize: 11,
    color: "#999",
    letterSpacing: 0.3,
  },
  rowArrow: {
    fontSize: 20,
    color: "#ccc",
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
  },
  emptyLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#ccc",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
  },

  // Map
  map: {
    flex: 1,
    width: "100%",
  },
  callout: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#1a1a1a",
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 160,
    alignItems: "center",
  },
  calloutName: {
    fontSize: 13,
    fontFamily: "Georgia",
    color: "#1a1a1a",
    marginBottom: 2,
    textAlign: "center",
  },
  calloutRating: {
    fontSize: 11,
    color: "#666",
    marginBottom: 4,
  },
  calloutCta: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#999",
    fontWeight: "600",
  },
});
