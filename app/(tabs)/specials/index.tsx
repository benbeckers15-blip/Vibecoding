// app/(tabs)/specials/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Special = {
  id: string;
  wineryName: string;
  winerySlug: string;
  title: string;
  description: string;
  category: "Tasting" | "Wine" | "Dining" | "Experience" | "Accommodation";
  discount?: string;
  validUntil: string; // "YYYY-MM-DD"
  image: string;
  isExclusive?: boolean;
  originalPrice?: string;
  offerPrice?: string;
};

type CategoryFilter = "All" | "Tasting" | "Wine" | "Dining" | "Experience" | "Accommodation";

// ─── Sample Data ──────────────────────────────────────────────────────────────

const SPECIALS: Special[] = [
  {
    id: "1",
    wineryName: "Leeuwin Estate",
    winerySlug: "leeuwin-estate",
    title: "20% Off All Tasting Flights",
    description:
      "Experience Leeuwin's iconic Art Series wines with 20% off all tasting flights at the cellar door. Includes the flagship Art Series Chardonnay.",
    category: "Tasting",
    discount: "20% OFF",
    validUntil: "2025-06-30",
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80",
    isExclusive: true,
  },
  {
    id: "2",
    wineryName: "Vasse Felix",
    winerySlug: "vasse-felix",
    title: "Complimentary Cheese Board",
    description:
      "Receive a seasonal cheese and charcuterie board on us with any wine purchase of $80 or more at the cellar door. Mix and match across the full range.",
    category: "Dining",
    validUntil: "2025-05-31",
    image:
      "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=800&q=80",
    isExclusive: false,
  },
  {
    id: "3",
    wineryName: "Voyager Estate",
    winerySlug: "voyager-estate",
    title: "Two-for-One Garden Tour",
    description:
      "Explore the stunning formal gardens and heritage rose collection. Purchase one adult ticket and bring a guest for free — a perfect morning in the Margaret River region.",
    category: "Experience",
    discount: "2-FOR-1",
    validUntil: "2025-07-15",
    image:
      "https://images.unsplash.com/photo-1568213816046-0ee1c42bd559?w=800&q=80",
    isExclusive: true,
  },
  {
    id: "4",
    wineryName: "Cape Mentelle",
    winerySlug: "cape-mentelle",
    title: "Reserve Vertical Tasting",
    description:
      "Unlock the Reserve Range with a guided vertical tasting of Cape Mentelle's finest vintages, hosted by a senior winemaker. Strictly limited to 8 guests per session.",
    category: "Tasting",
    originalPrice: "$85",
    offerPrice: "$60",
    validUntil: "2025-06-15",
    image:
      "https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=800&q=80",
    isExclusive: true,
  },
  {
    id: "5",
    wineryName: "Cullen Wines",
    winerySlug: "cullen-wines",
    title: "Free Biodynamic Farm Walk",
    description:
      "Join a guided walk through Cullen's certified biodynamic vineyard and learn about their regenerative farming practices, paired with a glass of Diana Madeline.",
    category: "Experience",
    validUntil: "2025-08-31",
    image:
      "https://images.unsplash.com/photo-1560493676-04071c5f467b?w=800&q=80",
    isExclusive: false,
  },
  {
    id: "6",
    wineryName: "Xanadu Wines",
    winerySlug: "xanadu-wines",
    title: "Six-Bottle Case Discount",
    description:
      "Purchase any six bottles from the Stevens Road range and receive 15% off your total. Mix and match across reds, whites, and rosé — available in-store and online.",
    category: "Wine",
    discount: "15% OFF",
    validUntil: "2025-05-20",
    image:
      "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=800&q=80",
    isExclusive: false,
  },
  {
    id: "7",
    wineryName: "Moss Wood",
    winerySlug: "moss-wood",
    title: "Cellar Door Lunch Package",
    description:
      "A relaxed long lunch in the winery garden with three courses designed to complement Moss Wood's acclaimed Cabernet Sauvignon and Chardonnay. Bookings essential.",
    category: "Dining",
    originalPrice: "$120",
    offerPrice: "$95",
    validUntil: "2025-07-31",
    image:
      "https://images.unsplash.com/photo-1519671282429-b44b41e04a6c?w=800&q=80",
    isExclusive: true,
  },
  {
    id: "8",
    wineryName: "Devil's Lair",
    winerySlug: "devils-lair",
    title: "Mixed Dozen – Member Price",
    description:
      "Enjoy member-exclusive pricing on a hand-picked mixed dozen spanning Fifth Leg, Margaret River and the premium 'Ninth Circle'. A cellar door exclusive offer.",
    category: "Wine",
    discount: "MEMBER PRICE",
    validUntil: "2025-09-30",
    image:
      "https://images.unsplash.com/photo-1580911782168-04e6f9e2b1d4?w=800&q=80",
    isExclusive: false,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function formatExpiry(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `Until ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

function daysRemaining(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const expiry = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(
    0,
    Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  );
}

const CATEGORY_FILTERS: CategoryFilter[] = [
  "All",
  "Tasting",
  "Wine",
  "Dining",
  "Experience",
  "Accommodation",
];

// ─── Special Card ──────────────────────────────────────────────────────────────

function SpecialCard({
  item,
  router,
}: {
  item: Special;
  router: ReturnType<typeof useRouter>;
}) {
  const days = daysRemaining(item.validUntil);
  const isUrgent = days <= 14;

  return (
    <Pressable
      style={cardStyles.card}
      onPress={() => router.push(`/wineries/${item.winerySlug}` as any)}
    >
      {/* Hero image */}
      <View style={cardStyles.imageWrapper}>
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={cardStyles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={cardStyles.imagePlaceholder}>
            <Text style={cardStyles.imagePlaceholderGlyph}>🍷</Text>
          </View>
        )}
        <LinearGradient
          colors={["rgba(0,0,0,0.35)", "transparent", "rgba(0,0,0,0.60)"]}
          style={cardStyles.gradient}
        />

        {/* Category badge — top left */}
        <View style={cardStyles.categoryBadge}>
          <Text style={cardStyles.categoryText}>
            {item.category.toUpperCase()}
          </Text>
        </View>

        {/* Discount or price badge — top right */}
        {item.discount && (
          <View style={cardStyles.discountBadge}>
            <Text style={cardStyles.discountText}>{item.discount}</Text>
          </View>
        )}

        {/* Exclusive marker — bottom left over gradient */}
        {item.isExclusive && (
          <View style={cardStyles.exclusiveBadge}>
            <Text style={cardStyles.exclusiveText}>★  APP EXCLUSIVE</Text>
          </View>
        )}
      </View>

      {/* Card body */}
      <View style={cardStyles.body}>
        {/* Winery */}
        <Text style={cardStyles.wineryLabel} numberOfLines={1}>
          {item.wineryName.toUpperCase()}
        </Text>

        {/* Offer title */}
        <Text style={cardStyles.title}>{item.title}</Text>

        {/* Description */}
        <Text style={cardStyles.description} numberOfLines={3}>
          {item.description}
        </Text>

        {/* Price comparison */}
        {item.originalPrice && item.offerPrice && (
          <View style={cardStyles.priceRow}>
            <Text style={cardStyles.originalPrice}>{item.originalPrice}</Text>
            <Text style={cardStyles.offerPrice}>{item.offerPrice}</Text>
            <View style={cardStyles.savingsBadge}>
              <Text style={cardStyles.savingsText}>SAVE</Text>
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={cardStyles.footer}>
          <View style={cardStyles.expiryRow}>
            <Ionicons
              name="time-outline"
              size={12}
              color={isUrgent ? "#940c0c" : "#bbb"}
              style={{ marginTop: 1 }}
            />
            <Text
              style={[
                cardStyles.expiryText,
                isUrgent && cardStyles.expiryUrgent,
              ]}
            >
              {isUrgent && days > 0
                ? `${days} days left`
                : formatExpiry(item.validUntil)}
            </Text>
          </View>
          <View style={cardStyles.ctaRow}>
            <Text style={cardStyles.ctaText}>VIEW OFFER</Text>
            <Text style={cardStyles.ctaArrow}>›</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SpecialsScreen() {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("All");
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const filtered = SPECIALS.filter(
    (s) => activeCategory === "All" || s.category === activeCategory
  );

  const exclusiveCount = filtered.filter((s) => s.isExclusive).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>OFFERS</Text>
          <Text style={styles.headerTitle}>Specials</Text>
        </View>
        {exclusiveCount > 0 && (
          <View style={styles.exclusiveCountBadge}>
            <Text style={styles.exclusiveCountText}>
              {exclusiveCount} EXCLUSIVE
            </Text>
          </View>
        )}
      </View>

      {/* ── Category filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScroll}
        contentContainerStyle={styles.filtersRow}
      >
        {CATEGORY_FILTERS.map((cat) => {
          const active = activeCategory === cat;
          return (
            <Pressable
              key={cat}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {cat}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── Count divider ── */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>
          {filtered.length} {filtered.length === 1 ? "OFFER" : "OFFERS"}
        </Text>
        <View style={styles.dividerLine} />
      </View>

      {/* ── List ── */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <SpecialCard item={item} router={router} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyLabel}>NO OFFERS</Text>
            <Text style={styles.emptyText}>
              Check back soon for exclusive deals.
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
  exclusiveCountBadge: {
    borderWidth: 1,
    borderColor: "#940c0c",
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4,
  },
  exclusiveCountText: {
    fontSize: 8,
    letterSpacing: 2,
    color: "#940c0c",
    fontWeight: "600",
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

  // Divider
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

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: "#faf9f6",
    overflow: "hidden",
  },

  // Image
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

  // Category badge — top left
  categoryBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    backgroundColor: "rgba(26,26,26,0.80)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryText: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#fff",
    fontWeight: "600",
  },

  // Discount badge — top right
  discountBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    backgroundColor: "#940c0c",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  discountText: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: "#fff",
    fontWeight: "700",
  },

  // Exclusive badge — bottom left
  exclusiveBadge: {
    position: "absolute",
    bottom: 14,
    left: 14,
    backgroundColor: "rgba(148,12,12,0.88)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  exclusiveText: {
    fontSize: 8,
    letterSpacing: 2,
    color: "#fff",
    fontWeight: "600",
  },

  // Body
  body: {
    paddingTop: 14,
    paddingBottom: 16,
  },
  wineryLabel: {
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
    marginBottom: 8,
  },
  description: {
    fontSize: 13,
    color: "#666",
    lineHeight: 19,
    marginBottom: 12,
  },

  // Price comparison
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  originalPrice: {
    fontSize: 14,
    color: "#bbb",
    textDecorationLine: "line-through",
    letterSpacing: 0.3,
  },
  offerPrice: {
    fontSize: 18,
    fontFamily: "Georgia",
    fontWeight: "700",
    color: "#940c0c",
    letterSpacing: 0.3,
  },
  savingsBadge: {
    borderWidth: 1,
    borderColor: "#940c0c",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savingsText: {
    fontSize: 8,
    letterSpacing: 1.5,
    color: "#940c0c",
    fontWeight: "600",
  },

  // Footer
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  expiryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  expiryText: {
    fontSize: 11,
    color: "#bbb",
    letterSpacing: 0.3,
  },
  expiryUrgent: {
    color: "#940c0c",
    fontWeight: "600",
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
