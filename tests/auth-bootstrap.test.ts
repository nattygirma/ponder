import { describe, expect, test } from "bun:test";
import {
  isSupportedPasswordHash,
} from "../apps/api/src/auth-bootstrap";

describe("stored password hashes", () => {
  test("distinguishes valid password hashes from plaintext or damaged database values", () => {
    const salt = "AAAAAAAAAAAAAAAAAAAAAA";
    const hash = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    expect(isSupportedPasswordHash(`pbkdf2-sha256$100000$${salt}$${hash}`)).toBe(true);
    expect(isSupportedPasswordHash("admin123")).toBe(false);
    expect(isSupportedPasswordHash("pbkdf2-sha256$100000$broken$broken")).toBe(false);
  });
});
