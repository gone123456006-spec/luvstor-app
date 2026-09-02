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

/** Chat list rows (Chats tab, notifications) */
export function ListRowSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View style={styles.listWrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <View style={styles.avatar} />
          <View style={styles.listRowText}>
            <Bone width="42%" height={14} radius={6} />
            <Bone width="72%" height={12} radius={6} style={{ marginTop: 8 }} />
          </View>
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
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: BONE,
    marginRight: 14,
  },
  listRowText: {
    flex: 1,
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
