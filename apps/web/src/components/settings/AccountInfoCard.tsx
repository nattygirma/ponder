import { UserRound } from "lucide-react";
import type { AuthUser } from "@ponder/shared";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";

export const AccountInfoCard = ({
  user,
  onLogout,
  isLoggingOut,
}: {
  user: AuthUser | null;
  onLogout: () => void;
  isLoggingOut: boolean;
}) => {
  const { t } = useTranslation();

  if (!user) return null;

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
        <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
          <UserRound className={SETTINGS_CARD_ICON_CLASSNAME} />
          {t("accountInfo.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-3 p-4 pt-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-800">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-normal text-slate-800">
            {user.displayName || user.username}
          </p>
          <p className="truncate text-xs text-slate-500">
            @{user.username} · {t(`users.roles.${user.role}`)}
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" disabled={isLoggingOut} onClick={onLogout}>
          {t(isLoggingOut ? "session.loggingOut" : "session.logout")}
        </Button>
      </CardContent>
    </Card>
  );
};
