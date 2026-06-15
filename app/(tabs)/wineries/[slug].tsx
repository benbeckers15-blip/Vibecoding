// app/(tabs)/wineries/[slug].tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
import { withScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
// Dark bg · glass header · gold accents · dark info grid · dark modal

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import SkeletonBox from "../../../components/SkeletonBox";
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { useAuth } from "../../../context/AuthContext";
import { useRegionConfig } from "../../../context/RegionContext";
import { useSaved } from "../../../context/SavedContext";
import { db } from "../../../firebaseConfig";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeOpenURL(url: string) {
  const trimmed = url.trim();
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  Linking.openURL(withProtocol).catch(() =>
    console.warn("Could not open URL:", withProtocol)
  );
}

// Open the user's native maps app with directions to a winery.
// On iOS we use Apple Maps; on Android we use a `geo:` URI so the system
// chooser picks Google Maps (or the user's default). We fall back to the
// universal Google Maps URL if the platform-specific scheme fails to open.
function openDirections(lat: number, lng: number, name: string) {
  const label = encodeURIComponent(name);
  const universal = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const url = Platform.select({
    ios: `http://maps.apple.com/?daddr=${lat},${lng}&q=${label}`,
    android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
    default: universal,
  }) as string;

  Linking.openURL(url).catch(() =>
    Linking.openURL(universal).catch(() =>
      console.warn("Could not open directions for", name)
    )
  );
}

const { width, height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = 400;
const PARALLAX_EXTRA = 80;

// ─── Types ────────────────────────────────────────────────────────────────────
interface HoursEntry {
  day: string;
  time: string;
}

interface WineryData {
  name: string;
  images: string[];
  description: string[];
  pullQuote?: string;
  phone: string;
  website: string;
  hours: HoursEntry[];
  byAppointmentOnly?: boolean;
  dogFriendly?: boolean;
  hasRestaurant?: boolean;
  isOrganic?: boolean;
  isBiodynamic?: boolean;
  hasCharcuterie?: boolean;
  hasWifi?: boolean;
  hasFireplace?: boolean;
  wheelchairAccessible?: boolean;
  rating?: number;
  userRatingsTotal?: number;
  region?: string;
  latitude?: number;
  longitude?: number;
}

// ── Section tabs (About / Events / Tasting Notes) ────────────────────────────
type DetailTab = "about" | "wines" | "events" | "tastings";

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "about",    label: "About" },
  { id: "wines",    label: "Wines" },
  { id: "events",   label: "Events" },
  { id: "tastings", label: "Tasting Notes" },
];

/** Wine docs from the public `wines` collection (the same collection the
 *  concierge's tasting-note index is built from — see
 *  scripts/rag/ingest-tasting-notes.js for the authoritative field list). */
interface WineDoc {
  id: string;
  name: string;
  vintage: string;
  variety: string;
  style: string;
  abv: string;
  price: string;
  tastingNotes: string;
  pairings: string;
  awards: string;
  /** Optional bottle/label photo — uploaded by the winery via the web portal. */
  image: string;
  boost: number;
}

/** Event docs from the public `events` collection, shaped for display. */
interface WineryEvent {
  id: string;
  title: string;
  venue: string;
  dateLabel: string;
  /** Raw ISO start date (YYYY-MM-DD) — chronological sort key. */
  sortDate: string;
  description: string;
  image: string;
  sourceUrl: string;
  isPast: boolean;
}

/** Community tasting notes from the public `winery_tastings` collection. */
interface CommunityTastingNote {
  id: string;
  wine: string;
  score: number;
  note: string;
  authorName: string;
  dateLabel: string;
  sortKey: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-03-12" → "12 Mar 2026". Falls back to the raw string. */
function formatISODate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/** Single date or "12 Mar – 14 Mar 2026"-style range label. */
function formatEventRange(start: string, end: string): string {
  if (!start) return "";
  if (!end || end === start) return formatISODate(start);
  return `${formatISODate(start)} – ${formatISODate(end)}`;
}

/** Firestore Timestamp (or anything with toDate) → "12 Mar 2026". */
function formatTimestamp(ts: unknown): string {
  if (!ts || typeof (ts as { toDate?: unknown }).toDate !== "function") {
    return "";
  }
  const d = (ts as { toDate: () => Date }).toDate();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Firestore Timestamp → millis for client-side sorting (no composite index). */
function timestampMillis(ts: unknown): number {
  if (!ts || typeof (ts as { toMillis?: unknown }).toMillis !== "function") {
    return 0;
  }
  return (ts as { toMillis: () => number }).toMillis();
}

// Feature badges — Ionicon names instead of emoji.
// Emoji rendered platform-default colors that fought the warm-paper palette
// and broke VoiceOver ("dog face emoji"). These render in `colors.accent`
// (forest) so the badges read as part of the brand system.
//
// `paw`              — Dog Friendly
// `restaurant-outline` — Restaurant
// `leaf-outline`     — Organic / herbal / earth
// `flower-outline`   — Biodynamic / living-soil
const FEATURE_BADGES: {
  key: keyof WineryData;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "dogFriendly",   label: "Dog Friendly", icon: "paw"                 },
  { key: "hasRestaurant", label: "Restaurant",   icon: "restaurant-outline"  },
  { key: "isOrganic",     label: "Organic",      icon: "leaf-outline"        },
  { key: "isBiodynamic",  label: "Biodynamic",   icon: "flower-outline"      },
  { key: "hasCharcuterie",       label: "Charcuterie",          icon: "fast-food-outline"     },
  { key: "hasWifi",              label: "Wi-Fi",                icon: "wifi-outline"          },
  { key: "hasFireplace",         label: "Fireplace",            icon: "flame-outline"         },
  { key: "wheelchairAccessible", label: "Wheelchair Accessible", icon: "accessibility-outline" },
];

function normaliseHours(raw: unknown): HoursEntry[] {
  if (Array.isArray(raw) && raw.length > 0) return raw as HoursEntry[];
  if (typeof raw === "string" && raw.trim())
    return [{ day: "Hours", time: raw.trim() }];
  return [{ day: "Hours", time: "N/A" }];
}

// ─── Screen ───────────────────────────────────────────────────────────────────
function WineryDetailsScreen() {
  const { slug, from, tripId, kind } = useLocalSearchParams<{
    slug: string;
    from?: string;
    tripId?: string;
    kind?: string;
  }>();
  const backLabel =
    from === "events"    ? "Events"    :
    from === "wineries"  ? "Wineries"  :
    from === "home"      ? "Home"      :
    from === "trip"      ? "Trip"      :
    from === "concierge" ? "Chat"      : "Back";

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const region = useRegionConfig();
  const { user } = useAuth();
  const { isSaved: isWinerySaved, toggle: toggleSavedWinery } = useSaved();
  const [winery, setWinery] = useState<WineryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoursVisible, setHoursVisible] = useState(false);

