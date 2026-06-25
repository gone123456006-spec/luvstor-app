import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Polygon, Path, Text as SvgText } from 'react-native-svg';

// ─────────────────────────────────────────────
// Wheel config
// ─────────────────────────────────────────────
const SEGMENTS = [
  { label: '100', subLabel: 'tokens', tokens: 100, color: '#534AB7', textColor: '#fff' },
  { label: '50', subLabel: 'tokens', tokens: 50, color: '#7F77DD', textColor: '#fff' },
  { label: 'Today\nUnlimited', subLabel: 'free today', tokens: -1, color: '#0F6E56', textColor: '#fff' },
  { label: '20', subLabel: 'tokens', tokens: 20, color: '#AFA9EC', textColor: '#3C3489' },
  { label: '15', subLabel: 'tokens', tokens: 15, color: '#CECBF6', textColor: '#3C3489' },
  { label: '40', subLabel: 'tokens', tokens: 40, color: '#3C3489', textColor: '#fff' },
  { label: '10', subLabel: 'tokens', tokens: 10, color: '#EEEDFE', textColor: '#534AB7' },
];

const N = SEGMENTS.length;
const TWO_PI = 2 * Math.PI;
const ARC = TWO_PI / N;
const { width: SCREEN_W } = Dimensions.get('window');
const WHEEL_SIZE = Math.min(SCREEN_W - 60, 300);
const R = WHEEL_SIZE / 2;

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

function buildSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(4)} ${y1.toFixed(4)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(4)} ${y2.toFixed(4)} Z`;
}

// ─────────────────────────────────────────────
// SpinModal (Updated to 1 Free Spin per day)
// ─────────────────────────────────────────────
interface SpinModalProps {
  visible: boolean;
  onClose: () => void;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
}

function SpinModal({ visible, onClose, balance, onBalanceChange }: SpinModalProps) {
  const rotAnim = React.useRef(new Animated.Value(0)).current;
  const currentRot = React.useRef(0);
  const [isSpinning, setIsSpinning] = React.useState(false);
  const [spinsLeft, setSpinsLeft] = React.useState(1); // Changed to 1
  const [result, setResult] = React.useState<typeof SEGMENTS[0] | null>(null);
  const slideAnim = React.useRef(new Animated.Value(300)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    } else {
      slideAnim.setValue(300);
    }
  }, [visible]);

  function doSpin() {
    if (isSpinning || spinsLeft <= 0) return;

    // It's a free daily spin, so we don't deduct cost
    setSpinsLeft(s => s - 1);
    setResult(null);
    setIsSpinning(true);

    const winIdx = Math.floor(Math.random() * N);
    const offset = (Math.random() * 0.6 - 0.3) * ARC;
    const targetLocal = (winIdx + 0.5) * ARC + offset;
    const normalised = (((-targetLocal) % TWO_PI) + TWO_PI) % TWO_PI;
    const currentNorm = ((currentRot.current % TWO_PI) + TWO_PI) % TWO_PI;

    let delta = normalised - currentNorm;
    if (delta <= 0) delta += TWO_PI;
    const extraRot = (6 + Math.floor(Math.random() * 3)) * TWO_PI;
    const totalRad = extraRot + delta;
    const totalDeg = (totalRad * 180) / Math.PI;
    const startDeg = (currentRot.current * 180) / Math.PI;

    rotAnim.setValue(startDeg % 360);

    Animated.timing(rotAnim, {
      toValue: startDeg + totalDeg,
      duration: 4500,
      easing: easeOut,
      useNativeDriver: true,
    }).start(() => {
      currentRot.current = (currentRot.current + totalRad) % TWO_PI;
      setIsSpinning(false);
      const won = SEGMENTS[winIdx];
      setResult(won);
      if (won.tokens > 0) {
        onBalanceChange(balance + won.tokens); // Add tokens without deducting
      }
    });
  }

  const spinDeg = rotAnim.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View style={[styles.modalSheet, { transform: [{ translateY: slideAnim }] }]}>

          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Daily Spin</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#5f6368" />
            </TouchableOpacity>
          </View>

          {/* Spins left dots */}
          <View style={styles.dotsRow}>
            <Text style={styles.dotsLabel}>Spins left: </Text>
            {[0].map(i => (
              <View key={i} style={[styles.dot, i >= spinsLeft && styles.dotUsed]} />
            ))}
          </View>

          {/* Wheel */}
          <View style={styles.wheelWrap}>
            <View style={styles.svgPointer}>
              <Svg width={28} height={30} viewBox="0 0 28 30">
                <Polygon
                  points="14,28 1,2 27,2"
                  fill="#8E2DE2"
                  stroke="#fff"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                />
              </Svg>
            </View>

            <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
              <Svg width={WHEEL_SIZE} height={WHEEL_SIZE}>
                {SEGMENTS.map((seg, i) => {
                  const startAngle = -Math.PI / 2 + i * ARC;
                  const endAngle = startAngle + ARC;
                  const midAngle = startAngle + ARC / 2;
                  const d = buildSlicePath(R, R, R - 1, startAngle, endAngle);
                  const textR = R * 0.62;
                  const tx = R + textR * Math.cos(midAngle);
                  const ty = R + textR * Math.sin(midAngle);
                  const rotDeg = (midAngle * 180) / Math.PI;
                  const lines = seg.label.split('\n');

                  return (
                    <G key={i}>
                      <Path d={d} fill={seg.color} stroke="#fff" strokeWidth={2.5} />
                      <Line
                        x1={R} y1={R}
                        x2={R + R * Math.cos(startAngle)}
                        y2={R + R * Math.sin(startAngle)}
                        stroke="#fff" strokeWidth={2}
                      />
                      {lines.map((line, li) => (
                        <SvgText
                          key={li}
                          x={tx}
                          y={ty + (li - (lines.length - 1) / 2) * 14 - (lines.length === 1 ? 5 : 0)}
                          fill={seg.textColor}
                          fontSize={lines.length > 1 ? 11 : 15}
                          fontWeight="700"
                          textAnchor="middle"
                          rotation={rotDeg}
                          originX={tx}
                          originY={ty}
                        >
                          {line}
                        </SvgText>
                      ))}
                      {lines.length === 1 && (
                        <SvgText
                          x={tx}
                          y={ty + 12}
                          fill={seg.textColor}
                          fontSize={10}
                          fontWeight="400"
                          textAnchor="middle"
                          opacity={0.75}
                          rotation={rotDeg}
                          originX={tx}
                          originY={ty}
                        >
                          {seg.subLabel}
                        </SvgText>
                      )}
                    </G>
                  );
                })}
                <Circle cx={R} cy={R} r={R - 1} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={3} />
                <Circle cx={R} cy={R} r={26} fill="#fff" stroke="rgba(0,0,0,0.05)" strokeWidth={2} />
              </Svg>
            </Animated.View>

            <TouchableOpacity
              style={styles.wheelCenterBtn}
              onPress={doSpin}
              disabled={isSpinning || spinsLeft <= 0}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh" size={20} color="#8E2DE2" />
            </TouchableOpacity>
          </View>

          {/* Spin button */}
          <TouchableOpacity
            style={[styles.modalSpinBtn, (isSpinning || spinsLeft <= 0) && styles.spinBtnDisabled]}
            onPress={doSpin}
            disabled={isSpinning || spinsLeft <= 0}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#8E2DE2', '#4A00E0']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.modalSpinBtnGradient}
            >
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.modalSpinBtnText}>
                {spinsLeft > 0 ? 'Spin' : 'No spins left'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={styles.spinNote}>1 free spin per day</Text>

          {/* Result */}
          {result && (
            <View style={[styles.resultCard, result.tokens === -1 && styles.resultCardGreen]}>
              <View style={[styles.resultIcon, result.tokens === -1 && styles.resultIconGreen]}>
                <Ionicons
                  name={result.tokens === -1 ? 'infinite' : 'diamond'}
                  size={22}
                  color={result.tokens === -1 ? '#0F6E56' : '#8E2DE2'}
                />
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultLabel}>You won</Text>
                <Text style={styles.resultValue}>
                  {result.tokens === -1 ? 'Today Unlimited' : `${result.tokens} Tokens`}
                </Text>
                <Text style={styles.resultSub}>
                  {result.tokens === -1 ? 'All features free for today!' : 'Added to your balance!'}
                </Text>
              </View>
            </View>
          )}

        </Animated.View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Main TokenScreen
// ─────────────────────────────────────────────
export default function TokenScreen() {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(15)).current;
  const [balance, setBalance] = React.useState(1250);
  const [spinModalOpen, setSpinModalOpen] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
      return () => { fadeAnim.setValue(0); slideAnim.setValue(15); };
    }, [])
  );

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          <Text style={styles.title}>Tokens</Text>

          {/* Balance Card */}
          <View style={styles.balanceCard}>
            <View style={styles.balanceInfo}>
              <Text style={styles.balanceLabel}>Your balance</Text>
              <Text style={styles.balanceAmount}>{balance.toLocaleString()}</Text>
              <Text style={styles.balanceSub}>Use tokens for premium features</Text>
            </View>
            <View style={styles.balanceIconContainer}>
              <Ionicons name="diamond" size={28} color="#8E2DE2" />
            </View>
          </View>

          {/* Spin Card */}
          <TouchableOpacity
            style={styles.spinCard}
            activeOpacity={0.7}
            onPress={() => setSpinModalOpen(true)}
          >
            <View style={styles.spinCardContent}>
              <View style={styles.spinIconBg}>
                <Ionicons name="gift" size={24} color="#8E2DE2" />
              </View>
              <View style={styles.spinTextContainer}>
                <Text style={styles.spinCardTitle}>Daily Lucky Spin</Text>
                <Text style={styles.spinCardSub}>Spin the wheel to win free tokens</Text>
                <View style={styles.spinCardBadge}>
                  <Text style={styles.spinCardBadgeText}>1 free spin / day</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#5f6368" />
            </View>
          </TouchableOpacity>

          {/* Buy Tokens Section */}
          <Text style={styles.sectionTitle}>Get more tokens</Text>

          {[
            { name: 'Starter Pack', count: '100', price: '$0.99' },
            { name: 'Popular Pack', count: '500', price: '$4.99', popular: true },
            { name: 'Mega Pack', count: '1000', price: '$8.99' },
          ].map(p => (
            <TouchableOpacity key={p.name} style={styles.packageCard} activeOpacity={0.7}>
              <View style={styles.packageLeft}>
                <Text style={styles.packageName}>{p.name}</Text>
                <Text style={styles.packageCount}>{p.count} Tokens</Text>
              </View>
              <View style={p.popular ? styles.packageRightPopular : styles.packageRight}>
                {p.popular && (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularText}>Best value</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.priceButton} activeOpacity={0.8}>
                  <LinearGradient
                    colors={['#8E2DE2', '#4A00E0']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.priceButtonGradient}
                  >
                    <Text style={styles.priceText}>{p.price}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}

          {/* Info Section */}
          <View style={styles.infoSection}>
            <Ionicons name="information-circle-outline" size={18} color="#5f6368" />
            <Text style={styles.infoText}>
              Tokens are used to unlock premium features like viewing who liked you, sending super likes, and boosting your profile.
            </Text>
          </View>

        </ScrollView>
      </Animated.View>

      {/* Spin Modal */}
      <SpinModal
        visible={spinModalOpen}
        onClose={() => setSpinModalOpen(false)}
        balance={balance}
        onBalanceChange={setBalance}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#ffffff' 
  },
  scrollContent: { 
    padding: 24, 
    paddingBottom: 40 
  },
  title: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    color: '#202124', 
    marginBottom: 24 
  },

  // Balance Card
  balanceCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#dadce0',
  },
  balanceInfo: {
    flex: 1,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#5f6368',
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#202124',
    marginBottom: 4,
  },
  balanceSub: {
    fontSize: 12,
    color: '#5f6368',
  },
  balanceIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F3E5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Spin Card (Entry)
  spinCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#dadce0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  spinCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinIconBg: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F3E5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  spinTextContainer: {
    flex: 1,
  },
  spinCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#202124',
    marginBottom: 2,
  },
  spinCardSub: {
    fontSize: 12,
    color: '#5f6368',
    marginBottom: 6,
  },
  spinCardBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e6f4ea',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  spinCardBadgeText: {
    fontSize: 10,
    color: '#137333',
    fontWeight: '600',
  },

  // Section Title
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#202124',
    marginBottom: 16,
  },

  // Package Card
  packageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dadce0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  packageLeft: {
    flex: 1,
  },
  packageName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#202124',
    marginBottom: 2,
  },
  packageCount: {
    fontSize: 14,
    color: '#5f6368',
  },
  packageRight: {
    alignItems: 'flex-end',
  },
  packageRightPopular: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 60,
  },
  popularBadge: {
    backgroundColor: '#e6f4ea',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  popularText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#137333',
  },
  priceButton: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  priceButtonGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  priceText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },

  // Info
  infoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#5f6368',
    lineHeight: 16,
  },

  // Modal
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    justifyContent: 'flex-end' 
  },
  modalSheet: {
    backgroundColor: '#fff', 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24,
    padding: 24, 
    paddingBottom: 40,
    alignItems: 'center',
  },
  modalHeader: { 
    width: '100%', 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24 
  },
  modalTitle: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#202124' 
  },
  closeBtn: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: '#f1f3f4', 
    alignItems: 'center', 
    justifyContent: 'center' 
  },

  dotsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dotsLabel: { fontSize: 12, color: '#5f6368', marginRight: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#8E2DE2', marginHorizontal: 3 },
  dotUsed: { backgroundColor: '#dadce0' },

  wheelWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  svgPointer: { position: 'absolute', top: -14, zIndex: 10, alignSelf: 'center' },

  wheelCenterBtn: {
    position: 'absolute',
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#fff',
    borderWidth: 2, borderColor: '#dadce0',
    alignItems: 'center', justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2,
  },

  modalSpinBtn: { 
    width: '100%', 
    borderRadius: 24, 
    overflow: 'hidden',
    marginBottom: 8,
  },
  modalSpinBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  modalSpinBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  spinBtnDisabled: { opacity: 0.5 },
  spinNote: { fontSize: 11, color: '#5f6368', marginBottom: 16, textAlign: 'center' },

  resultCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#F3E5F5', borderRadius: 12,
    borderWidth: 1, borderColor: '#dadce0', padding: 14,
  },
  resultCardGreen: { backgroundColor: '#e6f4ea', borderColor: '#dadce0' },
  resultIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  resultIconGreen: { backgroundColor: '#fff' },
  resultText: { flex: 1 },
  resultLabel: { fontSize: 11, color: '#5f6368', marginBottom: 2, textTransform: 'uppercase' },
  resultValue: { fontSize: 18, fontWeight: 'bold', color: '#202124' },
  resultSub: { fontSize: 12, color: '#5f6368', marginTop: 2 },
});