import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { getAuthToken } from '../utils/auth';
import {
  buildReferralShareMessage,
  fetchReferralDashboard,
  ReferralDashboard,
} from '../utils/referrals';
import { shareOptsForPlatform } from '../utils/profileLinks';

const C = {
  purple: '#370372',
  purpleSoft: '#EFE8F8',
  rose: '#FF4B6E',
  roseSoft: '#FFE8EE',
  ink: '#1C1B1F',
  muted: '#6B7280',
  card: '#FFFFFF',
  green: '#25D366',
  link: '#370372',
  line: '#E8E8ED',
  bg: '#F5F5F7',
  bgMid: '#EFE8F8',
  bgBot: '#FFE8EE',
};

function GiftHeroArt({ size = 200 }: { size?: number }) {
  const accent = C.purple;
  const soft = C.purpleSoft;
  const rose = C.rose;
  return (
    <Svg width={size} height={size * 0.85} viewBox="0 0 220 180">
      <Path d="M168 42 L198 52 L168 62 L174 52 Z" fill={accent} />
      <Circle cx="48" cy="58" r="22" fill={soft} stroke={accent} strokeWidth="2.5" />
      <Circle cx="48" cy="52" r="7" fill={accent} />
      <Path d="M36 72 Q48 62 60 72" fill={accent} />
      <Circle cx="168" cy="98" r="20" fill={C.roseSoft} stroke={rose} strokeWidth="2.5" />
      <Circle cx="168" cy="92" r="6.5" fill={rose} />
      <Path d="M157 110 Q168 101 179 110" fill={rose} />
      <Rect x="70" y="78" width="80" height="62" rx="6" fill="#FFFFFF" stroke={accent} strokeWidth="3" />
      <Rect x="70" y="58" width="80" height="24" rx="5" fill={soft} stroke={accent} strokeWidth="3" />
      <Rect x="104" y="58" width="12" height="82" fill={accent} />
      <Path
        d="M110 58 Q96 38 86 52 Q96 58 110 58 Q124 38 134 52 Q124 58 110 58"
        fill={rose}
      />
      <Circle cx="56" cy="128" r="12" fill="#F5C518" />
      <Path d="M52 131 L56 123 L60 131 Z" fill="#FFF7ED" />
      <Circle cx="162" cy="48" r="11" fill="#F5C518" />
      <Path d="M158 51 L162 43 L166 51 Z" fill="#FFF7ED" />
      <Circle cx="92" cy="40" r="3" fill={accent} />
      <Circle cx="130" cy="36" r="2.5" fill={rose} />
      <Path d="M38 108 L42 112 L38 116 L34 112 Z" fill={accent} />
    </Svg>
  );
}

function StepIcon({
  kind,
}: {
  kind: 'share' | 'signup' | 'tokens';
}) {
  if (kind === 'share') {
    return (
      <View style={styles.stepCircle}>
        <Ionicons name="chatbubble-ellipses-outline" size={26} color={C.purple} />
      </View>
    );
  }
  if (kind === 'signup') {
    return (
      <View style={styles.stepCircle}>
        <Ionicons name="checkbox-outline" size={26} color={C.purple} />
      </View>
    );
  }
  return (
    <View style={styles.stepCircle}>
      <Ionicons name="gift-outline" size={26} color={C.purple} />
    </View>
  );
}

