import { useCallback, useEffect, useRef, useState } from "react";
import { consumeStandaloneMobileEditorReturn, openStandaloneMobileEditor } from "@/lib/mobile-editor";

const MOBILE_EDITOR_QUERY = "(max-width: 639px)";

export const useStandaloneMobileEditor = ({
  memoId,
  mobileDefaultEditMemoId,
  onBackToList,
  onDefaultEditConsumed,
  readOnly,
  disabled = false,
}: {
  memoId: string | null;
  mobileDefaultEditMemoId: string | null;
  onBackToList: () => void;
  onDefaultEditConsumed: () => void;
  readOnly: boolean;
  /** The page layout edits in place on phones, so it never sends people to the standalone editor. */
  disabled?: boolean;
}) => {
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(MOBILE_EDITOR_QUERY).matches
  );
  const [requestedMemoId, setRequestedMemoId] = useState<string | null>(null);
  const standaloneOpenMemoIdRef = useRef<string | null>(null);
  const defaultEditRequested = Boolean(memoId && memoId === mobileDefaultEditMemoId && !readOnly);
  const editingActive = Boolean(
    !disabled && isMobileViewport && memoId && !readOnly && (defaultEditRequested || requestedMemoId === memoId)
  );

  useEffect(() => {
    if (disabled || !isMobileViewport || !defaultEditRequested || !memoId) return;
    if (consumeStandaloneMobileEditorReturn(memoId)) {
      onDefaultEditConsumed();
      setRequestedMemoId(null);
      onBackToList();
      return;
    }
    if (standaloneOpenMemoIdRef.current === memoId) return;

    standaloneOpenMemoIdRef.current = memoId;
    onDefaultEditConsumed();
    openStandaloneMobileEditor(memoId);
  }, [defaultEditRequested, disabled, isMobileViewport, memoId, onBackToList, onDefaultEditConsumed]);

  useEffect(() => {
    const clearReturnedEditor = () => {
      if (!consumeStandaloneMobileEditorReturn(memoId)) return;
      onDefaultEditConsumed();
      setRequestedMemoId(null);
      onBackToList();
    };

    clearReturnedEditor();
    window.addEventListener("pageshow", clearReturnedEditor);
    document.addEventListener("visibilitychange", clearReturnedEditor);
    return () => {
      window.removeEventListener("pageshow", clearReturnedEditor);
      document.removeEventListener("visibilitychange", clearReturnedEditor);
    };
  }, [memoId, onBackToList, onDefaultEditConsumed]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_EDITOR_QUERY);
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    setRequestedMemoId(null);
  }, [memoId]);

  const requestEdit = useCallback(() => {
    if (!memoId || readOnly || disabled) return;
    setRequestedMemoId(memoId);
    openStandaloneMobileEditor(memoId);
  }, [disabled, memoId, readOnly]);

  return { editingActive, requestEdit };
};
