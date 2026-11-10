import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MemoTemplate } from "@ponder/shared";
import { listMemoTemplateGallery } from "@ponder/shared/memo-template-gallery";
import { localizeDefaultMemoTemplate } from "@ponder/shared/memo-template-seeds";
import type { createPonderClient } from "@ponder/client";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { ActivityIndicator, FileText, LayoutTemplate, X } from "./icons";
import { Text } from "./LocalizedText";
import {
  galleryEntryToMobileSelectableTemplate,
  mobileTemplateToCreateSeed,
  toMobileSelectableTemplate,
  type MobileCreateMemoSeed,
  type MobileSelectableTemplate,
} from "../lib/mobile-templates";
import { useMobileLocale } from "../lib/mobile-locale";
import { styles } from "../screens/workspace-styles";

type MobileClient = ReturnType<typeof createPonderClient>;

/**
 * Template picker.
 * - `modal` (default): system Modal — use from the workspace root only.
 * - `overlay`: absolute fill overlay — use inside CreateMemoModal so we do NOT nest
 *   RN Modals over DomWebView (Android keyboard / focus breaks after nested modals).
 */
export const MobileTemplatePickerModal = ({
  bottomOffset = 0,
  client,
  onClose,
  onSelect,
  presentation = "modal",
  visible,
}: {
  bottomOffset?: number;
  client: MobileClient | null;
  onClose: () => void;
  onSelect: (seed: MobileCreateMemoSeed) => void;
  presentation?: "modal" | "overlay";
  visible: boolean;
}) => {
  const { resolvedLocale, translate } = useMobileLocale();

  const savedTemplatesQuery = useQuery({
    queryKey: ["mobile", "templates"],
    enabled: visible && Boolean(client),
    queryFn: async () => {
      if (!client) {
        return [] as MemoTemplate[];
      }
      if (typeof client.listTemplates !== "function") {
        throw new Error("Client is missing listTemplates; reload the app to pick up the latest bundle.");
      }
      const response = await client.listTemplates();
      return response.templates;
    },
    staleTime: 15_000,
    retry: 1,
  });

  const savedTemplates = useMemo(
    () => (savedTemplatesQuery.data ?? []).map((template) => (
      toMobileSelectableTemplate(localizeDefaultMemoTemplate(template, resolvedLocale))
    )),
    [resolvedLocale, savedTemplatesQuery.data],
  );
  const galleryTemplates = useMemo(
    () => listMemoTemplateGallery(resolvedLocale).map(galleryEntryToMobileSelectableTemplate),
    [resolvedLocale],
  );
  const isLoadingSaved = savedTemplatesQuery.isLoading || savedTemplatesQuery.isFetching;
  const savedLoadErrorMessage = savedTemplatesQuery.error instanceof Error
    ? savedTemplatesQuery.error.message
    : savedTemplatesQuery.isError
      ? String(savedTemplatesQuery.error ?? "")
      : "";

  const handleSelect = (template: MobileSelectableTemplate) => {
    onSelect(mobileTemplateToCreateSeed(template));
    onClose();
  };

  if (!visible) {
    return null;
  }

  const sheet = (
    <Pressable
      onPress={onClose}
      style={[
        styles.actionSheetBackdrop,
        presentation === "overlay" ? styles.templatePickerOverlayRoot : null,
        { paddingBottom: bottomOffset },
      ]}
    >
      <Pressable style={[styles.listActionSheet, styles.templatePickerSheet]} onPress={(event) => event.stopPropagation()}>
        <View style={styles.actionSheetHandle} />
        <View style={styles.listActionSheetHeader}>
          <View style={styles.listActionSheetHeaderText}>
            <Text numberOfLines={1} style={styles.actionSheetTitle}>{translate("New from template")}</Text>
            <Text numberOfLines={2} style={styles.actionSheetSubtitle}>
              {translate("Choose a template to get started. Every template can be edited or deleted on the web.")}
            </Text>
          </View>
          <Pressable accessibilityLabel={translate("Close")} accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
            <X color="#0f172a" size={18} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.listActionSheetContent} style={styles.listActionSheetScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.actionSheetSectionTitle}>{translate("Template")}</Text>
          {isLoadingSaved ? (
            <View style={styles.templatePickerLoading}>
              <ActivityIndicator color="#0f172a" size="small" />
              <Text style={styles.mutedText}>{translate("Loading templates")}</Text>
            </View>
          ) : null}
          {!isLoadingSaved && savedTemplatesQuery.isError ? (
            <View style={styles.templatePickerErrorBlock}>
              <Text style={styles.templatePickerHint}>
                {translate("Templates could not load. Please try again later.")}
              </Text>
              {savedLoadErrorMessage ? (
                <Text style={styles.templatePickerErrorDetail} numberOfLines={3}>
                  {savedLoadErrorMessage}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => void savedTemplatesQuery.refetch()}
                style={styles.templatePickerRetryButton}
              >
                <Text style={styles.templatePickerRetryText}>{translate("Retry")}</Text>
              </Pressable>
            </View>
          ) : null}
          {!isLoadingSaved && !savedTemplatesQuery.isError && savedTemplates.length === 0 ? (
            <Text style={styles.templatePickerHint}>
              {translate("No templates yet. Create one or save a note as a template on the web.")}
            </Text>
          ) : null}
          {savedTemplates.map((template) => (
            <TemplateRow key={template.id} onPress={() => handleSelect(template)} template={template} />
          ))}
          <Text style={styles.actionSheetSectionTitle}>{translate("Template Gallery")}</Text>
          {galleryTemplates.map((template) => (
            <TemplateRow key={template.id} onPress={() => handleSelect(template)} template={template} />
          ))}
        </ScrollView>
      </Pressable>
    </Pressable>
  );

  if (presentation === "overlay") {
    return sheet;
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      {sheet}
    </Modal>
  );
};

