import { useCallback, useEffect, type RefObject } from "react";

export const useMemoSelectionReconciliation = ({
  memos,
  selectedMemoId,
  setSelectedMemoId,
  rendererRecoveryMode,
  creatingMemoSelectionRef,
  pendingCreatedMemoIdRef,
  pendingOpenedMemoIdRef,
  createdMemoEditId,
  keepSelectionOutsideList = false,
}: {
  memos: ReadonlyArray<{ id: string }>;
  selectedMemoId: string | null;
  setSelectedMemoId: (id: string | null) => void;
  rendererRecoveryMode: boolean;
  creatingMemoSelectionRef: RefObject<boolean>;
  pendingCreatedMemoIdRef: RefObject<string | null>;
  pendingOpenedMemoIdRef: RefObject<string | null>;
  createdMemoEditId: string | null;
  /** The page tree can open a page the paged note list has not loaded. */
  keepSelectionOutsideList?: boolean;
}) => {
  // Call only for explicit list/notebook actions, never for a programmatic
  // note open: its guard must survive the destination list's first page.
  const clearPendingMemoSelection = useCallback(() => {
    if (!pendingOpenedMemoIdRef.current) return;
    pendingOpenedMemoIdRef.current = null;
    // Reconcile even when the user reselects the same notebook/list identity.
    setSelectedMemoId(null);
  }, [pendingOpenedMemoIdRef, setSelectedMemoId]);

  useEffect(() => {
    const selectedMemoInList = selectedMemoId ? memos.some((memo) => memo.id === selectedMemoId) : false;
    if (rendererRecoveryMode) return;
    if (keepSelectionOutsideList && selectedMemoId) return;
    if (creatingMemoSelectionRef.current || pendingCreatedMemoIdRef.current) return;

    if (pendingOpenedMemoIdRef.current) {
      const openedMemoId = pendingOpenedMemoIdRef.current;
      if (!memos.some((memo) => memo.id === openedMemoId)) return;
      pendingOpenedMemoIdRef.current = null;
      // The open may not have rendered yet, and the first note in the list must not replace it.
      if (selectedMemoId !== openedMemoId) {
        setSelectedMemoId(openedMemoId);
        return;
      }
    }

    if (createdMemoEditId && selectedMemoId === createdMemoEditId) {
      // Preserve the new note until the editor has consumed its autofocus request.
      return;
    }
    if (memos.length === 0) {
      setSelectedMemoId(null);
      return;
    }
    if (!selectedMemoId || !selectedMemoInList) setSelectedMemoId(memos[0].id);
  }, [keepSelectionOutsideList, createdMemoEditId, creatingMemoSelectionRef, memos, pendingCreatedMemoIdRef, pendingOpenedMemoIdRef, rendererRecoveryMode, selectedMemoId, setSelectedMemoId]);

  return clearPendingMemoSelection;
};
