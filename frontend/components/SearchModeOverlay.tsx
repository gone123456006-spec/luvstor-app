import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
    Dimensions,
    Keyboard,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import Animated, {
    Easing,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RecentSearchPerson } from "../utils/recentSearches";
import WhatsAppAvatar from "./WhatsAppAvatar";
import { NAV_ICON } from "../utils/platformIcons";
import { tc, themedStyles } from "../utils/theme";

const SCREEN_W = Dimensions.get("window").width;
const SCREEN_H = Dimensions.get("window").height;
const OPEN_MS = 320;
const CLOSE_MS = 260;
const PILL_H = 40;
/** Material "emphasized decelerate" — fast start, long soft landing */
const OPEN_EASING = Easing.bezier(0.05, 0.7, 0.1, 1);
/** Material "standard" — smooth both ends so the pill settles back into the bar */
const CLOSE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

type Props = {
  visible: boolean;
  query: string;
  onChangeQuery: (q: string) => void;
  onClose: () => void;
  placeholder?: string;
  recent: RecentSearchPerson[];
  onSelectRecent: (person: RecentSearchPerson) => void;
  onClearAll: () => void;
  children?: React.ReactNode;
  autoFocus?: boolean;
  backgroundColor?: string;
  /** Window Y of the Discover/Chat search bar — pill lifts from here */
  fromY?: number;
  /** Close animation finished — the screen's own search bar can reappear */
  onClosed?: () => void;
};

/**
 * Tap search → bar slides up and screen becomes the Recent searches page.
 */
