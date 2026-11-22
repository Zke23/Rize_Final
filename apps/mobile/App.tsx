import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.wordmark}>MATROOM</Text>
        <Text style={styles.subtitle}>Wrestling, in the spotlight.</Text>
      </View>

      <View style={styles.feedCard}>
        <Text style={styles.eyebrow}>THE DAILY MAT</Text>
        <Text style={styles.title}>Your highlight reel starts here.</Text>
        <Text style={styles.description}>
          Match moments, tournament wins, and practice clips from the wrestling
          community will live in this feed.
        </Text>
      </View>

      <Text style={styles.footer}>FEED {"   "} DISCOVER {"   "} PROFILE</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#101214",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
    justifyContent: "space-between",
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
  feedCard: {
    minHeight: 340,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#303438",
    backgroundColor: "#191c1f",
    padding: 24,
    justifyContent: "flex-end",
    gap: 12,
  },
  eyebrow: {
    color: "#f3a64a",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  title: {
    color: "#f4f4f1",
    fontSize: 28,
    fontWeight: "800",
  },
  description: {
    color: "#b1b5b8",
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {
    color: "#8e9397",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
  },
});
