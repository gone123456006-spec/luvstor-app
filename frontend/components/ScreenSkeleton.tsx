import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

const BONE = 'rgba(11, 20, 26, 0.08)';

function Bone({
  width,
  height,
  radius = 8,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: BONE,
        },
        style,
      ]}
    />
  );
}

/** Nearby / Discover horizontal list rows (avatar + text + like chip) */
export function ListRowSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View style={styles.listWrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <View style={styles.avatar} />
          <View style={styles.listRowText}>
            <View style={styles.listRowTop}>
              <Bone width="48%" height={14} radius={6} />
              <Bone width={44} height={12} radius={6} />
            </View>
            <Bone width="62%" height={12} radius={6} style={{ marginTop: 8 }} />
          </View>
          <Bone width={52} height={28} radius={7} style={{ marginLeft: 8 }} />
        </View>
      ))}
    </View>
  );
}

/** Discover grid cards */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.gridWrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.gridCard}>
          <Bone width="100%" height={180} radius={16} />
          <Bone width="60%" height={14} radius={6} style={{ marginTop: 10 }} />
          <Bone width="40%" height={12} radius={6} style={{ marginTop: 6 }} />
        </View>
      ))}
    </View>
  );
}

/** Chat thread message bubbles */
export function ChatThreadSkeleton() {
  return (
    <View style={styles.threadWrap}>
      <View style={[styles.bubbleRow, styles.bubbleLeft]}>
        <Bone width={160} height={36} radius={18} />
      </View>
      <View style={[styles.bubbleRow, styles.bubbleRight]}>
        <Bone width={120} height={36} radius={18} />
      </View>
      <View style={[styles.bubbleRow, styles.bubbleLeft]}>
        <Bone width={200} height={36} radius={18} />
      </View>
      <View style={[styles.bubbleRow, styles.bubbleRight]}>
        <Bone width={140} height={36} radius={18} />
      </View>
      <View style={[styles.bubbleRow, styles.bubbleLeft]}>
        <Bone width={100} height={36} radius={18} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listWrap: {
    flex: 1,
    paddingTop: 8,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  listRowText: {
    flex: 1,
    minWidth: 0,
  },
  listRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BONE,
    marginRight: 12,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 12,
  },
  gridCard: {
    width: '47%',
    marginBottom: 4,
  },
  threadWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    justifyContent: 'flex-end',
    paddingBottom: 24,
  },
  bubbleRow: {
    marginBottom: 10,
  },
  bubbleLeft: {
    alignItems: 'flex-start',
  },
  bubbleRight: {
    alignItems: 'flex-end',
  },
});
