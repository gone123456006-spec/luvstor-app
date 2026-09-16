import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveMediaUrl } from "../utils/media";

type Props = {
  visible: boolean;
  uris: string[];
  initialIndex?: number;
  onClose: () => void;
  /** Center header label (e.g. name, "Cover photo", "Photos") */
  title?: string;
  /**
   * When true, render as an absolute overlay instead of a second Modal.
   * Required when already inside a Modal (nested Modals freeze RN on many devices).
   */
  asOverlay?: boolean;
};

function resolveViewerUri(uri: string): string {
  return resolveMediaUrl(uri) || uri;
}

function PhotoPager({
  photos,
  initialIndex,
  onClose,
  topInset,
  title,
  width,
  height,
}: {
  photos: string[];
  initialIndex: number;
  onClose: () => void;
  topInset: number;
  title: string;
  width: number;
  height: number;
}) {
  const [index, setIndex] = React.useState(initialIndex);
  const listRef = React.useRef<FlatList<string>>(null);
  const startIndex = Math.min(
    Math.max(initialIndex, 0),
    Math.max(photos.length - 1, 0),
  );

  React.useEffect(() => {
    setIndex(startIndex);
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          index: startIndex,
          animated: false,
        });
      } catch {
        listRef.current?.scrollToOffset({
          offset: width * startIndex,
          animated: false,
        });
      }
    }, 16);
    return () => clearTimeout(t);
  }, [startIndex, photos.length, width]);

  const headerLabel =
    photos.length > 1 ? `${title}  ·  ${index + 1}/${photos.length}` : title;

  return (
    <View style={[styles.overlay, { width, height }]}>
      <View style={[styles.backdrop, { width, height }]} />

      <View style={[styles.stage, { width, height }]} pointerEvents="box-none">
        <FlatList
          ref={listRef}
          data={photos}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          style={{ width, height }}
          initialScrollIndex={startIndex > 0 ? startIndex : undefined}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: width * info.index,
              animated: false,
            });
          }}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            if (i >= 0 && i < photos.length) setIndex(i);
          }}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          removeClippedSubviews={false}
          renderItem={({ item }) => (
            <View style={{ width, height, backgroundColor: "#FFFFFF" }}>
              <Image
                source={{ uri: item }}
                style={{ width, height }}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
                recyclingKey={`viewer-${item}`}
              />
            </View>
          )}
        />

        <TouchableOpacity
          style={[styles.closeBtn, { top: Math.max(topInset, 12) + 8 }]}
          onPress={onClose}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={20} color="#FFFFFF" />
        </TouchableOpacity>

        <Text
          style={[styles.headerTitle, { top: Math.max(topInset, 12) + 14 }]}
          numberOfLines={1}
          pointerEvents="none"
        >
          {headerLabel}
        </Text>

        {photos.length > 1 ? (
          <View style={[styles.dotsRow, { bottom: Math.max(24, 36) }]}>
            {photos.map((_, i) => (
              <View
                key={`dot-${i}`}
                style={[styles.dot, i === index && styles.dotActive]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function ProfilePhotoViewer({
  visible,
  uris,
  initialIndex = 0,
  onClose,
  title = "Photos",
  asOverlay = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const [windowSize, setWindowSize] = React.useState(() => {
    const w = Dimensions.get("window");
    return { width: w.width, height: w.height };
  });

  React.useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setWindowSize({ width: window.width, height: window.height });
    });
    return () => sub.remove();
  }, []);

  const photos = React.useMemo(
    () =>
      uris
        .map((u) => resolveViewerUri(u))
        .filter((u) => !!u && typeof u === "string"),
    [uris],
  );

  if (!visible || !photos.length) return null;

  const body = (
    <PhotoPager
      photos={photos}
      initialIndex={initialIndex}
      onClose={onClose}
      topInset={insets.top}
      title={title.trim() || "Photos"}
      width={windowSize.width}
      height={windowSize.height}
    />
  );

  // Overlay mode: explicit window size so it never collapses into a half-sheet
  // when rendered inside an existing Modal / SafeAreaView.
  if (asOverlay) {
    return (
      <View
        style={[
          styles.overlayRoot,
          {
            width: windowSize.width,
            height: windowSize.height,
          },
        ]}
        collapsable={false}
        pointerEvents="auto"
      >
        {body}
      </View>
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
    zIndex: 99999,
    elevation: 99999,
  },
  overlay: {
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: "#FFFFFF",
  },
  stage: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 2,
  },
  closeBtn: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    position: "absolute",
    left: 56,
    right: 56,
    zIndex: 9,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
    color: "#111111",
    letterSpacing: 0.2,
  },
  dotsRow: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(0, 0, 0, 0.25)",
  },
  dotActive: {
    backgroundColor: "#111111",
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});
