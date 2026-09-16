import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React from "react";
import {
  Platform,
  Share,
  StyleSheet,
  Text,
  TextStyle,
  ToastAndroid,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { isValidPublicId } from "../utils/auth";
import {
  buildProfileShareMessageAsync,
  fetchBrandedProfileShareUrl,
} from "../utils/profileLinks";

type Props = {
  publicId?: string | null;
  /** Display name used in the share message */
  name?: string | null;
  /** Prefix before the ID, default "ID: " */
  prefix?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
  /** Show share button (default true) */
  showShare?: boolean;
  onCopied?: (id: string) => void;
  onShared?: (id: string) => void;
};

export { buildProfileShareMessage } from "../utils/profileLinks";

export async function sharePublicProfile(opts: {
  publicId?: string | null;
  name?: string | null;
}) {
  const id = isValidPublicId(opts.publicId)
    ? String(opts.publicId).toUpperCase()
    : "";
  if (!id) return false;
  const displayName = (opts.name || "").trim();
  const message = await buildProfileShareMessageAsync(displayName, id);
  const url = (await fetchBrandedProfileShareUrl(id)) || undefined;
  const result = await Share.share(
    Platform.OS === "ios"
      ? { message, url }
      : { message, title: "Share Luvstor profile" },
    {
      dialogTitle: "Share profile",
      subject: `${displayName || "Luvstor"} profile`,
    },
  );
  return result.action === Share.sharedAction;
}

/**
 * Tap ID to copy, or tap share to open the system share sheet (with profile link).
 */
export default function CopyablePublicId({
  publicId,
  name,
  prefix = "ID: ",
  style,
  textStyle,
  showShare = true,
  onCopied,
  onShared,
}: Props) {
  const [copied, setCopied] = React.useState(false);
  const valid = isValidPublicId(publicId);
  const id = valid ? String(publicId).toUpperCase() : "";
  const displayName = (name || "").trim();

  const copy = React.useCallback(async () => {
    if (!id) return;
    try {
      await Clipboard.setStringAsync(id);
      setCopied(true);
      if (Platform.OS === "android") {
        ToastAndroid.show("ID copied", ToastAndroid.SHORT);
      }
      onCopied?.(id);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }, [id, onCopied]);

  const share = React.useCallback(async () => {
    if (!id) return;
    try {
      const ok = await sharePublicProfile({ publicId: id, name: displayName });
      if (ok) onShared?.(id);
    } catch {
      /* user dismissed */
    }
  }, [id, displayName, onShared]);

  if (!valid) {
    return (
      <Text style={[styles.text, textStyle]}>
        {prefix}····
      </Text>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      <TouchableOpacity
        style={styles.idRow}
        onPress={copy}
        onLongPress={copy}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={`Copy ID ${id}`}
      >
        <Text style={[styles.text, textStyle]}>
          {prefix}
          {id}
        </Text>
        <Ionicons
          name={copied ? "checkmark-circle" : "copy-outline"}
          size={14}
          color={copied ? "#25D366" : "#8E8E8E"}
          style={styles.icon}
        />
        {copied ? <Text style={styles.copied}>Copied</Text> : null}
      </TouchableOpacity>

      {showShare ? (
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={share}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Share profile"
        >
          <Ionicons name="share-social-outline" size={15} color="#6750A4" />
          <Text style={styles.shareText}>Share</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    marginTop: 3,
    gap: 10,
  },
  idRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  text: {
    fontSize: 13,
    color: "#49454F",
    letterSpacing: 0.5,
  },
  icon: {
    marginLeft: 6,
  },
  copied: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#25D366",
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "#EADDFF",
  },
  shareText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6750A4",
  },
});