  // ── Section tabs (About / Events / Tasting Notes) ─────────────────────────
  // Two pieces of state so a tab switch can feel smooth when the user has
  // scrolled deep into a long section:
  //   • `tab`        — the SELECTED tab. Updates instantly (underline moves,
  //                    data fetching kicks off).
  //   • `contentTab` — the tab whose content is RENDERED. When the user is
  //                    scrolled past the tab strip, we first glide the scroll
  //                    back up to the strip, then swap the content. Swapping
  //                    immediately would shrink the content under the user's
  //                    feet and the scroll position would clamp with an
  //                    abrupt snap to the top.
  const [tab, setTab] = useState<DetailTab>("about");
  const [contentTab, setContentTab] = useState<DetailTab>("about");
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const tabsYRef = useRef(0);
  const tabSwapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function switchTab(next: DetailTab) {
    if (next === tab && next === contentTab) return;
    setTab(next);
    if (tabSwapTimer.current) clearTimeout(tabSwapTimer.current);
    const tabsY = tabsYRef.current;
    if (scrollY.value > tabsY && tabsY > 0) {
      // Scroll the strip to the top of the viewport first; the old (long)
      // content stays mounted during the glide so nothing clamps.
      scrollRef.current?.scrollTo({ y: tabsY, animated: true });
      tabSwapTimer.current = setTimeout(() => setContentTab(next), 300);
    } else {
      setContentTab(next);
    }
  }

  // Clear any pending content swap on unmount.
  useEffect(() => {
    return () => {
      if (tabSwapTimer.current) clearTimeout(tabSwapTimer.current);
    };
  }, []);

  // Events — fetched lazily the first time the tab is opened.
  const [events, setEvents] = useState<WineryEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Wines — fetched lazily the first time the tab is opened.
  const [wines, setWines] = useState<WineDoc[]>([]);
  const [winesLoading, setWinesLoading] = useState(false);
  const [winesLoaded, setWinesLoaded] = useState(false);
  const [expandedWineId, setExpandedWineId] = useState<string | null>(null);

