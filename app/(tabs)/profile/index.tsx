// app/(tabs)/profile/index.tsx
// Profile · Saved / Tastings / Palate
// "Cinematic Dusk" theme — all data live from Firestore users/{uid} doc
// and its subcollections: savedWineries, savedArticles, lists, tastings.
// Palate breakdown is derived from the tastings subcollection on the fly.

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "../../../context/AuthContext";
import { db } from "../../../firebaseConfig";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";

// ─── Firestore-shaped types ───────────────────────────────────────────────────

type ProfileUser = {
  name: string;
  initials: string;
  location: string;
  memberSince: string;  // formatted display string
};

type ProfileStat = {
  value: string;
  label: string;
};

type SavedList = {
  id: string;
  name: string;
  count: number;
  image: string;
};

type SavedWinery = {
  id: string;
  name: string;
  region: string;
  rating: number;
  distance: string;
  image: string;
};

type SavedArticle = {
  id: string;
  kicker: string;
  title: string;
  readTime: string;
  image: string;
};

type TastingEntry = {
  id: string;
  wineryName: string;
  wine: string;
  date: string;
  score: number;
  note: string;
};

type PalateRow = {
  variety: string;
  value: number;  // 0–1
};

type ProfileTab = "saved" | "tastings" | "palate";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a Firestore Timestamp or ISO string to a short display date. */
function formatDate(raw: unknown): string {
  if (!raw) return "";
  try {
    const date =
      typeof raw === "object" && "toDate" in (raw as object)
        ? (raw as { toDate: () => Date }).toDate()
        : new Date(raw as string);
    return date.toLocaleDateString("en-AU", { month: "short", year: "'yy" });
  } catch {
    return "";
  }
}

/** Format memberSince Timestamp into "Member since 'YY". */
function formatMemberSince(raw: unknown): string {
  if (!raw) return "";
  try {
    const date =
      typeof raw === "object" && "toDate" in (raw as object)
        ? (raw as { toDate: () => Date }).toDate()
        : new Date(raw as string);
    return `Member since '${date.getFullYear().toString().slice(-2)}`;
  } catch {
    return "";
  }
}

/**
 * Derive palate breakdown from an array of tasting entries.
 * Looks for known grape variety names anywhere in the wine title.
 */
