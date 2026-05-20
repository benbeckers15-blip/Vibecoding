// components/ConciergeChat.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Full-screen modal chat with the SipLocal Sommelier. Opens from a floating
// FAB on the home screen.
//
// Aesthetic:
//   • Dark editorial — matches the rest of the app (Forest Slate theme).
//   • Playfair italic for the AI's voice; DM Sans for the user's input.
//   • Wide-tracked kicker labels in the header.
//   • Sharp-cornered surfaces; pill chips for the suggested prompts.
//
// Behaviour:
//   • Singleton `Concierge` instance: history survives close/reopen until
//     the user explicitly taps "Reset".
//   • Init happens lazily on first open. Loading state covers the dataset
//     fetch on the very first send.
//   • Errors render inline as a system message so failures are diagnosable
//     without a console.
// ─────────────────────────────────────────────────────────────────────────────

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, spacing, type } from "../constants/theme";
import { useRegionConfig } from "../context/RegionContext";
import { useTrips } from "../context/TripContext";
import { getConcierge } from "../services/concierge/concierge";
import type {
  ChatMessage,
  TripProposal,
  WineryCardSuggestion,
} from "../services/concierge/concierge";
import {
  formatTokens,
  formatUsd,
  type TurnCost,
} from "../services/concierge/costTracker";
import type { TripStop } from "../types/trip";
import { optimiseRoute } from "../utils/routePlanner";

interface ConciergeChatProps {
  visible: boolean;
  onClose: () => void;
}

