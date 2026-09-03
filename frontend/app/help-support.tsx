import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuthToken } from '../utils/auth';
import { listMySupportTickets, submitSupportTicket, SupportTicket } from '../utils/support';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  primary: '#6750A4',
  primaryContainer: '#EADDFF',
  accent: '#FF4B6E',
  header: '#FDF8FF',
};

const FAQS = [
  {
    q: 'How do I delete my account permanently?',
    a: 'Go to Profile > Settings > Account and tap "Delete Account". Your account is deactivated immediately with a 7-day restore period.',
  },
  {
    q: 'Is Luvstor completely free to use?',
    a: 'Yes! Texting, matching, and audio chat inside Luvstor is 100% free. We offer premium Gold subscriptions for elevated discovery modes.',
  },
  {
    q: 'How do I block or report a user?',
    a: 'Open the user\'s profile or chat, tap the shield icon, and select "Block & Report". Our team reviews reports 24/7.',
  },
  {
    q: "Why am I not getting any matches?",
    a: 'Make sure your "About Me" is engaging and you have selected at least 3 interests to help matches vibe with you.',
  },
];

const CATEGORIES = ['Account', 'Billing', 'Safety', 'Bug Report'];

export default function HelpSupportScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [tab, setTab] = useState<'faq' | 'ticket' | 'mine'>('faq');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [ticketCategory, setTicketCategory] = useState('Account');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [myTickets, setMyTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const canSubmit =
    ticketSubject.trim().length >= 3 && ticketDescription.trim().length >= 10;

  const loadMyTickets = async () => {
    const token = await getAuthToken();
    if (!token) return;
    setLoadingTickets(true);
    try {
      const tickets = await listMySupportTickets(token);
      setMyTickets(tickets);
    } catch {
      /* keep previous */
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    if (tab === 'mine') void loadMyTickets();
  }, [tab]);

  const submitTicket = async () => {
    if (!canSubmit || submitting) return;
    const token = await getAuthToken();
    if (!token) {
      Alert.alert('Sign in required', 'Please log in to submit a support ticket.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitSupportTicket(token, {
        category: ticketCategory,
        subject: ticketSubject.trim(),
        description: ticketDescription.trim(),
      });
      Alert.alert(
        'Ticket Submitted',
        `Ticket ${result.ticketNumber} raised under "${ticketCategory}".\n\n${result.message || 'Our team will email you within 24 hours.'}`,
        [
          {
            text: 'OK',
            onPress: () => {
              setTicketSubject('');
              setTicketDescription('');
              setTab('mine');
            },
          },
        ],
      );
    } catch (err: any) {
      Alert.alert(
        'Could not submit',
        err?.message || 'Please try again in a moment.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={24} color={WA.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Help & Support</Text>
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === 'faq' && styles.tabActive]}
            onPress={() => setTab('faq')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === 'faq' && styles.tabTextActive]}>FAQ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'ticket' && styles.tabActive]}
            onPress={() => setTab('ticket')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === 'ticket' && styles.tabTextActive]}>
              Raise Issue
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'mine' && styles.tabActive]}
            onPress={() => setTab('mine')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>
              My tickets
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'faq' &&
            FAQS.map((item, i) => (
              <TouchableOpacity
                key={item.q}
                style={styles.faqCard}
                activeOpacity={0.85}
                onPress={() => setExpandedFaq(expandedFaq === i ? null : i)}
              >
                <View style={styles.faqRow}>
                  <Text style={styles.faqQ}>{item.q}</Text>
                  <Ionicons
                    name={expandedFaq === i ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={WA.secondary}
                  />
                </View>
                {expandedFaq === i ? <Text style={styles.faqA}>{item.a}</Text> : null}
              </TouchableOpacity>
            ))}

          {tab === 'ticket' && (
            <View style={styles.form}>
              <Text style={styles.label}>Category</Text>
              <View style={styles.chips}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, ticketCategory === c && styles.chipActive]}
                    onPress={() => setTicketCategory(c)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        ticketCategory === c && styles.chipTextActive,
                      ]}
                    >
                      {c}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Subject</Text>
              <TextInput
                style={styles.input}
                value={ticketSubject}
                onChangeText={setTicketSubject}
                placeholder="Short summary"
                placeholderTextColor="#999"
                maxLength={200}
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={ticketDescription}
                onChangeText={setTicketDescription}
                placeholder="Tell us what happened (min 10 characters)"
                placeholderTextColor="#999"
                multiline
                maxLength={5000}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.submitBtn, (!canSubmit || submitting) && styles.submitDisabled]}
                disabled={!canSubmit || submitting}
                onPress={() => void submitTicket()}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Submit ticket</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {tab === 'mine' && (
            <View style={styles.form}>
              {loadingTickets ? (
                <ActivityIndicator color={WA.primary} style={{ marginTop: 24 }} />
              ) : myTickets.length === 0 ? (
                <Text style={styles.emptyTickets}>No tickets yet.</Text>
              ) : (
                myTickets.map((t) => (
                  <View key={t.ticketNumber} style={styles.ticketCard}>
                    <View style={styles.ticketTop}>
                      <Text style={styles.ticketNumber}>{t.ticketNumber}</Text>
                      <Text style={styles.ticketStatus}>{t.status}</Text>
                    </View>
                    <Text style={styles.ticketSubject}>{t.subject}</Text>
                    <Text style={styles.ticketMeta}>
                      {t.category}
                      {t.createdAt
                        ? ` · ${new Date(t.createdAt).toLocaleDateString()}`
                        : ''}
                    </Text>
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WA.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
    backgroundColor: WA.header,
  },
  backBtn: { padding: 6, marginRight: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: WA.text },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: WA.primaryContainer,
    borderRadius: 12,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: WA.white },
  tabText: { fontSize: 13, fontWeight: '600', color: WA.secondary },
  tabTextActive: { color: WA.primary },
  scroll: { padding: 16, paddingBottom: 40 },
  faqCard: {
    backgroundColor: WA.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WA.border,
  },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  faqQ: { flex: 1, fontSize: 15, fontWeight: '600', color: WA.text },
  faqA: { marginTop: 10, fontSize: 14, lineHeight: 20, color: WA.secondary },
  form: { gap: 10 },
  label: { fontSize: 13, fontWeight: '600', color: WA.secondary, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: WA.white,
    borderWidth: 1,
    borderColor: WA.border,
  },
  chipActive: { backgroundColor: WA.primaryContainer, borderColor: WA.primary },
  chipText: { fontSize: 13, color: WA.secondary, fontWeight: '600' },
  chipTextActive: { color: WA.primary },
  input: {
    backgroundColor: WA.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: WA.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: WA.text,
  },
  textArea: { minHeight: 120 },
  submitBtn: {
    marginTop: 16,
    backgroundColor: WA.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  emptyTickets: { textAlign: 'center', color: WA.secondary, marginTop: 32 },
  ticketCard: {
    backgroundColor: WA.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: WA.border,
  },
  ticketTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  ticketNumber: { fontWeight: '700', color: WA.primary },
  ticketStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: WA.secondary,
    textTransform: 'capitalize',
  },
  ticketSubject: { fontSize: 15, fontWeight: '600', color: WA.text },
  ticketMeta: { marginTop: 4, fontSize: 12, color: WA.secondary },
});
