// app/(tabs)/trips/create.tsx
// Build-your-own-trip screen.
//
// Flow:
//   1. Fetch all wineries (same query the wineries list uses).
//   2. User taps wineries to add them — selected ones move to a "Your stops"
//      stack at the top so the order is editable.
//   3. User names the trip, taps Save → createTrip() in TripContext.
//   4. Router pushes to the new trip's detail screen.
//
// Validation:
//   • Need at least 2 stops, max 8 (Google Maps multi-stop URL limit).
//   • Wineries without coordinates are filtered out — they can't be routed.

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { useTrips } from "../../../context/TripContext";
import { db } from "../../../firebaseConfig";
import { TripStop } from "../../../types/trip";

const MIN_STOPS = 2;
const MAX_STOPS = 8;

interface WineryRow {
  id: string;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CreateTripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { createTrip } = useTrips();

  const [wineries, setWineries] = useState<WineryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "wineries"));
        const rows: WineryRow[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              name: data.name ?? "",
              slug: data.slug ?? d.id,
              latitude: data.latitude,
              longitude: data.longitude,
            };
          })
          .filter(
            (w) =>
              typeof w.latitude === "number" &&
              typeof w.longitude === "number"
          )
          .sort((a, b) => a.name.localeCompare(b.name));
        setWineries(rows);
      } catch (err) {
        console.warn("[trips/create] failed to fetch wineries:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const wineryById = useMemo(() => {
    const m = new Map<string, WineryRow>();
    wineries.forEach((w) => m.set(w.id, w));
    return m;
  }, [wineries]);

  const selectedStops = useMemo(
    () =>
      selectedIds
        .map((id) => wineryById.get(id))
        .filter(Boolean) as WineryRow[],
    [selectedIds, wineryById]
  );

  const filteredWineries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return wineries;
    return wineries.filter((w) => w.name.toLowerCase().includes(q));
  }, [search, wineries]);

  const toggleStop = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_STOPS) {
        Alert.alert(
          "Trip limit",
          `Trips can have at most ${MAX_STOPS} stops.`
        );
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleSave = () => {
    if (selectedStops.length < MIN_STOPS) {
      Alert.alert(
        "Add more stops",
        `A trip needs at least ${MIN_STOPS} wineries.`
      );
      return;
    }
    const stops: TripStop[] = selectedStops.map((w) => ({
      wineryId: w.id,
      name: w.name,
      slug: w.slug,
      latitude: w.latitude,
      longitude: w.longitude,
    }));
    const id = createTrip(name, stops);
    router.replace({
      pathname: "/(tabs)/trips/[id]",
      params: { id, kind: "user" },
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backLink}>‹ Trips</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Build a Trip</Text>
      </View>

      {/* ── Trip name ──────────────────────────────────────────────────── */}
      <View style={styles.nameWrap}>
        <Text style={styles.fieldLabel}>TRIP NAME</Text>
        <TextInput
          style={styles.nameInput}
          placeholder="My Margaret River day"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />
      </View>

      {/* ── Selected stops chip row ────────────────────────────────────── */}
      <View style={styles.selectedWrap}>
        <Text style={styles.fieldLabel}>
          YOUR STOPS · {selectedStops.length}/{MAX_STOPS}
        </Text>
        {selectedStops.length === 0 ? (
          <Text style={styles.selectedEmpty}>
            Tap wineries below to add them.
          </Text>
        ) : (
          <View style={styles.selectedList}>
            {selectedStops.map((s, idx) => (
              <Pressable
                key={s.id}
                style={styles.selectedChip}
                onPress={() => toggleStop(s.id)}
              >
                <Text style={styles.selectedChipIdx}>{idx + 1}</Text>
                <Text style={styles.selectedChipName} numberOfLines={1}>
                  {s.name}
                </Text>
                <Ionicons
                  name="close"
                  size={14}
                  color={colors.textOnDark}
                />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* ── Search ─────────────────────────────────────────────────────── */}
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
            placeholder="Add a winery…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons
                name="close-circle"
                size={16}
                color={colors.textMuted}
              />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Winery list ────────────────────────────────────────────────── */}
      <FlatList
        data={filteredWineries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const selected = selectedIds.includes(item.id);
          return (
            <Pressable
              style={[styles.row, selected && styles.rowSelected]}
              onPress={() => toggleStop(item.id)}
            >
              <Text style={styles.rowName} numberOfLines={1}>
                {item.name}
              </Text>
              <Ionicons
                name={selected ? "checkmark-circle" : "add-circle-outline"}
                size={22}
                color={selected ? colors.accent : colors.textMuted}
              />
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.rowSep} />}
      />

      {/* ── Save bar ───────────────────────────────────────────────────── */}
      <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[
            styles.saveBtn,
            selectedStops.length < MIN_STOPS && styles.saveBtnDisabled,
          ]}
          onPress={handleSave}
          disabled={selectedStops.length < MIN_STOPS}
        >
          <Text style={styles.saveBtnText}>Save Trip</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },

  header: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  backLink: {
    ...type.kicker,
    color: colors.accentSoft,
    fontFamily: fonts.serif,
    fontSize: 14,
    letterSpacing: 0,
  },
  headerTitle: { ...type.h2, color: colors.textPrimary },

  fieldLabel: {
    ...type.kicker,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },

  nameWrap: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  nameInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
    minHeight: spacing.hitTarget,
  },

  selectedWrap: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
  selectedEmpty: {
    ...type.body,
    color: colors.textMuted,
    fontFamily: fonts.serif,
    fontStyle: "italic",
  },
  selectedList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  selectedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    maxWidth: 240,
  },
  selectedChipIdx: {
    ...type.kicker,
    color: colors.textOnDark,
    opacity: 0.7,
  },
  selectedChipName: {
    ...type.caption,
    color: colors.textOnDark,
    fontWeight: weights.emphasis,
  },

  searchWrap: {
    paddingHorizontal: spacing.xxl,
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
    minHeight: spacing.hitTarget,
  },
  searchInput: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  listContent: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: 120,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSelected: {
    borderColor: colors.accent,
  },
  rowName: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 16,
    color: colors.textPrimary,
    marginRight: spacing.md,
  },
  rowSep: { height: spacing.sm },

  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xxl,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    minHeight: spacing.hitTarget,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: {
    ...type.kicker,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },
});
