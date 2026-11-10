import { join } from "node:path";

export const isMountedInstallerPath = (appPath, platform = process.platform) => {
  if (platform !== "darwin" || typeof appPath !== "string") return false;
  return appPath === "/Volumes" || appPath.startsWith("/Volumes/");
};

export const mountedInstallerCandidates = (volumeNames, volumesDirectory = "/Volumes") => {
  if (!Array.isArray(volumeNames)) return [];
  return volumeNames
    .filter((name) => typeof name === "string" && name.length > 0 && !name.includes("/"))
    .map((name) => {
      const volumePath = join(volumesDirectory, name);
      return {
        volumePath,
        appPath: join(volumePath, "Ponder.app"),
      };
    });
};

export const isMountedDiskImageVolume = (hdiutilOutput, volumePath) => {
  if (typeof hdiutilOutput !== "string" || typeof volumePath !== "string") return false;
  return hdiutilOutput
    .split("\n")
    .some((line) => line.slice(line.lastIndexOf("\t") + 1).trim() === volumePath);
};
