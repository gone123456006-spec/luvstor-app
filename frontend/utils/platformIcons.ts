import { Platform } from "react-native";

const IOS = Platform.OS === "ios";

/** Ionicons that follow each platform's own convention (iOS HIG vs Material). */
export const NAV_ICON = {
  back: IOS ? "chevron-back" : "arrow-back",
  more: IOS ? "ellipsis-horizontal" : "ellipsis-vertical",
  share: IOS ? "share-outline" : "share-social-outline",
} as const;

/** iOS list rows show a trailing chevron; Material rows don't. */
export const SHOW_ROW_CHEVRON = IOS;
