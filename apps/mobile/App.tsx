import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, apiRequest, errorMessage, isRecord } from "./api";
import VideoFeedScreen from "./VideoFeedScreen";

const sessionStorageKey = "matroom.session";

type AuthMode = "register" | "login";
type MainTab = "feed" | "messages" | "profile";

interface Profile {
  weightClass: string;
  school: string;
  seasonRecord: string;
}

interface SessionResponse {
  token: string;
  email: string;
}

interface ProfileVideo {
  id: string;
  caption: string;
  createdAt: string;
}

function parseSession(value: unknown): SessionResponse {
  if (
    !isRecord(value) ||
    typeof value.token !== "string" ||
    typeof value.email !== "string"
  ) {
    throw new Error("The API returned an invalid sign-in response.");
  }
  return { token: value.token, email: value.email };
}

function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value) || !("profile" in value)) {
    throw new Error("The API returned an invalid profile response.");
  }

  const profile = value.profile;
  if (profile === null) {
    return null;
  }
  if (
    !isRecord(profile) ||
    typeof profile.weightClass !== "string" ||
    typeof profile.school !== "string" ||
    typeof profile.seasonRecord !== "string"
  ) {
    throw new Error("The API returned an invalid profile.");
  }
  return {
    weightClass: profile.weightClass,
    school: profile.school,
    seasonRecord: profile.seasonRecord,
  };
}

