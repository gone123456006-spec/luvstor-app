import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

export default function BonusCoin({
  size = 58,
  iconSize,
}: {
  size?: number;
  iconSize?: number;
}) {
  const flash = iconSize ?? Math.round(size * 0.48);
  const border = size >= 44 ? 3 : Math.max(1.5, size * 0.08);
  return (
    <View
      style={[
        styles.coin,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: border,
          elevation: size >= 44 ? 14 : 2,
        },
      ]}
    >
      <Ionicons name="flash" size={flash} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  coin: {
    backgroundColor: "#F4C430",
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#F7E08A",
  },
});
