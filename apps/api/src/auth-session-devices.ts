export const resolveSessionDeviceId = (
  requestedDeviceId: string | undefined,
  userAgent: string | null,
  sessionId: string,
) => requestedDeviceId ?? (userAgent?.trim() ? `legacy-ua:${userAgent}` : `legacy-session:${sessionId}`);
