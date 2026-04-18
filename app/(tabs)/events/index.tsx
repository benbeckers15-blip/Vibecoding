// app/(tabs)/events/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { collection, getDocs } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import SkeletonBox from "../../../components/SkeletonBox";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../../firebaseConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

type Event = {
  id: string;
  title?: string;
  wineryName?: string;
  winerySlug?: string;
  venue?: string;
  startDate?: string;       // "YYYY-MM-DD"
  endDate?: string;         // "YYYY-MM-DD"
  date?: string;            // legacy field — kept for backward compatibility
  description?: string;
  image?: string;
  isWinerySponsored?: boolean;
  sourceUrl?: string;       // deep-link to margaretriver.com listing
};

type TimeFilter = "all" | "today" | "week" | "month";

// ─── Date Helpers ─────────────────────────────────────────────────────────────

const SHORT_DAYS   = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const SHORT_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                      "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const LONG_MONTHS  = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatBadgeDate(str: string): string {
  const d = parseLocalDate(str);
  return `${SHORT_DAYS[d.getDay()]}  ${d.getDate()}  ${SHORT_MONTHS[d.getMonth()]}`;
}

function formatDisplayDate(str: string): string {
  const d = parseLocalDate(str);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function eventStartKey(e: Event): string {
  return e.startDate ?? e.date ?? "";
}

function eventMatchesTimeFilter(event: Event, filter: TimeFilter): boolean {
  if (filter === "all") return true;
  const rawStart = eventStartKey(event);
  if (!rawStart) return false;

  const start = parseLocalDate(rawStart);
  const end   = event.endDate ? parseLocalDate(event.endDate) : new Date(start);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (filter === "today") {
    return start <= today && today <= end;
  }
  if (filter === "week") {
    const dow    = today.getDay();
    const wStart = new Date(today); wStart.setDate(today.getDate() - dow);
    const wEnd   = new Date(today); wEnd.setDate(today.getDate() + (6 - dow));
    return start <= wEnd && end >= wStart;
  }
  if (filter === "month") {
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const mEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return start <= mEnd && end >= mStart;
  }
  return true;
}

// ─── Calendar Component ───────────────────────────────────────────────────────

const CAL_DAYS = ["S", "M", "T", "W", "T", "F", "S"];

function CalendarView({
  events,
  selectedDay,
  onDaySelect,
}: {
  events: Event[];
  selectedDay: string | null;
  onDaySelect: (day: string | null) => void;
}) {
  const today = new Date();
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  // Build a set of date-keys that have at least one event
  const eventDateSet = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      const rawStart = eventStartKey(e);
      if (!rawStart) return;
      const start = parseLocalDate(rawStart);
      const end   = e.endDate ? parseLocalDate(e.endDate) : new Date(start);
      const cur   = new Date(start);
      while (cur <= end) {
        set.add(toDateKey(cur));
        cur.setDate(cur.getDate() + 1);
      }
    });
    return set;
  }, [events]);

  const firstDow     = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth  = new Date(calYear, calMonth + 1, 0).getDate();
  const todayKey     = toDateKey(today);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
    else                  setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
    else                   setCalMonth((m) => m + 1);
  };

  return (
    <View style={calStyles.wrapper}>
      {/* Month navigation */}
      <View style={calStyles.navRow}>
        <Pressable onPress={prevMonth} style={calStyles.navBtn}>
          <Text style={calStyles.navArrow}>‹</Text>
        </Pressable>
        <Text style={calStyles.monthTitle}>
          {LONG_MONTHS[calMonth].toUpperCase()}  {calYear}
        </Text>
        <Pressable onPress={nextMonth} style={calStyles.navBtn}>
          <Text style={calStyles.navArrow}>›</Text>
        </Pressable>
      </View>

      {/* Day-of-week headers */}
      <View style={calStyles.headerRow}>
        {CAL_DAYS.map((d, i) => (
          <Text key={i} style={calStyles.dayHeader}>{d}</Text>
        ))}
      </View>

      {/* Date grid */}
      <View style={calStyles.grid}>
        {cells.map((day, idx) => {
          if (!day) return <View key={`blank-${idx}`} style={calStyles.cell} />;
          const key       = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const hasEvent  = eventDateSet.has(key);
          const isToday   = key === todayKey;
          const isSelected = key === selectedDay;
          return (
            <Pressable
              key={key}
              style={[
                calStyles.cell,
                isSelected && calStyles.cellSelected,
                isToday && !isSelected && calStyles.cellToday,
              ]}
              onPress={() => onDaySelect(isSelected ? null : key)}
            >
              <Text style={[
                calStyles.dayNum,
                isSelected && calStyles.dayNumSelected,
                isToday && !isSelected && calStyles.dayNumToday,
              ]}>
                {day}
              </Text>
              {hasEvent && (
                <View style={[calStyles.dot, isSelected && calStyles.dotSelected]} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({
  item,
  router,
}: {
  item: Event;
  router: ReturnType<typeof useRouter>;
}) {
  const rawStart = eventStartKey(item);

  const handlePress = async () => {
    if (item.sourceUrl) {
      await openBrowserAsync(item.sourceUrl);
    } else if (item.winerySlug) {
      router.push(`/wineries/${item.winerySlug}?from=events`);
    }
  };

  const venueLine = item.venue ?? item.wineryName ?? "MARGARET RIVER REGION";
  const hasLink   = !!(item.sourceUrl || item.winerySlug);

  return (
    <Pressable style={cardStyles.card} onPress={hasLink ? handlePress : undefined}>

      {/* Hero image */}
      <View style={cardStyles.imageWrapper}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={cardStyles.image} resizeMode="cover" />
        ) : (
          <View style={cardStyles.imagePlaceholder}>
            <Text style={cardStyles.imagePlaceholderGlyph}>🍷</Text>
          </View>
        )}
        <LinearGradient
          colors={["rgba(0,0,0,0.40)", "transparent", "rgba(0,0,0,0.60)"]}
          style={cardStyles.gradient}
        />

        {/* Date badge — top left */}
        {rawStart && (
          <View style={cardStyles.dateBadge}>
            <Text style={cardStyles.dateBadgeText}>{formatBadgeDate(rawStart)}</Text>
          </View>
        )}

        {/* Sponsored badge — top right */}
        {item.isWinerySponsored && (
          <View style={cardStyles.sponsoredBadge}>
            <Text style={cardStyles.sponsoredText}>WINERY SPONSORED</Text>
          </View>
        )}
      </View>

      {/* Card body */}
      <View style={cardStyles.body}>
        <Text style={cardStyles.venueLabel} numberOfLines={1}>
          {venueLine.toUpperCase()}
        </Text>

        <Text style={cardStyles.title}>{item.title}</Text>

        {rawStart && (
          <View style={cardStyles.dateRow}>
            <Ionicons name="calendar-outline" size={13} color="#999" style={cardStyles.dateIcon} />
            <View>
              <Text style={cardStyles.dateText}>From:  {formatDisplayDate(rawStart)}</Text>
              {item.endDate && item.endDate !== rawStart && (
                <Text style={cardStyles.dateText}>Ends:  {formatDisplayDate(item.endDate)}</Text>
              )}
            </View>
          </View>
        )}

        {hasLink && (
          <View style={cardStyles.ctaRow}>
            <Text style={cardStyles.ctaText}>
              {item.sourceUrl ? "VIEW ON MARGARETRIVER.COM" : "LEARN MORE"}
            </Text>
            <Text style={cardStyles.ctaArrow}>›</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: "all",   label: "All" },
  { key: "today", label: "Today" },
  { key: "week",  label: "This Week" },
  { key: "month", label: "This Month" },
];

export default function EventsScreen() {
  const [events,      setEvents]      = useState<Event[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [timeFilter,  setTimeFilter]  = useState<TimeFilter>("all");
  const [wineryOnly,  setWineryOnly]  = useState(false);
  const [viewMode,    setViewMode]    = useState<"list" | "calendar">("list");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const snapshot = await getDocs(collection(db, "events"));
        const list: Event[] = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Event, "id">) }))
          .sort((a, b) => eventStartKey(a).localeCompare(eventStartKey(b)));
        setEvents(list);
      } catch (err) {
        console.error("Error fetching events:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      // If the user tapped a calendar day, override time filter
      if (selectedDay) {
        const rawStart = eventStartKey(e);
        if (!rawStart) return false;
        const start = parseLocalDate(rawStart);
        const end   = e.endDate ? parseLocalDate(e.endDate) : new Date(start);
        const sel   = parseLocalDate(selectedDay);
        if (!(start <= sel && sel <= end)) return false;
      } else {
        if (!eventMatchesTimeFilter(e, timeFilter)) return false;
      }
      if (wineryOnly && !e.isWinerySponsored) return false;
      return true;
    });
  }, [events, timeFilter, wineryOnly, selectedDay]);

  const handleDaySelect = useCallback((day: string | null) => {
    setSelectedDay(day);
  }, []);

  const handleTimeFilter = useCallback((f: TimeFilter) => {
    setTimeFilter(f);
    setSelectedDay(null);
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header skeleton */}
        <View style={skeletonStyles.header}>
          <SkeletonBox style={skeletonStyles.headerLabelLine} />
          <SkeletonBox style={skeletonStyles.headerTitleLine} />
        </View>

        {/* Filter chips skeleton */}
        <View style={skeletonStyles.chipsRow}>
          {[80, 60, 90, 72].map((w, i) => (
            <SkeletonBox
              key={i}
              style={[skeletonStyles.chip, { width: w }]}
            />
          ))}
        </View>

        {/* Divider skeleton */}
        <View style={skeletonStyles.dividerRow}>
          <View style={skeletonStyles.dividerLine} />
          <SkeletonBox style={skeletonStyles.dividerLabel} />
          <View style={skeletonStyles.dividerLine} />
        </View>

        {/* Event card skeletons */}
        {[0, 1, 2].map((i) => (
          <View key={i} style={skeletonStyles.card}>
            <SkeletonBox style={skeletonStyles.cardImage} />
            <View style={skeletonStyles.cardBody}>
              <SkeletonBox style={skeletonStyles.venueLine} />
              <SkeletonBox style={skeletonStyles.titleLine1} />
              <SkeletonBox style={skeletonStyles.titleLine2} />
              <SkeletonBox style={skeletonStyles.dateLine} />
            </View>
            {i < 2 && <View style={skeletonStyles.separator} />}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>CALENDAR</Text>
          <Text style={styles.headerTitle}>Events</Text>
        </View>
        <Pressable
          style={[styles.calToggle, viewMode === "calendar" && styles.calToggleActive]}
          onPress={() => setViewMode((v) => (v === "list" ? "calendar" : "list"))}
        >
          <Ionicons
            name="calendar-outline"
            size={20}
            color={viewMode === "calendar" ? "#fff" : "#1a1a1a"}
          />
        </Pressable>
      </View>

      {/* ── Filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScroll}
        contentContainerStyle={styles.filtersRow}
      >
        {TIME_FILTERS.map(({ key, label }) => {
          const active = timeFilter === key && !selectedDay;
          return (
            <Pressable
              key={key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => handleTimeFilter(key)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}

        {/* Divider between time filters and attribute filters */}
        <View style={styles.chipDivider} />

        <Pressable
          style={[styles.chip, wineryOnly && styles.chipActive]}
          onPress={() => setWineryOnly((v) => !v)}
        >
          <Text style={[styles.chipText, wineryOnly && styles.chipTextActive]}>
            Winery Sponsored
          </Text>
        </Pressable>
      </ScrollView>

      {/* ── Calendar (conditionally shown) ── */}
      {viewMode === "calendar" && (
        <CalendarView
          events={events}
          selectedDay={selectedDay}
          onDaySelect={handleDaySelect}
        />
      )}

      {/* ── Count divider ── */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>
          {selectedDay
            ? formatDisplayDate(selectedDay)
            : `${filtered.length} ${filtered.length === 1 ? "EVENT" : "EVENTS"}`}
        </Text>
        <View style={styles.dividerLine} />
      </View>

      {/* ── Event list ── */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <EventCard item={item} router={router} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyLabel}>NO EVENTS</Text>
            <Text style={styles.emptyText}>
              {selectedDay
                ? "No events on this date."
                : "Check back soon for upcoming events."}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#faf9f6",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#faf9f6",
    gap: 12,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
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
  calToggle: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 2,
  },
  calToggleActive: {
    backgroundColor: "#1a1a1a",
  },

  // Filter chips
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
    letterSpacing: 0.8,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  chipTextActive: {
    color: "#fff",
  },
  chipDivider: {
    width: 1,
    height: 18,
    backgroundColor: "#e0e0e0",
    marginHorizontal: 4,
  },

  // Count divider
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 10,
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
    gap: 0,
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginVertical: 10,
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
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
});

// Calendar styles
const calStyles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 24,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e8e8e8",
    padding: 16,
    backgroundColor: "#faf9f6",
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  navBtn: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  navArrow: {
    fontSize: 22,
    color: "#1a1a1a",
    fontWeight: "300",
  },
  monthTitle: {
    fontSize: 12,
    fontFamily: "Georgia",
    letterSpacing: 2,
    color: "#1a1a1a",
    fontWeight: "600",
  },
  headerRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  dayHeader: {
    flex: 1,
    textAlign: "center",
    fontSize: 9,
    letterSpacing: 1,
    color: "#bbb",
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 2,
  },
  cellToday: {
    borderWidth: 1,
    borderColor: "#1a1a1a",
  },
  cellSelected: {
    backgroundColor: "#1a1a1a",
  },
  dayNum: {
    fontSize: 13,
    color: "#1a1a1a",
    fontWeight: "400",
  },
  dayNumToday: {
    fontWeight: "700",
  },
  dayNumSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#4B0E15",
  },
  dotSelected: {
    backgroundColor: "#fff",
  },
});

// Card styles
const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: "#faf9f6",
    overflow: "hidden",
  },

  // Image section
  imageWrapper: {
    height: 210,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePlaceholderGlyph: {
    fontSize: 36,
    opacity: 0.4,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },

  // Date badge (top-left over image)
  dateBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    backgroundColor: "rgba(26,26,26,0.82)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dateBadgeText: {
    fontSize: 10,
    letterSpacing: 2.5,
    color: "#fff",
    fontWeight: "600",
  },

  // Sponsored badge (top-right over image)
  sponsoredBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    backgroundColor: "#4B0E15",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sponsoredText: {
    fontSize: 8,
    letterSpacing: 1.5,
    color: "#fff",
    fontWeight: "600",
  },

  // Card body
  body: {
    paddingTop: 14,
    paddingBottom: 16,
  },
  venueLabel: {
    fontSize: 9,
    letterSpacing: 2.5,
    color: "#999",
    marginBottom: 7,
  },
  title: {
    fontSize: 21,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#1a1a1a",
    lineHeight: 27,
    marginBottom: 10,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginBottom: 12,
  },
  dateIcon: {
    marginTop: 1,
  },
  dateText: {
    fontSize: 12,
    color: "#666",
    letterSpacing: 0.3,
    lineHeight: 19,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ctaText: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#1a1a1a",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 1,
  },
  ctaArrow: {
    fontSize: 14,
    color: "#1a1a1a",
  },
});

const skeletonStyles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 10,
  },
  headerLabelLine: {
    height: 8,
    width: 100,
    borderRadius: 4,
  },
  headerTitleLine: {
    height: 28,
    width: 160,
    borderRadius: 4,
  },
  chipsRow: {
    flexDirection: "row",
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    height: 28,
    borderRadius: 999,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e0e0",
  },
  dividerLabel: {
    height: 8,
    width: 60,
    borderRadius: 4,
  },
  card: {
    paddingHorizontal: 24,
  },
  cardImage: {
    height: 200,
    borderRadius: 4,
    marginBottom: 14,
  },
  cardBody: {
    gap: 10,
    marginBottom: 16,
  },
  venueLine: {
    height: 8,
    width: "45%",
    borderRadius: 4,
  },
  titleLine1: {
    height: 16,
    width: "90%",
    borderRadius: 4,
  },
  titleLine2: {
    height: 16,
    width: "65%",
    borderRadius: 4,
  },
  dateLine: {
    height: 10,
    width: "55%",
    borderRadius: 4,
  },
  separator: {
    height: 1,
    backgroundColor: "#e8e8e8",
    marginVertical: 16,
  },
});
