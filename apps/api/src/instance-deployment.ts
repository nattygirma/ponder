import {
  resolveDeploymentMethod,
  resolveDeploymentTrigger,
  type DeploymentMetadata,
} from "@ponder/shared/deployment-metadata";
import type { Bindings } from "./api-context";

declare const __PONDER_INSTANCE_DEPLOYMENT_TRIGGER__: string;
declare const __PONDER_INSTANCE_DEPLOYMENT_METHOD__: string;

const bundledTrigger = typeof __PONDER_INSTANCE_DEPLOYMENT_TRIGGER__ !== "undefined"
  ? __PONDER_INSTANCE_DEPLOYMENT_TRIGGER__
  : "";
const bundledMethod = typeof __PONDER_INSTANCE_DEPLOYMENT_METHOD__ !== "undefined"
  ? __PONDER_INSTANCE_DEPLOYMENT_METHOD__
  : "";

export const resolveInstanceDeploymentMetadata = (
  environment: Pick<Bindings, "PONDER_DEPLOYMENT_TRIGGER" | "PONDER_DEPLOYMENT_METHOD">,
): DeploymentMetadata => ({
  trigger: resolveDeploymentTrigger(environment.PONDER_DEPLOYMENT_TRIGGER?.trim() || bundledTrigger),
  method: resolveDeploymentMethod(environment.PONDER_DEPLOYMENT_METHOD?.trim() || bundledMethod),
});

export const resolveDeploymentVersionCreatedAt = (
  environment: Pick<Bindings, "deploymentVersionCreatedAt">,
): string | null => {
  const timestamp = environment.deploymentVersionCreatedAt;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  return new Date(timestamp).toISOString();
};

const normalizeTimestamp = (value: string | undefined): string | null => {
  const timestamp = value?.trim();
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  return new Date(timestamp).toISOString();
};

/**
 * How and when the container image was produced. This is separate from the
 * instance deployment metadata: an image can be deployed long after it was
 * built, and by a different mechanism.
 */
export const resolveImageBuildMetadata = (
  environment: Pick<Bindings, "PONDER_BUILD_CREATED_AT" | "PONDER_BUILD_TRIGGER" | "PONDER_BUILD_METHOD">,
): { buildCreatedAt: string | null; buildProvenance: DeploymentMetadata } => ({
  buildCreatedAt: normalizeTimestamp(environment.PONDER_BUILD_CREATED_AT),
  buildProvenance: {
    trigger: resolveDeploymentTrigger(environment.PONDER_BUILD_TRIGGER?.trim()),
    method: resolveDeploymentMethod(environment.PONDER_BUILD_METHOD?.trim()),
  },
});
