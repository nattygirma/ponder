import type { ReactNode } from "react";
import type { MemoSortMode } from "@ponder/client";
import { Modal, ScrollView, View } from "react-native";
import { Check, CheckSquare, FileText, Folder, Image, List, MoreVertical, Share2, Sparkles, Tag, Trash2, X } from "../components/icons";
import { Pressable, Text } from "../components/LocalizedText";
import type { MobileMemoListDensity } from "../lib/preferences";
import { styles } from "./workspace-styles";

const ActionSheetItem = ({
  compact = false,
  danger = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  compact?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={[
      styles.actionSheetItem,
      compact && styles.actionSheetItemCompact,
      disabled && styles.buttonDisabled,
    ]}
  >
    {icon}
    <Text
      style={[
        styles.actionSheetItemText,
        compact && styles.actionSheetItemTextCompact,
        danger && styles.actionSheetItemTextDanger,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

const SheetOptionRow = ({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon?: ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityState={{ checked: active }}
    onPress={onPress}
    style={[styles.sheetOptionRow, active && styles.sheetOptionRowActive]}
  >
    {icon ? <View style={styles.sheetOptionIcon}>{icon}</View> : null}
    <Text style={[styles.sheetOptionLabel, active && styles.sheetOptionLabelActive]}>{label}</Text>
    <View style={[styles.sheetOptionCheck, !active && styles.sheetOptionCheckHidden]}>
      <Check color="#ffffff" size={13} />
    </View>
  </Pressable>
);

export const NotesActionsModal = ({
  bottomOffset,
  canEnterSelection,
  listDescription,
  listTitle,
  memoListDensity,
  memoSortMode,
  onClose,
  onEnterSelection,
  onMemoListDensityChange,
  onOpenTagFilter,
  onSortModeChange,
  selectionMode,
  visible,
}: {
  bottomOffset: number;
  canEnterSelection: boolean;
  listDescription: string;
  listTitle: string;
  memoListDensity: MobileMemoListDensity;
  memoSortMode: MemoSortMode;
  onClose: () => void;
  onEnterSelection: () => void;
  onMemoListDensityChange: (density: MobileMemoListDensity) => void;
  onOpenTagFilter: () => void;
  onSortModeChange: (sortMode: MemoSortMode) => void;
  selectionMode: boolean;
  visible: boolean;
}) => (
  <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
    <Pressable onPress={onClose} style={[styles.actionSheetBackdrop, { paddingBottom: bottomOffset }]}>
      <Pressable style={styles.listActionSheet}>
        <View style={styles.actionSheetHandle} />
        <View style={styles.listActionSheetHeader}>
          <View style={styles.listActionSheetHeaderText}>
            <Text numberOfLines={1} style={styles.actionSheetTitle}>List options</Text>
            <Text numberOfLines={1} style={styles.actionSheetSubtitle}>{listTitle} · {listDescription}</Text>
          </View>
          <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
            <X color="#0f172a" size={18} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.listActionSheetContent} style={styles.listActionSheetScroll}>
          {!selectionMode ? (
            <>
              <ActionSheetItem
                compact
                disabled={!canEnterSelection}
                icon={<CheckSquare color="#0f172a" size={18} />}
                label="Select note"
                onPress={onEnterSelection}
              />
              <ActionSheetItem
                compact
                icon={<Tag color="#0f172a" size={18} />}
                label="Filter by tag"
                onPress={onOpenTagFilter}
              />
              <View style={styles.listActionDivider} />
            </>
          ) : null}
          <Text style={styles.actionSheetSectionTitle}>Display mode</Text>
          <SheetOptionRow
            active={memoListDensity === "preview"}
            icon={<FileText color={memoListDensity === "preview" ? "#10b981" : "#64748b"} size={18} />}
            label="Preview list"
            onPress={() => onMemoListDensityChange("preview")}
          />
          <SheetOptionRow
            active={memoListDensity === "compact"}
            icon={<List color={memoListDensity === "compact" ? "#10b981" : "#64748b"} size={18} />}
            label="Compact list"
            onPress={() => onMemoListDensityChange("compact")}
          />
          <View style={styles.listActionDivider} />
          <Text style={styles.actionSheetSectionTitle}>Sort by</Text>
          <SheetOptionRow active={memoSortMode === "updated-desc"} label="Recently updated" onPress={() => onSortModeChange("updated-desc")} />
          <SheetOptionRow active={memoSortMode === "created-desc"} label="Creation time" onPress={() => onSortModeChange("created-desc")} />
          <SheetOptionRow active={memoSortMode === "title-asc"} label="Title A-Z" onPress={() => onSortModeChange("title-asc")} />
          <SheetOptionRow active={memoSortMode === "title-desc"} label="Title Z-A" onPress={() => onSortModeChange("title-desc")} />
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>
);

const SelectionAction = ({
  danger = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <Pressable disabled={disabled} onPress={onPress} style={[styles.selectionAction, disabled && styles.buttonDisabled]}>
    {icon}
    <Text style={[styles.selectionActionText, danger && styles.selectionActionTextDanger]}>{label}</Text>
  </Pressable>
);

export const SelectionActionBar = ({
  bottomInset,
  canMove,
  isBusy,
  isTrashView,
  onDelete,
  onMore,
  onMove,
  selectedCount,
}: {
  bottomInset: number;
  canMove: boolean;
  isBusy: boolean;
  isTrashView: boolean;
  onDelete: () => void;
  onMore: () => void;
  onMove: () => void;
  selectedCount: number;
}) => (
  <View accessibilityLabel="Bulk actions" style={[styles.selectionBar, { paddingBottom: Math.max(2, bottomInset) }]}>
    <View style={styles.selectionActions}>
      <SelectionAction
        disabled={isBusy || !canMove}
        icon={<Folder color={canMove ? "#0f172a" : "#cbd5e1"} size={20} />}
        label="Move"
        onPress={onMove}
      />
      <SelectionAction
        danger
        disabled={isBusy || selectedCount === 0}
        icon={<Trash2 color={selectedCount === 0 ? "#cbd5e1" : "#b91c1c"} size={20} />}
        label={isTrashView ? "Delete permanently" : "Delete"}
        onPress={onDelete}
      />
      <SelectionAction
        disabled={isBusy}
        icon={<MoreVertical color="#0f172a" size={20} />}
        label="More"
        onPress={onMore}
      />
    </View>
  </View>
);

export const SelectionMoreModal = ({
  bottomOffset,
  canPin,
  canShare,
  canToggleVisibleSelection,
  onClear,
  onClose,
  onPin,
  onShare,
  onShareImage,
  onToggleVisibleSelection,
  pinLabel,
  selectedCount,
  selectionToggleLabel,
  visible,
}: {
  bottomOffset: number;
  canPin: boolean;
  canShare: boolean;
  canToggleVisibleSelection: boolean;
  onClear: () => void;
  onClose: () => void;
  onPin: () => void;
  onShare: () => void;
  onShareImage: () => void;
  onToggleVisibleSelection: () => void;
  pinLabel: string;
  selectedCount: number;
  selectionToggleLabel: string;
  visible: boolean;
}) => (
  <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
    <Pressable onPress={onClose} style={[styles.actionSheetBackdrop, { paddingBottom: bottomOffset }]}>
      <Pressable style={styles.selectionMoreSheet}>
        <View style={styles.actionSheetHandle} />
        <View style={styles.listActionSheetHeader}>
          <View style={styles.listActionSheetHeaderText}>
            <Text style={styles.actionSheetTitle}>Bulk actions</Text>
            <Text style={styles.actionSheetSubtitle}>{selectedCount > 0 ? `${selectedCount} selected` : "Select note"}</Text>
          </View>
          <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
            <X color="#0f172a" size={18} />
          </Pressable>
        </View>
        <ActionSheetItem
          disabled={!canToggleVisibleSelection}
          icon={<CheckSquare color={canToggleVisibleSelection ? "#0f172a" : "#cbd5e1"} size={18} />}
          label={selectionToggleLabel}
          onPress={onToggleVisibleSelection}
        />
        <ActionSheetItem
          disabled={!canPin}
          icon={<Sparkles color={canPin ? "#0f172a" : "#cbd5e1"} size={18} />}
          label={pinLabel}
          onPress={onPin}
        />
        <ActionSheetItem
          disabled={!canShare}
          icon={<Share2 color={canShare ? "#0f172a" : "#cbd5e1"} size={18} />}
          label="Share note"
          onPress={onShare}
        />
        <ActionSheetItem
          disabled={!canShare}
          icon={<Image color={canShare ? "#0f172a" : "#cbd5e1"} size={18} />}
          label="Share as image"
          onPress={onShareImage}
        />
        <ActionSheetItem icon={<X color="#0f172a" size={18} />} label="Clear selection" onPress={onClear} />
      </Pressable>
    </Pressable>
  </Modal>
);
