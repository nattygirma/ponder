const PASSWORD_HASH_PATTERN = /^pbkdf2-sha256\$(\d+)\$([^$]+)\$([^$]+)$/;

export const isSupportedPasswordHash = (passwordHash: string) => {
  const match = passwordHash.match(PASSWORD_HASH_PATTERN);
  if (!match || Number(match[1]) < 100_000) {
    return false;
  }

  try {
    return decodeBase64Url(match[2]).byteLength === 16 && decodeBase64Url(match[3]).byteLength === 32;
  } catch {
    return false;
  }
};

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
