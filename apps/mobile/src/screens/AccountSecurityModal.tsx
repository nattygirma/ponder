import { ApiRequestError } from "@ponder/client";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "../components/icons";
import { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
} from "react-native";
import { Pressable, Text, TextInput } from "../components/LocalizedText";
import { resolveMobileThemeStyles, useMobileTheme, type MobileResolvedTheme } from "../lib/mobile-theme";
import { useSession } from "../lib/session";

export const AccountSecurityPanel = ({
  active,
}: {
  active: boolean;
}) => {
  const { resolvedTheme } = useMobileTheme();
  refreshAccountSecurityThemeStyles(resolvedTheme);
  const { client } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Client is not ready");
      if (newPassword.length < 8) throw new Error("The new password must be at least 8 characters.");
      if (newPassword !== confirmPassword) throw new Error("The new passwords do not match.");
      return client.changePassword({ currentPassword, newPassword, confirmPassword });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
  });

  useEffect(() => {
    if (!active) {
      passwordMutation.reset();
    }
  }, [active]);

  const errorMessage = (error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "invalid_current_password") return "The current password is incorrect.";
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
  };

  return (
    <View style={styles.content}>
      <View style={styles.hero}>
        <KeyRound color="#15803d" size={22} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Change password</Text>
          <Text style={styles.help}>Keeps this device signed in and signs out other sessions.</Text>
        </View>
      </View>
      <Field label="Current password" onChangeText={setCurrentPassword} value={currentPassword} />
      <Field label="New password" onChangeText={setNewPassword} value={newPassword} />
      <Field label="Confirm new password" onChangeText={setConfirmPassword} value={confirmPassword} />
      {passwordMutation.error ? <Text style={styles.error}>{errorMessage(passwordMutation.error)}</Text> : null}
      {passwordMutation.isSuccess ? <Text accessibilityLiveRegion="polite" style={styles.success}>Password changed successfully.</Text> : null}
      <PrimaryButton
        disabled={passwordMutation.isPending}
        label={passwordMutation.isPending ? "Changing..." : "Change password"}
        onPress={() => passwordMutation.mutate()}
      />
    </View>
  );
};

const Field = ({ help, label, onChangeText, placeholder, secure = true, value }: {
  help?: string;
  label: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  value: string;
}) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#94a3b8"
      secureTextEntry={secure}
      style={styles.input}
      value={value}
    />
    {help ? <Text style={styles.help}>{help}</Text> : null}
  </View>
);

const PrimaryButton = ({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) => (
  <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}>
    <Text style={styles.primaryButtonText}>{label}</Text>
  </Pressable>
);

const baseAccountSecurityStyles = StyleSheet.create({
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  hero: { alignItems: "flex-start", backgroundColor: "transparent", flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  cardTitle: { color: "#17211a", fontSize: 16, fontWeight: "800" },
  help: { color: "#64748b", fontSize: 12, lineHeight: 18, marginTop: 3 },
  field: { gap: 7 },
  label: { color: "#334155", fontSize: 13, fontWeight: "700" },
  input: { backgroundColor: "#ffffff", borderColor: "#cad8cc", borderRadius: 10, borderWidth: 1, color: "#17211a", minHeight: 48, paddingHorizontal: 13 },
  primaryButton: { alignItems: "center", backgroundColor: "#15803d", borderRadius: 10, minHeight: 48, justifyContent: "center", paddingHorizontal: 16 },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  error: { color: "#be123c", fontSize: 13, lineHeight: 19 },
  success: { color: "#15803d", fontSize: 13, fontWeight: "700", lineHeight: 19 },
});

let styles = baseAccountSecurityStyles;
let accountSecurityStylesTheme: MobileResolvedTheme = "light";

const refreshAccountSecurityThemeStyles = (theme: MobileResolvedTheme) => {
  if (accountSecurityStylesTheme !== theme) {
    styles = resolveMobileThemeStyles(baseAccountSecurityStyles, theme);
    accountSecurityStylesTheme = theme;
  }
};
