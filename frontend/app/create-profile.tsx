import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from "react-native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import { apiRequest, AUTH_TOKEN_KEY } from "../utils/api";
import {
    getAuthToken,
    getCurrentAuthUser,
    getLocalProfile,
    hasFinishedProfileSetup,
    isServerProfileComplete,
    markAuthUserProfileComplete,
    normalizeEmail,
    saveLocalProfile,
    syncProfileToServer,
    userToLocalProfile,
} from "../utils/auth";
import { useAuth } from "../contexts/AuthContext";
import { needsLocationSetup } from "../utils/locationSetup";
import {
    followGenderChange,
    oppositeShowMe,
    SHOW_ME_OPTIONS,
    type ShowMeValue,
} from "../utils/showMe";

// ── Luvstor brand (WhatsApp-style, clean) ───────────────────
const C = {
  bg: "#F0F2F5",
  white: "#FFFFFF",
  text: "#1A1A2E",
  secondary: "#6B6B6B",
  border: "#E9E9EB",
  primary: "#7C3AED",
  primaryLight: "#EDE9FE",
  primaryDark: "#6D28D9",
  yellow: "#F5D547",
  disabled: "#D1D5DB",
  placeholder: "#9CA3AF",
};

const INTERESTS = [
  { label: "Travel", emoji: "✈️" },
  { label: "Music", emoji: "🎵" },
  { label: "Fitness", emoji: "🏋️" },
  { label: "Cooking", emoji: "🍳" },
  { label: "Art", emoji: "🎨" },
  { label: "Gaming", emoji: "🎮" },
  { label: "Movies", emoji: "🎬" },
  { label: "Photography", emoji: "📷" },
  { label: "Reading", emoji: "📖" },
  { label: "Dancing", emoji: "💃" },
  { label: "Nature", emoji: "🍃" },
  { label: "Coffee", emoji: "☕" },
  { label: "Yoga", emoji: "🧘" },
  { label: "Sports", emoji: "⚽" },
  { label: "Pets", emoji: "🐾" },
  { label: "Food", emoji: "🍕" },
];

const STEPS = [
  { title: "Add profile picture" },
  { title: "Basic information" },
  { title: "About you & Interests" },
];

// ── WhatsApp-style input row ────────────────────────────────
function WAInputField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  multiline,
  numberOfLines,
  error,
}: any) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={fieldStyles.container}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View
        style={[
          fieldStyles.inputBox,
          focused && fieldStyles.inputBoxFocused,
          !!error && fieldStyles.inputBoxError,
        ]}
      >
        <TextInput
          style={[
            fieldStyles.textInput,
            multiline && fieldStyles.textInputMultiline,
          ]}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={numberOfLines}
          placeholder={placeholder}
          placeholderTextColor={C.placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
      {error ? <Text style={fieldStyles.error}>{error}</Text> : null}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: C.secondary,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  inputBox: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: "center",
    backgroundColor: C.white,
  },
  inputBoxFocused: {
    borderColor: C.primary,
  },
  inputBoxError: {
    borderColor: "#B3261E",
  },
  error: {
    marginTop: 6,
    fontSize: 13,
    color: "#B3261E",
  },
  textInput: {
    fontSize: 16,
    color: C.text,
    paddingVertical: 12,
  },
  textInputMultiline: {
    minHeight: 100,
    textAlignVertical: "top",
    paddingTop: 12,
  },
});

