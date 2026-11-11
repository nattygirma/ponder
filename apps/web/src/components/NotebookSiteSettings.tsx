import { useMutation, useQuery } from "@tanstack/react-query";
import { GA_MEASUREMENT_ID_PATTERN, getMemoDisplayTitle, readNotebookSiteSettings, type NotebookShare, type NotebookSiteTheme } from "@ponder/shared";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiRequestError, getConfiguredDesktopApiBaseUrl, getPublicBaseUrl } from "@/lib/api";
import { resizeFaviconFile } from "@/lib/site-favicon";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { NotebookSiteMemoBrowser } from "./NotebookSiteMemoBrowser";
import { memoNotebookSitesQueryKey } from "./MemoNotebookSites";

export const NotebookSiteSettings = ({ notebookId, share, onSaved }: {
  notebookId: string; share: NotebookShare; onSaved: (data: { share: NotebookShare }) => void;
}) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(() => share.siteSettings ?? readNotebookSiteSettings());
  const [slug, setSlug] = useState(share.siteSlug ?? "");
  const [choosingHome, setChoosingHome] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const faviconInput = useRef<HTMLInputElement>(null);
  const selectedHome = useQuery({
    queryKey: ["notebook-site-home-title", getConfiguredDesktopApiBaseUrl(), notebookId, settings.homeMemoId],
    queryFn: () => api.getMemo(settings.homeMemoId!),
    enabled: Boolean(settings.homeMemoId),
    retry: false,
  });
  const homeSites = useQuery({
    queryKey: memoNotebookSitesQueryKey(settings.homeMemoId ?? ""),
    queryFn: () => api.getMemoNotebookSites(settings.homeMemoId!),
    enabled: Boolean(settings.homeMemoId),
    retry: false,
    staleTime: 0,
  });
  const homeUnavailable = Boolean(settings.homeMemoId) && (
    [selectedHome.error, homeSites.error].some((error) => error instanceof ApiRequestError && error.status === 404)
    || (homeSites.isSuccess && !homeSites.data.sites.some((site) => site.notebookId === notebookId && !site.excluded))
  );
  const homeError = Boolean(settings.homeMemoId) && !homeUnavailable && (selectedHome.isError || homeSites.isError);
  const save = useMutation({
    mutationFn: () => {
      const { homeMemoId, ...otherSettings } = settings;
      return api.updateNotebookSite(notebookId, { siteSlug: slug || null, settings: {
        ...otherSettings,
        ...(homeMemoId !== share.siteSettings?.homeMemoId ? { homeMemoId } : {}),
      } });
    },
    onSuccess: onSaved,
  });
  const label = (key: string) => t(`notebookSite.${key}`);
  const analyticsInvalid = Boolean(settings.gaMeasurementId) && !GA_MEASUREMENT_ID_PATTERN.test(settings.gaMeasurementId ?? "");
  const submit = (event: FormEvent) => { event.preventDefault(); if (!analyticsInvalid) save.mutate(); };
  const edit = (patch: Partial<typeof settings>) => { setSettings((previous) => ({ ...previous, ...patch })); save.reset(); };
  const contact = settings.contactButton ?? { label: "", url: "" };
  const editContact = (patch: Partial<typeof contact>) => {
    const next = { ...contact, ...patch };
    edit({ contactButton: next.label || next.url ? next : null });
  };
  const chooseFavicon = async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await resizeFaviconFile(file);
    setFaviconError(!dataUrl);
    if (dataUrl) edit({ faviconDataUrl: dataUrl });
  };
  const savedSlug = share.siteSlug;
  const sitemapUrl = savedSlug ? `${getPublicBaseUrl().replace(/\/$/, "")}/s/${encodeURIComponent(savedSlug)}/sitemap.xml` : null;
  return <Dialog open={choosingHome} onOpenChange={setChoosingHome}>
      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <h2 className="font-semibold">{label("homepage")}</h2>
          <p className="break-words text-sm text-muted-foreground">{settings.homeMemoId && !homeUnavailable ? (selectedHome.data?.memo ? getMemoDisplayTitle(selectedHome.data.memo.title, t("common.untitledMemo")) : label("homepageSelected")) : label("directory")}</p>
          {homeUnavailable && <p role="status" className="text-xs text-muted-foreground">{label("homepageFallback")}</p>}
          {homeError && <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{t("sharing.error")}</p><Button type="button" size="sm" variant="outline" onClick={() => { void selectedHome.refetch(); void homeSites.refetch(); }}>{t("sharing.retry")}</Button></div>}
          <div className="flex flex-wrap gap-2">
            <DialogTrigger asChild><Button type="button" variant="outline">{label("chooseHomepage")}</Button></DialogTrigger>
            <Button type="button" variant="ghost" disabled={!settings.homeMemoId} onClick={() => edit({ homeMemoId: null })}>{label("useDirectory")}</Button>
          </div>
        </section>
        <section className="grid gap-5 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-6">
          <label className="space-y-2 text-sm">{label("slug")}<Input value={slug} onChange={(event) => { setSlug(event.target.value); save.reset(); }} autoCapitalize="none" /></label>
          <label className="space-y-2 text-sm">{label("logo")}<Input type="url" value={settings.logoUrl ?? ""} onChange={(event) => edit({ logoUrl: event.target.value || null })} /></label>
          <div className="space-y-2 text-sm"><label htmlFor="notebook-site-order">{label("sort")}</label><Select value={settings.sortMode} onValueChange={(value) => edit({ sortMode: value as "existing" | "title" })}><SelectTrigger id="notebook-site-order"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="existing">{label("existingOrder")}</SelectItem><SelectItem value="title">{label("titleOrder")}</SelectItem></SelectContent></Select></div>
          <div className="space-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" disabled={share.passwordProtected} checked={!share.passwordProtected && settings.allowIndexing} onChange={(event) => edit({ allowIndexing: event.target.checked })} />{label("indexing")}</label><p className="text-xs text-muted-foreground">{label("indexingHint")}</p></div>
          <label className="space-y-2 text-sm sm:col-span-2">{label("footer")}<Textarea value={settings.footerText} onChange={(event) => edit({ footerText: event.target.value })} /></label>
          <fieldset className="space-y-3 sm:col-span-2"><legend className="mb-2 text-sm">{label("headerLinks")}</legend>
            {settings.headerLinks.map((link, index) => <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" key={index}>
              <Input aria-label={label("label")} placeholder={label("label")} value={link.label} required onChange={(event) => edit({ headerLinks: settings.headerLinks.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} />
              <Input aria-label={label("url")} placeholder={label("url")} type="url" required value={link.url} onChange={(event) => edit({ headerLinks: settings.headerLinks.map((item, i) => i === index ? { ...item, url: event.target.value } : item) })} />
              <Button type="button" variant="outline" onClick={() => edit({ headerLinks: settings.headerLinks.filter((_, i) => i !== index) })}>{label("remove")}</Button>
            </div>)}
            <Button type="button" variant="outline" onClick={() => edit({ headerLinks: [...settings.headerLinks, { label: "", url: "" }] })}>{label("addLink")}</Button>
          </fieldset>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <h2 className="font-semibold">{label("headerAndTheme")}</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 text-sm"><label htmlFor="notebook-site-theme">{label("siteTheme")}</label><Select value={settings.theme} onValueChange={(value) => edit({ theme: value as NotebookSiteTheme })}><SelectTrigger id="notebook-site-theme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">{label("followVisitor")}</SelectItem><SelectItem value="light">{label("light")}</SelectItem><SelectItem value="dark">{label("dark")}</SelectItem></SelectContent></Select></div>
            <div className="space-y-2 text-sm">
              <span id="notebook-site-favicon-label">{label("favicon")}</span>
              <div className="flex flex-wrap items-center gap-3">
                {settings.faviconDataUrl && <img src={settings.faviconDataUrl} alt="" className="size-8 rounded border bg-background object-contain" />}
                <input ref={faviconInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon" className="sr-only" aria-labelledby="notebook-site-favicon-label" tabIndex={-1} onChange={(event) => { void chooseFavicon(event.target.files?.[0]); event.target.value = ""; }} />
                <Button type="button" variant="outline" size="sm" onClick={() => faviconInput.current?.click()}>{label("uploadFavicon")}</Button>
                {settings.faviconDataUrl && <Button type="button" variant="ghost" size="sm" onClick={() => edit({ faviconDataUrl: null })}>{label("removeFavicon")}</Button>}
              </div>
              <p className="text-xs text-muted-foreground">{label("faviconHint")}</p>
              {faviconError && <p role="alert" className="text-xs text-destructive">{label("faviconError")}</p>}
            </div>
          </div>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm">{label("contactButton")}</legend>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Input aria-label={label("contactLabel")} placeholder={label("contactLabelPlaceholder")} maxLength={40} value={contact.label} required={Boolean(contact.url)} onChange={(event) => editContact({ label: event.target.value })} />
              <Input aria-label={label("contactUrl")} placeholder={label("contactUrl")} value={contact.url} required={Boolean(contact.label)} pattern="(https://|mailto:).+" onChange={(event) => editContact({ url: event.target.value.trim() })} />
            </div>
          </fieldset>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <h2 className="font-semibold">{label("searchAndAnalytics")}</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm sm:col-span-2">{label("siteDescription")}<Textarea maxLength={300} value={settings.description} onChange={(event) => edit({ description: event.target.value })} /><span className="block text-xs text-muted-foreground">{label("siteDescriptionHint")}</span></label>
            <label className="space-y-2 text-sm">{label("ogImage")}<Input type="url" value={settings.ogImageUrl ?? ""} onChange={(event) => edit({ ogImageUrl: event.target.value || null })} /></label>
            <label className="space-y-2 text-sm">{label("analytics")}<Input value={settings.gaMeasurementId ?? ""} placeholder="G-XXXXXXX" autoCapitalize="characters" spellCheck={false} aria-invalid={analyticsInvalid || undefined} aria-describedby="notebook-site-analytics-hint" onChange={(event) => edit({ gaMeasurementId: event.target.value.trim().toUpperCase() || null })} /><span id="notebook-site-analytics-hint" className={analyticsInvalid ? "block text-xs text-destructive" : "block text-xs text-muted-foreground"}>{label(analyticsInvalid ? "analyticsInvalid" : "analyticsHint")}</span></label>
          </div>
          {sitemapUrl && <p className="break-all text-xs text-muted-foreground">{t("notebookSite.sitemapHint", { url: sitemapUrl })}</p>}
        </section>
        <div className="flex flex-wrap items-center gap-4 pb-2">
          <Button type="submit" variant="solid" disabled={save.isPending || analyticsInvalid}>{label("save")}</Button><span className="text-xs text-muted-foreground">{label("saveHint")}</span>
          {save.isSuccess && <p role="status" className="text-sm">{label("saved")}</p>}
          {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        </div>
      </form>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogHeader><DialogTitle>{label("chooseHomepage")}</DialogTitle><DialogDescription>{label("homepageHint")}</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto"><NotebookSiteMemoBrowser notebookId={notebookId} token={share.token} selectedId={settings.homeMemoId} onSelect={(memo) => { edit({ homeMemoId: memo.id }); setChoosingHome(false); }} /></div>
      </DialogContent>
  </Dialog>;
};