export const MobileCreateChoiceModal = ({
  bottomOffset = 0,
  canCreate,
  onBlank,
  onClose,
  onTemplate,
  visible,
}: {
  bottomOffset?: number;
  canCreate: boolean;
  onBlank: () => void;
  onClose: () => void;
  onTemplate: () => void;
  visible: boolean;
}) => {
  const { translate } = useMobileLocale();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={[styles.actionSheetBackdrop, { paddingBottom: bottomOffset }]}>
        <Pressable style={styles.listActionSheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.actionSheetHandle} />
          <View style={styles.listActionSheetHeader}>
            <View style={styles.listActionSheetHeaderText}>
              <Text numberOfLines={1} style={styles.actionSheetTitle}>{translate("New note")}</Text>
              <Text numberOfLines={1} style={styles.actionSheetSubtitle}>{translate("Choose how to create")}</Text>
            </View>
            <Pressable accessibilityLabel={translate("Close")} accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
              <X color="#0f172a" size={18} />
            </Pressable>
          </View>
          <View style={styles.listActionSheetContent}>
            <Pressable
              accessibilityRole="button"
              disabled={!canCreate}
              onPress={() => {
                onClose();
                onBlank();
              }}
              style={[styles.templateChoiceRow, !canCreate && styles.templateChoiceRowDisabled]}
            >
              <View style={styles.templateChoiceIcon}>
                <FileText color="#0f172a" size={18} />
              </View>
              <View style={styles.templateChoiceText}>
                <Text style={styles.templateChoiceTitle}>{translate("Blank note")}</Text>
                <Text style={styles.templateChoiceDescription}>{translate("Start with an empty page")}</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canCreate}
              onPress={() => {
                onClose();
                onTemplate();
              }}
              style={[styles.templateChoiceRow, !canCreate && styles.templateChoiceRowDisabled]}
            >
              <View style={styles.templateChoiceIcon}>
                <LayoutTemplate color="#0f172a" size={18} />
              </View>
              <View style={styles.templateChoiceText}>
                <Text style={styles.templateChoiceTitle}>{translate("New from template")}</Text>
                <Text style={styles.templateChoiceDescription}>{translate("Use meeting notes, weekly reviews, and more")}</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const TemplateRow = ({
  onPress,
  template,
}: {
  onPress: () => void;
  template: MobileSelectableTemplate;
}) => {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.templateRow}>
      <View style={styles.templateRowIcon}>
        <LayoutTemplate color="#047857" size={16} />
      </View>
      <View style={styles.templateRowText}>
        <View style={styles.templateRowTitleRow}>
          <Text numberOfLines={1} style={styles.templateRowTitle}>{template.name}</Text>
        </View>
        {template.description ? (
          <Text numberOfLines={2} style={styles.templateRowDescription}>{template.description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
};
