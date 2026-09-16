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
  const border = size >= 44 ? 2 : Math.max(1, size * 0.06);
  return (
    <View
      style={[
        styles.coin,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: border,
          elevation: size >= 44 ? 4 : 1,
        },
      ]}
    >
      <Ionicons name="flash" size={flash} color="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  coin: {
    backgroundColor: "#EAB308",
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#FDE68A",
  },
});
