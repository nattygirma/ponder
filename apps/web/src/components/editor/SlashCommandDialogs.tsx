import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Database, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Pickers the `/` menu opens: Notion's "Linked view of data source" and the Actions' "Move to". */

type Choice = { id: string; title: string | null; icon: string | null };

const ROW = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none";

const PickerList = ({ choices, empty, fallbackIcon, onPick }: {
  choices: Choice[];
  empty: string;
  fallbackIcon: ReactNode;
  onPick: (choice: Choice) => void;
}) => {
  const { t } = useTranslation();
  if (!choices.length) return <p className="px-2 py-3 text-sm text-slate-500" role="status">{empty}</p>;
  return (
    <div className="max-h-72 overflow-y-auto">
      {choices.map((choice) => (
        <button key={choice.id} type="button" className={ROW} onClick={() => onPick(choice)}>
          <span className="flex w-4 justify-center" aria-hidden="true">{choice.icon ?? fallbackIcon}</span>
          <span className="truncate">{choice.title?.trim() || t("common.untitledMemo")}</span>
        </button>
      ))}
    </div>
  );
};

const matches = (choice: Choice, query: string) => (choice.title ?? "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

export const LinkedDatabaseDialog = ({ databases, onPick, onClose }: {
  databases: Array<Choice & { databaseId: string }>;
  onPick: (databaseId: string) => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = databases.filter((database) => matches(database, query));
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-linked-database-picker>
        <DialogHeader>
          <DialogTitle>{t("pages.slash.linkedTitle")}</DialogTitle>
          <DialogDescription>{t("pages.slash.linkedHint")}</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={query} placeholder={t("pages.db.search")} aria-label={t("pages.db.search")} onChange={(event) => setQuery(event.target.value)} />
        <PickerList
          choices={shown}
          empty={t("pages.slash.linkedEmpty")}
          fallbackIcon={<Database className="h-4 w-4 text-slate-500" />}
          onPick={(choice) => {
            const database = databases.find((item) => item.id === choice.id);
            if (database) onPick(database.databaseId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

export const MoveBlockDialog = ({ pages, onPick, onClose }: {
  pages: Choice[];
  onPick: (memoId: string) => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-move-block-picker>
        <DialogHeader>
          <DialogTitle>{t("pages.slash.moveTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("pages.block.movePlaceholder")}</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={query} placeholder={t("pages.slash.moveSearch")} aria-label={t("pages.slash.moveSearch")} onChange={(event) => setQuery(event.target.value)} />
        <PickerList
          choices={pages.filter((page) => matches(page, query))}
          empty={t("pages.slash.moveEmpty")}
          fallbackIcon={<FileText className="h-4 w-4 text-slate-500" />}
          onPick={(choice) => onPick(choice.id)}
        />
      </DialogContent>
    </Dialog>
  );
};