export default function SearchModeOverlay({
  visible,
  query,
  onChangeQuery,
  onClose,
  placeholder = "Search",
  recent,
  onSelectRecent,
  onClearAll,
  children,
  autoFocus = true,
  backgroundColor = tc("#FFFFFF", "bg"),
  fromY,
  onClosed,
}: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const showRecent = !query.trim();
  const [mounted, setMounted] = React.useState(visible);
  const closingRef = useRef(false);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progress = useSharedValue(0);
  const startTopSV = useSharedValue(
    typeof fromY === "number" && fromY > 0 ? fromY : insets.top + 78,
  );
  const destTopSV = useSharedValue(insets.top + 6);

  useEffect(() => {
    destTopSV.value = insets.top + 6;
  }, [insets.top]);

  const finishClose = () => {
    setMounted(false);
    onClosed?.();
  };

  const animateOpen = () => {
    progress.value = withTiming(1, { duration: OPEN_MS, easing: OPEN_EASING });
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    // Keyboard rises as the pill lands, not after a pause
    focusTimerRef.current = setTimeout(() => {
      if (autoFocus) inputRef.current?.focus();
    }, OPEN_MS - 80);
  };

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      startTopSV.value =
        typeof fromY === "number" && fromY > 0 ? fromY : insets.top + 78;
      destTopSV.value = insets.top + 6;
      if (mounted) {
        // Reopened mid-close: reverse from where the pill is now
        animateOpen();
      } else {
        progress.value = 0;
        setMounted(true);
        // animateOpen runs from the Modal's onShow so no frames are lost;
        // this only covers a platform that never fires onShow
        const fallback = setTimeout(() => {
          if (progress.value === 0 && !closingRef.current) animateOpen();
        }, 250);
        return () => clearTimeout(fallback);
      }
      return;
    }
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    if (mounted) {
      Keyboard.dismiss();
      progress.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: CLOSE_EASING },
        (finished) => {
          if (finished) runOnJS(finishClose)();
        },
      );
    }
  }, [visible]);

  useEffect(
    () => () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    },
    [],
  );

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    Keyboard.dismiss();
    onClose();
  };

  const pageStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  // The big vertical travel is a transform (no relayout per frame); only the
  // small left/width change touches layout.
  const pillStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      progress.value,
      [0, 1],
      [startTopSV.value - destTopSV.value, 0],
    );
    const left = interpolate(progress.value, [0, 1], [16, 44]);
    const width = interpolate(
      progress.value,
      [0, 1],
      [SCREEN_W - 32, SCREEN_W - 52],
    );
    return {
      position: "absolute" as const,
      top: destTopSV.value,
      left,
      width,
      height: PILL_H,
      zIndex: 20,
      transform: [{ translateY }],
    };
  });

  const backStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.25, 1], [0, 1]),
    transform: [
      {
        translateX: interpolate(progress.value, [0.25, 1], [-10, 0]),
      },
    ],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.2, 0.85], [0, 1]),
    transform: [
      {
        translateY: interpolate(progress.value, [0.2, 1], [18, 0]),
      },
    ],
  }));

  const backPosStyle = useAnimatedStyle(() => ({
    top: destTopSV.value,
  }));

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={requestClose}
      onShow={() => {
        if (!closingRef.current && progress.value < 1) animateOpen();
      }}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.page, { backgroundColor }, pageStyle]}>
          {/* Reserve space for sliding search pill + back */}
          <View style={{ height: insets.top + 56 }} />

          <Animated.View style={[styles.body, contentStyle]}>
            {showRecent ? (
              <View style={styles.recentBlock}>
                <View style={styles.recentHeader}>
                  <Text style={styles.recentTitle}>Recent searches</Text>
                  {recent.length > 0 ? (
                    <TouchableOpacity
                      style={styles.clearAllPill}
                      onPress={onClearAll}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.clearAllText}>Clear all</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {recent.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.recentRow}
                    keyboardShouldPersistTaps="handled"
                  >
                    {recent.map((person) => (
                      <TouchableOpacity
                        key={person.id}
                        style={styles.personChip}
                        onPress={() => onSelectRecent(person)}
                        activeOpacity={0.75}
                      >
                        <WhatsAppAvatar
                          photo={person.photo || undefined}
                          name={person.name}
                          size={64}
                        />
                        <Text style={styles.personName} numberOfLines={2}>
                          {person.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="time-outline" size={36} color="#BBC0C4" />
                    <Text style={styles.emptyTitle}>No recent searches</Text>
                    <Text style={styles.emptyText}>
                      People you search will show up here
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.results}>{children}</View>
            )}
          </Animated.View>
        </Animated.View>

        <Animated.View
          style={[styles.backAbs, backPosStyle, backStyle]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            onPress={requestClose}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name={NAV_ICON.back} size={28} color={tc("#050505", "fg")} />
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={[styles.searchPill, pillStyle]}>
          <Ionicons
            name="search"
            size={18}
            color={tc("#65676B", "fg")}
            style={styles.searchIcon}
          />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder={placeholder}
            placeholderTextColor={tc("#65676B", "fg")}
            value={query}
            onChangeText={onChangeQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {!!query && (
            <TouchableOpacity onPress={() => onChangeQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#BBC0C4" />
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
  modalRoot: {
    flex: 1,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  page: {
    ...StyleSheet.absoluteFill,
    flex: 1,
  },
  backAbs: {
    position: "absolute",
    left: 8,
    zIndex: 30,
    height: PILL_H,
    justifyContent: "center",
  },
  backBtn: {
    width: 36,
    height: PILL_H,
    alignItems: "center",
    justifyContent: "center",
  },
  searchPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E4E6EB",
    borderRadius: 20,
    paddingHorizontal: 14,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#050505",
    paddingVertical: 0,
  },
  body: {
    flex: 1,
  },
  recentBlock: {
    flex: 1,
    paddingTop: 4,
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 14,
    minHeight: 32,
  },
  recentTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#050505",
  },
  clearAllPill: {
    backgroundColor: "#E4E6EB",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#050505",
  },
  recentRow: {
    paddingHorizontal: 14,
    gap: 16,
    paddingBottom: 8,
  },
  personChip: {
    width: 76,
    alignItems: "center",
  },
  personName: {
    marginTop: 8,
    fontSize: 12,
    color: "#050505",
    textAlign: "center",
    lineHeight: 15,
  },
  emptyWrap: {
    paddingTop: 40,
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#050505",
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#65676B",
    textAlign: "center",
  },
  results: {
    flex: 1,
  },
}),
);
