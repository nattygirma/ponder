// appkeep.io has no report form yet, so diagnostics are deliberately left out of the link.
const FEEDBACK_URL = "https://appkeep.io";

export type GitHubFeedbackSystemInfoItem = {
  label: string;
  value: string;
};

export const buildGitHubFeedbackUrl = (_report?: unknown) => FEEDBACK_URL;