export default function ReferScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [dash, setDash] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showReferrals, setShowReferrals] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/login' as any);
        return;
      }
      const data = await fetchReferralDashboard(token);
      setDash(data);
    } catch (e: any) {
      Alert.alert('Could not load', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const reward = dash?.rewardTokens ?? 50;
  const maxMonth = dash?.maxPerMonth ?? 5;
  const shareUrl = dash?.shareUrl || '';
  const message = buildReferralShareMessage({
    shareUrl,
    rewardTokens: reward,
  });

  const shareWhatsApp = async () => {
    if (!shareUrl) return;
    setBusy(true);
    try {
      const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
      const can = await Linking.canOpenURL(url);
      if (can) {
        await Linking.openURL(url);
      } else {
        const web = `https://wa.me/?text=${encodeURIComponent(message)}`;
        await Linking.openURL(web);
      }
    } catch {
      await Share.share(shareOptsForPlatform(message, 'Refer & Get Tokens'));
    } finally {
      setBusy(false);
    }
  };

  const shareLink = async () => {
    if (!shareUrl) return;
    setBusy(true);
    try {
      await Share.share(shareOptsForPlatform(message, 'Refer & Get Tokens'));
    } catch {
      await Clipboard.setStringAsync(shareUrl);
      Alert.alert('Link copied', shareUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <LinearGradient
        colors={[C.bg, C.bgMid, C.bg, C.bgBot]}
        locations={[0, 0.28, 0.62, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </TouchableOpacity>
          <View style={styles.topRight}>
            <TouchableOpacity
              style={styles.referralsPill}
              onPress={() => setShowReferrals(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.referralsPillText}>Your Referrals</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowTerms(true)}
              hitSlop={10}
              style={styles.helpBtn}
            >
              <Ionicons name="help-circle-outline" size={26} color={C.muted} />
            </TouchableOpacity>
          </View>
        </View>

        {loading && !dash ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={C.purple} />
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={styles.title}>Refer & Get {reward} Tokens</Text>
              <Text style={styles.subtitle}>
                {reward} tokens/referral | Up to {maxMonth} referrals/month
              </Text>
              <View style={styles.artWrap}>
                <GiftHeroArt size={220} />
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>How it works?</Text>
                <TouchableOpacity onPress={() => setShowTerms(true)}>
                  <Text style={styles.termsLink}>Terms & Conditions</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.stepsRow}>
                <View style={styles.step}>
                  <StepIcon kind="share" />
                  <Text style={styles.stepLabel}>Share invite</Text>
                </View>
                <View style={styles.dots} />
                <View style={styles.step}>
                  <StepIcon kind="signup" />
                  <Text style={styles.stepLabel}>Your friend{'\n'}signs up</Text>
                </View>
                <View style={styles.dots} />
                <View style={styles.step}>
                  <StepIcon kind="tokens" />
                  <Text style={styles.stepLabel}>{reward} tokens</Text>
                </View>
              </View>

              {dash ? (
                <Text style={styles.monthHint}>
                  This month: {dash.referralsThisMonth}/{maxMonth} ·{' '}
                  {dash.referralsRemainingThisMonth} left
                </Text>
              ) : null}
            </View>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <TouchableOpacity
                style={[styles.waBtn, busy && { opacity: 0.7 }]}
                onPress={shareWhatsApp}
                disabled={busy || !shareUrl}
                activeOpacity={0.9}
              >
                <Ionicons name="logo-whatsapp" size={22} color="#fff" />
                <Text style={styles.waBtnText}>SHARE VIA WHATSAPP</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.linkBtn}
                onPress={shareLink}
                disabled={busy || !shareUrl}
                activeOpacity={0.8}
              >
                <Ionicons name="share-social-outline" size={18} color={C.link} />
                <Text style={styles.linkBtnText}>SHARE LINK</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </SafeAreaView>

      {/* Your Referrals */}
      <Modal visible={showReferrals} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Your Referrals</Text>
              <TouchableOpacity onPress={() => setShowReferrals(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={C.ink} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              {dash?.totalReferrals ?? 0} successful · {dash?.totalTokensEarned ?? 0}{' '}
              tokens earned
            </Text>
            <FlatList
              data={dash?.referrals || []}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  No referrals yet. Share your invite link to earn {reward} tokens when a
                  friend installs and completes login.
                </Text>
              }
              renderItem={({ item }) => (
                <View style={styles.refRow}>
                  <View style={styles.refAvatar}>
                    <Text style={styles.refAvatarText}>
                      {(item.name || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.refName}>{item.name}</Text>
                    <Text style={styles.refMeta}>
                      {item.publicId ? `@${item.publicId} · ` : ''}
                      +{item.tokensAwarded} tokens
                    </Text>
                  </View>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Terms */}
      <Modal visible={showTerms} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.termsCard, { marginBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>Terms & Conditions</Text>
            <Text style={styles.termsBody}>
              • You earn {reward} tokens when a friend downloads Luvstor using your invite
              link from the Play Store and completes login for the first time.{"\n\n"}
              • Maximum {maxMonth} successful referrals per calendar month.{"\n\n"}
              • Self-referrals and duplicate devices are not rewarded.{"\n\n"}
              • Rewards are credited to your token balance after your friend’s first
              successful login.{"\n\n"}
              • Luvstor may change or pause this program to prevent abuse.
            </Text>
            <TouchableOpacity
              style={styles.termsOk}
              onPress={() => setShowTerms(false)}
            >
              <Text style={styles.termsOkText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backBtn: { padding: 4 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  referralsPill: {
    backgroundColor: C.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
  },
  referralsPillText: { fontSize: 13, fontWeight: '600', color: C.ink },
  helpBtn: { padding: 2 },
  hero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 8 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: C.purple,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: C.muted,
    textAlign: 'center',
  },
  artWrap: { marginTop: 8, marginBottom: 4 },
  card: {
    marginHorizontal: 18,
    marginTop: 4,
    backgroundColor: C.card,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  termsLink: { fontSize: 13, fontWeight: '600', color: C.rose },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  step: { width: 88, alignItems: 'center' },
  stepCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: '#DDD0EE',
    backgroundColor: C.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.ink,
    textAlign: 'center',
    lineHeight: 16,
  },
  dots: {
    flex: 1,
    height: 0,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.line,
    marginTop: 28,
    marginHorizontal: 2,
  },
  monthHint: {
    marginTop: 14,
    textAlign: 'center',
    fontSize: 12,
    color: C.muted,
  },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  waBtn: {
    backgroundColor: C.green,
    borderRadius: 12,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  waBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.4,
  },
  linkBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  linkBtnText: {
    color: C.purple,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: C.ink },
  modalSub: { fontSize: 13, color: C.muted, marginBottom: 12 },
  empty: {
    textAlign: 'center',
    color: C.muted,
    paddingVertical: 28,
    paddingHorizontal: 12,
    lineHeight: 20,
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  refAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refAvatarText: { fontWeight: '800', color: C.purple },
  refName: { fontSize: 15, fontWeight: '700', color: C.ink },
  refMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  termsCard: {
    marginHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
  },
  termsBody: { marginTop: 12, fontSize: 14, color: C.muted, lineHeight: 21 },
  termsOk: {
    marginTop: 18,
    backgroundColor: C.purple,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  termsOkText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
