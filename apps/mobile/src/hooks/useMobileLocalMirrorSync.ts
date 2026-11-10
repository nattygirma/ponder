import { useCallback, useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { createPonderClient } from "@ponder/client";
import {
  isMobileLocalMirrorInitialized,
  syncMobileLocalMirror,
  type MobileBootstrapProgress,
} from "../lib/local-mirror";

type MobileClient = ReturnType<typeof createPonderClient>;

export const useMobileLocalMirrorSync = ({
  client,
  dataScope,
}: {
  client: MobileClient | null;
  dataScope: string;
}) => {
  const queryClient = useQueryClient();
  const [isInitialStatusPending, setIsInitialStatusPending] = useState(true);
  const [initialSyncProgress, setInitialSyncProgress] = useState<MobileBootstrapProgress | null>(null);
  const [initialSyncError, setInitialSyncError] = useState<unknown>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const retryInitialSync = useCallback(() => setSyncAttempt((attempt) => attempt + 1), []);

  useEffect(() => {
    if (!client) {
      return;
    }

    let active = true;
    const syncMirror = async () => {
      let isInitialSync = false;
      let refreshedNotebooksDuringBootstrap = false;
      try {
        isInitialSync = !(await isMobileLocalMirrorInitialized(dataScope));
        if (active) {
          setIsInitialStatusPending(false);
          setInitialSyncError(null);
          setInitialSyncProgress(isInitialSync ? { loadedCount: 0, totalCount: 0 } : null);
        }
        await syncMobileLocalMirror(client, dataScope, {
          onBootstrapProgress: isInitialSync ? async (progress) => {
            if (!active) {
              return;
            }
            setInitialSyncProgress(progress);
            const invalidations = [
              queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
              queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
            ];
            if (!refreshedNotebooksDuringBootstrap) {
              refreshedNotebooksDuringBootstrap = true;
              invalidations.push(queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }));
            }
            await Promise.all(invalidations);
          } : undefined,
        });
        if (active) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }),
            queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
            queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
          ]);
          setInitialSyncProgress(null);
        }
      } catch (error) {
        if (active && isInitialSync) {
          setInitialSyncProgress(null);
          setInitialSyncError(error);
        }
        // An initialized local mirror remains readable while offline.
      }
    };

    void syncMirror();
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void syncMirror();
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [client, dataScope, queryClient, syncAttempt]);

  return {
    initialSyncError,
    initialSyncProgress,
    isInitialStatusPending,
    retryInitialSync,
  };
};
