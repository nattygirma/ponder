export const isNativeDesktopRuntime = () =>
  Boolean(typeof window !== "undefined" && window.ponderDesktop?.isAvailable);
