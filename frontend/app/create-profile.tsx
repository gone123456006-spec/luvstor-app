import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  ActivityIndicator,
  StatusBar,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_TOKEN_KEY } from '../utils/api';
import {
  getAuthToken,
  getCurrentAuthUser,
  getLocalProfile,
  isLocalProfileComplete,
  normalizeEmail,
  saveLocalProfile,
  syncProfileToServer,
  userToLocalProfile,
} from '../utils/auth';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Google Material 3 Design Colors ─────────────────────────
const MD3 = {
  primary: '#6750A4',          // MD3 Purple
  onPrimary: '#FFFFFF',
  primaryContainer: '#EADDFF',
  onPrimaryContainer: '#21005D',
  surface: '#FEF7FF',          // MD3 light background
  onSurface: '#1D1B20',
  surfaceVariant: '#E7E0EC',
  onSurfaceVariant: '#49454F',
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
  error: '#B3261E',
  success: '#386A20',
  successContainer: '#C3E7A2',
};

const INTERESTS = [
  { label: 'Travel', emoji: '✈️' },
  { label: 'Music', emoji: '🎵' },
  { label: 'Fitness', emoji: '🏋️' },
  { label: 'Cooking', emoji: '🍳' },
  { label: 'Art', emoji: '🎨' },
  { label: 'Gaming', emoji: '🎮' },
  { label: 'Movies', emoji: '🎬' },
  { label: 'Photography', emoji: '📷' },
  { label: 'Reading', emoji: '📖' },
  { label: 'Dancing', emoji: '💃' },
  { label: 'Nature', emoji: '🍃' },
  { label: 'Coffee', emoji: '☕' },
  { label: 'Yoga', emoji: '🧘' },
  { label: 'Sports', emoji: '⚽' },
  { label: 'Pets', emoji: '🐾' },
  { label: 'Food', emoji: '🍕' },
];

const STEPS = [
  { title: 'Add profile picture', subtitle: 'A photo helps people get to know you', icon: 'camera-outline' },
  { title: 'Basic information', subtitle: 'Enter your name, age, and gender', icon: 'person-outline' },
  { title: 'About you & Interests', subtitle: 'Tell others what makes you unique', icon: 'heart-outline' },
];

// ── Google Material 3 Outlined Input Field ──────────────────
function MD3InputField({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  multiline,
  numberOfLines,
}: any) {
  const [focused, setFocused] = useState(false);
  const labelAnim = useRef(new Animated.Value(value ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(labelAnim, {
      toValue: focused || value ? 1 : 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [focused, value]);

  const labelStyle = {
    top: labelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [16, -10],
    }),
    fontSize: labelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [16, 12],
    }),
    color: labelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [MD3.onSurfaceVariant, MD3.primary],
    }),
    backgroundColor: focused || value ? MD3.surface : 'transparent',
  };

  return (
    <View style={fieldStyles.container}>
      <View style={[
        fieldStyles.inputBox,
        focused && fieldStyles.inputBoxFocused,
        multiline && { alignItems: 'flex-start', minHeight: 120, height: 'auto', paddingVertical: 12 }
      ]}>
        <Ionicons
          name={icon}
          size={20}
          color={focused ? MD3.primary : MD3.onSurfaceVariant}
          style={multiline ? { marginTop: 4 } : null}
        />
        <TextInput
          style={[fieldStyles.textInput, multiline && { textAlignVertical: 'top', minHeight: 90 }]}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={numberOfLines}
          placeholder={focused ? placeholder : ''}
          placeholderTextColor={MD3.outlineVariant}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
      <Animated.Text style={[fieldStyles.floatingLabel, labelStyle]}>
        {label}
      </Animated.Text>
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  container: {
    position: 'relative',
    marginBottom: 24,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: MD3.outline,
    borderRadius: 8,
    paddingHorizontal: 16,
    height: 56,
    gap: 12,
    backgroundColor: MD3.surface,
  },
  inputBoxFocused: {
    borderColor: MD3.primary,
    borderWidth: 2,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: MD3.onSurface,
    paddingVertical: 10,
  },
  floatingLabel: {
    position: 'absolute',
    left: 44,
    paddingHorizontal: 4,
    fontWeight: '500',
  },
});