export default function CreateProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshSession } = useAuth();
  const [step, setStep] = useState(0);
  const [checkingSession, setCheckingSession] = useState(true);

  // Form States
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [showMe, setShowMe] = useState<ShowMeValue>("All");
  const [height, setHeight] = useState("");
  const [tagline, setTagline] = useState("");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [relationshipGoal, setRelationshipGoal] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupDone, setSetupDone] = useState<{ welcomeTokens: number } | null>(
    null,
  );
  const leavingRef = React.useRef(false);

  React.useEffect(() => {
    (async () => {
      try {
        const authUser = await getCurrentAuthUser();
        if (!authUser?.email) {
          router.replace("/login");
          return;
        }

        const accountEmail = normalizeEmail(authUser.email);
        // Existing profile → home. Setup is first-time only; edits live in Profile.
        if (authUser.profileComplete) {
          router.replace("/(tabs)");
          return;
        }
        const local = await getLocalProfile(accountEmail);

        const token = await getAuthToken();
        if (token) {
          const { apiRequest } = await import("../utils/api");
          const user = (await apiRequest("/api/users/me", token)) as Record<
            string,
            unknown
          >;
          const mapped = userToLocalProfile(user);
          if (isServerProfileComplete(user)) {
            await saveLocalProfile(accountEmail, mapped);
            await markAuthUserProfileComplete();
            await refreshSession();
            router.replace("/(tabs)");
            return;
          }
          // Prefill Google / partial account data into the form
          if (mapped.photo) setPhoto(String(mapped.photo));
          if (mapped.name) setName(String(mapped.name));
          if (mapped.age != null && mapped.age !== "")
            setAge(String(mapped.age));
          if (mapped.gender) setGender(String(mapped.gender));
          if (mapped.showMe) setShowMe(mapped.showMe as ShowMeValue);
          if (mapped.height) setHeight(String(mapped.height));
          if (mapped.tagline) setTagline(String(mapped.tagline));
          if (mapped.bio) setBio(String(mapped.bio));
          if (Array.isArray(mapped.interests) && mapped.interests.length) {
            setInterests(mapped.interests.map(String));
          }
          if (mapped.relationshipGoal) {
            setRelationshipGoal(String(mapped.relationshipGoal));
          }
        } else if (local) {
          if (local.photo) setPhoto(String(local.photo));
          if (local.name) setName(String(local.name));
        }
      } catch {
        // Server unreachable — only skip setup if this account's cache shows it was done
        try {
          const authUser = await getCurrentAuthUser();
          const local = authUser?.email
            ? await getLocalProfile(normalizeEmail(authUser.email))
            : null;
          if (hasFinishedProfileSetup(local)) {
            router.replace("/(tabs)");
            return;
          }
        } catch {
          /* show create profile */
        }
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

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
    if (saving) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      await completeProfile();
    } finally {
      setSaving(false);
    }
  };

  const leaveSetupDone = React.useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      const [token, authUser] = await Promise.all([
        getAuthToken(),
        getCurrentAuthUser(),
      ]);
      if (token && authUser?.id && (await needsLocationSetup(token, authUser.id))) {
        router.replace("/enable-location");
        return;
      }
    } catch {
      /* fall through to home; the tabs gate re-checks location */
    }
    router.replace("/(tabs)");
  }, [router]);

  React.useEffect(() => {
    if (!setupDone) return;
    const t = setTimeout(() => void leaveSetupDone(), 2200);
    return () => clearTimeout(t);
  }, [setupDone, leaveSetupDone]);

  const completeProfile = async () => {
    const authUser = await getCurrentAuthUser();
    const accountEmail = authUser?.email
      ? normalizeEmail(authUser.email)
      : null;
    if (!accountEmail || !authUser?.id) {
      router.replace("/login");
      return;
    }
    let welcomeTokens = 0;

    const profileData = {
      photo,
      name,
      age,
      gender,
      showMe: showMe || "All",
      height,
      city: "San Francisco, CA",
      distance: "10",
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
        const syncRes: any = await syncProfileToServer(token, profileData);
        const profile = syncRes?.profile || syncRes || {};
        welcomeTokens = Number(syncRes?.welcomeTokensGranted || 0);
        // Also fetch /me so we get the unique publicId (ABCD1234)
        let publicId = String(syncRes?.publicId || profile?.publicId || "");
        try {
          const me: any = await apiRequest("/api/users/me", token);
          publicId = String(me?.publicId || publicId || "");
        } catch {
          /* ignore */
        }
        await saveLocalProfile(accountEmail, {
          ...profileData,
          photo: profile?.photo
            ? String(profile.photo)
            : profileData.photo,
          publicId: /^[A-Z]{4}[0-9]{4}$/.test(publicId) ? publicId : "",
        });
        if (syncRes?.profileCompleted === true || syncRes?.profileComplete === true) {
          await markAuthUserProfileComplete();
        }
      }
    } catch (e: any) {
      console.warn("Failed to save profile:", e?.message || e);
      // 4xx = the server rejected a value; show why instead of blaming the network.
      const status = Number(e?.status) || 0;
      Alert.alert(
        "Could not save profile",
        status >= 400 && status < 500 && e?.message
          ? String(e.message)
          : "Check your internet connection and tap Finish again.",
      );
      return;
    }
    try {
      await refreshSession();
    } catch {
      /* ignore */
    }
    setSetupDone({ welcomeTokens });
  };

  if (checkingSession) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: C.bg,
        }}
      >
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
    }
  };

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest],
    );
  };

  // Same limits the server enforces — catch them here, not after Finish.
  const ageNum = Number(age);
  const ageError =
    age.trim() !== "" && !(ageNum >= 18 && ageNum <= 100)
      ? "You must be 18 or older."
      : null;
  const heightNum = Number(height);
  const heightError =
    height.trim() !== "" && !(heightNum >= 100 && heightNum <= 250)
      ? "Enter a height between 100 and 250 cm, or leave it empty."
      : null;

  const canNext = () => {
    if (step === 0) return !!photo;
    if (step === 1)
      return (
        name.trim() !== "" &&
        age.trim() !== "" &&
        !!gender &&
        !ageError &&
        !heightError
      );
    if (step === 2)
      return bio.trim() !== "" && interests.length > 0 && !!relationshipGoal;
    return true;
  };

  // ── Step Content Renders ───────────────────────────────────
  const renderStepPhoto = () => (
    <View style={s.stepContent}>
      <View style={s.photoSection}>
        <TouchableOpacity
          onPress={pickPhoto}
          activeOpacity={0.85}
          style={s.avatarPicker}
        >
          {photo ? (
            <Image
              source={{ uri: photo }}
              style={s.avatarImage}
              contentFit="cover"
            />
          ) : (
            <View style={s.avatarPlaceholder}>
              <Ionicons name="person" size={72} color="#FFFFFF" />
            </View>
          )}
          <View style={s.cameraBadge}>
            <Ionicons name="camera" size={18} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text style={s.photoActionText}>
          {photo ? "Change profile photo" : "Add profile photo"}
        </Text>
        <Text style={s.photoHint}>
          Use a clear photo where your face is easy to see.
        </Text>
      </View>
    </View>
  );

  const renderStepDetails = () => (
    <View style={s.stepContent}>
      <View style={s.formCard}>
        <WAInputField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Your name"
        />
        <WAInputField
          label="Age"
          value={age}
          onChangeText={setAge}
          placeholder="Your age"
          keyboardType="number-pad"
          maxLength={2}
          error={ageError}
        />
        <WAInputField
          label="Height (cm)"
          value={height}
          onChangeText={setHeight}
          placeholder="Optional"
          keyboardType="number-pad"
          maxLength={3}
          error={heightError}
        />
      </View>

      <Text style={s.sectionHeader}>Gender</Text>
      <View style={s.formCard}>
        <View style={s.genderRow}>
          {[
            { label: "Man", icon: "male-outline" },
            { label: "Woman", icon: "female-outline" },
            { label: "Other", icon: "transgender-outline" },
          ].map((g) => {
            const selected = gender === g.label;
            return (
              <TouchableOpacity
                key={g.label}
                style={[s.choiceChip, selected && s.choiceChipSelected]}
                onPress={() => {
                  setShowMe((prev) =>
                    followGenderChange(gender, prev, g.label),
                  );
                  setGender(g.label);
                }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={g.icon as any}
                  size={18}
                  color={selected ? C.primary : C.secondary}
                />
                <Text
                  style={[
                    s.choiceChipText,
                    selected && s.choiceChipTextSelected,
                  ]}
                >
                  {g.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={s.sectionHeader}>Show me</Text>
      <Text style={s.sectionHeaderSub}>
        Nearby will only show people who match this
      </Text>
      <View style={s.formCard}>
        <View style={s.showMeRow}>
          {SHOW_ME_OPTIONS.map((option) => {
            const selected =
              (showMe || oppositeShowMe(gender)) === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[s.filterChip, selected && s.filterChipSelected]}
                onPress={() => setShowMe(option.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    s.filterChipText,
                    selected && s.filterChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  const renderStepAbout = () => (
    <View style={s.stepContent}>
      <View style={s.formCard}>
        <WAInputField
          label="Tagline"
          value={tagline}
          onChangeText={setTagline}
          placeholder="Optional short line"
          maxLength={60}
        />
        <WAInputField
          label="Bio"
          value={bio}
          onChangeText={setBio}
          placeholder="Tell people about yourself"
          maxLength={300}
          multiline
          numberOfLines={4}
        />
        <Text style={s.charCount}>{bio.length}/300</Text>
      </View>

      <Text style={s.sectionHeader}>Why I am here</Text>
      <View style={s.formCard}>
        <View style={s.goalsGrid}>
          {[
            { label: "Long-term relationship", emoji: "👩‍❤️‍👨" },
            { label: "Casual dating", emoji: "🥂" },
            { label: "Friendship", emoji: "🤝" },
            { label: "Just vibes", emoji: "🤙" },
            { label: "See where it goes", emoji: "🧭" },
            { label: "Meaningful connection", emoji: "💖" },
            { label: "Chat & chill", emoji: "💬" },
            { label: "Friends first", emoji: "👫" },
            { label: "Exploring", emoji: "🎒" },
            { label: "Open to possibilities", emoji: "🌟" },
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
                  <Ionicons name="checkmark" size={14} color={C.primary} />
                ) : (
                  <Text style={s.chipEmoji}>{emoji}</Text>
                )}
                <Text
                  style={[s.goalChipText, selected && s.goalChipTextSelected]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={s.sectionHeader}>Interests</Text>
      <Text style={s.sectionHeaderSub}>Select at least one</Text>
      <View style={s.formCard}>
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
                  <Ionicons name="checkmark" size={14} color={C.primary} />
                ) : (
                  <Text style={s.chipEmoji}>{emoji}</Text>
                )}
                <Text
                  style={[
                    s.filterChipText,
                    selected && s.filterChipTextSelected,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  const renderCurrentStep = () => {
    switch (step) {
      case 0:
        return renderStepPhoto();
      case 1:
        return renderStepDetails();
      case 2:
        return renderStepAbout();
      default:
        return null;
    }
  };

  if (setupDone) {
    return (
      <View style={s.doneContainer}>
        <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
        <View style={s.doneIconOuter}>
          <View style={s.doneIconInner}>
            <Ionicons name="checkmark" size={56} color={C.white} />
          </View>
        </View>
        <Text style={s.doneTitle}>Profile setup done!</Text>
        <Text style={s.doneText}>
          {name.trim() ? `Looking great, ${name.trim().split(/\s+/)[0]}. ` : ""}
          Your profile is ready.
        </Text>
        {setupDone.welcomeTokens > 0 ? (
          <View style={s.doneBonus}>
            <Ionicons name="diamond" size={16} color={C.primary} />
            <Text style={s.doneBonusText}>
              +{setupDone.welcomeTokens} free welcome tokens added
            </Text>
          </View>
        ) : null}
        <ActivityIndicator
          size="small"
          color={C.primary}
          style={{ marginTop: 32 }}
        />
        <TouchableOpacity
          onPress={() => void leaveSetupDone()}
          style={s.doneContinue}
          activeOpacity={0.85}
        >
          <Text style={s.doneContinueText}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={s.container}>
        <StatusBar barStyle="dark-content" backgroundColor={C.white} />

        <SafeAreaView edges={["top"]} style={s.header}>
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={handleBack}
              style={s.backButton}
              disabled={saving}
            >
              <Ionicons name="arrow-back" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Profile setup</Text>
            <Text style={s.headerStep}>
              {step + 1} of {STEPS.length}
            </Text>
          </View>
        </SafeAreaView>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View style={s.scrollInner}>
                <Text style={s.stepTitle}>{STEPS[step].title}</Text>
                {renderCurrentStep()}
              </View>
            </TouchableWithoutFeedback>
          </ScrollView>
        </KeyboardAvoidingView>

        <SafeAreaView
          edges={["bottom"]}
          style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}
        >
          <TouchableOpacity
            onPress={step === STEPS.length - 1 ? handleComplete : handleNext}
            disabled={!canNext() || saving}
            activeOpacity={0.88}
            style={[s.primaryBtn, !canNext() && s.primaryBtnDisabled]}
          >
            {saving ? (
              <View style={s.savingRow}>
                <ActivityIndicator size="small" color={C.text} />
                <Text style={s.primaryBtnText}>Saving your profile…</Text>
              </View>
            ) : (
              <Text
                style={[s.primaryBtnText, !canNext() && s.primaryBtnTextDisabled]}
              >
                {step === STEPS.length - 1 ? "Finish" : "Next"}
              </Text>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    backgroundColor: C.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 52,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: C.text,
  },
  headerStep: {
    fontSize: 14,
    fontWeight: "600",
    color: C.secondary,
    minWidth: 44,
    textAlign: "right",
    paddingRight: 8,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 100,
  },
  scrollInner: { flexGrow: 1 },
  stepTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: C.text,
    letterSpacing: -0.3,
    marginBottom: 16,
  },
  stepContent: {
    flex: 1,
  },
  formCard: {
    backgroundColor: C.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },

  photoSection: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 24,
  },
  avatarPicker: {
    width: 148,
    height: 148,
    borderRadius: 74,
    position: "relative",
    marginBottom: 16,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 74,
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    borderRadius: 74,
    backgroundColor: "#DFE5E7",
    justifyContent: "center",
    alignItems: "center",
  },
  cameraBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: C.white,
  },
  photoActionText: {
    fontSize: 17,
    fontWeight: "600",
    color: C.primary,
    marginBottom: 6,
  },
  photoHint: {
    fontSize: 14,
    color: C.secondary,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 24,
  },

  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    color: C.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHeaderSub: {
    fontSize: 13,
    fontWeight: "400",
    color: C.secondary,
    marginBottom: 8,
    paddingHorizontal: 4,
    marginTop: -4,
  },
  genderRow: {
    flexDirection: "row",
    gap: 8,
  },
  showMeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 44,
    flex: 1,
    backgroundColor: C.bg,
  },
  choiceChipSelected: {
    borderColor: "transparent",
    backgroundColor: C.primaryLight,
  },
  choiceChipText: {
    fontSize: 14,
    fontWeight: "500",
    color: C.secondary,
  },
  choiceChipTextSelected: {
    color: C.primary,
    fontWeight: "600",
  },

  charCount: {
    fontSize: 12,
    color: C.secondary,
    textAlign: "right",
    marginTop: -8,
    marginBottom: 4,
  },
  interestsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 100,
    paddingHorizontal: 12,
    height: 36,
    backgroundColor: C.bg,
  },
  filterChipSelected: {
    borderColor: "transparent",
    backgroundColor: C.primaryLight,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: C.secondary,
  },
  filterChipTextSelected: {
    color: C.primary,
    fontWeight: "600",
  },
  chipEmoji: {
    fontSize: 14,
  },
  goalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  goalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 100,
    paddingHorizontal: 12,
    height: 36,
    backgroundColor: C.bg,
  },
  goalChipSelected: {
    borderColor: "transparent",
    backgroundColor: C.primaryLight,
  },
  goalChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: C.secondary,
  },
  goalChipTextSelected: {
    color: C.primary,
    fontWeight: "600",
  },

  bottomBar: {
    backgroundColor: C.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  primaryBtn: {
    backgroundColor: C.yellow,
    borderRadius: 12,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnDisabled: {
    backgroundColor: C.disabled,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
  },
  primaryBtnTextDisabled: {
    color: "#9CA3AF",
  },
  savingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  doneContainer: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  doneIconOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: C.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  doneIconInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: C.text,
    textAlign: "center",
    marginBottom: 10,
  },
  doneText: {
    fontSize: 15,
    lineHeight: 22,
    color: C.secondary,
    textAlign: "center",
  },
  doneBonus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.primaryLight,
  },
  doneBonusText: { fontSize: 14, fontWeight: "700", color: C.primaryDark },
  doneContinue: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 24 },
  doneContinueText: { fontSize: 15, fontWeight: "700", color: C.primary },
});