export default function ConciergeChat({ visible, onClose }: ConciergeChatProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const concierge = getConcierge();
  const { createTrip, setTripStops, startTrip } = useTrips();
  // Region config drives the per-region empty-state prompts and the
  // region id we pass to the concierge for init() + the request body.
  const regionConfig = useRegionConfig();
  const SUGGESTIONS = regionConfig.suggestedPrompts;

  const [messages, setMessages] = useState<ChatMessage[]>(concierge.getHistory());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Stable per-message IDs that survive concierge.trimHistory() — the
  // concierge caps history at MAX_HISTORY_TURNS*2 messages and slices
  // the OLDEST entries off the front once the cap is hit. If we keyed
  // proposals by the array index, that index would silently re-bind to
  // whichever message ended up at that slot after the slice, and the
  // Start Trip card would visually "follow" the bottom of the chat
  // instead of staying with the assistant turn that proposed it.
  //
  // Two storage layers:
  //   • messageIdsRef: synchronous source of truth. Updated inline by
  //     the send() callback so the post-stream alignment math reads
  //     the latest value, not a stale closure snapshot.
  //   • messageIds state: drives renders. Mirrors the ref.
  // Every write goes through writeMessageIds() to keep them in sync.
  const initialIds = useState<string[]>(() =>
    concierge.getHistory().map((_, i) => `m${i}`)
  );
  const [messageIds, setMessageIdsState] = initialIds;
  const messageIdsRef = useRef<string[]>(messageIds);
  const messageIdCounterRef = useRef<number>(messageIds.length);
  const writeMessageIds = useCallback((next: string[]) => {
    messageIdsRef.current = next;
    setMessageIdsState(next);
  }, [setMessageIdsState]);
  const mintMessageId = useCallback(
    () => `m${messageIdCounterRef.current++}`,
    []
  );
  // Trip proposals keyed by stable message ID (NOT array index — see
  // the messageIds comment above for why index-keyed storage broke
  // once trimming kicked in). Cleared on Reset alongside the
  // conversation itself.
  const [proposals, setProposals] = useState<Record<string, TripProposal>>({});
  const [wineryCards, setWineryCards] = useState<Record<string, WineryCardSuggestion>>({});
  // True while the user has tapped a Start Trip card and we're routing
  // them through to /trip-active. Disables both Start buttons (we don't
  // want a double-tap to fire two trips) and shows a small spinner.
  // Keyed by the same stable message ID as proposals/wineryCards.
  const [startingTripId, setStartingTripId] = useState<string | null>(null);
  // True once the first streamed chunk has landed for the current
  // turn. We use this to swap the "Pouring a thought…" placeholder
  // out for the live, streaming assistant bubble so the user sees
  // exactly one indicator at a time.
  const [streaming, setStreaming] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Cost monitor (testing / demo phase) ────────────────────────────────
  // `lastCost` holds the breakdown for the most recent turn so the user
  // sees the cost of the question they just asked. `sessionTotals` is a
  // running aggregate across every turn in this modal-open lifetime.
  // Both reset when the user taps the Reset (refresh) button.
  const [lastCost, setLastCost] = useState<TurnCost | null>(null);
  const [sessionTotals, setSessionTotals] = useState<{
    turns: number;
    usd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>({
    turns: 0,
    usd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });

  const scrollRef = useRef<ScrollView>(null);

  // ── Streaming typewriter ──────────────────────────────────────────────
  // The model emits text deltas in chunky bursts (often whole phrases at
  // once). Painting each delta directly makes the reply land on screen
  // in big blocky jumps. We instead push every incoming delta into a
  // buffer and drain it a few characters at a time via a ticker, so the
  // visible text grows at a smooth typewriter pace. The drain rate
  // adapts to backlog so we never fall noticeably behind the model.
  const [streamingText, setStreamingText] = useState("");
  const pendingTextRef = useRef("");
  const streamDoneRef = useRef(true);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopFlusher = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const startFlusher = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setInterval(() => {
      const buf = pendingTextRef.current;
      if (!buf.length) {
        // Caught up. If the stream is also done we can stop the ticker
        // entirely; otherwise keep ticking so we're ready for the next
        // delta the moment it arrives.
        if (streamDoneRef.current) stopFlusher();
        return;
      }
      // Adaptive drain: chew through the backlog quickly when the
      // model is mid-burst, but slow to a true typewriter pace at
      // the tail so the reply finishes gracefully instead of
      // sprint-flickering to the end.
      const size =
        buf.length > 240 ? 12 :
        buf.length > 120 ? 6 :
        buf.length > 40 ? 3 :
        1;
      const slice = buf.slice(0, size);
      pendingTextRef.current = buf.slice(size);
      setStreamingText((prev) => prev + slice);
    }, 25);
  }, [stopFlusher]);

  // Wait until the typewriter buffer is fully drained — used after
  // the stream resolves so we don't "snap" the reply to its final
  // text and skip the tail of the animation.
  const waitForFlush = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (pendingTextRef.current.length === 0) resolve();
          else setTimeout(check, 20);
        };
        check();
      }),
    []
  );

  // Tear down the ticker if the modal unmounts mid-stream.
  useEffect(() => stopFlusher, [stopFlusher]);

  // Lazy-init the concierge the first time the modal opens.
  useEffect(() => {
    if (!visible) return;
    if (concierge.isReady()) return;
    let cancelled = false;
    (async () => {
      try {
        await concierge.init(regionConfig.regionId);
        if (!cancelled) setInitError(null);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setInitError(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, concierge, regionConfig.regionId]);

  // Fetch the user's location each time the chat opens so the concierge
  // can prioritise nearby wineries. Fails silently — location is optional
  // context, not a required feature.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          concierge.setUserLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        }
      } catch {
        // Location unavailable — concierge continues without proximity context.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, concierge]);

  // Whenever a message lands — or the streaming bubble's text grows
  // by another character on a ticker tick — snap the scroll view to
  // the latest so the live-typing reply stays in view. RAF coalesces
  // bursts of updates so this stays smooth even at 40 ticks/sec.
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages, sending, streaming, streamingText, visible]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setError(null);
      setInput("");
      // Optimistically render the user message before the API resolves.
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      // Mint a stable ID for the optimistic user bubble so the
      // post-stream alignment math has a length-matched array to
      // extend. We go through writeMessageIds so the ref (read
      // synchronously below) stays in lockstep with the state.
      writeMessageIds([...messageIdsRef.current, mintMessageId()]);
      setSending(true);
      setStreaming(false);

      // Spin up the typewriter pipeline for this turn. The streaming
      // bubble (rendered separately from `messages` below) is what
      // paints the live reply; `messages` only gets the canonical
      // committed text after the stream finishes draining.
      pendingTextRef.current = "";
      setStreamingText("");
      streamDoneRef.current = false;
      startFlusher();

      try {
        if (!concierge.isReady()) {
          await concierge.init(regionConfig.regionId);
        }
        // Streamed variant — `askStream` invokes the callback once
        // per text fragment as the model emits them. We DO NOT paint
        // the delta directly; instead we push it into the buffer the
        // ticker (`startFlusher`) drains a few chars at a time. This
        // smooths over Anthropic's chunky deltas (often whole phrases
        // at once) into a steady character-by-character typewriter.
        const result = await concierge.askStream(trimmed, (delta) => {
          if (!delta) return;
          pendingTextRef.current += delta;
          // First-chunk transition: hide the "Pouring a thought…"
          // indicator the moment text actually starts arriving.
          setStreaming(true);
        });

        // Stream is finished. Let the typewriter finish draining
        // whatever's still in the buffer before we commit — otherwise
        // the bubble would snap to its full text and the user would
        // miss the tail of the animation.
        streamDoneRef.current = true;
        await waitForFlush();

        // Final sync — concierge.history holds the canonical reply
        // (which may have been sentence-trimmed if the model hit
        // MAX_TOKENS). Resyncing here guarantees the committed bubble
        // shows the trimmed text rather than the raw streamed
        // fragment. Clearing `streamingText` in the same tick swaps
        // the live-typing bubble out for the committed one with no
        // visible flicker.
        const nextMessages = concierge.getHistory();
        setMessages(nextMessages);
        // Realign the parallel ID array to the canonical history. We
        // already minted one ID optimistically (for the user bubble);
        // append one more for the assistant message that just landed,
        // then slice from the FRONT to match the trimmed length. The
        // front-slice mirrors concierge.trimHistory() — without it,
        // a proposal made at the cap would silently re-bind to
        // whichever message landed in its slot after trim, and the
        // Start Trip card would visually stick to the bottom of the
        // chat instead of staying with the assistant turn that
        // proposed it.
        const expanded = [...messageIdsRef.current, mintMessageId()];
        const finalIds =
          expanded.length > nextMessages.length
            ? expanded.slice(expanded.length - nextMessages.length)
            : expanded;
        writeMessageIds(finalIds);
        setStreamingText("");
        // If the sommelier emitted a trip-plan tail, attach the parsed
        // proposal to the freshly-committed assistant bubble. The
        // bubble is the LAST entry in history (role "assistant"); its
        // stable ID is the LAST entry in finalIds. Keying by ID (not
        // index) keeps the proposal pinned to the right message even
        // after trimHistory() shifts the array.
        const assistantId = finalIds[finalIds.length - 1];
        if (result.proposal && assistantId) {
          setProposals((prev) => ({ ...prev, [assistantId]: result.proposal! }));
        }
        if (result.wineryCards && assistantId) {
          setWineryCards((prev) => ({ ...prev, [assistantId]: result.wineryCards! }));
        }
        setLastCost(result.cost);
        setSessionTotals((prev) => ({
          turns: prev.turns + 1,
          usd: prev.usd + result.cost.total.usd.total,
          inputTokens: prev.inputTokens + result.cost.total.inputTokens,
          outputTokens: prev.outputTokens + result.cost.total.outputTokens,
          cacheReadTokens:
            prev.cacheReadTokens + result.cost.total.cacheReadTokens,
          cacheWriteTokens:
            prev.cacheWriteTokens + result.cost.total.cacheWriteTokens,
        }));
      } catch (err) {
        // Tear down the typewriter — concierge.history is the source
        // of truth on error (it won't include the failed turn), so a
        // partial streamed bubble shouldn't linger in the UI either.
        streamDoneRef.current = true;
        pendingTextRef.current = "";
        stopFlusher();
        setStreamingText("");
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        // Roll the local history back to what the concierge actually has,
        // so the failed user turn doesn't linger in the UI.
        const rolledBack = concierge.getHistory();
        setMessages(rolledBack);
        // The failed turn was never committed to concierge.history, so
        // the optimistic ID we minted at the top of send() now points
        // to nothing. Drop it from the END (NOT the front — front is
        // reserved for trim-style shrinkage) to realign.
        if (messageIdsRef.current.length > rolledBack.length) {
          writeMessageIds(
            messageIdsRef.current.slice(0, rolledBack.length)
          );
        }
      } finally {
        setSending(false);
        setStreaming(false);
      }
    },
    [
      concierge,
      mintMessageId,
      sending,
      startFlusher,
      stopFlusher,
      waitForFlush,
      writeMessageIds,
    ]
  );

  const handleReset = () => {
    concierge.reset();
    // Tear down any in-flight typewriter state too — a Reset mid-stream
    // shouldn't leave the ticker running against a now-orphaned reply.
    pendingTextRef.current = "";
    streamDoneRef.current = true;
    stopFlusher();
    setStreamingText("");
    setMessages([]);
    writeMessageIds([]);
    messageIdCounterRef.current = 0;
    setProposals({});
    setWineryCards({});
    setStartingTripId(null);
    setError(null);
    // Reset the cost monitor too — a "Reset" should mean a clean slate
    // for both the conversation AND the running cost tally.
    setLastCost(null);
    setSessionTotals({
      turns: 0,
      usd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  };

  // ── Start Trip from a sommelier-proposed itinerary ─────────────────────
  // Mirrors trips/[id].tsx's handleStart so the trip lifecycle is
  // identical no matter how the trip was authored: hydrate slugs into
  // TripStops, request a location origin (fall back to the first
  // stop), run the Google Directions optimiser (with the local
  // nearest-neighbour fallback baked in), persist via TripContext,
  // flip status to active, and route to /trip-active. Closing the
  // modal is the last step so the user lands directly on the trip
  // screen rather than bouncing through the chat.
  const handleStartProposal = useCallback(
    async (proposal: TripProposal, msgId: string) => {
      if (startingTripId !== null) return;
      setStartingTripId(msgId);
      try {
        // 1. Hydrate the proposal's slugs into TripStops using the
        //    concierge's in-memory corpus. No Firestore round-trip.
        const stops: TripStop[] = [];
        const missing: string[] = [];
        for (const slug of proposal.slugs) {
          const w = concierge.getWinery(slug);
          if (
            w &&
            typeof w.latitude === "number" &&
            typeof w.longitude === "number" &&
            Number.isFinite(w.latitude) &&
            Number.isFinite(w.longitude)
          ) {
            stops.push({
              wineryId: w.id,
              name: w.name ?? "Winery",
              slug: w.slug || w.id,
              latitude: w.latitude,
              longitude: w.longitude,
            });
          } else {
            missing.push(slug);
          }
        }

        if (stops.length < 2) {
          Alert.alert(
            "Couldn’t build this trip",
            missing.length > 0
              ? "The sommelier referenced winer" +
                  (missing.length === 1 ? "y" : "ies") +
                  " I couldn’t resolve in the SipLocal corpus. Please ask for the trip again."
              : "A trip needs at least 2 wineries with valid coordinates."
          );
          return;
        }

        // 2. Origin for routing — same pattern as trips/[id].tsx. We
        //    don't block on a denied permission; the first stop is a
        //    fine fallback for optimisation purposes.
        let origin: { latitude: number; longitude: number } | null = null;
        try {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (perm.status === "granted") {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            origin = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            };
          }
        } catch {
          /* fall through to first-stop origin */
        }
        if (!origin) {
          origin = {
            latitude: stops[0].latitude,
            longitude: stops[0].longitude,
          };
        }

        // 3. Route optimisation. Falls back to a local nearest-
        //    neighbour heuristic inside optimiseRoute if Google fails.
        const optimised = await optimiseRoute(origin, stops);

        // 4. Persist via TripContext, then flip to active. createTrip
        //    initialises the trip in not_started state; setTripStops
        //    writes the optimised order; startTrip flips status.
        const tripId = createTrip(proposal.name, optimised.orderedStops);
        setTripStops(tripId, optimised.orderedStops, optimised.usedGoogle);
        startTrip(tripId);

        // 5. Close the chat modal BEFORE navigating so the user lands
        //    on the active-trip screen with a clean stack.
        onClose();
        router.replace({
          pathname: "/trip-active",
          params: { tripId },
        });
      } catch (err) {
        console.warn("[concierge] start trip failed:", err);
        Alert.alert(
          "Couldn’t start trip",
          "We couldn’t plan a route just now. Please try again."
        );
      } finally {
        setStartingTripId(null);
      }
    },
    [
      concierge,
      createTrip,
      onClose,
      router,
      setTripStops,
      startTrip,
      startingTripId,
    ]
  );

  const isEmpty = messages.length === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [
              styles.headerBtn,
              pressed && styles.headerBtnPressed,
            ]}
          >
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>

          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerKicker}>SIPLOCAL · CONCIERGE</Text>
            <Text style={styles.headerTitle}>The Sommelier</Text>
          </View>

          <Pressable
            onPress={handleReset}
            hitSlop={12}
            disabled={isEmpty}
            style={({ pressed }) => [
              styles.headerBtn,
              pressed && styles.headerBtnPressed,
              isEmpty && styles.headerBtnDisabled,
            ]}
          >
            <Ionicons
              name="refresh"
              size={18}
              color={isEmpty ? colors.textMuted : colors.textPrimary}
            />
          </Pressable>
        </View>

        <View style={styles.headerRule} />

        {/* ── Cost monitor (dev / demo overlay) ───────────────────────────── */}
        {/* Always visible during the testing phase so each query's token
            and USD cost is right there next to the answer. Remove or
            wrap in __DEV__ before shipping. */}
        <CostMonitor lastCost={lastCost} totals={sessionTotals} />

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {isEmpty ? (
              <EmptyState
                regionName={regionConfig.displayName}
                suggestions={SUGGESTIONS}
                disabled={sending || !!initError}
                onPick={(prompt) => void send(prompt)}
              />
            ) : (
              <>
                {messages.map((m, i) => {
                  // Stable ID for this message. Falls back to the array
                  // index ONLY for the (transient) moment before the
                  // parallel ID array catches up — keeps React keys
                  // valid even mid-render if the two states ever
                  // diverge by a tick.
                  const id = messageIds[i] ?? `m-fallback-${i}`;
                  const prop = proposals[id];
                  const cards = wineryCards[id];
                  // When the model emits winery cards for 2+ wineries but
                  // no dedicated <<TRIP_PLAN>> block, synthesize a proposal
                  // so the Start Trip button still appears on the cards.
                  const cardTripProposal: TripProposal | null =
                    !prop && cards && cards.slugs.length >= 2
                      ? { name: "Sommelier's route", slugs: cards.slugs }
                      : null;
                  return (
                    <View key={id}>
                      <MessageBubble role={m.role} content={m.content} />
                      {prop && m.role === "assistant" && (
                        <TripStartCard
                          proposal={prop}
                          starting={startingTripId === id}
                          disabled={
                            startingTripId !== null && startingTripId !== id
                          }
                          onStart={() => void handleStartProposal(prop, id)}
                        />
                      )}
                      {cards && m.role === "assistant" && (
                        <WineryCards
                          suggestion={cards}
                          onClose={onClose}
                          onStartTrip={
                            cardTripProposal
                              ? () => void handleStartProposal(cardTripProposal, id)
                              : undefined
                          }
                          starting={startingTripId === id}
                          tripDisabled={
                            startingTripId !== null && startingTripId !== id
                          }
                        />
                      )}
                    </View>
                  );
                })}
                {/* Live typewriter bubble — separate from the committed
                    `messages` array. The ticker grows `streamingText`
                    a few characters at a time; when the stream finishes
                    and drains, the committed assistant message lands in
                    `messages` and `streamingText` clears in the same
                    render so there's no flicker. */}
                {streamingText.length > 0 && (
                  <MessageBubble role="assistant" content={streamingText} />
                )}
              </>
            )}

            {sending && !streaming && (
              <View style={styles.thinking}>
                <ActivityIndicator size="small" color={colors.accentSoft} />
                <Text style={styles.thinkingText}>Pouring a thought…</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBlock}>
                <Text style={styles.errorKicker}>SOMETHING WENT WRONG</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {initError && (
              <View style={styles.errorBlock}>
                <Text style={styles.errorKicker}>SETUP NEEDED</Text>
                <Text style={styles.errorText}>{initError}</Text>
              </View>
            )}
          </ScrollView>

          {/* ── Input bar ─────────────────────────────────────────────────── */}
          <View
            style={[
              styles.inputBar,
              { paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <TextInput
              style={styles.input}
              placeholder="Ask the sommelier…"
              placeholderTextColor={colors.textMuted}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => void send(input)}
              returnKeyType="send"
              multiline
              editable={!sending}
              blurOnSubmit
            />
            <Pressable
              onPress={() => void send(input)}
              disabled={!input.trim() || sending}
              style={({ pressed }) => [
                styles.sendBtn,
                (!input.trim() || sending) && styles.sendBtnDisabled,
                pressed && !!input.trim() && !sending && styles.sendBtnPressed,
              ]}
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Dev / demo overlay. Shows:
//   • The latest turn's cost (USD) and token totals — what the user
//     just paid to get the answer on screen.
//   • A running session total (turns × cost × tokens).
//   • A per-call breakdown so router-vs-response cost is visible.
// Renders a "—" placeholder before the first turn so the panel is
// always present (avoids layout jump when the first reply lands).
function CostMonitor({
  lastCost,
  totals,
}: {
  lastCost: TurnCost | null;
  totals: {
    turns: number;
    usd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}) {
  const last = lastCost?.total;
  return (
    <View style={styles.costMonitor}>
      <View style={styles.costRow}>
        <Text style={styles.costKicker}>DEV · LAST TURN</Text>
        <Text style={styles.costKickerRight}>
          {totals.turns > 0 ? `SESSION · ${totals.turns} TURN${totals.turns === 1 ? "" : "S"}` : "SESSION"}
        </Text>
      </View>

      <View style={styles.costRow}>
        <Text style={styles.costFigure}>
          {last ? formatUsd(last.usd.total) : "—"}
        </Text>
        <Text style={styles.costFigure}>
          {formatUsd(totals.usd)}
        </Text>
      </View>

      <View style={styles.costRow}>
        <Text style={styles.costDetail}>
          {last
            ? `${formatTokens(last.inputTokens)} in · ${formatTokens(last.outputTokens)} out · ${formatTokens(last.cacheReadTokens)} cached`
            : "ask a question to see the cost"}
        </Text>
        <Text style={styles.costDetail}>
          {totals.turns > 0
            ? `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`
            : ""}
        </Text>
      </View>

      {lastCost && lastCost.parts.length > 0 && (
        <View style={styles.costParts}>
          {lastCost.parts.map((p) => (
            <Text key={p.label} style={styles.costPartLine}>
              {p.label}: {formatUsd(p.breakdown.usd.total)} ·{" "}
              {formatTokens(p.breakdown.inputTokens)} in /{" "}
              {formatTokens(p.breakdown.outputTokens)} out
              {p.breakdown.cacheReadTokens > 0
                ? ` · ${formatTokens(p.breakdown.cacheReadTokens)} cached`
                : ""}
              {p.breakdown.cacheWriteTokens > 0
                ? ` · ${formatTokens(p.breakdown.cacheWriteTokens)} write`
                : ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function MessageBubble({ role, content }: { role: ChatMessage["role"]; content: string }) {
  const isUser = role === "user";
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAi]}>
      {!isUser && <Text style={styles.aiKicker}>SOMMELIER</Text>}
      <View style={isUser ? styles.bubbleUser : styles.bubbleAi}>
        <Text style={isUser ? styles.bubbleUserText : styles.bubbleAiText}>
          {content}
        </Text>
      </View>
    </View>
  );
}

// ─── Trip start card ─────────────────────────────────────────────────────────
// Rendered inline beneath an assistant bubble whose reply carried a
// parsed trip proposal. Shows the editorial trip name, an ordered list
// of the proposed wineries (resolved against the in-memory corpus so
// we display the friendly names — not the raw slugs), and a Start
// Trip button that mirrors the trip-detail screen's start flow.
//
// Visual register matches the rest of the chat: sharp corners,
// editorial kicker label, soft surface card with an accent left border.
// The button itself uses the same accent colour as the send-message
// FAB so it reads as the primary action when present.
function TripStartCard({
  proposal,
  onStart,
  starting,
  disabled,
}: {
  proposal: TripProposal;
  onStart: () => void;
  starting: boolean;
  disabled: boolean;
}) {
  const concierge = getConcierge();
  // Hydrate slugs → display names for the itinerary list. Falls back
  // to a humanised slug for any slug the corpus doesn't know about
  // (shouldn't happen in practice — the prompt requires exact ids —
  // but we never want to show a raw kebab-case slug).
  const items = proposal.slugs.map((slug) => {
    const w = concierge.getWinery(slug);
    if (w?.name) return w.name;
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  });

  return (
    <View style={styles.tripCard}>
      <Text style={styles.tripCardKicker}>SUGGESTED TRIP</Text>
      <Text style={styles.tripCardTitle}>{proposal.name}</Text>
      <View style={styles.tripCardList}>
        {items.map((name, i) => (
          <View key={`${name}-${i}`} style={styles.tripCardRow}>
            <Text style={styles.tripCardIndex}>{String(i + 1).padStart(2, "0")}</Text>
            <Text style={styles.tripCardStop}>{name}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={onStart}
        disabled={disabled || starting}
        style={({ pressed }) => [
          styles.tripCardBtn,
          (disabled || starting) && styles.tripCardBtnDisabled,
          pressed && !disabled && !starting && styles.tripCardBtnPressed,
        ]}
      >
        {starting ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <>
            <Ionicons name="car-sport" size={16} color={colors.onAccent} />
            <Text style={styles.tripCardBtnText}>START TRIP</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

// ─── Winery cards ────────────────────────────────────────────────────────────
// Rendered beneath an assistant bubble when the model signals interest in
// one or more wineries. Shows a compact card per winery with hero image,
// name, region, rating, and a tap-through to the detail screen.
//
// Any winery in the SipLocal corpus is eligible — we used to require
// `featured === true`, but that meant the cards almost never rendered.
// The only filter now is "slug exists in the in-memory corpus" so a
// stray hallucinated slug from the model can't break the row.
//
// Tapping a card closes the chat modal AND routes to the winery
// detail screen. Closing first matters: the chat is a full-screen
// Modal, so without dismissing it the navigation happens underneath
// and the user appears to tap a dead link.
function WineryCards({
  suggestion,
  onClose,
  onStartTrip,
  starting,
  tripDisabled,
}: {
  suggestion: WineryCardSuggestion;
  onClose: () => void;
  onStartTrip?: () => void;
  starting?: boolean;
  tripDisabled?: boolean;
}) {
  const concierge = getConcierge();
  const router = useRouter();

  const wineries = suggestion.slugs
    .map((slug) => concierge.getWinery(slug))
    .filter((w): w is NonNullable<typeof w> => !!w);

  if (__DEV__ && wineries.length < suggestion.slugs.length) {
    const dropped = suggestion.slugs.filter((s) => !concierge.getWinery(s));
    // Helps diagnose "the model emitted a card but nothing rendered" —
    // usually means the slug it picked isn't in the loaded corpus.
    console.warn("[WineryCards] dropped unknown slugs:", dropped);
  }

  if (wineries.length === 0) return null;

  return (
    <View style={styles.wineryCardsWrap}>
      {wineries.map((w) => (
        <Pressable
          key={w.slug || w.id}
          style={({ pressed }) => [
            styles.wineryCard,
            pressed && styles.wineryCardPressed,
          ]}
          onPress={() => {
            // Dismiss the chat modal BEFORE navigating so the user
            // actually sees the winery screen instead of staring at
            // the chat. Same pattern as Start Trip above.
            onClose();
            // `?from=concierge` lets the winery detail screen show a
            // sensible back label and, more importantly, route the
            // user back to home with a flag that reopens the chat —
            // otherwise the back button would just dump them onto
            // the home screen with no obvious way back to where they
            // were.
            router.push(`/wineries/${w.slug || w.id}?from=concierge` as any);
          }}
        >
          {w.images && w.images.length > 0 && (
            <Image
              source={{ uri: w.images[0] }}
              style={styles.wineryCardImg}
              contentFit="cover"
              transition={150}
            />
          )}
          <View style={styles.wineryCardBody}>
            <Text style={styles.wineryCardRegion}>
              {(w.region ?? "TASMANIA").toUpperCase()}
            </Text>
            <View style={styles.wineryCardTitleRow}>
              <Text style={styles.wineryCardName} numberOfLines={2}>
                {w.name}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={colors.accent} />
            </View>
            {typeof w.rating === "number" && (
              <Text style={styles.wineryCardRating}>
                ★ {w.rating.toFixed(1)}
                {typeof w.userRatingsTotal === "number"
                  ? `  ·  ${w.userRatingsTotal.toLocaleString()} reviews`
                  : ""}
              </Text>
            )}
            {/*
              ── Booking-required call-to-action ─────────────────────
              When the sommelier recommends a winery that doesn't take
              walk-ins, surface a tap-to-call CTA in the card itself so
              the guest can ring ahead and book without first opening
              the detail screen. The button stops tap propagation so it
              doesn't ALSO trigger the parent card's "open detail" press.
            */}
            {w.walkinWelcome === false && w.phone && (
              <View style={styles.bookingBlock}>
                <View style={styles.bookingNoticeRow}>
                  <Ionicons
                    name="information-circle-outline"
                    size={11}
                    color={colors.accentSoft}
                    style={styles.bookingNoticeIcon}
                  />
                  <Text style={styles.bookingNoticeText} numberOfLines={2}>
                    Bookings required — walk-ins not accepted.
                  </Text>
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    const tel = w.phone!.replace(/\s/g, "");
                    Linking.openURL(`tel:${tel}`).catch(() =>
                      console.warn("Could not open phone link")
                    );
                  }}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.bookingCallBtn,
                    pressed && styles.bookingCallBtnPressed,
                  ]}
                >
                  <Ionicons name="call" size={12} color={colors.onAccent} />
                  <Text style={styles.bookingCallBtnText}>CALL TO BOOK</Text>
                </Pressable>
              </View>
            )}
          </View>
        </Pressable>
      ))}
      {onStartTrip && (
        <Pressable
          onPress={onStartTrip}
          disabled={tripDisabled || starting}
          style={({ pressed }) => [
            styles.cardTripBtn,
            (tripDisabled || starting) && styles.cardTripBtnDisabled,
            pressed && !tripDisabled && !starting && styles.cardTripBtnPressed,
          ]}
        >
          {starting ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <>
              <Ionicons name="car-sport" size={16} color={colors.onAccent} />
              <Text style={styles.cardTripBtnText}>START TRIP</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

function EmptyState({
  regionName,
  suggestions,
  disabled,
  onPick,
}: {
  regionName: string;
  suggestions: string[];
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.goldLine} />
      <Text style={styles.emptyKicker}>YOUR PRIVATE GUIDE TO {regionName.toUpperCase()}</Text>
      <Text style={styles.emptyHeadline}>
        Plan a day. Find the right cellar door. Ask anything.
      </Text>
      <Text style={styles.emptyBody}>
        I know every winery in the SipLocal guide — their hours, regions, the
        wines they're known for. Tell me what you're after.
      </Text>

      <Text style={styles.suggestionsKicker}>TRY ASKING</Text>
      <View style={styles.suggestions}>
        {suggestions.map((s) => (
          <Pressable
            key={s}
            onPress={() => onPick(s)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.suggestionChip,
              pressed && styles.suggestionChipPressed,
              disabled && styles.suggestionChipDisabled,
            ]}
          >
            <Text style={styles.suggestionText}>{s}</Text>
            <Ionicons name="arrow-forward" size={13} color={colors.accent} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ── Header ─────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerBtnPressed: {
    opacity: 0.7,
  },
  headerBtnDisabled: {
    opacity: 0.45,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: 2,
  },
  headerTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  headerRule: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xxl,
  },

  // ── Cost monitor (dev overlay) ─────────────────────────────────────────
  // Deliberately a little visually loud — different surface colour, sharp
  // edges, monospace-y vibe — so it's obviously a debug widget and not a
  // production UI element. Strip these styles (and the component above)
  // when shipping a public build.
  costMonitor: {
    marginHorizontal: spacing.xxl,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    gap: 2,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  costKicker: {
    ...type.kicker,
    color: colors.accent,
    fontSize: 9,
  },
  costKickerRight: {
    ...type.kicker,
    color: colors.textMuted,
    fontSize: 9,
  },
  costFigure: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  costDetail: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  costParts: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 2,
  },
  costPartLine: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 0.1,
  },

  // ── Scroll body ────────────────────────────────────────────────────────
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },

  // ── Empty state ────────────────────────────────────────────────────────
  empty: {
    paddingTop: spacing.xl,
  },
  goldLine: {
    width: 32,
    height: 1,
    backgroundColor: colors.accent,
    marginBottom: spacing.lg,
  },
  emptyKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.md,
  },
  emptyHeadline: {
    fontFamily: fonts.serifBold,
    fontSize: 30,
    lineHeight: 36,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    marginBottom: spacing.lg,
  },
  emptyBody: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.hero,
  },
  suggestionsKicker: {
    ...type.kicker,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  suggestions: {
    gap: spacing.sm,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: spacing.hitTarget,
  },
  suggestionChipPressed: {
    opacity: 0.7,
    borderColor: colors.accent,
  },
  suggestionChipDisabled: {
    opacity: 0.5,
  },
  suggestionText: {
    flex: 1,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 21,
  },

  // ── Bubbles ────────────────────────────────────────────────────────────
  bubbleRow: {
    marginBottom: spacing.xl,
  },
  bubbleRowUser: {
    alignItems: "flex-end",
  },
  bubbleRowAi: {
    alignItems: "flex-start",
  },
  aiKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.sm,
  },
  bubbleUser: {
    maxWidth: "85%",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.accent,
  },
  bubbleUserText: {
    ...type.body,
    color: colors.onAccent,
    fontFamily: fonts.sansMedium,
    lineHeight: 21,
  },
  bubbleAi: {
    maxWidth: "100%",
  },
  bubbleAiText: {
    fontFamily: fonts.roboto,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 26,
    letterSpacing: 0,
  },

  // ── Winery cards ──────────────────────────────────────────────────────
  wineryCardsWrap: {
    marginTop: -spacing.sm,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  wineryCard: {
    // Vertical layout — hero image fills the full card width on top,
    // metadata + CTA sit below. Previous horizontal layout forced
    // landscape winery photos into a 72×72 thumbnail (cropped sides)
    // or stranded the square next to a growing body (gray dead space).
    // Full-width hero matches the wineries-list aesthetic and shows
    // the photo in its natural aspect ratio.
    flexDirection: "column",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    overflow: "hidden",
  },
  wineryCardPressed: {
    opacity: 0.85,
  },
  wineryCardImg: {
    width: "100%",
    // 140px tall is enough to read the photo at chat-width without
    // dominating the card. `contentFit: "cover"` crops top/bottom of a
    // landscape photo minimally at this aspect ratio (~2.3:1 on a
    // ~320px-wide modal).
    height: 140,
  },
  wineryCardBody: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // Title row groups the winery name with the chevron affordance on
  // the right. Used to be a separate column at the card edge; moving
  // it inline with the name keeps the visual weight on the title and
  // saves a column of horizontal space.
  wineryCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  wineryCardRegion: {
    fontFamily: fonts.sans,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.textMuted,
    marginBottom: 2,
  },
  wineryCardName: {
    flex: 1,
    fontFamily: fonts.serifBold,
    fontSize: 16,
    lineHeight: 21,
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  wineryCardRating: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.accentSoft,
    marginTop: 3,
  },
  // ── Booking-required CTA (walk-ins not welcome) ────────────────────────
  // Sits beneath the rating inside the winery card. The hairline
  // separates it from the metadata above so it reads as a distinct
  // "action required" affordance rather than another label line.
  bookingBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
  },
  bookingNoticeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  bookingNoticeIcon: {
    marginRight: 5,
  },
  bookingNoticeText: {
    flex: 1,
    fontFamily: fonts.serifItalic,
    fontSize: 11,
    lineHeight: 15,
    color: colors.accentSoft,
  },
  bookingCallBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignSelf: "flex-start",
  },
  bookingCallBtnPressed: {
    opacity: 0.85,
  },
  bookingCallBtnText: {
    ...type.kicker,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.onAccent,
  },
  cardTripBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    minHeight: spacing.hitTarget,
    marginTop: spacing.xs,
  },
  cardTripBtnPressed: {
    opacity: 0.85,
  },
  cardTripBtnDisabled: {
    opacity: 0.5,
  },
  cardTripBtnText: {
    ...type.kicker,
    color: colors.onAccent,
    fontSize: 12,
    letterSpacing: 2,
  },

  // ── Trip start card ────────────────────────────────────────────────────
  // Sits beneath the assistant bubble that proposed the itinerary. The
  // negative top margin pulls it tight against the bubble so it reads
  // as a continuation of the same turn, not a separate message.
  tripCard: {
    marginTop: -spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    borderRadius: radius.card,
  },
  tripCardKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  tripCardTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 19,
    color: colors.textPrimary,
    letterSpacing: -0.2,
    marginBottom: spacing.md,
  },
  tripCardList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tripCardRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  tripCardIndex: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.accent,
    minWidth: 24,
  },
  tripCardStop: {
    flex: 1,
    fontFamily: fonts.serifRegular,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  tripCardBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    minHeight: spacing.hitTarget,
  },
  tripCardBtnPressed: {
    opacity: 0.85,
  },
  tripCardBtnDisabled: {
    opacity: 0.5,
  },
  tripCardBtnText: {
    ...type.kicker,
    color: colors.onAccent,
    fontSize: 12,
    letterSpacing: 2,
  },

  // ── Thinking / error ─────────────────────────────────────────────────
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  thinkingText: {
    ...type.kicker,
    color: colors.textMuted,
  },
  errorBlock: {
    padding: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderLeftWidth: 2,
    borderLeftColor: colors.error,
    marginBottom: spacing.xl,
  },
  errorKicker: {
    ...type.kicker,
    color: colors.error,
    marginBottom: spacing.xs,
  },
  errorText: {
    ...type.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // ── Input bar ───────────────────────────────────────────────────────
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: spacing.hitTarget,
    maxHeight: 120,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.inputSurface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
  sendBtn: {
    width: spacing.hitTarget,
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnPressed: {
    opacity: 0.8,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