  // Community tasting notes — live subscription while the tab is open.
  const [notes, setNotes] = useState<CommunityTastingNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);

  // Add-a-note form
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [formWine, setFormWine] = useState("");
  const [formScore, setFormScore] = useState(0);
  const [formNote, setFormNote] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  // Saved state comes from the shared SavedContext (live Firestore sync),
  // so hearts on the list screen and this page always agree.
  const isSaved = slug ? isWinerySaved(slug) : false;

  // Parallax scroll tracking
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });
  const heroParallaxStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [0, HERO_HEIGHT],
          [0, -PARALLAX_EXTRA],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const docRef = doc(db, "wineries", slug);
        // getDocFromServer bypasses the in-memory cache so portal-approved
        // changes (photo reorders, new images) always appear immediately.
        const docSnap = await getDocFromServer(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setWinery({
            name:            data.name || "Unnamed Winery",
            images:          Array.isArray(data.images) ? data.images : [],
            description:     Array.isArray(data.description)
                               ? data.description
                               : [String(data.description || "")],
            pullQuote:       data.pullQuote || undefined,
            phone:           (data.phone || "N/A").trim(),
            website:         (data.website || "").trim(),
            hours:           normaliseHours(data.hoursStructured ?? data.hours),
            byAppointmentOnly: !!data.byAppointmentOnly,
            dogFriendly:     !!data.dogFriendly,
            hasRestaurant:   !!data.hasRestaurant,
            isOrganic:       !!data.isOrganic,
            isBiodynamic:    !!data.isBiodynamic,
            hasCharcuterie:  !!data.hasCharcuterie,
            hasWifi:         !!data.hasWifi,
            hasFireplace:    !!data.hasFireplace,
            wheelchairAccessible: !!data.wheelchairAccessible,
            rating:          typeof data.rating === "number" ? data.rating : undefined,
            userRatingsTotal: typeof data.userRatingsTotal === "number"
                               ? data.userRatingsTotal : undefined,
            region:          typeof data.region === "string" && data.region.trim()
                               ? data.region.trim() : undefined,
            latitude:        typeof data.latitude === "number" ? data.latitude : undefined,
            longitude:       typeof data.longitude === "number" ? data.longitude : undefined,
          });
        } else {
          console.warn("No such winery found!");
        }
      } catch (error) {
        console.error("Error fetching winery:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // ── Events — re-fetch every time the Events tab is opened (not just first) ──
  // Using getDocsFromServer (bypasses cache) + re-fetching on each tab switch
  // ensures newly-approved events appear without requiring an app restart.
  useEffect(() => {
    if (tab !== "events" || !slug) return;
    let cancelled = false;
    (async () => {
      setEventsLoading(true);
      try {
        // getDocsFromServer bypasses the Firebase in-memory cache so newly-
        // approved events always appear without requiring an app restart.
        const snap = await getDocsFromServer(
          query(collection(db, "events"), where("winerySlug", "==", slug))
        );
        if (cancelled) return;
        const today = new Date().toISOString().slice(0, 10);
        const items: WineryEvent[] = snap.docs.map((d) => {
          const data = d.data();
          const start: string = data.startDate ?? data.date ?? "";
          const end: string = data.endDate ?? "";
          return {
            id:          d.id,
            title:       data.title ?? "Event",
            venue:       data.venue ?? "",
            dateLabel:   formatEventRange(start, end),
            sortDate:    start,
            description: data.description ?? "",
            image:       data.image ?? "",
            sourceUrl:   data.sourceUrl ?? "",
            isPast:      Boolean(start) && (end || start) < today,
          };
        });
        // Upcoming first (soonest at the top), then past (most recent first).
        const upcoming = items
          .filter((e) => !e.isPast)
          .sort((a, b) => a.sortDate.localeCompare(b.sortDate));
        const past = items
          .filter((e) => e.isPast)
          .sort((a, b) => b.sortDate.localeCompare(a.sortDate));
        setEvents([...upcoming, ...past]);
      } catch (err) {
        console.warn("[winery detail] failed to load events:", err);
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, slug]);

  // ── Wines — lazy fetch on first open of the Wines tab ─────────────────────
  useEffect(() => {
    if (tab !== "wines" || winesLoaded || !slug) return;
    let cancelled = false;
    (async () => {
      setWinesLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, "wines"), where("wineryId", "==", slug))
        );
        if (cancelled) return;
        const items: WineDoc[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id:           d.id,
            name:         String(data.name ?? "Unnamed wine"),
            vintage:      String(data.vintage ?? ""),
            // `varietal` is a legacy alias for `variety` in the source sheet.
            variety:      String(data.variety ?? data.varietal ?? ""),
            style:        String(data.style ?? ""),
            abv:          String(data.abv ?? ""),
            price:        String(data.price ?? ""),
            tastingNotes: String(data.tastingNotes ?? ""),
            pairings:     String(data.pairings ?? ""),
            awards:       String(data.awards ?? ""),
            image:        String(data.image ?? ""),
            boost:        typeof data.boost === "number" ? data.boost : 0,
          };
        });
        // Boosted wines first (same signal the concierge ranks on), then A–Z.
        items.sort(
          (a, b) => b.boost - a.boost || a.name.localeCompare(b.name)
        );
        setWines(items);
        setWinesLoaded(true);
      } catch (err) {
        console.warn("[winery detail] failed to load wines:", err);
      } finally {
        if (!cancelled) setWinesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, winesLoaded, slug]);

  // ── Community tasting notes — live while the tab is open ──────────────────
  useEffect(() => {
    if (tab !== "tastings" || !slug) return;
    setNotesLoading(true);
    const unsub = onSnapshot(
      // Equality filter only — sorted client-side so no composite index is
      // needed on the new collection.
      query(collection(db, "winery_tastings"), where("winerySlug", "==", slug)),
      (snap) => {
        const items: CommunityTastingNote[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id:         d.id,
            wine:       data.wine ?? "",
            score:      typeof data.score === "number" ? data.score : 0,
            note:       data.note ?? "",
            authorName: data.authorName ?? "Anonymous",
            dateLabel:  formatTimestamp(data.createdAt),
            sortKey:    timestampMillis(data.createdAt),
          };
        });
        items.sort((a, b) => b.sortKey - a.sortKey);
        setNotes(items);
        setNotesLoading(false);
      },
      (err) => {
        console.warn("[winery detail] tasting notes listener error:", err);
        setNotesLoading(false);
      }
    );
    return unsub;
  }, [tab, slug]);

  // ── Post a community tasting note ──────────────────────────────────────────
  async function submitTastingNote() {
    const wine = formWine.trim();
    const note = formNote.trim();
    if (!user || !winery || !slug || !wine || formScore === 0 || submittingNote)
      return;
    setSubmittingNote(true);
    try {
      // Display name from the user's profile doc, falling back to the email
      // prefix so notes are never blankly attributed.
      let authorName = "";
      try {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        authorName = String(uSnap.data()?.name ?? "").trim();
      } catch {
        /* fall through to email prefix */
      }
      if (!authorName) authorName = user.email?.split("@")[0] ?? "Guest";

      await addDoc(collection(db, "winery_tastings"), {
        winerySlug: slug,
        wineryName: winery.name,
        wine,
        score:      formScore,
        note,
        authorId:   user.uid,
        authorName,
        createdAt:  serverTimestamp(),
      });
      // Mirror into the private profile subcollection so the profile's
      // Tastings list and Palate breakdown keep working.
      await addDoc(collection(db, "users", user.uid, "tastings"), {
        wineryName: winery.name,
        wine,
        score:     formScore,
        note,
        createdAt: serverTimestamp(),
      });
      setFormWine("");
      setFormScore(0);
      setFormNote("");
      setNoteFormOpen(false);
    } catch (err) {
      console.warn("[winery detail] failed to post tasting note:", err);
    } finally {
      setSubmittingNote(false);
    }
  }

  // ── Toggle save / unsave (delegates to SavedContext → Firestore) ──────────
  function toggleSave() {
    if (!slug || !winery) return;
    toggleSavedWinery(slug, {
      name:   winery.name,
      image:  winery.images[0] ?? "",
      rating: winery.rating,
      region: region.displayName,
    });
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <SkeletonBox
          style={{ height: HERO_HEIGHT, borderRadius: 0, backgroundColor: colors.surfaceDeep }}
        />
        <View style={skeletonStyles.infoGrid}>
          <View style={skeletonStyles.infoCell}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.subLine,   { backgroundColor: colors.surfaceDeep }]} />
          </View>
          <View style={[skeletonStyles.infoCell, skeletonStyles.infoCellBorderLeft]}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { backgroundColor: colors.surfaceDeep }]} />
          </View>
        </View>
        <View style={skeletonStyles.contactRow}>
          <View style={skeletonStyles.infoCell}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { width: "60%", backgroundColor: colors.surfaceDeep }]} />
          </View>
          <View style={[skeletonStyles.infoCell, skeletonStyles.infoCellBorderLeft]}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { width: "70%", backgroundColor: colors.surfaceDeep }]} />
          </View>
        </View>
        <View style={skeletonStyles.aboutSection}>
          <View style={skeletonStyles.dividerSkeleton}>
            <View style={skeletonStyles.dividerLine} />
            <SkeletonBox style={[skeletonStyles.dividerLabel, { backgroundColor: colors.surfaceDeep }]} />
            <View style={skeletonStyles.dividerLine} />
          </View>
          <SkeletonBox style={[skeletonStyles.textLineLg, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineLg, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineLg, { width: "75%", backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={{ height: 12, marginTop: 20, backgroundColor: colors.surfaceDeep }} />
          <SkeletonBox style={[skeletonStyles.textLineSm, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineSm, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineSm, { width: "60%", backgroundColor: colors.surfaceDeep }]} />
        </View>
      </View>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!winery) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundLabel}>WINERY NOT FOUND</Text>
        <Text style={styles.notFoundText}>This winery could not be loaded.</Text>
      </View>
    );
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out ${winery.name} — a winery in ${region.displayName}!`,
        url: winery.website || "",
      });
    } catch (e) {
      console.warn("Share failed:", e);
    }
  };

  return (
    // The whole screen starts below the status bar / Dynamic Island so the
    // hero photo is never cut by the front-facing camera. The strip above
    // is solid page background.
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ── Hero Carousel ─────────────────────────────────────────────────── */}
        <View style={styles.heroContainer}>

          {/* Glass header buttons — hero already sits below the notch, so
              these only need a small inset from its top edge. */}
          <View style={[styles.headerOverlay, { top: spacing.md }]}>
            <Pressable
              style={styles.headerBtn}
              onPress={() => {
                // The concierge case has to OVERRIDE the natural
                // stack pop: even if `canGoBack()` would return us
                // to the home screen, we still need to signal "open
                // the chat again on arrival" via a query param.
                // Falling through to router.back() would dump the
                // user on a closed-chat home screen with no way back
                // to the conversation they were in.
                if (from === "concierge") {
                  router.replace("/(tabs)/home?openConcierge=1" as any);
                  return;
                }
                // When the user arrived from a trip itinerary, route them back
                // to that specific trip — NOT a plain router.back(). The winery
                // detail was pushed onto the *wineries* tab stack (rooted at the
                // wineries list), so router.back() would pop to the list rather
                // than the trip the user came from. Override the natural pop the
                // same way the concierge case does.
                if (from === "trip" && tripId) {
                  const kindQS = kind ? `?kind=${kind}` : "";
                  router.replace(
                    `/trips/${encodeURIComponent(tripId)}${kindQS}` as any
                  );
                  return;
                }
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(tabs)/wineries");
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={`Back to ${backLabel}`}
            >
              <Ionicons name="chevron-back" size={16} color={colors.textOnDark} />
              <Text style={styles.headerBtnText}>{backLabel}</Text>
            </Pressable>
            <View style={styles.headerRight}>
              <Pressable
                style={styles.headerIconBtn}
                onPress={handleShare}
                accessibilityRole="button"
                accessibilityLabel={`Share ${winery.name}`}
              >
                <Ionicons name="share-outline" size={16} color={colors.textOnDark} />
              </Pressable>
            </View>
          </View>

          {/* Images */}
          {winery.images.length > 0 ? (
            <Carousel
              width={width}
              height={HERO_HEIGHT}
              data={winery.images}
              loop={winery.images.length > 1}
              autoPlay={winery.images.length > 1}
              autoPlayInterval={4000}
              scrollAnimationDuration={800}
              onSnapToItem={(index) => setCurrentIndex(index)}
              mode="parallax"
              modeConfig={{
                parallaxScrollingScale: 0.9,
                parallaxScrollingOffset: 50,
              }}
              renderItem={({ item }) => (
                <View style={styles.heroCardFrame}>
                  <Animated.View style={heroParallaxStyle}>
                    <View style={styles.heroImage}>
                      <Image
                        source={{ uri: String(item) }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={200}
                      />
                      {/* Gradient fades to dark bg so content below blends */}
                      {/* Dark scrim deepens toward the bottom so the title
                          overlay reads cleanly on any photo. The page below
                          (paper) begins right at the photo's edge. */}
                      <LinearGradient
                        colors={[
                          "transparent",
                          colors.photoOverlaySoft,
                          colors.photoOverlayStrong,
                        ]}
                        locations={[0, 0.5, 1]}
                        style={styles.heroGradient}
                      />
                    </View>
                  </Animated.View>
                </View>
              )}
            />
          ) : (
            <Animated.View style={[styles.heroPlaceholder, heroParallaxStyle]}>
              <Text style={styles.heroPlaceholderEmoji}>🍷</Text>
              <Text style={styles.heroPlaceholderName}>{winery.name}</Text>
            </Animated.View>
          )}

          {/* Winery name + rating overlaid on hero */}
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>{winery.name}</Text>
            {winery.rating != null && (
              <View style={styles.heroRatingRow}>
                <Text style={styles.heroRatingStar}>
                  ★ {winery.rating.toFixed(1)}
                </Text>
                {winery.userRatingsTotal != null && (
                  <Text style={styles.heroRatingCount}>
                    ({winery.userRatingsTotal.toLocaleString()})
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Save (heart) — bottom-right of the hero */}
          <Pressable
            style={[styles.headerIconBtn, styles.heroSaveBtn]}
            onPress={toggleSave}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? "Unsave winery" : "Save winery"}
          >
            <Ionicons
              name={isSaved ? "heart" : "heart-outline"}
              size={16}
              color={isSaved ? colors.error : colors.textOnDark}
            />
          </Pressable>

          {/* Pagination dashes */}
          {winery.images.length > 1 && (
            <View style={styles.dotsContainer}>
              {winery.images.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === currentIndex && styles.dotActive]}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Info Grid — Hours | Location ──────────────────────────────────── */}
        <View style={styles.infoGrid}>
          {/* Hours cell */}
          {winery.byAppointmentOnly ? (
            <Pressable
              style={styles.infoCell}
              onPress={() => winery.website ? safeOpenURL(winery.website) : undefined}
              disabled={!winery.website}
              accessibilityRole="button"
              accessibilityLabel={
                winery.website
                  ? "By appointment only. Book via website."
                  : "By appointment only"
              }
            >
              <Text style={styles.infoCellLabel}>HOURS</Text>
              <View style={styles.valueRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                <Text style={styles.appointmentLink}>By Appointment Only</Text>
              </View>
              {winery.website ? (
                <Text style={styles.infoCellTap}>Book via website ›</Text>
              ) : null}
            </Pressable>
          ) : (
            <Pressable
              style={styles.infoCell}
              onPress={() => setHoursVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="See all opening hours"
            >
              <Text style={styles.infoCellLabel}>HOURS</Text>
              <View style={styles.valueRow}>
                <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                <Text style={styles.infoCellValue}>
                  {winery.hours[0]?.time ?? "N/A"}
                </Text>
              </View>
              <Text style={styles.infoCellTap}>See all hours ›</Text>
            </Pressable>
          )}

          {/* Location cell */}
          {(() => {
            const hasCoords =
              typeof winery.latitude === "number" &&
              typeof winery.longitude === "number" &&
              Number.isFinite(winery.latitude) &&
              Number.isFinite(winery.longitude);
            const locationLabel = winery.region || region.displayName;
            const Wrapper: React.ComponentType<any> = hasCoords ? Pressable : View;
            return (
              <Wrapper
                style={[styles.infoCell, styles.infoCellBorderLeft]}
                onPress={
                  hasCoords
                    ? () =>
                        openDirections(
                          winery.latitude as number,
                          winery.longitude as number,
                          winery.name
                        )
                    : undefined
                }
                accessibilityRole={hasCoords ? "button" : undefined}
                accessibilityLabel={
                  hasCoords
                    ? `Get directions to ${winery.name} in ${locationLabel}`
                    : undefined
                }
              >
                <Text style={styles.infoCellLabel}>LOCATION</Text>
                <View style={styles.valueRow}>
                  <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                  <Text style={styles.infoCellValue}>{locationLabel}</Text>
                </View>
                {hasCoords ? (
                  <Text style={styles.infoCellTap}>Get directions ›</Text>
                ) : null}
              </Wrapper>
            );
          })()}
        </View>

        {/* ── Contact Row — Call | Website ──────────────────────────────────── */}
        <View style={styles.contactRow}>
          {winery.phone !== "N/A" && (
            <Pressable
              style={styles.contactBtn}
              onPress={() =>
                Linking.openURL(
                  `tel:${winery.phone.replace(/\s/g, "")}`
                ).catch(() => console.warn("Could not open phone link"))
              }
              accessibilityRole="button"
              accessibilityLabel={`Call ${winery.name} at ${winery.phone}`}
            >
              <Text style={styles.contactLabel}>CALL</Text>
              <View style={styles.valueRow}>
                <Ionicons name="call-outline" size={16} color={colors.textMuted} />
                <Text style={styles.contactValue}>{winery.phone}</Text>
              </View>
            </Pressable>
          )}

          {winery.website ? (
            <Pressable
              style={[
                styles.contactBtn,
                winery.phone !== "N/A" && styles.contactBtnBorderLeft,
              ]}
              onPress={() => safeOpenURL(winery.website)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${winery.name} website`}
            >
              <Text style={styles.contactLabel}>WEBSITE</Text>
              <View style={styles.valueRow}>
                <Ionicons name="globe-outline" size={16} color={colors.textMuted} />
                <Text style={styles.contactLink} numberOfLines={1}>
                  {winery.website
                    .replace(/^https?:\/\//, "")
                    .replace(/^www\./, "")
                    .replace(/\/.*$/, "")}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {/* ── Feature Badges ────────────────────────────────────────────────── */}
        {FEATURE_BADGES.some(({ key }) => winery[key]) && (
          <View style={styles.badgesRow}>
            {FEATURE_BADGES.filter(({ key }) => winery[key]).map(
              ({ key, label, icon }) => (
                <View
                  key={key}
                  style={styles.badge}
                  accessible
                  accessibilityLabel={label}
                >
                  <Ionicons
                    name={icon}
                    size={14}
                    color={colors.accent}
                    style={styles.badgeIcon}
                  />
                  <Text style={styles.badgeText}>{label}</Text>
                </View>
              )
            )}
          </View>
        )}

        {/* ── Section tabs — About / Events / Tasting Notes ─────────────────── */}
        <View
          style={styles.sectionTabs}
          onLayout={(e) => {
            tabsYRef.current = e.nativeEvent.layout.y;
          }}
        >
          {DETAIL_TABS.map((t) => {
            const active = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => switchTab(t.id)}
                style={styles.sectionTabItem}
                accessibilityRole="button"
                accessibilityLabel={`${t.label} tab`}
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.sectionTabLabel,
                    active && styles.sectionTabLabelActive,
                  ]}
                >
                  {t.label}
                </Text>
                {/* The green indicator line — sits under the active word */}
                <View
                  style={[
                    styles.sectionTabUnderline,
                    active && styles.sectionTabUnderlineActive,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>

        {/* ── About ──────────────────────────────────────────────────────────── */}
        {contentTab === "about" && (
        <View style={styles.tabSection}>

          {/* Paragraphs */}
          {winery.description.map((para, idx) => (
            <React.Fragment key={idx}>
              <Text
                style={idx === 0 ? styles.ledeParagraph : styles.paragraph}
              >
                {"  "}
                {para}
              </Text>

              {/* Pull quote after first paragraph */}
              {idx === 0 && winery.pullQuote ? (
                <View style={styles.pullQuoteBlock}>
                  <View style={styles.pullQuoteBar} />
                  <Text style={styles.pullQuoteText}>{winery.pullQuote}</Text>
                </View>
              ) : null}
            </React.Fragment>
          ))}
        </View>
        )}

        {/* ── Wines ──────────────────────────────────────────────────────────── */}
        {contentTab === "wines" && (
        <View style={styles.tabSection}>
          {winesLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.accent}
              style={styles.tabLoading}
            />
          ) : wines.length === 0 ? (
            <Text style={styles.tabEmptyText}>
              No wines listed for {winery.name} yet. Check back soon.
            </Text>
          ) : (
            wines.map((w, idx) => {
              const expanded = expandedWineId === w.id;
              const meta = [w.vintage, w.variety, w.style, w.abv && `${w.abv} ABV`]
                .filter(Boolean)
                .join("  ·  ");
              const hasDetail = Boolean(
                w.tastingNotes || w.pairings || w.awards
              );
              return (
                <Pressable
                  key={w.id}
                  style={[
                    styles.wineRow,
                    idx === wines.length - 1 && styles.wineRowLast,
                  ]}
                  onPress={() =>
                    hasDetail && setExpandedWineId(expanded ? null : w.id)
                  }
                  disabled={!hasDetail}
                  accessibilityRole={hasDetail ? "button" : undefined}
                  accessibilityLabel={
                    hasDetail
                      ? `${w.name}. ${expanded ? "Collapse" : "Expand"} details`
                      : w.name
                  }
                  accessibilityState={hasDetail ? { expanded } : undefined}
                >
                  <View style={styles.wineRowInner}>
                    {w.image ? (
                      <Image
                        source={{ uri: w.image }}
                        style={styles.wineThumb}
                        contentFit="cover"
                        transition={150}
                        accessibilityLabel={`Bottle photo of ${w.name}`}
                      />
                    ) : null}
                    <View style={styles.wineBody}>
                      <View style={styles.wineHeadLine}>
                        <Text style={styles.wineName}>{w.name}</Text>
                        {w.price ? (
                          <Text style={styles.winePrice}>{w.price}</Text>
                        ) : null}
                      </View>
                      {meta ? <Text style={styles.wineMeta}>{meta}</Text> : null}
                      {w.tastingNotes ? (
                        <Text
                          style={styles.wineNotes}
                          numberOfLines={expanded ? undefined : 2}
                        >
                          {w.tastingNotes}
                        </Text>
                      ) : null}
                      {expanded && w.pairings ? (
                        <>
                          <Text style={styles.wineDetailLabel}>PAIRS WITH</Text>
                          <Text style={styles.wineDetailText}>{w.pairings}</Text>
                        </>
                      ) : null}
                      {expanded && w.awards ? (
                        <>
                          <Text style={styles.wineDetailLabel}>AWARDS</Text>
                          <Text style={styles.wineDetailText}>{w.awards}</Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                  {hasDetail ? (
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={colors.textMuted}
                      style={styles.wineChevron}
                    />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>
        )}

        {/* ── Events ─────────────────────────────────────────────────────────── */}
        {contentTab === "events" && (
        <View style={styles.tabSection}>
          {eventsLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.accent}
              style={styles.tabLoading}
            />
          ) : events.length === 0 ? (
            <Text style={styles.tabEmptyText}>
              No events posted for {winery.name} yet. Check back soon.
            </Text>
          ) : (
            events.map((ev) => (
              <View
                key={ev.id}
                style={[styles.eventCard, ev.isPast && styles.eventCardPast]}
              >
                {ev.image ? (
                  <Image
                    source={{ uri: ev.image }}
                    style={styles.eventImage}
                    contentFit="cover"
                    transition={150}
                  />
                ) : null}
                <View style={styles.eventBody}>
                  <View style={styles.eventMetaRow}>
                    {ev.dateLabel ? (
                      <Text style={styles.eventDate}>{ev.dateLabel}</Text>
                    ) : null}
                    {ev.isPast ? (
                      <Text style={styles.eventPastTag}>PAST</Text>
                    ) : null}
                  </View>
                  <Text style={styles.eventTitle}>{ev.title}</Text>
                  {ev.venue ? (
                    <Text style={styles.eventVenue}>{ev.venue}</Text>
                  ) : null}
                  {ev.description ? (
                    <Text style={styles.eventDesc} numberOfLines={4}>
                      {ev.description}
                    </Text>
                  ) : null}
                  {ev.sourceUrl ? (
                    <Pressable
                      onPress={() => safeOpenURL(ev.sourceUrl)}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel={`More info about ${ev.title}`}
                    >
                      <Text style={styles.eventLink}>More info ›</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </View>
        )}

        {/* ── Tasting Notes ──────────────────────────────────────────────────── */}
        {contentTab === "tastings" && (
        <View style={styles.tabSection}>
          {/* Header row — count + add-note toggle */}
          <View style={styles.notesHeaderRow}>
            <Text style={styles.notesCount}>
              {notesLoading
                ? " "
                : `${notes.length} NOTE${notes.length === 1 ? "" : "S"}`}
            </Text>
            {user ? (
              <Pressable
                style={styles.addNoteBtn}
                onPress={() => setNoteFormOpen((open) => !open)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={
                  noteFormOpen ? "Close tasting note form" : "Add a tasting note"
                }
              >
                <Ionicons
                  name={noteFormOpen ? "close" : "create-outline"}
                  size={18}
                  color={colors.onAccent}
                />
              </Pressable>
            ) : null}
          </View>

          {/* Add-a-note form */}
          {noteFormOpen && (
            <View style={styles.noteForm}>
              <TextInput
                style={styles.formInput}
                placeholder="Wine (e.g. 2023 Pinot Noir)"
                placeholderTextColor={colors.textMuted}
                value={formWine}
                onChangeText={setFormWine}
              />
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setFormScore(n)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`${n} star${n === 1 ? "" : "s"}`}
                    accessibilityState={{ selected: formScore >= n }}
                  >
                    <Ionicons
                      name={formScore >= n ? "star" : "star-outline"}
                      size={24}
                      color={
                        formScore >= n ? colors.accentSoft : colors.textMuted
                      }
                    />
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={[styles.formInput, styles.formInputMultiline]}
                placeholder="Your tasting note…"
                placeholderTextColor={colors.textMuted}
                value={formNote}
                onChangeText={setFormNote}
                multiline
              />
              <Pressable
                style={[
                  styles.postBtn,
                  (!formWine.trim() || formScore === 0 || submittingNote) &&
                    styles.postBtnDisabled,
                ]}
                onPress={submitTastingNote}
                disabled={
                  !formWine.trim() || formScore === 0 || submittingNote
                }
                accessibilityRole="button"
                accessibilityLabel="Post tasting note"
                accessibilityState={{
                  disabled: !formWine.trim() || formScore === 0 || submittingNote,
                  busy: submittingNote,
                }}
              >
                {submittingNote ? (
                  <ActivityIndicator size="small" color={colors.onAccent} />
                ) : (
                  <Text style={styles.postBtnText}>Post Note</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Notes list */}
          {notesLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.accent}
              style={styles.tabLoading}
            />
          ) : notes.length === 0 ? (
            <Text style={styles.tabEmptyText}>
              No tasting notes yet. Be the first to share one.
            </Text>
          ) : (
            notes.map((n, idx) => (
              <View
                key={n.id}
                style={[
                  styles.noteRow,
                  idx === notes.length - 1 && styles.noteRowLast,
                ]}
              >
                <View style={styles.noteHeadLine}>
                  <Text style={styles.noteAuthor}>
                    {n.authorName.toUpperCase()}
                  </Text>
                  <Text style={styles.noteDate}>{n.dateLabel}</Text>
                </View>
                <View style={styles.noteTitleLine}>
                  <Text style={styles.noteWine}>{n.wine}</Text>
                  <Text style={styles.noteScore}>★ {n.score.toFixed(1)}</Text>
                </View>
                {n.note ? (
                  <Text style={styles.noteText}>“{n.note}”</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
        )}
      </Animated.ScrollView>

      {/* ── Hours Modal ───────────────────────────────────────────────────────── */}
      <Modal
        visible={hoursVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHoursVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setHoursVisible(false)}
          accessibilityRole="button"
          accessibilityLabel="Close opening hours"
        >
          <Pressable
            style={styles.modalSheet}
            onPress={() => {}}
            accessible={false}
          >
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>OPENING HOURS</Text>

            {winery.hours.map((entry, i) => (
              <View
                key={i}
                style={[
                  styles.hoursRow,
                  i < winery.hours.length - 1 && styles.hoursRowBorder,
                ]}
              >
                <Text style={styles.hoursDay}>{entry.day}</Text>
                <Text style={styles.hoursTime}>{entry.time}</Text>
              </View>
            ))}

            <Pressable
              style={styles.modalClose}
              onPress={() => setHoursVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close opening hours"
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Outer wrapper — pads the whole screen below the status bar / notch.
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingBottom: 120,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
    gap: 10,
  },
  notFoundLabel: {
    ...type.kicker,                            // bumped 9 → 10 (kicker minimum)
    letterSpacing: 3,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  notFoundText: {
    ...type.body,
    color: colors.textMuted,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  headerOverlay: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
  // Header buttons sit ON TOP of the hero photo, so they use dark glass
  // chrome regardless of the page bg — keeps icons + text legible on any image.
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.photoChrome,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    paddingHorizontal: spacing.lg,            // bumped 14 → 16
    paddingVertical: spacing.md,              // bumped 8 → 12 (toward 44pt)
    minHeight: spacing.hitTarget,
  },
  headerBtnText: {
    color: colors.textOnDark,
    fontSize: type.body.fontSize,             // 13 → 14
    fontWeight: weights.body,
    letterSpacing: 0.2,
  },
  headerRight: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  headerIconBtn: {
    width: spacing.hitTarget,                 // bumped 38 → 44 (Apple HIG)
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.photoChrome,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: "center",
    justifyContent: "center",
  },

  // Heart sits at the hero's bottom-right, aligned with heroContent's bottom.
  heroSaveBtn: {
    position: "absolute",
    bottom: spacing.xxxl,
    right: spacing.xxl,
    zIndex: 10,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  heroContainer: {
    position: "relative",
    height: HERO_HEIGHT,
  },
  heroCardFrame: {
    height: HERO_HEIGHT,
    borderRadius: 0,
    overflow: "hidden",
  },
  heroImage: {
    width,
    height: HERO_HEIGHT + PARALLAX_EXTRA,
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroPlaceholder: {
    height: HERO_HEIGHT + PARALLAX_EXTRA,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  heroPlaceholderEmoji: {
    fontSize: 48,
  },
  heroPlaceholderName: {
    ...type.h3,
    fontWeight: weights.body,
    fontStyle: "italic",
    color: colors.textSecondary,
  },
  heroContent: {
    position: "absolute",
    bottom: spacing.xxxl,                     // 32 — was 28
    left: spacing.xxl,
    right: spacing.xxl,
    // Keep long titles from running under the bottom-right save button.
    paddingRight: spacing.hitTarget + spacing.sm,
  },
  // Hero text sits over the photo's dark scrim — uses on-dark tokens.
  heroTitle: {
    ...type.h1,                               // 36 / italic Georgia / 42 line / -0.5
    color: colors.textOnDark,
  },
  heroRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  heroRatingStar: {
    ...type.body,                             // 14 — bumped from 13
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
  },
  heroRatingCount: {
    ...type.caption,
    color: colors.textOnDarkSubtle,
  },

  // Pagination dashes — also overlaid on hero photo
  dotsContainer: {
    position: "absolute",
    bottom: 14,
    right: 20,
    flexDirection: "row",
    gap: 4,
  },
  dot: {
    width: 16,
    height: 2,
    backgroundColor: colors.textOnDarkSubtle,
    borderRadius: 1,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.accent,
  },

  // ── Info Grid (Hours | Location) ─────────────────────────────────────────
  // Fix 7: 16px row gutter (paddingVertical), 12px internal padding between
  // label / value / tap-hint. Matched on all info + contact cells so the
  // whole hours-features-contact stack reads as a single visual rhythm.
  infoGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  infoCell: {
    flex: 1,
    paddingVertical: spacing.lg,              // 16px row gutter (Fix 7)
    paddingHorizontal: spacing.xl,            // 20px internal — generous for wide cells
    gap: spacing.md,                          // 12px between label / value / tap (Fix 7)
  },
  infoCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  infoCellLabel: {
    ...type.kicker,                           // bumped 9 → 10 (kicker minimum)
    color: colors.textMuted,
  },
  infoCellValue: {
    ...type.body,                             // 14 — bumped from 13
    color: colors.textPrimary,
    fontWeight: weights.body,
  },
  appointmentLink: {
    ...type.body,
    color: colors.accentSoft,
    fontWeight: weights.body,
    textDecorationLine: "underline",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  infoCellTap: {
    ...type.caption,                          // bumped 11 → 12
    color: colors.accentSoft,
    letterSpacing: 0.2,
  },

  // ── Contact Row ───────────────────────────────────────────────────────────
  // Same rhythm as info grid (Fix 7) — 16 row, 20 internal, 12 stack gap.
  contactRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  contactBtn: {
    flex: 1,
    paddingVertical: spacing.lg,              // 16 row gutter (Fix 7)
    paddingHorizontal: spacing.xl,
    gap: spacing.md,                          // 12 internal (Fix 7)
  },
  contactBtnBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  contactLabel: {
    ...type.kicker,
    color: colors.textMuted,
  },
  contactValue: {
    ...type.body,
    color: colors.textPrimary,
    fontWeight: weights.body,
  },
  contactLink: {
    ...type.body,
    color: colors.accentSoft,
    fontWeight: weights.body,
    textDecorationLine: "underline",
  },

  // ── Feature Badges ────────────────────────────────────────────────────────
  // 16 row gutter to match the grid above; emoji ditched in favour of
  // accent-coloured Ionicons (Fix 4: Color).
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24
    paddingVertical: spacing.lg,              // 16 row gutter (Fix 7)
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,              // bumped 6 → 8 for breathing room
    backgroundColor: colors.surface,
  },
  badgeIcon: {
    // Spacing only — colour and size are passed via props on <Ionicons>
    marginRight: 2,
  },
  badgeText: {
    ...type.caption,
    fontWeight: weights.body,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },

  // ── About Section ─────────────────────────────────────────────────────────
  // ── Section tab strip — About / Events / Tasting Notes ───────────────────
  sectionTabs: {
    flexDirection: "row",
    justifyContent: "space-between",          // equal spacing between all 4 tabs
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xxxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTabItem: {
    paddingTop: spacing.sm,
    minHeight: spacing.hitTarget,             // 44pt tap floor
    justifyContent: "flex-end",
  },
  sectionTabLabel: {
    ...type.body,
    fontSize: type.body.fontSize + 1,         // 14 → 15, slightly larger tab labels
    lineHeight: type.body.lineHeight + 1,
    fontWeight: weights.emphasis,
    color: colors.textMuted,
  },
  sectionTabLabelActive: {
    color: colors.textPrimary,
  },
  // The green indicator line, sitting directly under the tab word. Hangs
  // 1px over the strip's hairline so the active state reads as connected.
  sectionTabUnderline: {
    height: 2,
    marginTop: spacing.md,
    marginBottom: -1,
    backgroundColor: "transparent",
  },
  sectionTabUnderlineActive: {
    backgroundColor: colors.accent,
  },

  // Shared wrapper for each tab's content. The minHeight keeps the total
  // content tall enough that sitting at the tab strip's scroll offset is
  // always valid — without it, swapping to a short tab (e.g. an empty
  // Events list) shrinks the content and the scroll position clamps with
  // an abrupt snap. (The remaining ~120px comes from the scroll view's
  // contentContainer bottom padding.)
  tabSection: {
    paddingHorizontal: spacing.xxl,           // 24 (already standardised)
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.hero,
    minHeight: SCREEN_HEIGHT - 120,
  },
  tabLoading: {
    marginTop: spacing.xl,
    alignSelf: "center",
  },
  tabEmptyText: {
    ...type.body,
    color: colors.textMuted,
    lineHeight: 22,
  },

  // ── Wines tab ─────────────────────────────────────────────────────────────
  wineRow: {
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wineRowLast: {
    borderBottomWidth: 0,
  },
  wineRowInner: {
    flexDirection: "row",
  },
  wineThumb: {
    width: 56,
    height: 72,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    marginRight: spacing.lg,
  },
  wineBody: {
    flex: 1,
  },
  wineHeadLine: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: spacing.xs,
  },
  wineName: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.md,
  },
  winePrice: {
    ...type.caption,
    fontWeight: weights.emphasis,
    color: colors.accentSoft,
  },
  wineMeta: {
    ...type.kicker,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  wineNotes: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  wineDetailLabel: {
    ...type.kicker,
    color: colors.accentSoft,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  wineDetailText: {
    ...type.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  wineChevron: {
    alignSelf: "center",
    marginTop: spacing.sm,
  },

  // ── Events tab ────────────────────────────────────────────────────────────
  eventCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  eventCardPast: {
    opacity: 0.55,
  },
  eventImage: {
    width: "100%",
    height: 140,
    backgroundColor: colors.surfaceDeep,
  },
  eventBody: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  eventMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eventDate: {
    ...type.kicker,
    color: colors.accentSoft,
  },
  eventPastTag: {
    ...type.kicker,
    color: colors.textMuted,
  },
  eventTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  eventVenue: {
    ...type.caption,
    color: colors.textSecondary,
  },
  eventDesc: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  eventLink: {
    ...type.caption,
    fontWeight: weights.emphasis,
    color: colors.accentSoft,
    marginTop: spacing.sm,
    minHeight: spacing.xl,
  },

  // ── Tasting Notes tab ─────────────────────────────────────────────────────
  notesHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
  },
  notesCount: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.textMuted,
  },
  // Icon-only circular button — pencil to open the form, × to close it.
  addNoteBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  noteForm: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  formInput: {
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...type.body,
    color: colors.textPrimary,
    minHeight: spacing.hitTarget,
  },
  formInputMultiline: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  starRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  postBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    minHeight: spacing.hitTarget,
  },
  postBtnDisabled: {
    opacity: 0.5,
  },
  postBtnText: {
    ...type.caption,
    fontWeight: weights.emphasis,
    letterSpacing: 1,
    color: colors.onAccent,
  },
  noteRow: {
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  noteRowLast: {
    borderBottomWidth: 0,
  },
  noteHeadLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  noteAuthor: {
    ...type.kicker,
    color: colors.accentSoft,
  },
  noteDate: {
    ...type.kicker,
    color: colors.textMuted,
  },
  noteTitleLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  noteWine: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.md,
  },
  noteScore: {
    ...type.caption,
    fontWeight: weights.emphasis,
    color: colors.accentSoft,
  },
  noteText: {
    ...type.caption,
    fontStyle: "italic",
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  // First paragraph — editorial lede (italic, slightly larger)
  ledeParagraph: {
    ...type.lede,                             // 17 / italic / 400 / Georgia
    color: colors.textSecondary,
    lineHeight: 29,                           // slightly looser for the lede
    marginBottom: spacing.xxl,
  },
  // Body paragraphs — Georgia at body weight, no 500 drift
  paragraph: {
    fontFamily: fonts.serif,
    fontSize: 15,                             // body-plus for editorial reading
    fontWeight: weights.body,
    color: colors.textSecondary,
    lineHeight: 27,
    marginBottom: spacing.lg,
  },
  // Pull quote — italic Georgia, body weight, clear forest accent rule
  pullQuoteBlock: {
    flexDirection: "row",
    alignItems: "stretch",
    marginVertical: spacing.xxl,
    marginHorizontal: spacing.xs,
  },
  pullQuoteBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
    marginRight: spacing.lg,
  },
  pullQuoteText: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: type.h3.fontSize,               // 22 (was 20 — toward token scale)
    fontStyle: "italic",
    fontWeight: weights.body,
    color: colors.textPrimary,
    lineHeight: 32,
    letterSpacing: 0.2,
  },

  // ── Hours Modal ───────────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: spacing.xl,
    borderTopRightRadius: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xxl,           // standardised 28 → 24
    paddingTop: spacing.lg,
    paddingBottom: spacing.hero,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.xxl,
  },
  modalTitle: {
    ...type.kicker,
    letterSpacing: 3,
    color: colors.accentSoft,
    marginBottom: spacing.xl,
  },
  hoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.lg,              // 16 row gutter (Fix 7)
  },
  hoursRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hoursDay: {
    ...type.body,
    fontFamily: fonts.serif,
    color: colors.textSecondary,
    flex: 1,
  },
  hoursTime: {
    ...type.body,
    color: colors.textPrimary,
    fontWeight: weights.emphasis,
    textAlign: "right",
  },
  modalClose: {
    marginTop: spacing.xxl,
    alignSelf: "center",
    paddingVertical: 12,                      // bumped 10 → 12 (toward 44pt)
    paddingHorizontal: spacing.xxxl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    minHeight: spacing.hitTarget,
    justifyContent: "center",
  },
  modalCloseText: {
    ...type.caption,
    letterSpacing: 1,
    color: colors.textMuted,
  },
});

// ─── Skeleton styles ──────────────────────────────────────────────────────────
// Mirror the live-data rhythm so the loading state feels structural rather
// than empty.
const skeletonStyles = StyleSheet.create({
  infoGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  infoCell: {
    flex: 1,
    paddingVertical: spacing.lg,              // 16 row gutter (Fix 7)
    paddingHorizontal: spacing.xl,
    gap: spacing.md,                          // 12 internal (Fix 7)
  },
  infoCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  contactRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  labelLine:  { height: 8,  width: "40%", borderRadius: radius.card },
  valueLine:  { height: 13, width: "80%", borderRadius: radius.card },
  subLine:    { height: 9,  width: "50%", borderRadius: radius.card },
  textLineLg: { height: 14, borderRadius: radius.card },
  textLineSm: { height: 12, borderRadius: radius.card },
  aboutSection: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.hero,
    gap: spacing.lg,
  },
  dividerSkeleton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerLabel: { height: 8, width: 48, borderRadius: radius.card },
});

export default withScreenErrorBoundary(WineryDetailsScreen, "wineries/[slug]");
