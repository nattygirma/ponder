declare const __PONDER_INSTANCE_BUILD_ID__: string;

const bundledBuildId = typeof __PONDER_INSTANCE_BUILD_ID__ !== "undefined"
  ? __PONDER_INSTANCE_BUILD_ID__
  : "";
const runtimeBuildId = typeof process !== "undefined"
  ? process.env.PONDER_BUILD_ID ?? process.env.GITHUB_SHA ?? ""
  : "";

export const INSTANCE_BUILD_ID = (bundledBuildId || runtimeBuildId).trim() || "unknown";