function derivePalate(tastings: TastingEntry[]): PalateRow[] {
  const VARIETIES = [
    "Pinot Noir", "Chardonnay", "Riesling", "Cabernet",
    "Sauvignon Blanc", "Shiraz", "Merlot", "Sparkling",
    "Pinot Gris", "Semillon", "Grenache", "Tempranillo",
  ];

  const counts: Record<string, number> = {};
  for (const t of tastings) {
    const wineLower = t.wine.toLowerCase();
    for (const v of VARIETIES) {
      if (wineLower.includes(v.toLowerCase())) {
        counts[v] = (counts[v] ?? 0) + 1;
      }
    }
  }

  const max = Math.max(...Object.values(counts), 1);
  return Object.entries(counts)
    .map(([variety, count]) => ({ variety, value: count / max }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [tab, setTab] = useState<ProfileTab>("saved");

  // ── Edit-name modal state ─────────────────────────────────────────────────
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [editNameValue, setEditNameValue]     = useState("");
  const [editNameSaving, setEditNameSaving]   = useState(false);

  const openEditName = () => {
    setEditNameValue(profileUser?.name ?? "");
    setEditNameVisible(true);
  };

  const saveEditName = async () => {
    if (!user) return;
    const trimmed = editNameValue.trim();
    if (!trimmed) return;
    setEditNameSaving(true);
    try {
      const initials = trimmed
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "?";
      await updateDoc(doc(db, "users", user.uid), { name: trimmed, initials });
      setEditNameVisible(false);
    } catch (e) {
      console.warn("saveEditName error:", e);
    } finally {
      setEditNameSaving(false);
    }
  };

  // ── Firestore state ───────────────────────────────────────────────────────
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileUser, setProfileUser]         = useState<ProfileUser | null>(null);
  const [lists, setLists]                     = useState<SavedList[]>([]);
  const [savedWineries, setSavedWineries]     = useState<SavedWinery[]>([]);
  const [savedArticles, setSavedArticles]     = useState<SavedArticle[]>([]);
  const [tastings, setTastings]               = useState<TastingEntry[]>([]);

  // Derived
  const palate = derivePalate(tastings);
  const palateCount = tastings.length;

  const stats: ProfileStat[] = [
    { value: String(savedWineries.length), label: "Cellar doors" },
    { value: String(lists.length),         label: "Trips" },
    { value: String(savedArticles.length), label: "Articles" },
    { value: String(tastings.length),      label: "Tastings" },
  ];

  // ── Subscribe to Firestore ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const uid = user.uid;

    // User profile doc
    const unsubProfile = onSnapshot(doc(db, "users", uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setProfileUser({
          name:        d.name ?? "",
          initials:    d.initials ?? "?",
          location:    d.location ?? "",
          memberSince: formatMemberSince(d.memberSince),
        });
      }
      setProfileLoading(false);
    });

    // savedWineries subcollection
    const unsubWineries = onSnapshot(
      collection(db, "users", uid, "savedWineries"),
      (snap) => {
        setSavedWineries(
          snap.docs.map((d) => ({
            id:       d.id,
            name:     d.data().name ?? "",
            region:   d.data().region ?? "",
            rating:   d.data().rating ?? 0,
            distance: d.data().distance ?? "",
            image:    d.data().image ?? "",
          }))
        );
      }
    );

    // savedArticles subcollection
    const unsubArticles = onSnapshot(
      collection(db, "users", uid, "savedArticles"),
      (snap) => {
        setSavedArticles(
          snap.docs.map((d) => ({
            id:       d.id,
            kicker:   d.data().kicker ?? "",
            title:    d.data().title ?? "",
            readTime: d.data().readTime ?? "",
            image:    d.data().image ?? "",
          }))
        );
      }
    );

    // lists subcollection
    const unsubLists = onSnapshot(
      collection(db, "users", uid, "lists"),
      (snap) => {
        setLists(
          snap.docs.map((d) => ({
            id:    d.id,
            name:  d.data().name ?? "",
            count: d.data().count ?? 0,
            image: d.data().image ?? "",
          }))
        );
      }
    );

    // tastings subcollection — ordered newest first
    const unsubTastings = onSnapshot(
      query(
        collection(db, "users", uid, "tastings"),
        orderBy("createdAt", "desc")
      ),
      (snap) => {
        setTastings(
          snap.docs.map((d) => ({
            id:          d.id,
            wineryName:  d.data().wineryName ?? "",
            wine:        d.data().wine ?? "",
            date:        formatDate(d.data().createdAt),
            score:       d.data().score ?? 0,
            note:        d.data().note ?? "",
          }))
        );
      }
    );

    return () => {
      unsubProfile();
      unsubWineries();
      unsubArticles();
      unsubLists();
      unsubTastings();
    };
  }, [user]);

  // ── Sign out ──────────────────────────────────────────────────────────────
  const handleSignOut = useCallback(() => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/auth");
        },
      },
    ]);
  }, [signOut, router]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (profileLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const displayUser = profileUser ?? { name: "", initials: "?", location: "", memberSince: "" };

  return (
    <View style={styles.container}>
      {/* ── Floating top bar ─────────────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
        <Pressable
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={handleSignOut}
        >
          <Ionicons name="log-out-outline" size={15} color={colors.textPrimary} />
        </Pressable>
        <Pressable style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Share profile">
          <Ionicons name="share-outline" size={15} color={colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 70 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile header ──────────────────────────────────────────────── */}
        <View style={styles.profileHead}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayUser.initials}</Text>
          </View>
          <Pressable
            style={styles.nameRow}
            onPress={openEditName}
            accessibilityRole="button"
            accessibilityLabel="Edit display name"
          >
            <Text style={styles.name}>{displayUser.name || "Set your name"}</Text>
            <Ionicons name="pencil-outline" size={14} color={colors.textMuted} style={styles.pencilIcon} />
          </Pressable>
          <Text style={styles.meta}>
            {displayUser.location
              ? `${displayUser.location.toUpperCase()} · `
              : ""}
            {displayUser.memberSince.toUpperCase()}
          </Text>
        </View>

        {/* ── Stat row ────────────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <View key={`${s.label}-${i}`} style={styles.statBox}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        {/* ── Tab strip ───────────────────────────────────────────────────── */}
        <View style={styles.tabStrip}>
          {([
            { id: "saved",    label: "Saved" },
            { id: "tastings", label: "Tastings" },
            { id: "palate",   label: "Palate" },
          ] as { id: ProfileTab; label: string }[]).map((x) => {
            const active = tab === x.id;
            return (
              <Pressable
                key={x.id}
                onPress={() => setTab(x.id)}
                style={[styles.tabItem, active && styles.tabItemActive]}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {x.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── Saved ────────────────────────────────────────────────────────── */}
        {tab === "saved" && (
          <View>
            {/* Lists row */}
            {lists.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeadRow}>
                  <Text style={styles.sectionKickerMuted}>YOUR LISTS</Text>
                  <Pressable accessibilityRole="button">
                    <Text style={styles.newListLink}>+ New list</Text>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.listsRow}
                >
                  {lists.map((l) => (
                    <Pressable key={l.id} style={styles.listCard}>
                      {l.image ? (
                        <Image source={{ uri: l.image }} style={styles.listCardImg} contentFit="cover" transition={150} />
                      ) : (
                        <View style={[styles.listCardImg, { backgroundColor: colors.surfaceDeep }]} />
                      )}
                      <View style={styles.listCardOverlay}>
                        <Text style={styles.listCardName}>{l.name}</Text>
                        <Text style={styles.listCardCount}>{l.count} SAVED</Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Saved cellar doors */}
            <View style={styles.section}>
              <Text style={styles.sectionKickerGold}>SAVED CELLAR DOORS</Text>
              {savedWineries.length === 0 ? (
                <Text style={styles.emptyText}>
                  No saved cellar doors yet. Heart a winery to save it here.
                </Text>
              ) : (
                savedWineries.map((w, idx) => (
                  <View key={w.id} style={[styles.row, idx === 0 && styles.rowFirst]}>
                    {w.image ? (
                      <Image source={{ uri: w.image }} style={styles.rowImg} contentFit="cover" transition={150} />
                    ) : (
                      <View style={[styles.rowImg, { backgroundColor: colors.surfaceDeep }]} />
                    )}
                    <View style={styles.rowText}>
                      <Text style={styles.rowKicker}>{w.region.toUpperCase()}</Text>
                      <Text style={styles.rowTitle} numberOfLines={2}>{w.name}</Text>
                      <View style={styles.rowMetaRow}>
                        <Text style={styles.ratingText}>★ {w.rating.toFixed(1)}</Text>
                        {w.distance ? (
                          <>
                            <Text style={styles.dotSep}>·</Text>
                            <Text style={styles.distanceText} numberOfLines={1}>{w.distance}</Text>
                          </>
                        ) : null}
                      </View>
                    </View>
                    <Pressable
                      style={styles.heartBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Unsave ${w.name}`}
                    >
                      <Ionicons name="heart" size={16} color={colors.accentSoft} />
                    </Pressable>
                  </View>
                ))
              )}
            </View>

            {/* Saved articles */}
            <View style={styles.section}>
              <Text style={styles.sectionKickerGold}>SAVED ARTICLES</Text>
              {savedArticles.length === 0 ? (
                <Text style={styles.emptyText}>
                  No saved articles yet.
                </Text>
              ) : (
                savedArticles.map((a, idx) => (
                  <View key={a.id} style={[styles.row, idx === 0 && styles.rowFirst]}>
                    {a.image ? (
                      <Image source={{ uri: a.image }} style={styles.rowImg} contentFit="cover" transition={150} />
                    ) : (
                      <View style={[styles.rowImg, { backgroundColor: colors.surfaceDeep }]} />
                    )}
                    <View style={styles.rowText}>
                      <Text style={styles.rowKicker}>
                        {a.kicker.toUpperCase()}{a.readTime ? ` · ${a.readTime.toUpperCase()}` : ""}
                      </Text>
                      <Text style={styles.rowTitle} numberOfLines={3}>{a.title}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        )}

        {/* ── Tastings ─────────────────────────────────────────────────────── */}
        {tab === "tastings" && (
          <View style={styles.section}>
            {tastings.length === 0 ? (
              <Text style={styles.emptyText}>
                No tasting notes logged yet. Add your first note from any winery page.
              </Text>
            ) : (
              tastings.map((t, idx) => (
                <View
                  key={t.id}
                  style={[
                    styles.tastingRow,
                    idx === tastings.length - 1 && styles.tastingRowLast,
                  ]}
                >
                  <View style={styles.tastingHeadLine}>
                    <Text style={styles.tastingWinery}>{t.wineryName.toUpperCase()}</Text>
                    <Text style={styles.tastingDate}>{t.date}</Text>
                  </View>
                  <View style={styles.tastingTitleLine}>
                    <Text style={styles.tastingWine}>{t.wine}</Text>
                    <Text style={styles.tastingScore}>★ {t.score.toFixed(1)}</Text>
                  </View>
                  {t.note ? (
                    <Text style={styles.tastingNote}>"{t.note}"</Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        )}

        {/* ── Palate ───────────────────────────────────────────────────────── */}
        {tab === "palate" && (
          <View style={styles.section}>
            {palate.length === 0 ? (
              <Text style={styles.emptyText}>
                Log tasting notes to build your palate breakdown.
              </Text>
            ) : (
              <>
                <Text style={styles.palateHeadline}>Your palate.</Text>
                <Text style={styles.palateSubhead}>
                  From {palateCount} tasting{palateCount !== 1 ? "s" : ""} logged.
                  Updates as you log more.
                </Text>
                <View style={{ marginTop: 22, gap: 14 }}>
                  {palate.map((p, i) => (
                    <View key={`${p.variety}-${i}`}>
                      <View style={styles.palateBarTop}>
                        <Text style={styles.palateLabel}>{p.variety}</Text>
                        <Text style={styles.palatePercent}>
                          {Math.round(p.value * 100)}%
                        </Text>
                      </View>
                      <View style={styles.palateTrack}>
                        <View
                          style={[
                            styles.palateFill,
                            { width: `${Math.max(0, Math.min(1, p.value)) * 100}%` },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Edit Name Modal ──────────────────────────────────────────────────── */}
      <Modal
        visible={editNameVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditNameVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setEditNameVisible(false)}>
            <Pressable style={styles.editNameSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.editNameTitle}>YOUR NAME</Text>
              <TextInput
                style={styles.editNameInput}
                value={editNameValue}
                onChangeText={setEditNameValue}
                placeholder="e.g. James Halliday"
                placeholderTextColor={colors.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveEditName}
                selectionColor={colors.accent}
              />
              <Text style={styles.editNameHint}>
                This is how you'll appear in the app.
              </Text>
              <View style={styles.editNameButtons}>
                <Pressable
                  style={styles.editNameCancel}
                  onPress={() => setEditNameVisible(false)}
                >
                  <Text style={styles.editNameCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.editNameSave,
                    (!editNameValue.trim() || editNameSaving) && styles.editNameSaveDisabled,
                  ]}
                  onPress={saveEditName}
                  disabled={!editNameValue.trim() || editNameSaving}
                >
                  {editNameSaving ? (
                    <ActivityIndicator color={colors.onAccent} size="small" />
                  ) : (
                    <Text style={styles.editNameSaveText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
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
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },

  // ── Top bar ───────────────────────────────────────────────────────────────
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: spacing.hitTarget,                 // bumped 38 → 44 (Apple HIG)
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Profile header ────────────────────────────────────────────────────────
  profileHead: {
    paddingTop: 60,
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
    alignItems: "center",
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 30,
    fontWeight: weights.body,                 // 500 → 400 (Fix 4)
    color: colors.accentSoft,
  },
  name: {
    ...type.h2,                               // 28 / Georgia / bold
    color: colors.textPrimary,
  },
  meta: {
    ...type.kicker,
    letterSpacing: 1.8,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // ── Stat row ──────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
  },
  statBox: {
    flex: 1,
    paddingVertical: spacing.lg,              // bumped 14 → 16
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    alignItems: "center",
  },
  statValue: {
    ...type.h2,                               // 24 → 28 (token scale)
    color: colors.textPrimary,
  },
  statLabel: {
    ...type.kicker,                           // bumped 8.5 → 10 (kicker minimum)
    letterSpacing: 1.4,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: "center",
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabStrip: {
    flexDirection: "row",
    gap: spacing.xxl,
    marginTop: spacing.xxxl,                  // bumped 28 → 32
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabItem: {
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
    minHeight: spacing.hitTarget,             // 44pt floor for tab strip taps
    justifyContent: "center",
  },
  tabItemActive: {
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    ...type.body,                             // 13 → 14
    fontWeight: weights.emphasis,             // 600 → 700 (Fix 4)
    color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.textPrimary,
  },

  // ── Section blocks ────────────────────────────────────────────────────────
  section: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xxl,           // standardised 22 → 24
  },
  sectionHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  sectionKickerMuted: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.textMuted,
  },
  sectionKickerGold: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: 6,
    paddingTop: 10,
  },
  newListLink: {
    fontSize: 11.5,
    color: colors.accentSoft,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 20,
    paddingVertical: 16,
  },

  // ── Lists carousel ────────────────────────────────────────────────────────
  listsRow: {
    gap: 10,
    paddingVertical: 6,
    paddingRight: 4,
  },
  listCard: {
    width: 150,
    height: 90,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.surfaceDeep,
  },
  listCardImg: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    opacity: 0.6,
  },
  listCardOverlay: {
    flex: 1,
    padding: 12,
    justifyContent: "flex-end",
  },
  listCardName: {
    fontFamily: fonts.serif,
    fontSize: 16,
    fontWeight: "500",
    color: colors.textOnDark,
    lineHeight: 18,
    letterSpacing: -0.2,
  },
  listCardCount: {
    ...type.kicker,                           // bumped 9 → 10 (kicker minimum)
    letterSpacing: 1.2,
    color: colors.textOnDarkMuted,
    marginTop: spacing.xs,
  },

  // ── List rows (wineries / articles) ───────────────────────────────────────
  row: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowFirst: {
    borderTopColor: colors.border,
  },
  rowImg: {
    width: 70,
    height: 70,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowKicker: {
    ...type.kicker,                           // bumped 9.5 → 10
    letterSpacing: 1.5,
    color: colors.textMuted,
  },
  rowTitle: {
    fontFamily: fonts.serif,
    fontSize: type.lede.fontSize,             // 17
    fontWeight: weights.emphasis,             // 500 → 700 (Fix 4)
    color: colors.textPrimary,
    marginTop: spacing.xs,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  rowMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  ratingText: {
    fontSize: 11,
    color: colors.accentSoft,
    fontWeight: "600",
  },
  dotSep: {
    fontSize: 11,
    color: colors.textMuted,
  },
  distanceText: {
    fontSize: 11,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  heartBtn: {
    width: spacing.hitTarget,                 // bumped 32 → 44 (Apple HIG)
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Tastings log ──────────────────────────────────────────────────────────
  tastingRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tastingRowLast: {
    borderBottomWidth: 0,
  },
  tastingHeadLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  tastingWinery: {
    ...type.kicker,                           // bumped 9.5 → 10
    letterSpacing: 1.5,
    color: colors.textMuted,
  },
  tastingDate: {
    ...type.kicker,                           // 10.5 → 10 (token-aligned)
    color: colors.textMuted,
  },
  tastingTitleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 4,
  },
  tastingWine: {
    fontFamily: fonts.serif,
    fontSize: 17,
    fontWeight: "500",
    color: colors.textPrimary,
    letterSpacing: -0.2,
    flex: 1,
    marginRight: 12,
  },
  tastingScore: {
    color: colors.accentSoft,
    fontWeight: "600",
    fontSize: 13,
  },
  tastingNote: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: "italic",
    marginTop: 4,
  },

  // ── Name row (name + pencil icon) ────────────────────────────────────────
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  pencilIcon: {
    marginTop: 2,
  },

  // ── Edit name modal ───────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "flex-end",
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 24,
  },
  editNameSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: spacing.xl,
    borderTopRightRadius: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xxl,           // standardised 28 → 24
    paddingTop: spacing.lg,
    paddingBottom: spacing.hitTarget,
  },
  editNameTitle: {
    ...type.kicker,
    letterSpacing: 3,
    color: colors.accentSoft,
    marginBottom: spacing.lg,
  },
  editNameInput: {
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,              // bumped 14 → 16
    fontSize: type.lede.fontSize,             // 17
    fontFamily: fonts.serif,
    color: colors.textPrimary,
    minHeight: spacing.hitTarget,
  },
  editNameHint: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  editNameButtons: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  editNameCancel: {
    flex: 1,
    paddingVertical: spacing.lg,              // bumped 14 → 16 (toward 44pt)
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    alignItems: "center",
    justifyContent: "center",
    minHeight: spacing.hitTarget,
  },
  editNameCancelText: {
    ...type.body,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  editNameSave: {
    flex: 2,
    paddingVertical: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    alignItems: "center",
    justifyContent: "center",
    minHeight: spacing.hitTarget,
  },
  editNameSaveDisabled: {
    opacity: 0.45,
  },
  editNameSaveText: {
    ...type.kicker,
    fontSize: 12,                              // bumped 12pt for "save" CTA legibility
    letterSpacing: 2,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },

  // ── Palate ────────────────────────────────────────────────────────────────
  palateHeadline: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 22,
    fontWeight: "500",
    color: colors.textPrimary,
    letterSpacing: -0.3,
    paddingTop: 6,
  },
  palateSubhead: {
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 6,
    lineHeight: 19,
  },
  palateBarTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  palateLabel: {
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  palatePercent: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
  },
  palateTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceDeep,
    overflow: "hidden",
  },
  palateFill: {
    height: "100%",
    backgroundColor: colors.accent,
  },
});