function parseProfileVideos(value: unknown): ProfileVideo[] {
  if (!isRecord(value) || !Array.isArray(value.videos)) {
    throw new Error("The API returned an invalid uploads response.");
  }

  return value.videos.map((video): ProfileVideo => {
    if (
      !isRecord(video) ||
      typeof video.id !== "string" ||
      typeof video.caption !== "string" ||
      typeof video.createdAt !== "string"
    ) {
      throw new Error("The API returned an invalid uploaded video.");
    }
    return {
      id: video.id,
      caption: video.caption,
      createdAt: video.createdAt,
    };
  });
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("feed");
  const [profile, setProfile] = useState<Profile>({
    weightClass: "",
    school: "",
    seasonRecord: "",
  });
  const [hasProfile, setHasProfile] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [isStarting, setIsStarting] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadProfile = useCallback(async (token: string): Promise<void> => {
    setError("");
    try {
      const savedProfile = parseProfile(
        await apiRequest("/api/profile", { token }),
      );
      setProfile(
        savedProfile ?? { weightClass: "", school: "", seasonRecord: "" },
      );
      setHasProfile(savedProfile !== null);
      setProfileReady(true);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await SecureStore.deleteItemAsync(sessionStorageKey);
        setSessionToken(null);
        setProfileReady(false);
        setError("Your session expired. Please sign in again.");
      } else {
        setError(errorMessage(loadError));
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    const restoreSession = async (): Promise<void> => {
      try {
        const token = await SecureStore.getItemAsync(sessionStorageKey);
        if (!active) {
          return;
        }
        if (token) {
          setSessionToken(token);
          await loadProfile(token);
        }
      } catch (restoreError) {
        if (active) {
          setError(errorMessage(restoreError));
        }
      } finally {
        if (active) {
          setIsStarting(false);
        }
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, [loadProfile]);

  async function submitAuthentication(): Promise<void> {
    setError("");
    setNotice("");
    if (authMode === "register" && password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    setIsBusy(true);
    try {
      const session = parseSession(
        await apiRequest(`/api/auth/${authMode}`, {
          method: "POST",
          body: { email, password },
        }),
      );
      await SecureStore.setItemAsync(sessionStorageKey, session.token);
      setSessionToken(session.token);
      setEmail(session.email);
      setPassword("");
      setConfirmPassword("");
      await loadProfile(session.token);
    } catch (authError) {
      setError(errorMessage(authError));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveProfile(): Promise<void> {
    if (!sessionToken) {
      return;
    }
    setError("");
    setNotice("");
    setIsBusy(true);
    try {
      const savedProfile = parseProfile(
        await apiRequest("/api/profile", {
          token: sessionToken,
          method: "PUT",
          body: profile,
        }),
      );
      if (!savedProfile) {
        throw new Error("The API did not return the saved profile.");
      }
      setProfile(savedProfile);
      setHasProfile(true);
      setNotice("Profile saved.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    if (!sessionToken) {
      return;
    }
    setError("");
    setNotice("");
    setIsBusy(true);
    try {
      await apiRequest("/api/auth/logout", {
        token: sessionToken,
        method: "POST",
      });
      await SecureStore.deleteItemAsync(sessionStorageKey);
      setSessionToken(null);
      setProfileReady(false);
      setHasProfile(false);
      setProfile({ weightClass: "", school: "", seasonRecord: "" });
      setAuthMode("login");
      setActiveTab("feed");
    } catch (signOutError) {
      setError(errorMessage(signOutError));
    } finally {
      setIsBusy(false);
    }
  }

  function updateProfile(field: keyof Profile, value: string): void {
    setProfile((currentProfile) => ({ ...currentProfile, [field]: value }));
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      {isStarting ? (
        <ScrollView contentContainerStyle={styles.content}>
          <BrandHeader />
          <View style={styles.card}>
            <ActivityIndicator color="#f3a64a" />
            <Text style={styles.description}>Loading your account...</Text>
          </View>
        </ScrollView>
      ) : sessionToken && !profileReady ? (
        <ScrollView contentContainerStyle={styles.content}>
          <BrandHeader />
          <View style={styles.card}>
            <Text style={styles.title}>Connecting to your profile</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ActionButton
              label="Try again"
              disabled={isBusy}
              onPress={() => void loadProfile(sessionToken)}
            />
            <Pressable
              disabled={isBusy}
              onPress={() => void signOut()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : sessionToken ? (
        <View style={styles.dashboard}>
          <View style={styles.dashboardContent}>
            {activeTab === "feed" ? (
              <VideoFeedScreen token={sessionToken} />
            ) : activeTab === "messages" ? (
              <MessagesScreen />
            ) : (
              <ProfileScreen
                token={sessionToken}
                profile={profile}
                hasProfile={hasProfile}
                isBusy={isBusy}
                error={error}
                notice={notice}
                onUpdate={updateProfile}
                onSave={() => void saveProfile()}
                onSignOut={() => void signOut()}
              />
            )}
          </View>
          <BottomNavigation activeTab={activeTab} onChange={setActiveTab} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <BrandHeader />
          <View style={styles.card}>
            <Text style={styles.eyebrow}>WRESTLER PROFILE</Text>
            <Text style={styles.title}>
              {authMode === "register" ? "Create your account" : "Welcome back"}
            </Text>
            <Text style={styles.description}>
              {authMode === "register"
                ? "Sign up to save your wrestling profile."
                : "Sign in to view and update your profile."}
            </Text>

            <FormField
              label="Email"
              value={email}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              onChangeText={setEmail}
            />
            <FormField
              label="Password"
              value={password}
              placeholder="At least 8 characters"
              secureTextEntry
              autoCapitalize="none"
              onChangeText={setPassword}
            />
            {authMode === "register" ? (
              <FormField
                label="Confirm password"
                value={confirmPassword}
                placeholder="Enter your password again"
                secureTextEntry
                autoCapitalize="none"
                onChangeText={setConfirmPassword}
              />
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ActionButton
              label={
                isBusy
                  ? "Please wait..."
                  : authMode === "register"
                    ? "Create account"
                    : "Sign in"
              }
              disabled={isBusy}
              onPress={() => void submitAuthentication()}
            />
            <Pressable
              disabled={isBusy}
              onPress={() => {
                setError("");
                setAuthMode(authMode === "register" ? "login" : "register");
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>
                {authMode === "register"
                  ? "Already have an account? Sign in"
                  : "New to Matroom? Create an account"}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.footer}>YOUR PROFILE. YOUR MATROOM.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function BrandHeader() {
  return (
    <View style={styles.header}>
      <Text style={styles.wordmark}>MATROOM</Text>
      <Text style={styles.subtitle}>Wrestling, in the spotlight.</Text>
    </View>
  );
}

interface ProfileScreenProps {
  token: string;
  profile: Profile;
  hasProfile: boolean;
  isBusy: boolean;
  error: string;
  notice: string;
  onUpdate: (field: keyof Profile, value: string) => void;
  onSave: () => void;
  onSignOut: () => void;
}

function ProfileScreen({
  token,
  profile,
  hasProfile,
  isBusy,
  error,
  notice,
  onUpdate,
  onSave,
  onSignOut,
}: ProfileScreenProps) {
  const [videos, setVideos] = useState<ProfileVideo[]>([]);
  const [areVideosLoading, setAreVideosLoading] = useState(true);
  const [videosError, setVideosError] = useState("");
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);

  const loadVideos = useCallback(async (): Promise<void> => {
    setVideosError("");
    setAreVideosLoading(true);
    try {
      setVideos(parseProfileVideos(await apiRequest("/api/profile/videos", { token })));
    } catch (loadError) {
      setVideosError(errorMessage(loadError));
    } finally {
      setAreVideosLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  async function takeDownVideo(videoId: string): Promise<void> {
    setVideosError("");
    setDeletingVideoId(videoId);
    try {
      await apiRequest(`/api/videos/${encodeURIComponent(videoId)}`, {
        token,
        method: "DELETE",
      });
      setVideos((currentVideos) =>
        currentVideos.filter((video) => video.id !== videoId),
      );
    } catch (deleteError) {
      setVideosError(errorMessage(deleteError));
    } finally {
      setDeletingVideoId(null);
    }
  }

  function confirmTakeDown(video: ProfileVideo): void {
    Alert.alert(
      "Take down this video?",
      "It will be removed from your profile and the feed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Take down",
          style: "destructive",
          onPress: () => void takeDownVideo(video.id),
        },
      ],
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.profileContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.eyebrow}>WRESTLER PROFILE</Text>
        <Text style={styles.title}>{hasProfile ? "Your profile" : "Create your profile"}</Text>
        <Text style={styles.description}>
          Add your school, weight class, and season record.
        </Text>
        <FormField
          label="Weight class"
          value={profile.weightClass}
          placeholder="Example: 125 lb"
          onChangeText={(value) => onUpdate("weightClass", value)}
        />
        <FormField
          label="School"
          value={profile.school}
          placeholder="Your school"
          onChangeText={(value) => onUpdate("school", value)}
        />
        <FormField
          label="Season record (W-L or W-L-T)"
          value={profile.seasonRecord}
          placeholder="Example: 18-2"
          onChangeText={(value) => onUpdate("seasonRecord", value)}
          autoCapitalize="none"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <ActionButton
          label={isBusy ? "Saving..." : "Save profile"}
          disabled={isBusy}
          onPress={onSave}
        />
        <Pressable
          disabled={isBusy}
          onPress={onSignOut}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>YOUR VIDEOS</Text>
        <Text style={styles.title}>Uploads</Text>
        {areVideosLoading ? (
          <ActivityIndicator color="#f3a64a" />
        ) : videosError && videos.length === 0 ? (
          <>
            <Text style={styles.error}>{videosError}</Text>
            <ActionButton
              label="Retry"
              disabled={areVideosLoading}
              onPress={() => void loadVideos()}
            />
          </>
        ) : videos.length === 0 ? (
          <Text style={styles.description}>Your uploaded clips will appear here.</Text>
        ) : (
          <View style={styles.uploadList}>
            {videos.map((video) => (
              <View key={video.id} style={styles.uploadRow}>
                <View style={styles.uploadDetails}>
                  <Text style={styles.uploadCaption} numberOfLines={2}>
                    {video.caption || "Wrestling clip"}
                  </Text>
                  <Text style={styles.uploadDate}>
                    {new Date(video.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Take down ${video.caption || "video"}`}
                  disabled={deletingVideoId !== null}
                  onPress={() => confirmTakeDown(video)}
                  style={[
                    styles.takeDownButton,
                    deletingVideoId !== null && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.takeDownText}>
                    {deletingVideoId === video.id ? "Taking down..." : "Take down"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {videosError && videos.length > 0 ? (
          <Text style={styles.error}>{videosError}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function MessagesScreen() {
  return (
    <View style={styles.messagesScreen}>
      <Text style={styles.eyebrow}>MATROOM</Text>
      <Text style={styles.title}>Messages</Text>
      <Text style={styles.description}>
        Your personal messages will appear here. Messaging is coming soon.
      </Text>
    </View>
  );
}

interface BottomNavigationProps {
  activeTab: MainTab;
  onChange: (tab: MainTab) => void;
}

function BottomNavigation({ activeTab, onChange }: BottomNavigationProps) {
  const tabs: { id: MainTab; label: string }[] = [
    { id: "feed", label: "Feed" },
    { id: "messages", label: "Messages" },
    { id: "profile", label: "Profile" },
  ];

  return (
    <View style={styles.bottomNavigation}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.id}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === tab.id }}
          onPress={() => onChange(tab.id)}
          style={styles.navigationButton}
        >
          <Text
            style={[
              styles.navigationLabel,
              activeTab === tab.id && styles.navigationLabelActive,
            ]}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

interface FormFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address";
  secureTextEntry?: boolean;
}

function FormField({
  label,
  value,
  placeholder,
  onChangeText,
  autoCapitalize = "words",
  keyboardType = "default",
  secureTextEntry = false,
}: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        placeholder={placeholder}
        placeholderTextColor="#71777b"
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  disabled: boolean;
  onPress: () => void;
}

function ActionButton({ label, disabled, onPress }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled && styles.disabledButton]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#101214",
  },
  content: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
    gap: 32,
  },
  dashboard: {
    flex: 1,
  },
  dashboardContent: {
    flex: 1,
  },
  profileContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 28,
    gap: 16,
  },
  messagesScreen: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  bottomNavigation: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: "#303438",
    backgroundColor: "#101214",
  },
  navigationButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 62,
  },
  navigationLabel: {
    color: "#8e9397",
    fontSize: 12,
    fontWeight: "700",
  },
  navigationLabelActive: {
    color: "#f3a64a",
  },
  header: {
    gap: 6,
  },
  wordmark: {
    color: "#f4f4f1",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 2,
  },
  subtitle: {
    color: "#9b9fa3",
    fontSize: 14,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#303438",
    backgroundColor: "#191c1f",
    padding: 24,
    gap: 16,
  },
  eyebrow: {
    color: "#f3a64a",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  title: {
    color: "#f4f4f1",
    fontSize: 27,
    fontWeight: "800",
  },
  description: {
    color: "#b1b5b8",
    fontSize: 15,
    lineHeight: 22,
  },
  field: {
    gap: 8,
  },
  label: {
    color: "#e5e6e3",
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3a3f43",
    backgroundColor: "#101214",
    color: "#f4f4f1",
    paddingHorizontal: 14,
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#f3a64a",
    paddingHorizontal: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#151515",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: "#f3a64a",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  error: {
    color: "#ff8b82",
    fontSize: 13,
    lineHeight: 19,
  },
  notice: {
    color: "#9ce3b0",
    fontSize: 13,
  },
  uploadList: {
    gap: 10,
  },
  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#303438",
    paddingVertical: 8,
  },
  uploadDetails: {
    flex: 1,
    gap: 4,
  },
  uploadCaption: {
    color: "#f4f4f1",
    fontSize: 14,
    fontWeight: "700",
  },
  uploadDate: {
    color: "#9b9fa3",
    fontSize: 12,
  },
  takeDownButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#7a3d38",
    backgroundColor: "#30201f",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  takeDownText: {
    color: "#ff8b82",
    fontSize: 12,
    fontWeight: "800",
  },
  footer: {
    color: "#8e9397",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
  },
});
