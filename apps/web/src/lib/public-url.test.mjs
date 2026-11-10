import { afterEach, describe, expect, test } from "bun:test";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  globalThis.fetch = originalFetch;
});

describe("public links on AppKeep", () => {
  test("use the address the server reports, not the one in the browser", async () => {
    // AppKeep serves the app at ponder.appkeep.app for everyone; this account's copy is shared from its own address.
    globalThis.window = { location: { origin: "https://ponder.appkeep.app", href: "https://ponder.appkeep.app/" }, localStorage: { getItem: () => null } };
    globalThis.fetch = async () => Response.json({
      authRequired: true,
      authenticated: true,
      demoMode: false,
      platformSignIn: { loginUrl: "/_altstack/login", logoutUrl: "/_altstack/logout" },
      publicUrl: "https://ponder-abc123.appkeep.app",
      user: { id: "usr_1", username: "a", displayName: "A", role: "owner" },
    });
    const { api, getPublicBaseUrl } = await import("./api.ts");
    expect(getPublicBaseUrl()).toBe("https://ponder.appkeep.app");
    await api.getSession();
    expect(getPublicBaseUrl()).toBe("https://ponder-abc123.appkeep.app");
    const { getPublicShareUrl } = await import("../components/dialogs/ShareMemoDialog.tsx");
    expect(getPublicShareUrl("note")).toBe("https://ponder-abc123.appkeep.app/share/note");
    const { getMcpRemoteServerUrl } = await import("../components/settings/settings-utils.ts");
    expect(getMcpRemoteServerUrl()).toBe("https://ponder-abc123.appkeep.app/mcp");

    // Off AppKeep the server reports no address, and links fall back to the browser's.
    globalThis.fetch = async () => Response.json({ authRequired: true, authenticated: false, demoMode: false, user: null });
    await api.getSession();
    expect(getPublicBaseUrl()).toBe("https://ponder.appkeep.app");
  });
});
