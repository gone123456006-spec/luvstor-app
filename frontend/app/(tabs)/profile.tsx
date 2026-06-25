import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentAuthUser, getLocalProfile, saveLocalProfile } from '../../utils/auth';
import { useAuth } from '../../contexts/AuthContext';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ── Design Tokens ──────────────────────────────────────────
const C = {
  primary: '#6750A4',   // M3 primary
  primaryContainer: '#EADDFF',
  surface: '#FFFBFE',
  surfaceVariant: '#E7E0EC',
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
  onSurface: '#1C1B1F',
  onSurfaceVariant: '#49454F',
  accent: '#FF4B6E',     // Romance/Luvstor Pink
  accentLight: '#FFF0F2',
};

const INTEREST_EMOJIS: Record<string, string> = {
  'Travel': '✈️',
  'Music': '🎵',
  'Fitness': '🏋️',
  'Cooking': '🍳',
  'Art': '🎨',
  'Gaming': '🎮',
  'Movies': '🎬',
  'Photography': '📷',
  'Reading': '📖',
  'Dancing': '💃',
  'Nature': '🍃',
  'Coffee': '☕',
  'Yoga': '🧘',
  'Sports': '⚽',
  'Food': '🍕',
};

const GOAL_EMOJIS: Record<string, string> = {
  'Long-term relationship': '👩‍❤️‍👨',
  'Casual dating': '🥂',
  'Friendship': '🤝',
  'Just vibes': '🤙',
  'See where it goes': '🧭',
  'Meaningful connection': '💖',
  'Chat & chill': '💬',
  'Friends first': '👫',
  'Exploring': '🎒',
  'Open to possibilities': '🌟',
};

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut, sessionVersion } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [safetyVisible, setSafetyVisible] = useState(false);
  const [supportVisible, setSupportVisible] = useState(false);
  const [supportTab, setSupportTab] = useState<'faq' | 'ticket'>('faq');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketCategory, setTicketCategory] = useState('Account');
  const supportScrollRef = useRef<ScrollView>(null);

  const [activeSafetyTab, setActiveSafetyTab] = useState<'tips' | 'checklist'>('tips');
  const [checklistItems, setChecklistItems] = useState<string[]>([]);

  const CHECKLIST_OPTIONS = [
    { key: 'public', text: 'Meet in a crowded public space (like a cafe) ☕' },
    { key: 'friend', text: 'Let a friend know where you are going & share details 📍' },
    { key: 'transport', text: 'Have your own transport arranged (Uber/car/transit) 🚗' },
    { key: 'privacy', text: 'Keep your personal details (address, handles) private 🔒' },
    { key: 'instinct', text: 'Trust your gut feeling & leave if you feel uncomfortable 💯' },
  ];

  const toggleChecklistItem = (key: string) => {
    setChecklistItems(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  // Fetch the saved profile details whenever this tab comes into focus
  useFocusEffect(
    useCallback(() => {
      const loadProfile = async () => {
        try {
          const authUser = await getCurrentAuthUser();
          if (!authUser?.email) {
            setProfile(null);
            return;
          }

          const parsed = await getLocalProfile(authUser.email);
          if (parsed) {
            if (!parsed.userId && authUser.id) {
              parsed.userId = authUser.id;
              await saveLocalProfile(authUser.email, parsed);
            }
            setProfile(parsed);
          } else {
            setProfile(null);
          }
        } catch (e) {
          console.error('Failed to load profile', e);
        }
      };
      loadProfile();
    }, [sessionVersion])
  );

  const MENU_ITEMS = [
    { icon: 'card-outline', label: 'Subscription', color: C.accent },
    { icon: 'shield-checkmark-outline', label: 'Safety Center', color: '#4CAF50' },
    { icon: 'help-circle-outline', label: 'Help & Support', color: '#2196F3' },
    { icon: 'log-out-outline', label: 'Logout', color: '#f44336' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Premium Light Gradient Background */}
      <LinearGradient
        colors={["#FFFFFF", "#FDF8FF", "#F5E6FF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/luvstoer logo.png')}
          style={[styles.headerLogo, { tintColor: C.primary }]}
          contentFit="contain"
        />
        <TouchableOpacity
          onPress={() => router.push('/create-profile')}
          style={styles.editBtn}
          activeOpacity={0.8}
        >
          <Ionicons name="pencil" size={20} color={C.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* ── Avatar / General Info ── */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {profile?.photo ? (
              <Image
                source={{ uri: profile.photo }}
                style={styles.avatar}
                contentFit="cover"
              />
            ) : (
              <Image
                source={require('../../assets/images/boy-image.png')}
                style={styles.avatar}
                contentFit="cover"
              />
            )}
            <LinearGradient
              colors={[C.accent, '#FF8F71']}
              style={styles.premiumBadge}
            >
              <Ionicons name="star" size={12} color="#fff" />
            </LinearGradient>
          </View>
          <Text style={styles.userName}>
            {profile?.name || 'John Doe'}, {profile?.age || '28'}
          </Text>
          <View style={[styles.userIdContainer, { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }]}>
            <Ionicons name="finger-print-outline" size={13} color="#79747E" />
            <Text style={[styles.userIdText, { color: '#79747E', fontSize: 13, fontWeight: '500' }]}>
              ID: {profile?.userId || '12354123232'}
            </Text>
          </View>
          {profile?.tagline && (
            <Text style={[styles.tagline, { color: C.primary }]}>"{profile.tagline}"</Text>
          )}

          {/* Demographic Capsule Tags */}
          <View style={[styles.demographicsRow, { flexDirection: 'row', gap: 8, marginTop: 12 }]}>
            {profile?.gender && (
              <View style={[styles.demographicBadge, { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primaryContainer, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 }]}>
                <Ionicons
                  name={
                    profile.gender === 'Man' ? 'male-outline' :
                      profile.gender === 'Woman' ? 'female-outline' : 'transgender-outline'
                  }
                  size={13}
                  color={C.primary}
                />
                <Text style={[styles.demographicText, { color: C.primary, fontSize: 13, fontWeight: '600' }]}>{profile.gender}</Text>
              </View>
            )}

            {profile?.height && (
              <View style={[styles.demographicBadge, { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primaryContainer, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 }]}>
                <Ionicons name="resize-outline" size={13} color={C.primary} />
                <Text style={[styles.demographicText, { color: C.primary, fontSize: 13, fontWeight: '600' }]}>{profile.height} cm</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Details / Preferences ── */}
        {profile && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="options-outline" size={20} color={C.primary} />
              <Text style={styles.sectionTitle}>Preferences & Info</Text>
            </View>
            <View style={styles.preferencesList}>
              <View style={styles.preferenceRow}>
                <Text style={styles.preferenceLabel}>Gender</Text>
                <Text style={styles.preferenceValue}>{profile.gender || 'Not specified'}</Text>
              </View>
              <View style={[styles.preferenceRow, styles.preferenceBorder]}>
                <Text style={styles.preferenceLabel}>Looking For</Text>
                <Text style={styles.preferenceValue}>
                  {profile.relationshipGoal
                    ? `${GOAL_EMOJIS[profile.relationshipGoal] || ''} ${profile.relationshipGoal}`
                    : 'Not specified'}
                </Text>
              </View>
              <View style={[styles.preferenceRow, styles.preferenceBorder]}>
                <Text style={styles.preferenceLabel}>Discovery Distance</Text>
                <Text style={styles.preferenceValue}>{profile.distance ? `${profile.distance} km` : '10 km'}</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── About Me Card ── */}
        {profile?.bio && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="document-text-outline" size={20} color={C.primary} />
              <Text style={styles.sectionTitle}>About Me</Text>
            </View>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        )}

        {/* ── Interests Section ── */}
        {profile?.interests && profile.interests.length > 0 && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="heart-outline" size={20} color={C.primary} />
              <Text style={styles.sectionTitle}>Interests</Text>
            </View>
            <View style={styles.interestsGrid}>
              {profile.interests.map((interest: string) => (
                <View key={interest} style={styles.interestChip}>
                  <Text style={styles.interestEmoji}>
                    {INTEREST_EMOJIS[interest] || '✨'}
                  </Text>
                  <Text style={styles.interestText}>{interest}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Upgrade Card ── */}
        <TouchableOpacity style={styles.upgradeCard} activeOpacity={0.9}>
          <LinearGradient
            colors={['#1a1a1a', '#333']}
            style={styles.upgradeGradient}
          >
            <View>
              <Text style={styles.upgradeTitle}>Upgrade to Gold</Text>
              <Text style={styles.upgradeText}>Unlimited likes & more features</Text>
            </View>
            <Ionicons name="chevron-forward-circle" size={32} color="#FFD700" />
          </LinearGradient>
        </TouchableOpacity>

        {/* ── Settings Menu ── */}
        <View style={styles.menuSection}>
          {MENU_ITEMS.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={() => {
                if (item.label === 'Safety Center') {
                  setSafetyVisible(true);
                } else if (item.label === 'Help & Support') {
                  setSupportVisible(true);
                } else if (item.label === 'Logout') {
                  Alert.alert('Logout', 'Are you sure you want to log out?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Logout',
                      style: 'destructive',
                      onPress: async () => {
                        await signOut();
                        router.replace('/login');
                      },
                    },
                  ]);
                } else {
                  Alert.alert(item.label, `Welcome to the ${item.label} section of Luvstor.`);
                }
              }}
            >
              <View style={[styles.iconContainer, { backgroundColor: item.color + '15' }]}>
                <Ionicons name={item.icon as any} size={22} color={item.color} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color="#ccc" />
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>

      {/* ── Safety Center Modal (Luvstor Shield & Safety Hub) ── */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={safetyVisible}
        onRequestClose={() => setSafetyVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>

            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.shieldIconBox}>
                  <Ionicons name="shield-checkmark" size={24} color={C.accent} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Shield & Safety Hub</Text>
                  <Text style={styles.modalSubtitle}>Your safety is our top priority</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setSafetyVisible(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={20} color={C.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            {/* Segmented Button (M3 Navigation Tabs) */}
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tabButton, activeSafetyTab === 'tips' && styles.tabButtonActive]}
                onPress={() => setActiveSafetyTab('tips')}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="book-outline"
                  size={16}
                  color={activeSafetyTab === 'tips' ? '#fff' : C.onSurfaceVariant}
                />
                <Text style={[styles.tabButtonText, activeSafetyTab === 'tips' && styles.tabButtonTextActive]}>
                  Safety Rules
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, activeSafetyTab === 'checklist' && styles.tabButtonActive]}
                onPress={() => setActiveSafetyTab('checklist')}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="checkbox-outline"
                  size={16}
                  color={activeSafetyTab === 'checklist' ? '#fff' : C.onSurfaceVariant}
                />
                <Text style={[styles.tabButtonText, activeSafetyTab === 'checklist' && styles.tabButtonTextActive]}>
                  Date Checklist
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>

              {activeSafetyTab === 'tips' ? (
                <>
                  {/* SOS Emergency Helpline Card */}
                  <View style={styles.sosCard}>
                    <View style={styles.sosLeft}>
                      <Ionicons name="alert-circle" size={24} color="#D32F2F" />
                      <View style={styles.sosTextContainer}>
                        <Text style={styles.sosTitle}>Need Immediate Help?</Text>
                        <Text style={styles.sosText}>Connect with Luvstor Response Team</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.sosButton}
                      onPress={() => {
                        Alert.alert(
                          'Emergency Contact',
                          'Directing to safety support services. If you are in immediate danger, please contact your local police department (911/112) immediately.',
                          [{ text: 'Dismiss' }, { text: 'Call Helpline', onPress: () => Alert.alert('Dialing support...', 'Connecting you with safety specialists...') }]
                        );
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.sosButtonText}>SOS</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Safety Rule Items */}
                  <Text style={styles.sectionHeading}>Dating Safety Rules</Text>

                  {[
                    {
                      icon: 'chatbubble-ellipses-outline',
                      title: 'Keep Chats on Luvstor',
                      desc: 'Do not share phone numbers, social handles, or personal addresses early on. Keep your chats protected inside our secure system.',
                      color: C.accent,
                    },
                    {
                      icon: 'location-outline',
                      title: 'Private Boundaries',
                      desc: 'Location is completely removed from your profiles. Never share your exact home or work location with new matches.',
                      color: '#FF9800',
                    },
                    {
                      icon: 'cafe-outline',
                      title: 'Meet in Public & Tell a Friend',
                      desc: 'For first dates, always choose busy public locations (like coffee shops). Always notify a friend of your location and plans.',
                      color: '#4CAF50',
                    },
                    {
                      icon: 'cash-outline',
                      title: 'Zero Financial Requests',
                      desc: 'Never send money, wire transfers, or financial help to matches. Report anyone asking you for monetary support immediately.',
                      color: '#2196F3',
                    },
                    {
                      icon: 'shield-outline',
                      title: 'Block and Report Anytime',
                      desc: 'If a match behaves suspiciously or makes you uncomfortable, block them instantly. Our support team reviews reports 24/7.',
                      color: '#f44336',
                    }
                  ].map((rule, i) => (
                    <View key={i} style={styles.ruleCard}>
                      <View style={[styles.ruleIconBox, { backgroundColor: rule.color + '12' }]}>
                        <Ionicons name={rule.icon as any} size={22} color={rule.color} />
                      </View>
                      <View style={styles.ruleContent}>
                        <Text style={styles.ruleTitle}>{rule.title}</Text>
                        <Text style={styles.ruleDesc}>{rule.desc}</Text>
                      </View>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  {/* Interactive Checklist Intro */}
                  <View style={styles.checklistIntroCard}>
                    <Ionicons name="sparkles" size={20} color="#FF9800" />
                    <Text style={styles.checklistIntroText}>
                      Tap each checkmark to prepare safely for your upcoming physical date!
                    </Text>
                  </View>

                  <Text style={styles.sectionHeading}>First Date Preparations</Text>

                  {CHECKLIST_OPTIONS.map(({ key, text }) => {
                    const checked = checklistItems.includes(key);
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.checklistCard, checked && styles.checklistCardActive]}
                        onPress={() => toggleChecklistItem(key)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.checkbox, checked && styles.checkboxActive]}>
                          {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </View>
                        <Text style={[styles.checklistText, checked && styles.checklistTextActive]}>
                          {text}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}

            </ScrollView>

            {/* Bottom Button */}
            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={() => setSafetyVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalDoneBtnText}>I understand</Text>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>
      {/* ── Help & Support Modal (Luvstor Help & Support Hub) ── */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={supportVisible}
        onRequestClose={() => setSupportVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>

              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderLeft}>
                  <View style={[styles.shieldIconBox, { backgroundColor: C.accentLight }]}>
                    <Ionicons name="help-circle" size={24} color={C.accent} />
                  </View>
                  <View>
                    <Text style={styles.modalTitle}>Help & Support Hub</Text>
                    <Text style={styles.modalSubtitle}>How can we assist you today?</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setSupportVisible(false)}
                  style={styles.modalCloseBtn}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close" size={20} color={C.onSurfaceVariant} />
                </TouchableOpacity>
              </View>

              {/* Segmented Button (Tabs switcher) */}
              <View style={styles.tabContainer}>
                <TouchableOpacity
                  style={[styles.tabButton, supportTab === 'faq' && { backgroundColor: C.accent }]}
                  onPress={() => setSupportTab('faq')}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="help-buoy-outline"
                    size={16}
                    color={supportTab === 'faq' ? '#fff' : C.onSurfaceVariant}
                  />
                  <Text style={[styles.tabButtonText, supportTab === 'faq' && styles.tabButtonTextActive]}>
                    FAQ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tabButton, supportTab === 'ticket' && { backgroundColor: C.accent }]}
                  onPress={() => setSupportTab('ticket')}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="create-outline"
                    size={16}
                    color={supportTab === 'ticket' ? '#fff' : C.onSurfaceVariant}
                  />
                  <Text style={[styles.tabButtonText, supportTab === 'ticket' && styles.tabButtonTextActive]}>
                    Raise Issue
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                ref={supportScrollRef}
                contentContainerStyle={styles.modalScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >

                {supportTab === 'faq' && (
                  <>
                    <Text style={styles.sectionHeading}>Frequently Asked Questions</Text>
                    {[
                      {
                        q: 'How do I delete my account permanently?',
                        a: 'Go to Profile > Settings > Account and tap "Delete Account". All your chats, matches, and images will be permanently wiped from our database.'
                      },
                      {
                        q: 'Is Luvstor completely free to use?',
                        a: 'Yes! Texting, matching, and audio chat inside Luvstor is 100% free. We offer premium Gold subscriptions for elevated discovery modes.'
                      },
                      {
                        q: 'How do I block or report a user?',
                        a: 'Open the user\'s profile or chat bubble, tap the shield icon in the top right, and select "Block & Report". Our team reviews reports 24/7.'
                      },
                      {
                        q: 'Why am I not getting any matches?',
                        a: 'Make sure your "About Me" description is engaging and you have selected at least 3 interests (with emojis) to help matches vibe with you!'
                      }
                    ].map((faq, i) => {
                      const isOpen = expandedFaq === i;
                      return (
                        <TouchableOpacity
                          key={i}
                          style={styles.faqCard}
                          onPress={() => setExpandedFaq(isOpen ? null : i)}
                          activeOpacity={0.9}
                        >
                          <View style={styles.faqHeader}>
                            <Text style={styles.faqQuestion}>{faq.q}</Text>
                            <Ionicons
                              name={isOpen ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="#49454F"
                            />
                          </View>
                          {isOpen && (
                            <View style={styles.faqAnswerContainer}>
                              <Text style={styles.faqAnswer}>{faq.a}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                {supportTab === 'ticket' && (
                  <>
                    <Text style={styles.sectionHeading}>Raise a Problem / Issue</Text>

                    {/* Category select pills */}
                    <Text style={styles.inputLabel}>Issue Category</Text>
                    <View style={styles.categoryPillRow}>
                      {['Account', 'Billing', 'Safety', 'Bug Report'].map(cat => {
                        const isSel = ticketCategory === cat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            style={[styles.categoryPill, isSel && styles.categoryPillActiveSupport]}
                            onPress={() => setTicketCategory(cat)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.categoryPillText, isSel && styles.categoryPillTextActive]}>
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Outlined Subject input */}
                    <Text style={styles.inputLabel}>Subject</Text>
                    <TextInput
                      style={styles.supportInput}
                      placeholder="Brief summary of the issue..."
                      placeholderTextColor="#79747E"
                      value={ticketSubject}
                      onChangeText={setTicketSubject}
                      onFocus={() => {
                        setTimeout(() => {
                          supportScrollRef.current?.scrollTo({ y: 120, animated: true });
                        }, 100);
                      }}
                    />

                    {/* Outlined Description Input */}
                    <Text style={styles.inputLabel}>Describe your problem</Text>
                    <TextInput
                      style={[styles.supportInput, styles.supportInputLarge]}
                      placeholder="Please explain the details of the problem..."
                      placeholderTextColor="#79747E"
                      multiline={true}
                      numberOfLines={4}
                      value={ticketDescription}
                      onChangeText={setTicketDescription}
                      onFocus={() => {
                        setTimeout(() => {
                          supportScrollRef.current?.scrollToEnd({ animated: true });
                        }, 100);
                      }}
                    />

                    {/* Spacing cushion to allow scrolling past keyboard */}
                    <View style={{ height: Platform.OS === 'ios' ? 140 : 100 }} />

                    {/* Submit Button */}
                    <TouchableOpacity
                      style={[
                        styles.submitTicketBtn,
                        (!ticketSubject.trim() || !ticketDescription.trim()) && styles.submitTicketBtnDisabled
                      ]}
                      onPress={() => {
                        if (!ticketSubject.trim() || !ticketDescription.trim()) return;
                        Alert.alert(
                          'Ticket Submitted!',
                          `Thank you! Your ticket #${Math.floor(100000 + Math.random() * 900000)} has been raised under category "${ticketCategory}".\n\nOur support specialists will email you back within 2 hours.`,
                          [{
                            text: 'OK',
                            onPress: () => {
                              setTicketSubject('');
                              setTicketDescription('');
                              setSupportVisible(false);
                            }
                          }]
                        );
                      }}
                      activeOpacity={0.8}
                      disabled={!ticketSubject.trim() || !ticketDescription.trim()}
                    >
                      <Text style={styles.submitTicketText}>Submit Problem</Text>
                    </TouchableOpacity>
                  </>
                )}



              </ScrollView>

            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0,
  },
  headerLogo: {
    width: 90,
    height: 30,
  },
  editBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accentLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileSection: {
    alignItems: 'center',
    marginTop: 25,
  },
  avatarContainer: {
    position: 'relative',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  avatar: {
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 4,
    borderColor: '#FFF0F2',
  },
  premiumBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: C.onSurface,
    marginTop: 16,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  userLocation: {
    fontSize: 14,
    color: C.onSurfaceVariant,
    fontWeight: '500',
  },
  tagline: {
    fontSize: 15,
    fontStyle: 'italic',
    color: C.primary,
    marginTop: 10,
    paddingHorizontal: 30,
    textAlign: 'center',
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: '#F7F2FA',
    marginHorizontal: 20,
    marginTop: 25,
    borderRadius: 20,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: '#EADDFF',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#EADDFF',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: C.onSurface,
  },
  statLabel: {
    fontSize: 12,
    color: C.onSurfaceVariant,
    marginTop: 4,
    fontWeight: '600',
  },

  // Section Card style (Google Material-like design)
  sectionCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: '#E7E0EC',
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 20,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.onSurface,
  },
  bioText: {
    fontSize: 14,
    color: C.onSurfaceVariant,
    lineHeight: 20,
  },

  // Interests chips
  interestsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  interestText: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '700',
  },
  interestEmoji: {
    fontSize: 14,
  },

  // Preferences List
  preferencesList: {
    gap: 12,
  },
  preferenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  preferenceBorder: {
    borderTopWidth: 1,
    borderTopColor: '#E7E0EC',
    paddingTop: 12,
  },
  preferenceLabel: {
    fontSize: 14,
    color: C.onSurfaceVariant,
    fontWeight: '500',
  },
  preferenceValue: {
    fontSize: 14,
    color: C.onSurface,
    fontWeight: '700',
  },

  // Menu Options
  menuSection: {
    marginTop: 15,
    paddingHorizontal: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    color: C.onSurface,
    fontWeight: '600',
  },
  upgradeCard: {
    marginHorizontal: 20,
    marginTop: 24,
    borderRadius: 16,
    overflow: 'hidden',
  },
  upgradeGradient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  upgradeTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  upgradeText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 4,
  },

  // ── Safety Center Modal Styles ──────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FEF7FF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E0EC',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shieldIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EADDFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1B1F',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#49454F',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E7E0EC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalScroll: {
    paddingVertical: 20,
  },

  // SOS helpline card
  sosCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderWidth: 1,
    borderColor: '#FFCDCD',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  sosLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  sosTextContainer: {
    flex: 1,
  },
  sosTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B71C1C',
  },
  sosText: {
    fontSize: 12,
    color: '#D32F2F',
    marginTop: 2,
  },
  sosButton: {
    backgroundColor: '#D32F2F',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#D32F2F',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },

  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1B1F',
    marginBottom: 16,
  },
  ruleCard: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0EC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  ruleIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ruleContent: {
    flex: 1,
  },
  ruleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1C1B1F',
  },
  ruleDesc: {
    fontSize: 13,
    color: '#49454F',
    lineHeight: 18,
    marginTop: 4,
  },

  modalDoneBtn: {
    backgroundColor: '#6750A4',
    borderRadius: 100,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  modalDoneBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Premium Navigation & Interactive Checklist Styles
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#EAE2F8',
    borderRadius: 100,
    padding: 4,
    marginTop: 16,
    marginHorizontal: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 100,
  },
  tabButtonActive: {
    backgroundColor: '#6750A4',
    shadowColor: '#6750A4',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#49454F',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },
  checklistIntroCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderColor: '#FFE082',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
  },
  checklistIntroText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#E65100',
    fontWeight: '600',
  },
  checklistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#FFFFFF',
    borderColor: '#E7E0EC',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  checklistCardActive: {
    borderColor: '#EADDFF',
    backgroundColor: '#F3EDF7',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#79747E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    borderColor: '#6750A4',
    backgroundColor: '#6750A4',
  },
  checklistText: {
    flex: 1,
    fontSize: 14,
    color: '#1C1B1F',
    fontWeight: '600',
  },
  checklistTextActive: {
    color: '#6750A4',
  },

  // FAQ Accordion styles
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0EC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  faqQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1B1F',
  },
  faqAnswerContainer: {
    borderTopWidth: 1,
    borderTopColor: '#E7E0EC',
    marginTop: 12,
    paddingTop: 12,
  },
  faqAnswer: {
    fontSize: 13,
    color: '#49454F',
    lineHeight: 18,
  },

  // Raise problem form inputs
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1C1B1F',
    marginTop: 16,
    marginBottom: 8,
  },
  categoryPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: '#F3EDF7',
    borderWidth: 1,
    borderColor: '#E7E0EC',
  },
  categoryPillActiveSupport: {
    backgroundColor: '#F3EDF7',
    borderColor: '#6750A4',
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#49454F',
  },
  categoryPillTextActive: {
    color: '#6750A4',
  },
  supportInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#79747E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1C1B1F',
    marginBottom: 12,
  },
  supportInputLarge: {
    height: 120,
    textAlignVertical: 'top',
  },
  submitTicketBtn: {
    backgroundColor: '#6750A4',
    borderRadius: 100,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#6750A4',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  submitTicketBtnDisabled: {
    backgroundColor: '#E0E0E0',
    elevation: 0,
  },
  submitTicketText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Contact support channel cards
  contactCard: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0EC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  contactIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactDetails: {
    flex: 1,
  },
  contactLabel: {
    fontSize: 12,
    color: '#79747E',
    fontWeight: '500',
  },
  contactValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1C1B1F',
    marginTop: 2,
  },
  contactSub: {
    fontSize: 11,
    color: '#49454F',
    marginTop: 2,
  },

  // User ID styling
  userIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3EDF7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    marginTop: 6,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#E7E0EC',
  },
  userIdText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#49454F',
    letterSpacing: 0.5,
  },

  // Demographics row
  demographicsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  demographicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.accentLight,
    borderWidth: 1,
    borderColor: '#FFF0F2',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
  },
  demographicText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.accent,
  },
});
