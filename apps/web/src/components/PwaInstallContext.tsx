import React, { createContext, useContext, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PwaInstallContextType {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  showIOSPrompt: boolean;
  install: () => Promise<boolean>;
  dismissIOSPrompt: () => void;
}

const PwaInstallContext = createContext<PwaInstallContextType | undefined>(undefined);

const IOS_DISMISSED_KEY = "ponder:ios-pwa-dismissed";

export const PwaInstallProvider = ({ children }: { children: React.ReactNode }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  // Detect iOS device
  const isIOS =
    typeof window !== "undefined" &&
    /iPad|iPhone|iPod/.test(window.navigator.userAgent) &&
    !(window as any).MSStream;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Check if currently running in stand-alone mode
    const checkIsInstalled = () => {
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
      setIsInstalled(isStandalone);
      return isStandalone;
    };

    const standalone = checkIsInstalled();

    // Listen to beforeinstallprompt event for Chromium-based browsers
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // If iOS and not running as standalone app, show prompt if not dismissed
    if (isIOS && !standalone) {
      try {
        const dismissed = window.localStorage.getItem(IOS_DISMISSED_KEY) === "true";
        if (!dismissed) {
          setShowIOSPrompt(true);
        }
      } catch {
        // Storage access may be blocked
        setShowIOSPrompt(true);
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [isIOS]);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) {
      return false;
    }
    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === "accepted") {
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } catch (err) {
      console.error("PWA install error:", err);
      return false;
    }
  };

  const dismissIOSPrompt = () => {
    setShowIOSPrompt(false);
    try {
      window.localStorage.setItem(IOS_DISMISSED_KEY, "true");
    } catch {
      // Storage access may be blocked
    }
  };

  return (
    <PwaInstallContext.Provider
      value={{
        isInstallable: !!deferredPrompt,
        isInstalled,
        isIOS,
        showIOSPrompt,
        install,
        dismissIOSPrompt,
      }}
    >
      {children}
    </PwaInstallContext.Provider>
  );
};

export const usePwaInstall = () => {
  const context = useContext(PwaInstallContext);
  if (!context) {
    throw new Error("usePwaInstall must be used within a PwaInstallProvider");
  }
  return context;
};
