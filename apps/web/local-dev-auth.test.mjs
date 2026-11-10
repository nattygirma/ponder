import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { localDevelopmentAuth } from "./local-dev-auth.ts";

const originalProfile = process.env.PONDER_DEVELOPMENT_PROFILE;
const originalAutoLogin = process.env.PONDER_LOCAL_AUTO_LOGIN;
afterEach(() => {
  if (originalProfile === undefined) delete process.env.PONDER_DEVELOPMENT_PROFILE;
  else process.env.PONDER_DEVELOPMENT_PROFILE = originalProfile;
  if (originalAutoLogin === undefined) delete process.env.PONDER_LOCAL_AUTO_LOGIN;
  else process.env.PONDER_LOCAL_AUTO_LOGIN = originalAutoLogin;
  mock.restore();
});
const setup = (profile = "local", autoLogin = "true") => {
  process.env.PONDER_DEVELOPMENT_PROFILE = profile;
  process.env.PONDER_LOCAL_AUTO_LOGIN = autoLogin;
  const handlers = [];
  const provision = mock(async () => ({ token: "test-token", maxAge: 100 }));
  const plugin = localDevelopmentAuth(provision);
  plugin.configureServer({ middlewares: { use: (handler) => handlers.push(handler) } });
  return { handler: handlers[0], provision, plugin };
};
const request = (headers = {}) => ({
  url: "/api/v1/auth/session", method: "GET", headers: { host: "127.0.0.1:5173", ...headers },
});
const response = () => ({ setHeader: mock(), end: mock() });

describe("local browser auto-login boundary", () => {
  test("is serve-only and absent from remote, demo, plain web and opt-out development", () => {
    for (const profile of ["remote", "demo", ""]) expect(setup(profile).handler).toBeUndefined();
    expect(setup("local", "false").handler).toBeUndefined();
    expect(setup().plugin.apply).toBe("serve");
  });

  test("returns a validated real session with an HttpOnly cookie for a new browser", async () => {
    const { handler, provision } = setup();
    const fetchMock = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ authRequired: true, authenticated: false }))
      .mockResolvedValueOnce(Response.json({ authRequired: true, authenticated: true, user: { id: "usr_real" } }));
    const res = response();
    const next = mock();
    await handler(request(), res, next);
    expect(provision).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: "Bearer test-token" });
    expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("HttpOnly; SameSite=Lax"));
    expect(JSON.parse(res.end.mock.calls[0][0]).user.id).toBe("usr_real");
    expect(next).not.toHaveBeenCalled();
  });

  test("does not replace an existing authenticated account", async () => {
    const { handler, provision } = setup();
    spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ authRequired: true, authenticated: true }));
    await handler(request({ cookie: "ponder_session=existing" }), response(), mock());
    expect(provision).not.toHaveBeenCalled();
  });

  test("does not create sessions for foreign hosts or cross-site requests", async () => {
    const { handler, provision } = setup();
    const fetchMock = spyOn(globalThis, "fetch");
    for (const headers of [{ host: "example.com" }, { origin: "https://example.com" }, { "sec-fetch-site": "cross-site" }]) {
      const next = mock();
      await handler(request(headers), response(), next);
      expect(next).toHaveBeenCalled();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  test("passes logout cookies through and signs back in on the next load", async () => {
    const { handler } = setup();
    spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ ok: true }, { headers: { "Set-Cookie": "ponder_session=; Max-Age=0" } }));
    const res = response();
    await handler({ ...request(), url: "/api/v1/auth/logout", method: "POST" }, res, mock());
    expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", ["ponder_session=; Max-Age=0"]);
  });
});
