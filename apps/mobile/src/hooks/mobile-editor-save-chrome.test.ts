import { describe, expect, test } from "bun:test";
import {
  getMobileEditorSaveChrome,
  shouldScheduleMobileEditorAutosave,
} from "./mobile-editor-save-chrome";

const idle = {
  dirty: false,
  draftRestored: false,
  error: false,
  ready: true,
  saving: false,
  uploading: false,
};

describe("getMobileEditorSaveChrome", () => {
  test("keeps a saved note on the quiet chip", () => {
    expect(getMobileEditorSaveChrome(idle)).toEqual({ emphasized: false, label: "Saved" });
  });

  test("shows unsaved edits without a saving flash or green pill", () => {
    expect(getMobileEditorSaveChrome({ ...idle, dirty: true })).toEqual({
      emphasized: false,
      label: "Not saved",
    });
    expect(getMobileEditorSaveChrome({ ...idle, dirty: true, saving: true })).toEqual({
      emphasized: false,
      label: "Not saved",
    });
  });

  test("keeps a restored draft visible while its first save is in flight", () => {
    expect(getMobileEditorSaveChrome({ ...idle, dirty: true, draftRestored: true, saving: true })).toEqual({
      emphasized: false,
      label: "Local draft",
    });
  });

  test("keeps upload and failure visible", () => {
    expect(getMobileEditorSaveChrome({ ...idle, uploading: true, dirty: true })).toEqual({
      emphasized: true,
      label: "Uploading",
    });
    expect(getMobileEditorSaveChrome({ ...idle, error: true, saving: true })).toEqual({
      emphasized: false,
      label: "Save failed",
    });
  });

  test("shows a loading label before the editor is ready", () => {
    expect(getMobileEditorSaveChrome({ ...idle, ready: false }).label).toBe("Loading");
  });
});

describe("shouldScheduleMobileEditorAutosave", () => {
  const ready = {
    active: true,
    closing: false,
    dirty: true,
    ready: true,
    saving: false,
    uploading: false,
  };

  test("schedules after an edit settles", () => {
    expect(shouldScheduleMobileEditorAutosave(ready)).toBe(true);
  });

  test("waits out an in-flight save, upload, or close", () => {
    expect(shouldScheduleMobileEditorAutosave({ ...ready, saving: true })).toBe(false);
    expect(shouldScheduleMobileEditorAutosave({ ...ready, uploading: true })).toBe(false);
    expect(shouldScheduleMobileEditorAutosave({ ...ready, closing: true })).toBe(false);
    expect(shouldScheduleMobileEditorAutosave({ ...ready, dirty: false })).toBe(false);
    expect(shouldScheduleMobileEditorAutosave({ ...ready, active: false })).toBe(false);
  });
});