export default function CreateProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [checkingSession, setCheckingSession] = useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const authUser = await getCurrentAuthUser();
        if (!authUser?.email) {
          router.replace('/login');
          return;
        }

        const accountEmail = normalizeEmail(authUser.email);
        const local = await getLocalProfile(accountEmail);
        if (isLocalProfileComplete(local)) {
          router.replace('/(tabs)');
          return;
        }

        const token = await getAuthToken();
        if (token) {
          const { apiRequest } = await import('../utils/api');
          const user = await apiRequest('/api/users/me', token);
          if (user?.name && String(user.name).trim()) {
            await saveLocalProfile(accountEmail, userToLocalProfile(user));
            router.replace('/(tabs)');
          }
        }
      } catch {
        /* new account — show create profile */
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

  // Form States
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [height, setHeight] = useState('');
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [relationshipGoal, setRelationshipGoal] = useState('');

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    } else {
      router.back();
    }
  };

  const handleComplete = async () => {
    const authUser = await getCurrentAuthUser();
    const accountEmail = authUser?.email ? normalizeEmail(authUser.email) : null;
    if (!accountEmail || !authUser?.id) {
      router.replace('/login');
      return;
    }

    const profileData = {
      photo,
      name,
      age,
      gender,
      height,
      city: 'San Francisco, CA',
      distance: '10',
      tagline,
      bio,
      interests,
      relationshipGoal,
      userId: authUser.id,
    };
    try {
      await saveLocalProfile(accountEmail, profileData);
      const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      if (token) {
        const serverUser = await syncProfileToServer(token, profileData);
        // Save the server response (which has real photo URL) back to local
        if (serverUser?.photo) {
          await saveLocalProfile(accountEmail, { ...profileData, photo: String(serverUser.photo) });
        }
      }
    } catch (e) {
      console.error('Failed to save profile', e);
    }
    router.replace('/(tabs)');
  };

  if (checkingSession) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: MD3.surface }}>
        <ActivityIndicator size="large" color={MD3.primary} />
      </View>
    );
  }

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
    }
  };

  const toggleInterest = (interest: string) => {
    setInterests(prev =>
      prev.includes(interest) ? prev.filter(i => i !== interest) : [...prev, interest]
    );
  };

  const canNext = () => {
    if (step === 0) return !!photo;
    if (step === 1) return name.trim() !== '' && age.trim() !== '' && !!gender;
    if (step === 2) return bio.trim() !== '' && interests.length > 0 && !!relationshipGoal;
    return true;
  };

  // ── Step Content Renders ───────────────────────────────────
  const renderStepPhoto = () => (
    <View style={s.stepContent}>
      <TouchableOpacity onPress={pickPhoto} activeOpacity={0.8} style={s.photoFrame}>
        {photo ? (
          <>
            <Image source={{ uri: photo }} style={s.photoImage} contentFit="cover" />
            <View style={s.photoEditBadge}>
              <Ionicons name="camera" size={20} color="#fff" />
            </View>
          </>
        ) : (
          <View style={s.photoPlaceholder}>
            <View style={s.photoPlaceholderIconRing}>
              <Ionicons name="add" size={32} color={MD3.primary} />
            </View>
            <Text style={s.photoPlaceholderText}>Add photo</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={s.tipCard}>
        <Ionicons name="bulb-outline" size={20} color={MD3.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.tipTitle}>Choose a photo of yourself</Text>
          <Text style={s.tipBody}>Make sure your face is centered, well-lit, and easy to see. Avoid sunglasses or busy backgrounds.</Text>
        </View>
      </View>
    </View>
  );

  const renderStepDetails = () => (
    <View style={s.stepContent}>
      <MD3InputField
        label="Name"
        icon="person-outline"
        value={name}
        onChangeText={setName}
        placeholder="First and last name"
      />
      <MD3InputField
        label="Age"
        icon="calendar-outline"
        value={age}
        onChangeText={setAge}
        placeholder="Enter your age"
        keyboardType="number-pad"
        maxLength={2}
      />
      <MD3InputField
        label="Height (cm) - optional"
        icon="resize-outline"
        value={height}
        onChangeText={setHeight}
        placeholder="e.g. 175"
        keyboardType="number-pad"
        maxLength={3}
      />

      <Text style={s.sectionHeader}>Gender</Text>
      <View style={s.genderRow}>
        {[
          { label: 'Man', icon: 'male-outline' },
          { label: 'Woman', icon: 'female-outline' },
          { label: 'Other', icon: 'transgender-outline' },
        ].map(g => {
          const selected = gender === g.label;
          return (
            <TouchableOpacity
              key={g.label}
              style={[s.choiceChip, selected && s.choiceChipSelected]}
              onPress={() => setGender(g.label)}
              activeOpacity={0.8}
            >
              <Ionicons 
                name={g.icon as any} 
                size={18} 
                color={selected ? MD3.primary : MD3.onSurfaceVariant} 
              />
              <Text style={[s.choiceChipText, selected && s.choiceChipTextSelected]}>
                {g.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderStepAbout = () => (
    <View style={s.stepContent}>
      <MD3InputField
        label="Tagline (optional)"
        icon="sparkles-outline"
        value={tagline}
        onChangeText={setTagline}
        placeholder="A short catchy line about you"
        maxLength={60}
      />
      <MD3InputField
        label="Bio"
        icon="create-outline"
        value={bio}
        onChangeText={setBio}
        placeholder="Tell potential matches about yourself"
        maxLength={300}
        multiline
        numberOfLines={4}
      />
      <Text style={s.charCount}>{bio.length}/300</Text>

      <Text style={s.sectionHeader}>Why I am here</Text>
      <View style={s.goalsGrid}>
        {[
          { label: 'Long-term relationship', emoji: '👩‍❤️‍👨' },
          { label: 'Casual dating', emoji: '🥂' },
          { label: 'Friendship', emoji: '🤝' },
          { label: 'Just vibes', emoji: '🤙' },
          { label: 'See where it goes', emoji: '🧭' },
          { label: 'Meaningful connection', emoji: '💖' },
          { label: 'Chat & chill', emoji: '💬' },
          { label: 'Friends first', emoji: '👫' },
          { label: 'Exploring', emoji: '🎒' },
          { label: 'Open to possibilities', emoji: '🌟' }
        ].map(({ label, emoji }) => {
          const selected = relationshipGoal === label;
          return (
            <TouchableOpacity
              key={label}
              style={[s.goalChip, selected && s.goalChipSelected]}
              onPress={() => setRelationshipGoal(label)}
              activeOpacity={0.8}
            >
              {selected ? (
                <Ionicons name="checkmark" size={14} color={MD3.primary} />
              ) : (
                <Text style={s.chipEmoji}>{emoji}</Text>
              )}
              <Text style={[s.goalChipText, selected && s.goalChipTextSelected]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={s.sectionHeader}>Interests <Text style={s.sectionHeaderSub}>(select at least 1)</Text></Text>
      <View style={s.interestsGrid}>
        {INTERESTS.map(({ label, emoji }) => {
          const selected = interests.includes(label);
          return (
            <TouchableOpacity
              key={label}
              style={[s.filterChip, selected && s.filterChipSelected]}
              onPress={() => toggleInterest(label)}
              activeOpacity={0.8}
            >
              {selected ? (
                <Ionicons name="checkmark" size={14} color={MD3.primary} />
              ) : (
                <Text style={s.chipEmoji}>{emoji}</Text>
              )}
              <Text style={[s.filterChipText, selected && s.filterChipTextSelected]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderCurrentStep = () => {
    switch (step) {
      case 0: return renderStepPhoto();
      case 1: return renderStepDetails();
      case 2: return renderStepAbout();
      default: return null;
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={s.container}>
        <StatusBar barStyle="dark-content" backgroundColor={MD3.surface} />
        
        {/* ── Google MD3 Clean Header ── */}
        <SafeAreaView edges={['top']} style={s.header}>
          <View style={s.headerRow}>
            <TouchableOpacity onPress={handleBack} style={s.backButton}>
              <Ionicons name="arrow-back" size={24} color={MD3.onSurface} />
            </TouchableOpacity>
            <Image
              source={require('../assets/images/luvstoer logo.png')}
              style={[s.logo, { tintColor: MD3.primary }]}
              contentFit="contain"
            />
            <View style={{ width: 48 }} />
          </View>

          {/* Thin Segmented Progress Indicator */}
          <View style={s.progressBarTrack}>
            {STEPS.map((_, i) => (
              <View key={i} style={s.progressBarSegment}>
                <View style={[
                  s.progressBarFill, 
                  i <= step && { backgroundColor: MD3.primary }
                ]} />
              </View>
            ))}
          </View>

          <View style={s.titleContainer}>
            <Text style={s.stepTitle}>{STEPS[step].title}</Text>
            <Text style={s.stepSubtitle}>{STEPS[step].subtitle}</Text>
          </View>
        </SafeAreaView>

        {/* ── Content Area ── */}
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {renderCurrentStep()}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* ── Google MD3 Bottom Actions ── */}
        <SafeAreaView edges={['bottom']} style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={s.bottomRow}>
            {step > 0 ? (
              <TouchableOpacity onPress={handleBack} style={s.textButton}>
                <Text style={s.textButtonText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}

            <TouchableOpacity
              onPress={step === STEPS.length - 1 ? handleComplete : handleNext}
              disabled={!canNext()}
              activeOpacity={0.8}
              style={[
                s.filledButton,
                !canNext() && s.filledButtonDisabled
              ]}
            >
              <Text style={[
                s.filledButtonText,
                !canNext() && s.filledButtonTextDisabled
              ]}>
                {step === STEPS.length - 1 ? 'Finish' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MD3.surface,
  },
  header: {
    backgroundColor: MD3.surface,
    borderBottomWidth: 1,
    borderBottomColor: MD3.surfaceVariant,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 56,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 100,
    height: 32,
  },
  progressBarTrack: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  progressBarSegment: {
    flex: 1,
    height: 4,
    backgroundColor: MD3.surfaceVariant,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    flex: 1,
    height: '100%',
  },
  titleContainer: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: MD3.onSurface,
    letterSpacing: -0.5,
  },
  stepSubtitle: {
    fontSize: 14,
    color: MD3.onSurfaceVariant,
    marginTop: 6,
    lineHeight: 20,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 120, // Add generous bottom spacing so scroll view content doesn't get covered by fixed bottom button
  },
  stepContent: {
    flex: 1,
  },
  
  // Step 1: Photo
  photoFrame: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: MD3.outlineVariant,
    borderStyle: 'dashed',
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    backgroundColor: MD3.surface,
    marginTop: 10,
    marginBottom: 30,
  },
  photoImage: {
    width: '100%',
    height: '100%',
    borderRadius: 80,
  },
  photoEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: MD3.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoPlaceholderIconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: MD3.primaryContainer,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderText: {
    fontSize: 14,
    fontWeight: '600',
    color: MD3.primary,
  },
  tipCard: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: MD3.primaryContainer,
    borderRadius: 12,
    padding: 16,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: MD3.onPrimaryContainer,
  },
  tipBody: {
    fontSize: 12,
    color: MD3.onPrimaryContainer,
    lineHeight: 18,
    marginTop: 4,
  },

  // Step 2: Details
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: MD3.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 12,
  },
  sectionHeaderSub: {
    fontSize: 12,
    fontWeight: '400',
    color: MD3.outline,
    textTransform: 'none',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 10,
  },
  choiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: MD3.outlineVariant,
    borderRadius: 100, // Capsule shape
    paddingHorizontal: 12,
    height: 48,
    flex: 1,
    backgroundColor: MD3.surface,
  },
  choiceChipSelected: {
    borderColor: MD3.primary,
    backgroundColor: MD3.primaryContainer,
  },
  choiceChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: MD3.onSurfaceVariant,
  },
  choiceChipTextSelected: {
    color: MD3.primary,
    fontWeight: '700',
  },

  // Step 3: About & Interests
  charCount: {
    fontSize: 12,
    color: MD3.outline,
    textAlign: 'right',
    marginTop: -16,
    marginBottom: 20,
  },
  interestsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: MD3.outlineVariant,
    borderRadius: 100, // Capsule shape
    paddingHorizontal: 14,
    height: 38,
    backgroundColor: MD3.surface,
  },
  filterChipSelected: {
    borderColor: MD3.primary,
    backgroundColor: MD3.primaryContainer,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: MD3.onSurfaceVariant,
  },
  filterChipTextSelected: {
    color: MD3.primary,
    fontWeight: '700',
  },
  chipEmoji: {
    fontSize: 14,
  },
  goalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  goalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: MD3.outlineVariant,
    borderRadius: 100,
    paddingHorizontal: 12,
    height: 38,
    backgroundColor: MD3.surface,
  },
  goalChipSelected: {
    borderColor: MD3.primary,
    backgroundColor: MD3.primaryContainer,
  },
  goalChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: MD3.onSurfaceVariant,
  },
  goalChipTextSelected: {
    color: MD3.primary,
    fontWeight: '700',
  },

  // Bottom action bar
  bottomBar: {
    backgroundColor: MD3.surface,
    borderTopWidth: 1,
    borderTopColor: MD3.surfaceVariant,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 48,
  },
  textButton: {
    paddingHorizontal: 16,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: MD3.primary,
  },
  filledButton: {
    backgroundColor: MD3.primary,
    borderRadius: 100,
    paddingHorizontal: 24,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 90,
  },
  filledButtonDisabled: {
    backgroundColor: MD3.surfaceVariant,
  },
  filledButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: MD3.onPrimary,
  },
  filledButtonTextDisabled: {
    color: MD3.outlineVariant,
  },
});
