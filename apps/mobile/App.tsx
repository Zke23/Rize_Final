import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const sessionStorageKey = "matroom.session";

type AuthMode = "register" | "login";

interface Profile {
  weightClass: string;
  school: string;
  seasonRecord: string;
}

interface SessionResponse {
  token: string;
  email: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

async function apiRequest(
  path: string,
  options: { token?: string; method?: string; body?: object } = {},
): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (response.status === 204) {
    return null;
  }

  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `The request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
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
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.wordmark}>MATROOM</Text>
          <Text style={styles.subtitle}>Wrestling, in the spotlight.</Text>
        </View>

        {isStarting ? (
          <View style={styles.card}>
            <ActivityIndicator color="#f3a64a" />
            <Text style={styles.description}>Loading your account...</Text>
          </View>
        ) : sessionToken && !profileReady ? (
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
        ) : sessionToken ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>WRESTLER PROFILE</Text>
            <Text style={styles.title}>
              {hasProfile ? "Your profile" : "Create your profile"}
            </Text>
            <Text style={styles.description}>
              Add your school, weight class, and season record.
            </Text>

            <FormField
              label="Weight class"
              value={profile.weightClass}
              placeholder="Example: 125 lb"
              onChangeText={(value) => updateProfile("weightClass", value)}
            />
            <FormField
              label="School"
              value={profile.school}
              placeholder="Your school"
              onChangeText={(value) => updateProfile("school", value)}
            />
            <FormField
              label="Season record (W-L or W-L-T)"
              value={profile.seasonRecord}
              placeholder="Example: 18-2"
              onChangeText={(value) => updateProfile("seasonRecord", value)}
              autoCapitalize="none"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            <ActionButton
              label={isBusy ? "Saving..." : "Save profile"}
              disabled={isBusy}
              onPress={() => void saveProfile()}
            />
            <Pressable
              disabled={isBusy}
              onPress={() => void signOut()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
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
        )}

        <Text style={styles.footer}>YOUR PROFILE. YOUR MATROOM.</Text>
      </ScrollView>
    </SafeAreaView>
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
  footer: {
    color: "#8e9397",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
  },
});
