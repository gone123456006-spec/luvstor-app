import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const POPUP_WIDTH = SCREEN_WIDTH - 40;
const POPUP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.78, POPUP_WIDTH * 1.45);

type Props = {
  visible: boolean;
  uris: string[];
  initialIndex?: number;
  onClose: () => void;
};

export default function ProfilePhotoViewer({
  visible,
  uris,
  initialIndex = 0,
  onClose,
}: Props) {
  const [index, setIndex] = React.useState(initialIndex);
  const listRef = React.useRef<FlatList<string>>(null);

  const photos = uris.filter(Boolean);

  React.useEffect(() => {
    if (!visible) return;
    const next = Math.min(
      Math.max(initialIndex, 0),
      Math.max(photos.length - 1, 0),
    );
    setIndex(next);
    if (photos.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: next, animated: false });
      });
    }
  }, [visible, initialIndex, photos.length]);

  if (!photos.length) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={50}
            tint="light"
            style={StyleSheet.absoluteFillObject}
          />
        ) : null}
        {Platform.OS === "android" ? (
          <View style={styles.backdropAndroidLayers} pointerEvents="none">
            <View style={styles.backdropAndroidDim} />
            <View style={styles.backdropAndroidFrost} />
          </View>
        ) : null}
        <Pressable
          style={[
            styles.backdrop,
            Platform.OS === "ios" && styles.backdropIos,
          ]}
          onPress={onClose}
        />

        <View style={styles.popup} pointerEvents="box-none">
          <View style={styles.imageFrame}>
            <FlatList
              ref={listRef}
              data={photos}
              horizontal
              pagingEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              style={styles.list}
              initialScrollIndex={Math.min(initialIndex, photos.length - 1)}
              getItemLayout={(_, i) => ({
                length: POPUP_WIDTH,
                offset: POPUP_WIDTH * i,
                index: i,
              })}
              onScrollToIndexFailed={(info) => {
                requestAnimationFrame(() => {
                  listRef.current?.scrollToOffset({
                    offset: info.averageItemLength * info.index,
                    animated: false,
                  });
                });
              }}
              onMomentumScrollEnd={(e) => {
                const i = Math.round(
                  e.nativeEvent.contentOffset.x / POPUP_WIDTH,
                );
                if (i >= 0 && i < photos.length) setIndex(i);
              }}
              keyExtractor={(uri, i) => `${uri}-${i}`}
              renderItem={({ item }) => (
                <View style={styles.page}>
                  <Image
                    source={{ uri: item }}
                    style={styles.image}
                    contentFit="cover"
                    cachePolicy="none"
                    transition={150}
                  />
                </View>
              )}
            />

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.75}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            {photos.length > 1 ? (
              <View style={styles.dotsRow}>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropIos: {
    backgroundColor: "rgba(255, 255, 255, 0.38)",
  },
  backdropAndroidLayers: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropAndroidDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.22)",
  },
  backdropAndroidFrost: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  popup: {
    width: POPUP_WIDTH,
    alignItems: "stretch",
    zIndex: 2,
  },
  imageFrame: {
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#F2F2F2",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  closeBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
  },
  page: {
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  dotsRow: {
    position: "absolute",
    bottom: 12,
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
    backgroundColor: "rgba(255, 255, 255, 0.45)",
  },
  dotActive: {
    backgroundColor: "#FFFFFF",
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});
