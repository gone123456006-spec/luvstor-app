import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  const [tab, setTab] = useState<'faq' | 'ticket'>('faq');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [ticketCategory, setTicketCategory] = useState('Account');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');

  const canSubmit = ticketSubject.trim().length > 0 && ticketDescription.trim().length > 0;

  const submitTicket = () => {
    if (!canSubmit) return;
    Alert.alert(
      'Ticket Submitted!',
      `Thank you! Your ticket #${Math.floor(100000 + Math.random() * 900000)} has been raised under "${ticketCategory}".\n\nOur support team will email you within 2 hours.`,
      [
        {
          text: 'OK',
          onPress: () => {
            setTicketSubject('');
            setTicketDescription('');
            setTab('faq');
          },
        },
      ]
    );
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

        {/* Tabs */}
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
        </View>

        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'faq' ? (
            <>
              <Text style={styles.sectionHint}>Frequently asked questions</Text>
              <View style={styles.listGroup}>
                {FAQS.map((faq, i) => {
                  const open = expandedFaq === i;
                  return (
                    <View key={i}>
                      <TouchableOpacity
                        style={styles.listRow}
                        activeOpacity={0.7}
                        onPress={() => setExpandedFaq(open ? null : i)}
                      >
                        <View style={[styles.iconCircle, { backgroundColor: WA.primary }]}>
                          <Ionicons
                            name={open ? 'chevron-down' : 'help'}
                            size={18}
                            color="#fff"
                          />
                        </View>
                        <Text style={styles.rowLabel}>{faq.q}</Text>
                        <Ionicons
                          name={open ? 'chevron-up' : 'chevron-forward'}
                          size={18}
                          color={WA.secondary}
                        />
                      </TouchableOpacity>
                      {open && (
                        <View style={styles.answerBox}>
                          <Text style={styles.answerText}>{faq.a}</Text>
                        </View>
                      )}
                      {i < FAQS.length - 1 && <View style={styles.divider} />}
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionHint}>Issue category</Text>
              <View style={styles.listGroup}>
                {CATEGORIES.map((cat, i) => {
                  const selected = ticketCategory === cat;
                  return (
                    <View key={cat}>
                      <TouchableOpacity
                        style={styles.listRow}
                        activeOpacity={0.7}
                        onPress={() => setTicketCategory(cat)}
                      >
                        <View
                          style={[
                            styles.iconCircle,
                            {
                              backgroundColor: selected ? WA.primary : '#CAC4D0',
                            },
                          ]}
                        >
                          <Ionicons
                            name={
                              cat === 'Account'
                                ? 'person'
                                : cat === 'Billing'
                                  ? 'card'
                                  : cat === 'Safety'
                                    ? 'shield-checkmark'
                                    : 'bug'
                            }
                            size={18}
                            color="#fff"
                          />
                        </View>
                        <Text style={styles.rowLabel}>{cat}</Text>
                        <View style={[styles.radio, selected && styles.radioOn]}>
                          {selected && <View style={styles.radioDot} />}
                        </View>
                      </TouchableOpacity>
                      {i < CATEGORIES.length - 1 && <View style={styles.divider} />}
                    </View>
                  );
                })}
              </View>

              <Text style={styles.sectionHint}>Subject</Text>
              <View style={styles.listGroup}>
                <TextInput
                  style={styles.input}
                  placeholder="Brief summary of the issue..."
                  placeholderTextColor={WA.secondary}
                  value={ticketSubject}
                  onChangeText={setTicketSubject}
                  onFocus={() => {
                    setTimeout(() => scrollRef.current?.scrollTo({ y: 180, animated: true }), 100);
                  }}
                />
              </View>

              <Text style={styles.sectionHint}>Describe your problem</Text>
              <View style={styles.listGroup}>
                <TextInput
                  style={[styles.input, styles.inputLarge]}
                  placeholder="Please explain the details..."
                  placeholderTextColor={WA.secondary}
                  value={ticketDescription}
                  onChangeText={setTicketDescription}
                  multiline
                  textAlignVertical="top"
                  onFocus={() => {
                    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
                  }}
                />
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
                activeOpacity={0.8}
                onPress={submitTicket}
                disabled={!canSubmit}
              >
                <Text style={styles.submitText}>Submit Problem</Text>
              </TouchableOpacity>
            </>
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
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: WA.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: WA.primaryContainer,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: WA.text },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: WA.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: WA.primary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: WA.secondary,
  },
  tabTextActive: {
    color: WA.primary,
  },
  scroll: { paddingBottom: 40 },
  sectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  listGroup: { backgroundColor: WA.white },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: WA.text,
    fontWeight: '400',
    lineHeight: 22,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  answerBox: {
    paddingHorizontal: 16,
    paddingLeft: 72,
    paddingBottom: 14,
  },
  answerText: {
    fontSize: 14,
    color: WA.secondary,
    lineHeight: 20,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: WA.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOn: { borderColor: WA.primary },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: WA.primary,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: WA.text,
  },
  inputLarge: {
    minHeight: 120,
    paddingTop: 14,
  },
  submitBtn: {
    marginHorizontal: 20,
    marginTop: 24,
    height: 48,
    borderRadius: 24,
    backgroundColor: WA.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
