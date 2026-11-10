export const MOBILE_EDITOR_AUTOSAVE_DELAY_MS = 1200;

export type MobileEditorSaveChromeInput = {
  dirty: boolean;
  draftRestored: boolean;
  error: boolean;
  ready: boolean;
  saving: boolean;
  uploading: boolean;
};

export type MobileEditorSaveChrome = {
  /** Green pill. Routine autosave stays on the quiet gray chip. */
  emphasized: boolean;
  label: "Save failed" | "Uploading" | "Local draft" | "Not saved" | "Saved" | "Loading";
};

/**
 * Status chip for an existing note.
 * A background save keeps the unsaved label, so the header does not cycle
 * through "Saving" and "Saved" on every pause. The Done button stays a label.
 */
export const getMobileEditorSaveChrome = ({
  dirty,
  draftRestored,
  error,
  ready,
  saving,
  uploading,
}: MobileEditorSaveChromeInput): MobileEditorSaveChrome => {
  if (error) return { emphasized: false, label: "Save failed" };
  if (uploading) return { emphasized: true, label: "Uploading" };
  if (dirty || saving) return { emphasized: false, label: draftRestored ? "Local draft" : "Not saved" };
  if (ready) return { emphasized: false, label: "Saved" };
  return { emphasized: false, label: "Loading" };
};

export const shouldScheduleMobileEditorAutosave = ({
  active,
  closing,
  dirty,
  ready,
  saving,
  uploading,
}: {
  active: boolean;
  closing: boolean;
  dirty: boolean;
  ready: boolean;
  saving: boolean;
  uploading: boolean;
}) => active && dirty && ready && !saving && !uploading && !closing;
