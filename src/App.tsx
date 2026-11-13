import { ASSIGNMENT, EXAM, loadStudy } from "./lib/study";
import { SIDEBAR_ITEMS, sidebarPalette } from "./components/SettingsModal";
import { loadSrs, scanAll, syncPage } from "./lib/srs";
import { parseImports, pickImportFiles, type ImportedPage, type ImportFailure } from "./lib/importNotes";
import { importOmap } from "./lib/omapFile";
import { StudyHome } from "./components/StudyHome";
import { UpdateUI } from "./components/UpdateUI";
import { SpellUI } from "./components/SpellUI";
import { loadSpell } from "./lib/spell/engine";
import { checkForUpdates, startUpdates } from "./lib/updates";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { OPEN_SEARCH_EVENT, Sidebar } from "./components/Sidebar";
import { ContextMenuHost, type MenuItem } from "./components/ContextMenu";
import { isTextField, textFieldMenu } from "./lib/menus";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Network,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react";
import { TitleBar, type TabInfo } from "./components/TitleBar";
import { PageHeader } from "./components/PageHeader";
import { NeridaDownloadPill, NeridaPanel } from "./components/NeridaPanel";
import { HomeSwitch, NeridaSidebar } from "./components/NeridaHome";
import { NeridaCardsHost } from "./components/NeridaCards";import { NeridaEditUI } from "./components/NeridaEditUI";
import { NeridaOutlineUI } from "./components/NeridaOutlineUI";
import { NERIDA_TASK, type TaskRequest } from "./lib/neridaTask";
import { NERIDA_NOTE, type NoteRequest } from "./lib/neridaPdf";
import { BlockNoteEditor } from "@blocknote/core";
import { schema } from "./editor/schema";
import { withMath, type MdBlock } from "./components/PageEditor";
import { withCards, type SaveCardsDetail } from "./lib/neridaStudy";
import { engine, nerida, useNerida } from "./lib/nerida";
import { PageEditor } from "./components/PageEditor";
import { Toast } from "./components/Toast";
import { SpatialCanvas } from "./components/SpatialCanvas";
import { pageDirectory } from "./editor/pageDirectory";
import { extractLinks } from "./lib/links";
import { getSeedBlocks, isInTrash, subtreeIds, type PageMeta } from "./data/workspace";
import { api, type PageProperties as PageProps, type PageRecord, type WorkspaceRecord } from "./data/api";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CalendarDays } from "lucide-react";
import type { AppView } from "./components/ViewSwitcher";
import { SidebarFooter } from "./components/SidebarFooter";
import { Tooltip } from "./components/Tooltip";
import { prefs } from "./lib/prefs";
import { readFileBytes } from "./lib/fileIO";
import { EmbedInNoteModal } from "./components/EmbedInNoteModal";
import { SearchModal } from "./components/SearchModal";
import { OPEN_EMBED_FILE, saveOpenEditor, type FileEmbedKind } from "./lib/embedSource";
import { AppLoader, AppSwitcher, type AppId } from "./components/AppSwitcher";
import { ImportMetaDialog, type MetaChoice } from "./components/ImportMetaDialog";
type DupChoice = "open" | "copy" | "replace" | "cancel";
import { setBanner } from "./lib/banners";
import { DeleteConfirmHost, loadConfirmDeleteSettings, requestDelete, setOpenProbe } from "./lib/confirmDelete";
import type { OpenItem } from "./components/OpenNowRow";
import { WorkspaceDialog } from "./components/WorkspaceDialog";
import { Modal, ModalButton } from "./components/Modal";
import { PageProperties } from "./components/PageProperties";
import { CalendarView } from "./components/CalendarView";
import { PagePeek } from "./components/PagePeek";
import { SettingsModal, type AppSettings } from "./components/SettingsModal";
import { NamePrompt } from "./components/NamePrompt";
import { LibraryView } from "./components/LibraryView";
import { DocsHome } from "./docs/DocsHome";
import { DocsSidebar } from "./docs/DocsSidebar";
import { DocEditor } from "./docs/DocEditor";
import { docTitle, isDirtyUntitled, loadDocsSettings, newUntitled, useDocs } from "./docs/store";
import { SavePrompt } from "./docs/SavePrompt";
import { SketchHome } from "./sketch/SketchHome";
import { SketchSidebar } from "./sketch/SketchSidebar";
import { SketchEditor } from "./sketch/SketchEditor";
import { isDirtySketch, loadSketchSettings, newSketch, sketchTitle } from "./sketch/store";
import { HomeView } from "./components/HomeView";
import { TagsPanel } from "./components/TagsPanel";
import { isoDate, setTagColors } from "./lib/colors";
import { MindmapGallery } from "./mindmap/MindmapGallery";
import { MindmapView, MINDMAP_SAVED } from "./mindmap/MindmapView";
import { MindmapSidebar } from "./mindmap/MindmapSidebar";
import { createMindmap } from "./mindmap/MindmapGallery";
import type { MindmapRecord } from "./data/api";
import { OPEN_MINDMAP } from "./editor/mindmapBlock";
import { PdfReader } from "./pdf/PdfReader";
import { OPEN_PDF, type PdfTarget } from "./pdf/importPdf";
import { PDF_CHANGED } from "./pdf/pdfjs";
import { SEND_TO_NOTE, type SendToNote } from "./pdf/PdfRef";

/** The pinned Home tab: always first, can't be closed, moved or duplicated. */
const HOME_TAB = "home-tab";
const homeTab = (): Tab => ({ id: HOME_TAB, history: [HOME], index: 0 });
/** Oceanic Mindmap's own pinned Home (its gallery). */
const MM_HOME_TAB = "mindmap-home-tab";
/** Oceanic Docs' pinned Home; its tabs hold `doc:<path>` entries. */
const DOCS_HOME_TAB = "docs-home-tab";
/** Oceanic Sketch's pinned Home; its tabs hold `sketch:<path>` entries. */
const SKETCH_HOME_TAB = "sketch-home-tab";
const PINNED = new Set([HOME_TAB, "mindmap-home-tab", DOCS_HOME_TAB, SKETCH_HOME_TAB]);
const SKETCH = "sketch";
const sketchEntry = (path: string) => `sketch:${path}`;
const isSketchEntry = (id: string) => id === SKETCH || id.startsWith("sketch:");
const DOCS = "docs";
const docEntry = (path: string) => `doc:${path}`;
const isDocEntry = (id: string) => id === DOCS || id.startsWith("doc:");

/** Tab history entries for Oceanic Mindmap: the gallery, or one map. */
const MINDMAPS = "mindmaps";
const mindmapEntry = (id: string) => `mindmap:${id}`;
const LIBRARY = "library";
/** The PDF reader: `pdf:<docId>`, opened from a note's PDF card (back returns to it). */
const pdfEntry = (docId: string) => `pdf:${docId}`;
const isAppEntry = (id: string) => id === HOME || id === LIBRARY || id === MINDMAPS || id.startsWith("mindmap:") || id.startsWith("pdf:") || isDocEntry(id) || isSketchEntry(id);
const mmHomeTab = (): Tab => ({ id: MM_HOME_TAB, history: [MINDMAPS], index: 0 });
const docsHomeTab = (): Tab => ({ id: DOCS_HOME_TAB, history: [DOCS], index: 0 });
const sketchHomeTab = (): Tab => ({ id: SKETCH_HOME_TAB, history: [SKETCH], index: 0 });
/** Each tab belongs to one app: Oceanic (notes) or Oceanic Mindmap. Only the active app's tabs show. */
const appOf = (t: Tab): "notes" | "mindmap" | "docs" | "sketch" =>
  t.id === SKETCH_HOME_TAB || isSketchEntry(currentPage(t))
    ? "sketch"
    : t.id === DOCS_HOME_TAB || isDocEntry(currentPage(t))
    ? "docs"
    : t.id === MM_HOME_TAB || currentPage(t) === MINDMAPS || currentPage(t).startsWith("mindmap:")
      ? "mindmap"
      : "notes";

/** History entry for the Home dashboard (not a page id). */
const HOME = "home";

/** A tab is its own little browser: a stack of visited pages and a cursor. */
type Tab = {
  id: string;
  history: string[];
  index: number;
};

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;

/** Wire format → in-app page. */
const toMeta = (r: PageRecord): PageMeta => ({
  id: r.id,
  icon: r.icon,
  title: r.title,
  pinned: r.isPinned,
  parentId: r.parentId,
  trashedAt: r.archivedAt ? Date.parse(r.archivedAt) : undefined,
  updatedAt: r.updatedAt,
  createdAt: r.createdAt,
  workspaceId: r.workspaceId,
  dueDate: r.dueDate,
  status: r.status,
  tags: r.tags,
});

const DEFAULT_SETTINGS: AppSettings = { userName: "", avatar: "", theme: "dark", accent: "#2383e2", closeToTray: true, startup: "last", homeStyle: "classic", weekStart: "sunday", editorSize: "default", studyChime: true, appLoader: true, sidebarIcons: "subtle", sidebarColors: "" };

/** Recolors Tailwind's sky scale (the app's accent) from one hex value. */
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Puts the resolved theme on <html>; `fade` cross-fades colors for the switch. */
function applyTheme(theme: "dark" | "light", fade: boolean) {
  const html = document.documentElement;
  if (html.dataset.theme === theme) return;
  if (fade) {
    html.classList.add("oc-theme-fade");
    window.setTimeout(() => html.classList.remove("oc-theme-fade"), 200);
  }
  html.dataset.theme = theme;
  // Read by index.html before first paint, so launch never flashes the wrong theme.
  try {
    localStorage.setItem("oceanic.theme", theme);
  } catch {
    /* storage blocked */
  }
}

function applyAccent(hex: string) {
  const root = document.documentElement.style;
  root.setProperty("--color-sky-400", `color-mix(in srgb, ${hex} 75%, white)`);
  root.setProperty("--color-sky-500", hex);
  root.setProperty("--color-sky-600", `color-mix(in srgb, ${hex} 85%, black)`);
}

const SAVE_DELAY = 500;

const tabFor = (pageId: string): Tab => ({ id: uid("tab"), history: [pageId], index: 0 });
const currentPage = (tab: Tab) => tab.history[tab.index];

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const { open: neridaOpen, homeMode } = useNerida();
  // Ctrl+J toggles Nerida's side panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        nerida.toggle();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  /** Live and trashed pages together; the tree helpers tell them apart. */
  const [pages, setPages] = useState<PageMeta[]>([]);
  /** Documents fetched (or edited) so far, keyed by page id. */
  const [docs, setDocs] = useState<Record<string, PartialBlock[]>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railTip, setRailTip] = useState<{ text: string; x: number; y: number } | null>(null);
  /** Document editor, or the workspace-wide spatial canvas. */
  const [view, setView] = useState<AppView>("document");
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("general");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [askName, setAskName] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean | string>(false);
  // Deep links into Settings (e.g. Nerida's model menu → Settings → Nerida AI).
  useEffect(() => {
    const open = (e: Event) => setSettingsOpen((e as CustomEvent<string>).detail || true);
    window.addEventListener("oc-open-settings", open);
    return () => window.removeEventListener("oc-open-settings", open);
  }, []);
  /** Workspace dialog: "new", or the id being edited. */
  const [wsDialog, setWsDialog] = useState<string | null>(null);
  const [wsToDelete, setWsToDelete] = useState<string | null>(null);
  /** Calendar side peek. */
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekCenter, setPeekCenter] = useState(false);
  /** Page ids by last opened, for Home's "Recently visited". */
  const [recent, setRecent] = useState<string[]>([]);
  const [pageFonts, setPageFonts] = useState<Record<string, string>>({});
  const [tagColorMap, setTagColorMap] = useState<Record<string, string>>({});
  const [tagsOpen, setTagsOpen] = useState(false);
  const [savePrompt, setSavePrompt] = useState<{ path: string; proceed: () => void } | null>(null);
  const [tagLibrary, setTagLibrary] = useState<string[]>([]);
  const [metaAsk, setMetaAsk] = useState<{ titles: string[]; existingTags: string[]; newTags: string[]; resolve: (c: MetaChoice) => void } | null>(null);
  const [dupAsk, setDupAsk] = useState<{ title: string; resolve: (c: DupChoice) => void } | null>(null);
  const [mindmapTitles, setMindmapTitles] = useState<Record<string, string>>({});
  const [mindmaps, setMindmaps] = useState<MindmapRecord[]>([]);
  /** Mindmap ids by last opened, for Home's "Maps". */
  const [recentMaps, setRecentMaps] = useState<string[]>([]);
  /** Last visit time per page id / "mindmap:<id>" (Library's "Last visited"). */
  const [visitedAt, setVisitedAt] = useState<Record<string, number>>({});

  // Keep the map list fresh (sidebar, Home) whenever a map is saved, made or deleted.
  useEffect(() => {
    const reload = () =>
      api
        .getAllMindmaps()
        .then((list) => {
          setMindmaps(list);
          keys.current.closeDeletedMaps(new Set(list.map((m) => m.id)));
        })
        .catch(() => {});
    reload();
    window.addEventListener(MINDMAP_SAVED, reload);
    return () => window.removeEventListener(MINDMAP_SAVED, reload);
  }, []);
  const [notice, setNotice] = useState<{ text: string; key: number; action?: { label: string; run: () => void } } | null>(null);
  /** Files an import couldn't read, listed in a small dialog. */
  const [importFailures, setImportFailures] = useState<{ count: number; failed: ImportFailure[] } | null>(null);
  const [prefersDark, setPrefersDark] = useState(systemDark);
  const resolvedTheme = settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
  const themeReady = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    applyTheme(resolvedTheme, themeReady.current);
    themeReady.current = true;
  }, [resolvedTheme, loaded]);
  /** Bumped after every save so backlinks and the canvas refresh. */
  const [linksVersion, setLinksVersion] = useState(0);
  /** The page just moved to Trash, offered back through the Undo toast. */
  const [trashToast, setTrashToast] = useState<{ pageId: string; key: number } | null>(null);

  /* ------------------------------------------------------------- Load */
  useEffect(() => {
    (async () => {
      const [live, trashed, savedTabs, wsList, stored] = await Promise.all([
        api.getPages(),
        api.getTrashedPages(),
        api.getTabs(),
        api.getWorkspaces(),
        api.getSettings(),
      ]);
      const next: AppSettings = {
        userName: stored.userName ?? "",
        theme: stored.theme === "light" || stored.theme === "system" ? stored.theme : "dark",
        accent: stored.accent ?? DEFAULT_SETTINGS.accent,
        closeToTray: stored.closeToTray !== "false",
        startup: stored.startup === "home" || stored.startup === "nerida" ? stored.startup : "last",
        homeStyle: stored.homeStyle === "student" ? "student" : "classic",
        avatar: stored.avatar ?? "",
        weekStart: stored.weekStart === "monday" ? "monday" : "sunday",
        editorSize: stored.editorSize === "small" || stored.editorSize === "large" ? stored.editorSize : "default",
        studyChime: stored.studyChime !== "false",
        appLoader: stored.appLoader !== "false",
        sidebarIcons: stored.sidebarIcons === "richer" || stored.sidebarIcons === "custom" ? stored.sidebarIcons : "subtle",
        sidebarColors: stored.sidebarColors ?? "",
      };
      setSettings(next);
      loadConfirmDeleteSettings(stored);
      applyAccent(next.accent);
      setAskName(!next.userName);
      setWorkspaces(wsList);
      setRecent(JSON.parse(stored.recentPages ?? "[]"));
      setRecentMaps(JSON.parse(stored.recentMindmaps ?? "[]"));
      setVisitedAt(JSON.parse(stored.visitedAt ?? "{}"));
      loadDocsSettings(stored);
      loadSketchSettings(stored);
      loadStudy(stored);
      loadSrs(stored);
      void loadSpell(stored);
      void startUpdates(stored);
      setTagLibrary(JSON.parse(stored.tagLibrary ?? "[]"));
      setPageFonts(JSON.parse(stored.pageFonts ?? "{}"));
      const colors = JSON.parse(stored.tagColors ?? "{}");
      setTagColorMap(colors);
      setTagColors(colors);
      setActiveWorkspaceId(wsList.some((w) => w.id === stored.activeWorkspace) ? stored.activeWorkspace : (wsList[0]?.id ?? "general"));
      const all = [...live, ...trashed].map(toMeta);
      const visible = new Set(all.filter((p) => !isInTrash(all, p)).map((p) => p.id));

      // Restore tabs, dropping pages that no longer exist or sit in Trash.
      let restored: Tab[] = savedTabs.flatMap((t) => {
        if (PINNED.has(t.id)) return [];
        const history = t.history.filter((id) => id !== HOME && id !== LIBRARY && (isAppEntry(id) || visible.has(id)));
        if (!history.length) return [];
        const index = Math.max(0, history.lastIndexOf(t.history[t.historyIndex]));
        return [{ id: t.id, history, index }];
      });
      // Home is pinned first; other tabs follow in their saved order.
      restored = [homeTab(), mmHomeTab(), docsHomeTab(), sketchHomeTab(), ...restored];
      const savedActive = savedTabs.find((t) => t.isActive)?.id;

      setPages(all);
      void scanAll(all.map((p) => p.id));
      let front = restored.find((t) => t.id === savedActive)?.id ?? restored[0]?.id ?? null;
      // "Open on startup: Home" keeps every restored tab and puts Home in front.
      if (next.startup !== "last" || !front) front = HOME_TAB;
      // Home opens in its plain mode unless the user chose Nerida; "last" keeps the remembered mode.
      if (next.startup !== "last") nerida.set({ homeMode: next.startup === "nerida" ? "nerida" : "home" });
      setTabs(restored);
      setActiveTabId(front);
      setLoaded(true);
      // Workspace is up: let the native splash window dismiss itself.
      if (isTauri()) invoke("finish_splash").catch(() => {});
    })().catch((e) => console.error("Failed to load workspace", e));
  }, []);

  /* ------------------------------------------------- Debounced auto-save */
  // Timers read the newest state through refs, so a save always writes the
  // latest title + document no matter when it fires.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const saveTimers = useRef(new Map<string, number>());

  const flushSave = useCallback(async (pageId: string) => {
    window.clearTimeout(saveTimers.current.get(pageId));
    saveTimers.current.delete(pageId);
    const page = pagesRef.current.find((p) => p.id === pageId);
    if (!page) return;
    const doc = docsRef.current[pageId];
    try {
      const updatedAt = doc
        ? await api.savePage(pageId, page.title, JSON.stringify(doc), extractLinks(doc))
        : await api.renamePage(pageId, page.title);
      setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, updatedAt } : p)));
      if (doc) setLinksVersion((v) => v + 1);
    } catch (e) {
      console.error("Save failed", pageId, e);
    }
  }, []);

  const scheduleSave = (pageId: string) => {
    window.clearTimeout(saveTimers.current.get(pageId));
    saveTimers.current.set(pageId, window.setTimeout(() => flushSave(pageId), SAVE_DELAY));
  };

  // Don't lose the last keystrokes when the window closes.
  useEffect(() => {
    const flushAll = () => [...saveTimers.current.keys()].forEach((id) => void flushSave(id));
    window.addEventListener("beforeunload", flushAll);
    return () => window.removeEventListener("beforeunload", flushAll);
  }, [flushSave]);

  /** Stored document for `id`, falling back to the seed for `seedFrom`. */
  const loadBlocks = async (id: string, seedFrom = id) => {
    const page = await api.getPage(id);
    return page?.content ? (JSON.parse(page.content) as PartialBlock[]) : getSeedBlocks(seedFrom);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  /** Library lives inside the Home tab: shown after clicking Library, gone once you leave Home. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  useEffect(() => {
    if (activeTabId !== HOME_TAB) setLibraryOpen(false);
  }, [activeTabId]);
  const activePageId = activeTab ? (activeTab.id === HOME_TAB && libraryOpen ? LIBRARY : currentPage(activeTab)) : null;
  /** Each app (Oceanic, Oceanic Mindmap) shows only its own tabs. */
  const activeApp = activeTab ? appOf(activeTab) : "notes";
  const visibleTabs = tabs.filter((t) => appOf(t) === activeApp);

  useEffect(() => {
    if (!loaded || !activePageId?.startsWith("mindmap:")) return;
    const id = activePageId.slice(8);
    setRecentMaps((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 12);
      api.setSetting("recentMindmaps", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [activePageId, loaded]);

  // Keep the tray's "Recent pages" / "Recent documents" submenus in sync (desktop app only).
  const docsRecent = useDocs().recent;
  const trayRecentKey = recent
    .slice(0, 5)
    .map((id) => pages.find((p) => p.id === id && !p.trashedAt))
    .filter((p): p is PageMeta => !!p)
    .map((p) => `${p.id}\u0000${p.icon} ${p.title || "Untitled"}`)
    .join("\u0001");
  const todayIso = isoDate(new Date());
  const trayTodayKey = pages
    .filter((p) => !p.trashedAt && p.dueDate === todayIso && p.status !== "done")
    .map((p) => `${p.id}\u0000${p.icon} ${p.title || "Untitled"}`)
    .join("\u0001");
  useEffect(() => {
    if (!isTauri() || !loaded) return;
    const items = trayRecentKey ? trayRecentKey.split("\u0001").map((x) => ({ id: x.split("\u0000")[0], title: x.split("\u0000")[1] })) : [];
    const docs = docsRecent.slice(0, 5).map((p) => ({ id: p, title: "📄 " + docTitle(p) }));
    const today = trayTodayKey ? trayTodayKey.split("\u0001").map((x) => ({ id: x.split("\u0000")[0], title: x.split("\u0000")[1] })) : [];
    invoke("set_tray_recent", { items, docs, today }).catch(() => {});
  }, [trayRecentKey, trayTodayKey, loaded, docsRecent.join("|")]);

  const lastNotesTab = useRef<string | null>(null);
  const lastMindmapTab = useRef<string | null>(null);
  const lastDocsTab = useRef<string | null>(null);
  const lastSketchTab = useRef<string | null>(null);
  useEffect(() => {
    if (!activeTab) return;
    if (appOf(activeTab) === "sketch") lastSketchTab.current = activeTab.id;
    else if (appOf(activeTab) === "docs") lastDocsTab.current = activeTab.id;
    else if (appOf(activeTab) === "mindmap") lastMindmapTab.current = activeTab.id;
    else lastNotesTab.current = activeTab.id;
  }, [activeTab?.id]);

  // Remember visits for Home's "Recently visited".
  useEffect(() => {
    if (!loaded || !activePageId || (isAppEntry(activePageId) && !activePageId.startsWith("mindmap:"))) return;
    setVisitedAt((prev) => {
      const next = { ...prev, [activePageId]: Date.now() };
      api.setSetting("visitedAt", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [activePageId, loaded]);
  useEffect(() => {
    if (!loaded || !activePageId || isAppEntry(activePageId)) return;
    setRecent((prev) => {
      const next = [activePageId, ...prev.filter((id) => id !== activePageId)].slice(0, 30);
      api.setSetting("recentPages", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [activePageId, loaded]);

  // Fetch a page's document the first time it is shown.
  useEffect(() => {
    if (!activePageId || isAppEntry(activePageId) || docsRef.current[activePageId]) return;
    loadBlocks(activePageId)
      .then((blocks) => setDocs((prev) => (prev[activePageId] ? prev : { ...prev, [activePageId]: blocks })))
      .catch((e) => console.error("Loading page failed", e));
  }, [activePageId]);

  // Persist the tab strip (order, per-tab history, focus) shortly after changes.
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => {
      api
        .saveTabs(
          tabs.map((tab) => ({
            id: tab.id,
            history: tab.history,
            historyIndex: tab.index,
            isActive: tab.id === activeTabId,
          })),
        )
        .catch((e) => console.error("Saving tabs failed", e));
    }, 300);
    return () => window.clearTimeout(t);
  }, [tabs, activeTabId, loaded]);

  /* ------------------------------------------------------------- Tabs */
  /** Sidebar / search: focus the tab already showing the page, else open a new one. */
  const openPage = (pageId: string) => {
    if (pageId === MINDMAPS) return setActiveTabId(MM_HOME_TAB);
    if (pageId === DOCS) return setActiveTabId(DOCS_HOME_TAB);
    if (pageId === SKETCH) return setActiveTabId(SKETCH_HOME_TAB);
    const existing = tabs.find((t) => currentPage(t) === pageId);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab = tabFor(pageId);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  /** Always a fresh tab (Ctrl/middle-click on a page link). */
  const openInNewTab = (pageId: string) => {
    const tab = tabFor(pageId);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  /** Breadcrumbs and page links: move the active tab to another page, recording history. */
  const navigate = (pageId: string) => {
    // Home lives in its pinned tab; pages opened from Home get their own tab.
    if (pageId === HOME) return setActiveTabId(HOME_TAB);
    if (pageId === MINDMAPS) return setActiveTabId(MM_HOME_TAB);
    if (pageId === DOCS) return setActiveTabId(DOCS_HOME_TAB);
    if (pageId === SKETCH) return setActiveTabId(SKETCH_HOME_TAB);
    if (!activeTab || PINNED.has(activeTab.id)) return openPage(pageId);
    if (currentPage(activeTab) === pageId) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, history: [...t.history.slice(0, t.index + 1), pageId], index: t.index + 1 }
          : t,
      ),
    );
  };

  const step = (delta: -1 | 1) => {
    if (!activeTab) return;
    const index = activeTab.index + delta;
    if (index < 0 || index >= activeTab.history.length) return;
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, index } : t)));
  };

  /** Replace the tab list, keeping a sensible tab focused (the neighbour of a closed one). */
  const setTabsAndFocus = (next: Tab[]) => {
    setTabs(next);
    if (next.some((t) => t.id === activeTabId)) return;
    // Focus the neighbour within the same app (its pinned Home as a last resort).
    const app = activeTab ? appOf(activeTab) : "notes";
    const oldIdx = tabs.filter((t) => appOf(t) === app).findIndex((t) => t.id === activeTabId);
    const same = next.filter((t) => appOf(t) === app);
    setActiveTabId(same[Math.max(0, Math.min(oldIdx, same.length - 1))]?.id ?? (app === "mindmap" ? MM_HOME_TAB : app === "docs" ? DOCS_HOME_TAB : app === "sketch" ? SKETCH_HOME_TAB : HOME_TAB));
  };

  const closeTabNow = (tabId: string) => !PINNED.has(tabId) && setTabsAndFocus(tabs.filter((t) => t.id !== tabId));
  /** Asks "Save changes?" first when the tab holds an unsaved, edited document. */
  const closeTab = (tabId: string) => {
    const page = tabs.find((t) => t.id === tabId);
    const doc = page && currentPage(page).startsWith("doc:") ? currentPage(page).slice(4) : null;
    if (doc && isDirtyUntitled(doc)) setSavePrompt({ path: doc, proceed: () => closeTabNow(tabId) });
    else if (page && currentPage(page).startsWith("sketch:") && isDirtySketch(currentPage(page).slice(7)) && !window.confirm("This sketch hasn't been saved. Close it and lose your drawing?")) return;
    else closeTabNow(tabId);
  };

  const closeOtherTabs = (tabId: string) => {
    const app = appOf(tabs.find((t) => t.id === tabId)!);
    setTabs(tabs.filter((t) => t.id === tabId || PINNED.has(t.id) || appOf(t) !== app));
    setActiveTabId(tabId);
  };

  const closeTabsToRight = (tabId: string) => {
    const app = appOf(tabs.find((t) => t.id === tabId)!);
    const same = tabs.filter((t) => appOf(t) === app);
    const drop = new Set(same.slice(same.findIndex((t) => t.id === tabId) + 1).map((t) => t.id));
    const next = tabs.filter((t) => !drop.has(t.id));
    setTabs(next);
    if (!next.some((t) => t.id === activeTabId)) setActiveTabId(tabId);
  };

  const duplicateTab = (tabId: string) => {
    if (PINNED.has(tabId)) return;
    const idx = tabs.findIndex((t) => t.id === tabId);
    const copy = { ...tabs[idx], id: uid("tab") };
    setTabs([...tabs.slice(0, idx + 1), copy, ...tabs.slice(idx + 1)]);
    setActiveTabId(copy.id);
  };

  /** `toIndex` is a position in the visible strip (the active app's tabs). */
  const moveTab = (fromId: string, toIndex: number) =>
    !PINNED.has(fromId) &&
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === fromId);
      if (!tab) return prev;
      const strip = prev.filter((t) => appOf(t) === appOf(tab));
      const fromIdx = strip.findIndex((t) => t.id === fromId);
      const target = strip[Math.max(1, Math.min(toIndex, strip.length - 1))];
      if (!target || target.id === fromId) return prev;
      const next = prev.filter((t) => t.id !== fromId);
      const at = next.findIndex((t) => t.id === target.id);
      next.splice(fromIdx < toIndex ? at + 1 : at, 0, tab);
      return next;
    });

  /** Drop pages from every tab's history; tabs left with nothing close. */
  const pruneTabs = (gone: Set<string>) => {
    const next: Tab[] = [];
    for (const t of tabs) {
      const kept: string[] = [];
      let index = -1;
      t.history.forEach((id, i) => {
        if (gone.has(id) || kept[kept.length - 1] === id) return;
        kept.push(id);
        if (i <= t.index) index = kept.length - 1;
      });
      if (kept.length || PINNED.has(t.id)) next.push({ ...t, history: kept.length ? kept : t.history, index: Math.max(0, index) });
    }
    setTabsAndFocus(next);
  };

  /* ------------------------------------------------------------- Pages */
  /** Optimistic local update; "Edited just now" shows before the save lands. */
  const patchPage = (pageId: string, patch: Partial<PageMeta>) =>
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, updatedAt: new Date().toISOString(), ...patch } : p)),
    );

  const report = (what: string) => (e: unknown) => console.error(`${what} failed`, e);

  const createPage = async (parentId: string | null, dueDate: string | null = null) => {
    try {
      const page = toMeta(await api.createPage(parentId, activeWorkspaceId, dueDate));
      setPages((prev) => [...prev, page]);
      setDocs((prev) => ({ ...prev, [page.id]: getSeedBlocks(page.id) }));
      // On the calendar a new page opens in the side peek; a new subpage in the centered peek (Notion).
      setPeekCenter(!!parentId && view !== "calendar");
      if (view === "calendar" || parentId) setPeekId(page.id);
      else openPage(page.id);
      return page.id;
    } catch (e) {
      report("Create page")(e);
    }
  };

  /** Import notes (picker or dropped files); Notion exports keep their page tree. */
  const allLivePagesRef = useRef<PageMeta[]>([]);
  /** `fromExplorer`: a double-clicked .ocean — an existing page with that title just opens. */
  const importNotes = async (dropped?: File[], fromExplorer = false) => {
    try {
      const files = dropped
        ? await Promise.all(dropped.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
        : await pickImportFiles();
      if (!files.length) return;
      const { pages: parsed, failed } = await parseImports(files);
      // .ocean notes with date/status/tags: always ask what to bring in.
      const tags = new Set<string>();
      let hasMeta = false;
      const scan = (p: ImportedPage) => {
        if (p.props && (p.props.dueDate || p.props.status || p.props.tags.length)) hasMeta = true;
        p.props?.tags.forEach((t) => tags.add(t));
        p.children.forEach(scan);
      };
      parsed.forEach(scan);
      let keep: Set<string> | null = null; // tags allowed onto pages; null = no properties
      if (hasMeta) {
        const existing = [...tags].filter((t) => tagLibrary.includes(t));
        const fresh = [...tags].filter((t) => !tagLibrary.includes(t));
        const choice = await new Promise<MetaChoice>((resolve) => setMetaAsk({ titles: parsed.map((p) => p.title), existingTags: existing, newTags: fresh, resolve }));
        setMetaAsk(null);
        if (!choice) return;
        if (choice.meta) {
          const colors = Object.assign({}, ...parsed.map((p) => p.tagColors ?? {})) as Record<string, string>;
          choice.newTags.forEach((t) => createTag(t, colors[t] ?? "gray"));
          keep = new Set([...existing, ...choice.newTags]);
        }
      }
      let count = 0;
      const create = async (p: ImportedPage, parentId: string | null): Promise<string> => {
        const rec = await api.createPage(parentId, activeWorkspaceId, null);
        await api.savePage(rec.id, p.title, JSON.stringify(p.blocks), []);
        // Seed the open-document cache too, so the page shows its content at once
        // (and the normal save path re-saves it).
        setDocs((prev) => ({ ...prev, [rec.id]: p.blocks.length ? p.blocks : getSeedBlocks(rec.id) }));
        if (p.icon) api.setPageIcon(rec.id, p.icon).catch(() => {});
        if (p.props && keep) api.setPageProperties(rec.id, { ...p.props, tags: p.props.tags.filter((t) => keep!.has(t)) } as PageProps).catch(() => {});
        if (p.banner) setBanner(rec.id, p.banner);
        count++;
        for (const c of p.children) await create(c, rec.id);
        return rec.id;
      };
      let first: string | null = null;
      // Same title + same content already exists: ask what to do.
      const norm = (t: string) => t.trim().toLowerCase();
      const body = (b: unknown) => JSON.stringify(b, (k, v) => (k === "id" ? undefined : v));
      let opened: string | null = null;
      for (const p of parsed) {
        let existing: PageMeta | undefined;
        for (const x of allLivePagesRef.current.filter((x) => norm(x.title) === norm(p.title)))
          if (body(await loadBlocks(x.id)) === body(p.blocks)) { existing = x; break; }
        if (existing) {
          const c = await new Promise<DupChoice>((resolve) => setDupAsk({ title: p.title || "Untitled", resolve }));
          setDupAsk(null);
          if (c === "open") opened ??= existing.id;
          if (c !== "copy" && c !== "replace") continue;
          if (c === "replace") trashPage(existing.id);
        }
        const id = await create(p, null);
        first ??= id;
      }
      void fromExplorer;
      const list = await api.getPages();
      setPages(list.map(toMeta));
      if (first ?? opened) openPage((first ?? opened)!);
      if (count) setNotice({ text: `Imported ${count} page${count === 1 ? "" : "s"}`, key: Date.now() });
      if (failed.length) setImportFailures({ count, failed });
    } catch (e) {
      report("Import")(e);
      setImportFailures({ count: 0, failed: [{ name: "Import", reason: e instanceof Error ? e.message : String(e) }] });
    }
  };

  /** Student dashboard: a new page with tags/date/title, left closed (returns its id). */
  const createTagged = async (title: string, tags: string[], dueDate: string | null, body?: PartialBlock[]) => {
    try {
      const page = toMeta(await api.createPage(null, activeWorkspaceId, dueDate));
      setPages((prev) => [...prev, { ...page, title, tags, status: "not_started" }]);
      setDocs((prev) => ({ ...prev, [page.id]: body?.length ? body : getSeedBlocks(page.id) }));
      api.setPageProperties(page.id, { dueDate, status: "not_started", tags }).catch(report("Save properties"));
      if (body?.length) api.savePage(page.id, title, JSON.stringify(body), []).catch(report("Save page"));
      else if (title) api.renamePage(page.id, title).catch(report("Rename"));
      return page.id;
    } catch (e) {
      report("Create page")(e);
    }
  };

  /** Sidebar Home row: show Home in the active tab, like Notion. */
  const goHome = () => {
    setLibraryOpen(false);
    setView("document");
    navigate(HOME);
  };
  const newHomeTab = () => {
    setView("document");
    setActiveTabId(activeTab && appOf(activeTab) === "mindmap" ? MM_HOME_TAB : activeTab && appOf(activeTab) === "docs" ? DOCS_HOME_TAB : activeTab && appOf(activeTab) === "sketch" ? SKETCH_HOME_TAB : HOME_TAB);
  };

  const setPageFont = (pageId: string, font: string) =>
    setPageFonts((prev) => {
      const next = { ...prev, [pageId]: font };
      api.setSetting("pageFonts", JSON.stringify(next)).catch(report("Save font"));
      return next;
    });

  /* -------------------------------------------------------------- Tags */
  const editTags = (fn: (tags: string[]) => string[]) => {
    for (const p of pages) {
      if (!p.tags?.length) continue;
      const tags = [...new Set(fn(p.tags))];
      if (tags.join("\u0000") !== p.tags.join("\u0000")) changeProperties(p.id, { ...propsOf(p), tags });
    }
  };
  const renameTag = (from: string, to: string) => {
    editTags((tags) => tags.map((t) => (t === from ? to : t)));
    if (tagColorMap[from]) {
      const { [from]: c, ...rest } = tagColorMap;
      changeTagColor(to, c, rest);
    }
  };
  const deleteTag = (tag: string) => editTags((tags) => tags.filter((t) => t !== tag));
  /** Tag library: tags created in Tags & status (or via "Add new tag"). */
  const createTag = (tag: string, color: string) => {
    setTagLibrary((prev) => {
      const next = prev.includes(tag) ? prev : [...prev, tag];
      api.setSetting("tagLibrary", JSON.stringify(next)).catch(report("Save tags"));
      return next;
    });
    changeTagColor(tag, color);
  };

  const changeTagColor = (tag: string, color: string, base = tagColorMap) => {
    const next = { ...base, [tag]: color };
    setTagColorMap(next);
    setTagColors(next);
    api.setSetting("tagColors", JSON.stringify(next)).catch(report("Save tag color"));
  };

  const changeProperties = (pageId: string, props: PageProps) => {
    patchPage(pageId, props);
    api.setPageProperties(pageId, props).catch(report("Set properties"));
  };

  const propsOf = (p: PageMeta): PageProps => ({ dueDate: p.dueDate ?? null, status: p.status ?? null, tags: p.tags ?? [] });

  /* -------------------------------------------------------- Workspaces */
  const selectWorkspace = (id: string) => {
    setActiveWorkspaceId(id);
    setPeekId(null);
    api.setSetting("activeWorkspace", id).catch(report("Save workspace"));
  };

  const saveWorkspace = async (draft: { name: string; icon: string; color: string }) => {
    try {
      if (wsDialog === "new") {
        const ws = await api.createWorkspace(draft.name, draft.icon, draft.color);
        setWorkspaces((prev) => [...prev, ws]);
        selectWorkspace(ws.id);
      } else if (wsDialog) {
        const id = wsDialog;
        setWorkspaces((prev) => prev.map((w) => (w.id === id ? { ...w, ...draft } : w)));
        await api.updateWorkspace(id, draft.name, draft.icon, draft.color);
      }
    } catch (e) {
      report("Save workspace")(e);
    }
    setWsDialog(null);
  };

  const reorderWorkspaces = (ids: string[]) => {
    setWorkspaces((prev) => ids.map((id) => prev.find((w) => w.id === id)!).filter(Boolean));
    api.reorderWorkspaces(ids).catch(report("Reorder workspaces"));
  };

  const deleteWorkspace = async (id: string) => {
    const fallback = workspaces.find((w) => w.id !== id);
    if (!fallback) return;
    const now = Date.now();
    const inWs = new Set(pages.filter((p) => p.workspaceId === id).map((p) => p.id));
    // Its live top-level pages go to Trash; everything is rehomed to `fallback`.
    const roots = pages.filter((p) => inWs.has(p.id) && !p.trashedAt && !(p.parentId && inWs.has(p.parentId)));
    setPages((prev) =>
      prev.map((p) =>
        inWs.has(p.id)
          ? { ...p, workspaceId: fallback.id, trashedAt: roots.includes(p) ? now : p.trashedAt }
          : p,
      ),
    );
    pruneTabs(new Set([...inWs]));
    setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    if (activeWorkspaceId === id) selectWorkspace(fallback.id);
    api.deleteWorkspace(id, fallback.id).catch(report("Delete workspace"));
  };

  const moveToWorkspace = (pageId: string, workspaceId: string) => {
    const ids = subtreeIds(pages, pageId);
    setPages((prev) => {
      const moved = prev.find((p) => p.id === pageId);
      const rest = prev.filter((p) => p.id !== pageId).map((p) => (ids.has(p.id) ? { ...p, workspaceId } : p));
      return moved ? [...rest, { ...moved, workspaceId, parentId: null }] : rest;
    });
    const ws = workspaces.find((w) => w.id === workspaceId);
    setNotice({ text: `Moved to ${ws?.icon ?? ""} ${ws?.name ?? "workspace"}`, key: Date.now() });
    api.movePageToWorkspace(pageId, workspaceId).catch(report("Move to workspace"));
  };

  /* ---------------------------------------------------------- Settings */
  const changeSettings = (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    if (patch.accent) applyAccent(patch.accent);
    for (const [k, v] of Object.entries(patch)) api.setSetting(k, String(v)).catch(report("Save setting"));
  };

  const togglePin = (pageId: string) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, pinned: !p.pinned } : p)));
    api.togglePinPage(pageId).catch(report("Toggle favorite"));
  };

  const changeTitle = (pageId: string, title: string) => {
    patchPage(pageId, { title });
    scheduleSave(pageId);
  };

  const changeIcon = (pageId: string, icon: string) => {
    patchPage(pageId, { icon });
    api.setPageIcon(pageId, icon).catch(report("Set icon"));
  };

  const changeDoc = (pageId: string, blocks: PartialBlock[]) => {
    setDocs((prev) => ({ ...prev, [pageId]: blocks }));
    patchPage(pageId, {});
    scheduleSave(pageId);
    syncPage(pageId, blocks as never);
  };

  // Nerida flashcards for a note that isn't open in an editor (e.g. test mistakes → cards).
  const changeDocRef = useRef(changeDoc);
  changeDocRef.current = changeDoc;
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent<SaveCardsDetail>).detail;
      setTimeout(async () => {
        if (detail.handled) return;
        detail.handled = true;
        const blocks = docsRef.current[detail.pageId] ?? (await loadBlocks(detail.pageId));
        changeDocRef.current(detail.pageId, withCards(blocks as PartialBlock[], detail.cards) as PartialBlock[]);
      });
    };
    window.addEventListener("oc-nerida-cards", on);
    return () => window.removeEventListener("oc-nerida-cards", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Nerida task card → a new dated note (top level), or a due date on the open note.
  const taskRef = useRef({ createTagged, changeProperties, pages, openPage });
  taskRef.current = { createTagged, changeProperties, pages, openPage };
  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<TaskRequest>).detail;
      const { createTagged, changeProperties, pages } = taskRef.current;
      const page = r.target === "current" ? pages.find((p) => p.id === r.pageId) : null;
      if (page) {
        const tags = r.tag && !page.tags?.includes(r.tag) ? [...(page.tags ?? []), r.tag] : page.tags ?? [];
        changeProperties(page.id, { dueDate: r.dueDate, status: page.status ?? "not_started", tags });
      } else void createTagged(r.title, r.tag ? [r.tag] : [], r.dueDate);
    };
    window.addEventListener(NERIDA_TASK, on);
    return () => window.removeEventListener(NERIDA_TASK, on);
  }, []);

  // Nerida makes a note (PDF summary, PDF flashcards); `reuse` finds one with the same title first.
  useEffect(() => {
    const on = async (e: Event) => {
      const r = (e as CustomEvent<NoteRequest>).detail;
      const { createTagged, pages, openPage } = taskRef.current;
      const same = r.reuse && pages.find((p) => !p.trashedAt && p.title.trim().toLowerCase() === r.title.trim().toLowerCase());
      if (same) return r.done(same.id);
      const body = r.markdown ? (withMath(BlockNoteEditor.create({ schema }).tryParseMarkdownToBlocks(r.markdown) as unknown as MdBlock[]) as unknown as PartialBlock[]) : undefined;
      const id = await createTagged(r.title, [], null, body);
      if (!id) return;
      r.done(id);
      if (r.open) openPage(id);
    };
    window.addEventListener(NERIDA_NOTE, on);
    return () => window.removeEventListener(NERIDA_NOTE, on);
  }, []);

  /** Copy of the page and its content (no sub-pages), placed right after it. */
  const duplicatePage = async (pageId: string) => {
    try {
      // The copy takes what's on screen, even if the debounced save hasn't run.
      const doc = docsRef.current[pageId];
      const copy = toMeta(
        await api.duplicatePage(pageId, doc ? JSON.stringify(doc) : null, doc ? extractLinks(doc) : null),
      );
      const copyDoc = doc ?? (await loadBlocks(copy.id, pageId));
      setPages((prev) => {
        const idx = prev.findIndex((p) => p.id === pageId);
        return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      });
      setDocs((prev) => ({ ...prev, [copy.id]: copyDoc }));
      openPage(copy.id);
    } catch (e) {
      report("Duplicate")(e);
    }
  };

  /** Soft delete: the page (and its sub-pages) leave the tree and every tab. */
  const trashPage = (pageId: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, trashedAt: Date.now() } : p)),
    );
    pruneTabs(subtreeIds(pages, pageId));
    setTrashToast({ pageId, key: Date.now() });
    api.deletePage(pageId).catch(report("Move to Trash"));
  };

  /** Notes' Delete: through Settings → Deleting (confirm unless turned off). */
  const askTrashPage = (pageId: string) =>
    requestDelete({ app: "notes", kind: "trash", title: pages.find((p) => p.id === pageId)?.title ?? "", run: () => trashPage(pageId) });

  const restorePage = (pageId: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, trashedAt: undefined } : p)),
    );
    api.restorePage(pageId).catch(report("Restore"));
  };

  const deleteForever = (pageId: string) => {
    const gone = subtreeIds(pages, pageId);
    gone.forEach((id) => {
      window.clearTimeout(saveTimers.current.get(id));
      saveTimers.current.delete(id);
    });
    setPages((prev) => prev.filter((p) => !gone.has(p.id)));
    setDocs((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !gone.has(id))));
    if (trashToast && gone.has(trashToast.pageId)) setTrashToast(null);
    api.deletePageForever(pageId).catch(report("Delete forever"));
  };

  const restoreAll = () => pages.filter((p) => p.trashedAt).forEach((p) => restorePage(p.id));

  /** Empty Trash. Pages nested under another trashed page go with it, so only the roots are deleted. */
  const emptyTrash = () => {
    const trashed = pages.filter((p) => p.trashedAt);
    const nested = new Set(
      trashed.flatMap((t) => [...subtreeIds(pages, t.id)].filter((id) => id !== t.id)),
    );
    trashed.filter((p) => !nested.has(p.id)).forEach((p) => deleteForever(p.id));
  };

  /**
   * Sidebar drag & drop: nest under `parentId` (null = top level) at `position`
   * among its live children. Sibling order is the array order, so the page is
   * spliced in next to its new siblings.
   */
  const movePage = (pageId: string, parentId: string | null, position: number) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    if (parentId && subtreeIds(pages, pageId).has(parentId)) return;

    const rest = pages.filter((p) => p.id !== pageId);
    const siblings = rest.filter((p) => p.parentId === parentId && !p.trashedAt);
    const moved = { ...page, parentId, updatedAt: new Date().toISOString() };
    const anchor = siblings[position];
    const at = anchor
      ? rest.indexOf(anchor)
      : siblings.length
        ? rest.indexOf(siblings[siblings.length - 1]) + 1
        : rest.length;
    setPages([...rest.slice(0, at), moved, ...rest.slice(at)]);

    api
      .updatePageParent(pageId, parentId, position)
      .then((updatedAt) =>
        setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, updatedAt } : p))),
      )
      .catch(report("Move page"));
  };

  /* ------------------------------------------------------- Keyboard shortcuts */
  // Handlers change every render; the listener reads the latest through a ref.
  const openMindmap = (id: string) => openPage(mindmapEntry(id));
  /** A deleted mindmap's tabs close (focus moves to a neighbour). */
  const closeDeletedMaps = (existing: Set<string>) => {
    const gone = new Set(
      tabs.flatMap((t) => t.history).filter((id) => id.startsWith("mindmap:") && !existing.has(id.slice(8))),
    );
    if (gone.size) pruneTabs(gone);
  };
  /** Ctrl+Shift+M: the item being embedded, with its finished block. */
  const [embedding, setEmbedding] = useState<{ name: string; block: PartialBlock; ref: string } | null>(null);
  /** Search for Docs, Sketch and Mindmap; Notes keeps the one in its Sidebar. */
  const [appSearchOpen, setAppSearchOpen] = useState(false);
  const startEmbed = async () => {
    const id = activePageId;
    if (id?.startsWith("mindmap:")) {
      const mindmapId = id.slice(8);
      const map = await api.getMindmapById(mindmapId);
      if (!map) return;
      setEmbedding({ name: map.title, ref: mindmapId, block: { type: "mindmapEmbed", props: { mindmapId, name: map.title } } as never });
      return;
    }
    const kind: FileEmbedKind | null = id?.startsWith("doc:") ? "doc" : id?.startsWith("sketch:") ? "sketch" : null;
    if (!kind) return;
    // Saving a new item opens Save As; cancelling it cancels the embed.
    const path = await saveOpenEditor();
    if (!path) return;
    const name = kind === "doc" ? docTitle(path) : sketchTitle(path);
    setEmbedding({ name, ref: path, block: { type: "fileEmbed", props: { kind, path, name } } as never });
  };
  const embedInto = async (noteId: string, created = false) => {
    const item = embedding;
    if (!item) return;
    setEmbedding(null);
    try {
      const blocks = created ? [] : (docsRef.current[noteId] ?? (await loadBlocks(noteId)));
      const already = blocks.some((b) => b.type === item.block.type && JSON.stringify(b.props ?? {}).includes(JSON.stringify(item.ref)));
      changeDoc(noteId, [...blocks, item.block, { type: "paragraph" }]);
      setNotice({
        text: already ? `Embedded “${item.name}” again (that note already had it)` : `Embedded “${item.name}”`,
        key: Date.now(),
        action: { label: "Open note", run: () => keys.current.openPage(noteId) },
      });
    } catch (e) {
      report("Embed in note")(e);
    }
  };
  const createNoteForEmbed = async (title: string, parentId: string | null) => {
    try {
      const page = toMeta(await api.createPage(parentId, activeWorkspaceId, null));
      if (title) await api.renamePage(page.id, title);
      setPages((prev) => [...prev, { ...page, title }]);
      await embedInto(page.id, true);
    } catch (e) {
      report("Create note for embed")(e);
    }
  };
  const newInApp = () => {
    if (activeApp === "mindmap") void createMindmap("").then((id) => keys.current.navigate(mindmapEntry(id)));
    else if (activeApp === "docs") openPage(docEntry(newUntitled()));
    else if (activeApp === "sketch") openPage(sketchEntry(newSketch(1280, 720)));
    else void createPage(null);
  };
  const keys = useRef({ importNotes, openPage, createPage, newHomeTab, closeTab, step, tabs: visibleTabs, activeTabId, setActiveTabId, openMindmap, closeDeletedMaps, navigate, activePageId, activeApp, startEmbed, newInApp });
  keys.current = { importNotes, openPage, createPage, newHomeTab, closeTab, step, tabs: visibleTabs, activeTabId, setActiveTabId, openMindmap, closeDeletedMaps, navigate, activePageId, activeApp, startEmbed, newInApp };
  // Flashcard "Open in note": open the page; PageEditor scrolls to the block.
  useEffect(() => {
    const on = (e: Event) => keys.current.openPage((e as CustomEvent<{ pageId: string }>).detail.pageId);
    window.addEventListener("oc-open-block", on);
    return () => window.removeEventListener("oc-open-block", on);
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const { kind, path } = (e as CustomEvent<{ kind: FileEmbedKind; path: string }>).detail;
      setView("document");
      keys.current.openPage(kind === "doc" ? docEntry(path) : sketchEntry(path));
    };
    window.addEventListener(OPEN_EMBED_FILE, on);
    return () => window.removeEventListener(OPEN_EMBED_FILE, on);
  }, []);

  // PDF cards, `p. N` chips and search hits open the reader in the current tab.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { docId } = (e as CustomEvent<PdfTarget>).detail;
      setView("document");
      if (keys.current.activePageId !== pdfEntry(docId)) keys.current.navigate(pdfEntry(docId));
    };
    window.addEventListener(OPEN_PDF, onOpen);
    return () => window.removeEventListener(OPEN_PDF, onOpen);
  }, []);
  // Reader → "Send to note": a quote block with a `p. N` chip, appended to the
  // note the reader was opened from (else any open note holding that PDF).
  const sendQuote = useRef<(q: SendToNote) => void>(() => {});
  sendQuote.current = (q) => {
    const back = activeTab ? activeTab.history.slice(0, activeTab.index).reverse() : [];
    const holds = (id: string) => JSON.stringify(docsRef.current[id] ?? "").includes(q.docId);
    const isNote = (id: string) => !isAppEntry(id) && pages.some((p) => p.id === id);
    const target = back.find((id) => isNote(id) && holds(id)) ?? back.find(isNote) ?? Object.keys(docsRef.current).find(holds);
    const page = target && pages.find((p) => p.id === target);
    if (!target || !page) return;
    const quote = {
      type: "quote",
      content: [
        { type: "text", text: `“${q.text}” `, styles: {} },
        { type: "pdfRef", props: { docId: q.docId, page: q.page, annotationId: q.annotationId } },
      ],
    } as PartialBlock;
    // The note may not be loaded yet (e.g. the app restarted on the reader tab).
    void (async () => {
      const blocks = docsRef.current[target] ?? (await loadBlocks(target));
      changeDoc(target, [...blocks, quote]);
    })().catch(report("Send to note"));
    q.result = page.title || "Untitled";
  };
  useEffect(() => {
    const on = (e: Event) => sendQuote.current((e as CustomEvent<SendToNote>).detail);
    window.addEventListener(SEND_TO_NOTE, on);
    return () => window.removeEventListener(SEND_TO_NOTE, on);
  }, []);
  /** PDF names for reader tabs. */
  const [pdfTitles, setPdfTitles] = useState<Record<string, string>>({});
  const pdfIds = tabs.flatMap((t) => t.history).filter((id) => id.startsWith("pdf:")).map((id) => id.slice(4));
  const loadPdfTitle = (id: string) =>
    void api.getPdfDoc(id).then((d) => d && setPdfTitles((prev) => (prev[id] === d.name ? prev : { ...prev, [id]: d.name }))).catch(() => {});
  useEffect(() => pdfIds.filter((id) => !(id in pdfTitles)).forEach(loadPdfTitle), [pdfIds.join()]);
  useEffect(() => {
    const on = (e: Event) => loadPdfTitle((e as CustomEvent<string>).detail);
    window.addEventListener(PDF_CHANGED, on);
    return () => window.removeEventListener(PDF_CHANGED, on);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setView("document");
      keys.current.openMindmap((e as CustomEvent<string>).detail);
    };
    window.addEventListener(OPEN_MINDMAP, onOpen);
    return () => window.removeEventListener(OPEN_MINDMAP, onOpen);
  }, []);

  // Tray menu → "New page" (the window is shown first on the Rust side).
  useEffect(() => {
    if (!isTauri()) return;
    // Tray menu actions (the Rust side shows the window first).
    const off = listen<string>("tray-action", ({ payload }) => {
      setView("document");
      const k = keys.current;
      if (payload === "new_page") k.createPage(null);
      else if (payload === "mindmap") k.setActiveTabId(MM_HOME_TAB);
      else if (payload === "docs") k.setActiveTabId(DOCS_HOME_TAB);
      else if (payload === "sketch") k.setActiveTabId(SKETCH_HOME_TAB);
      else if (payload === "new_doc") k.openPage(docEntry(newUntitled()));
      else if (payload === "new_sketch") k.openPage(sketchEntry(newSketch(1280, 720)));
      else if (payload === "new_mindmap") void createMindmap("").then((id) => k.openPage(mindmapEntry(id)));
      else if (payload === "settings") setSettingsOpen(true);
      else if (payload === "nerida") nerida.set({ open: true });
      else if (payload === "check_updates") void checkForUpdates(true);
      else if (payload === "calendar") (k.setActiveTabId(HOME_TAB), setView("calendar"));
      else if (payload === "search") {
        k.setActiveTabId(HOME_TAB);
        window.setTimeout(() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)), 50);
      }
    });
    // .ocean / .omap opened from Explorer (at launch or while running).
    const openFile = async (path: string) => {
      const bytes = await readFileBytes(path);
      const name = path.split(/[\\/]/).pop()!;
      setView("document");
      if (/\.omap$/i.test(path)) {
        const r = await importOmap(bytes);
        keys.current.openPage(mindmapEntry(r.id));
        if (r.existing) setNotice({ text: `“${r.title}” is already in Oceanic, so the existing map was opened`, key: Date.now() });
      }
      else void keys.current.importNotes([new File([bytes as BlobPart], name)], true);
    };
    void engine.status().then((s) => s.lite_removed && setNotice({
      text: "Nerida Lite is discontinued and was removed from this PC. Nerida AI is now the only built-in model.",
      key: Date.now(),
    })).catch(() => {});
    void invoke<string | null>("launch_file").then((p) => { if (p) void openFile(p); }).catch(() => {});
    const offFile = listen<string>("open-file", ({ payload }) => void openFile(payload));
    const offPage = listen<string>("tray-open-page", ({ payload }) => {
      setView("document");
      k_open(payload);
    });
    const k_open = (id: string) => keys.current.openPage(id);
    return () => {
      void off.then((f) => f());
      void offPage.then((f) => f());
      void offFile.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Universal keys work in every app, even while typing, but wait for modals.
      if (document.querySelector("[data-oc-modal]")) return;
      const k = keys.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Docs and Sketch editors run their own Ctrl+N (new document, new canvas dialog).
      const editorNew = k.activePageId?.startsWith("doc:") || k.activePageId?.startsWith("sketch:");
      const focusAt = (i: number) => {
        const t = k.tabs[(i + k.tabs.length) % k.tabs.length];
        if (t) k.setActiveTabId(t.id);
      };
      const activeIdx = k.tabs.findIndex((t) => t.id === k.activeTabId);

      if (mod && e.key === "\\") setSidebarCollapsed((v) => !v);
      else if (mod && !e.shiftKey && e.key.toLowerCase() === "t") k.newHomeTab();
      else if (mod && !e.shiftKey && key === "k") {
        if (k.activeApp === "notes") window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
        else setAppSearchOpen(true);
      }
      else if (mod && !e.shiftKey && e.key === ",") setSettingsOpen(true);
      else if (mod && e.shiftKey && key === "m") {
        if (k.activeApp === "notes") return;
        void k.startEmbed().catch((err) => console.error("Embed in note failed", err));
      }
      else if (mod && key === "n") {
        if (editorNew) return;
        k.newInApp();
      }
      else if (mod && e.key.toLowerCase() === "w") k.activeTabId && k.closeTab(k.activeTabId);
      else if (mod && e.key === "Tab") focusAt(activeIdx + (e.shiftKey ? -1 : 1));
      else if (mod && !e.altKey && /^[1-9]$/.test(e.key))
        focusAt(e.key === "9" ? k.tabs.length - 1 : Number(e.key) - 1);
      else if ((e.altKey && e.key === "ArrowLeft") || (mod && e.key === "[")) k.step(-1);
      else if ((e.altKey && e.key === "ArrowRight") || (mod && e.key === "]")) k.step(1);
      else return;
      e.preventDefault();
      // Editors listen on window too; a handled key must not reach them.
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  /* ------------------------------------------------------------- Derived */
  const allLivePages = pages.filter((p) => !isInTrash(pages, p));
  /** The sidebar tree and the canvas only show the active workspace. */
  allLivePagesRef.current = allLivePages;
  const livePages = allLivePages.filter((p) => p.workspaceId === activeWorkspaceId);
  const trashedPages = pages
    .filter((p) => p.trashedAt)
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
  const activePage = allLivePages.find((p) => p.id === activePageId) ?? null;
  // Student tags exist from the start (Home widgets + Calendar chips use them).
  useEffect(() => {
    if (!loaded) return;
    if (!tagLibrary.includes(ASSIGNMENT)) createTag(ASSIGNMENT, "blue");
    if (!tagLibrary.includes(EXAM)) createTag(EXAM, "red");
  }, [loaded]);
  const propertiesFor = (p: PageMeta) => (
    <PageProperties value={propsOf(p)} onChange={(v) => changeProperties(p.id, v)} library={tagLibrary} onCreateTag={createTag} />
  );

  const peekPage = peekId ? (allLivePages.find((p) => p.id === peekId) ?? null) : null;

  // Peeked pages load their document the same way tabs do.
  useEffect(() => {
    if (!peekId || docsRef.current[peekId]) return;
    loadBlocks(peekId)
      .then((blocks) => setDocs((prev) => (prev[peekId] ? prev : { ...prev, [peekId]: blocks })))
      .catch((e) => console.error("Loading page failed", e));
  }, [peekId]);
  const tabInfos: TabInfo[] = visibleTabs.flatMap((t) => {
    if (currentPage(t) === HOME) return [{ tabId: t.id, icon: "logo", title: "Home", pinned: t.id === HOME_TAB }];
    if (currentPage(t) === LIBRARY) return [{ tabId: t.id, icon: "📚", title: "Library" }];
    if (currentPage(t) === SKETCH) return [{ tabId: t.id, icon: "sketch-logo", title: "Sketch Home", pinned: t.id === SKETCH_HOME_TAB }];
    if (currentPage(t).startsWith("sketch:")) return [{ tabId: t.id, icon: "sketch-logo", title: sketchTitle(currentPage(t).slice(7)) }];
    if (currentPage(t) === DOCS) return [{ tabId: t.id, icon: "docs-logo", title: "Docs Home", pinned: t.id === DOCS_HOME_TAB }];
    if (currentPage(t).startsWith("doc:")) return [{ tabId: t.id, icon: "docs-logo", title: docTitle(currentPage(t).slice(4)) }];
    if (currentPage(t) === MINDMAPS)
      return [{ tabId: t.id, icon: "mindmap-logo", title: "Mindmap Home", pinned: t.id === MM_HOME_TAB }];
    if (currentPage(t).startsWith("mindmap:"))
      return [{ tabId: t.id, icon: "mindmap-logo", title: mindmapTitles[currentPage(t).slice(8)] || mindmaps.find((m) => m.id === currentPage(t).slice(8))?.title || "Mindmap" }];
    if (currentPage(t).startsWith("pdf:")) return [{ tabId: t.id, icon: "📕", title: pdfTitles[currentPage(t).slice(4)] || "PDF" }];
    const page = pages.find((p) => p.id === currentPage(t));
    return page ? [{ tabId: t.id, icon: page.icon, title: page.title || "Untitled" }] : [];
  });

  // Link chips read titles/icons from the directory and navigate through it.
  const navRef = useRef({ navigate, openInNewTab });
  navRef.current = { navigate, openInNewTab };
  const directoryKey = allLivePages.map((p) => `${p.id}\u0000${p.icon}\u0000${p.title}`).join("\u0001");
  useEffect(() => {
    pageDirectory.set(allLivePages, (id, newTab) => {
      setView("document");
      if (newTab) navRef.current.openInNewTab(id);
      else navRef.current.navigate(id);
    });
  }, [directoryKey]);

  /** Oceanic Mindmap acts as its own app: its own sidebar while a map tab is in front. */
  // Like Word: the sidebar hides while a document is open, and returns elsewhere (Ctrl+\\ still toggles).
  // Docs and Sketch editors are full-window like Word/Paint: no Oceanic top bar or sidebar.
  /** Files of one app still open in background tabs, for its Home's "Open now" row. */
  const openNow = (prefix: string, title: (page: string) => string): OpenItem[] =>
    tabs.filter((t) => currentPage(t).startsWith(prefix)).map((t) => ({ tabId: t.id, title: title(currentPage(t)) }));
  /** Sidebar "More apps": jump to an app's last tab (or its Home), behind a short loader. */
  const [appLoading, setAppLoading] = useState<AppId | null>(null);
  /** Bumped as the loader fades: Homes remount so their intro plays where you can see it. */
  const [homeKey, setHomeKey] = useState(0);
  const appRoot = useRef<HTMLDivElement>(null);
  const switchApp = (app: AppId) => {
    const doc = activePageId?.startsWith("doc:") ? activePageId.slice(4) : null;
    if (doc && isDirtyUntitled(doc)) return setSavePrompt({ path: doc, proceed: () => go(app) });
    go(app);
  };
  const go = (app: AppId) => {
    setView("document");
    setActiveTabId(
      app === "notes" ? (lastNotesTab.current ?? HOME_TAB)
      : app === "docs" ? (lastDocsTab.current ?? DOCS_HOME_TAB)
      : app === "sketch" ? (lastSketchTab.current ?? SKETCH_HOME_TAB)
      : (lastMindmapTab.current ?? MM_HOME_TAB),
    );
    if (settings.appLoader) setAppLoading(app);
  };
  const footerFor = (app: AppId) => (
    <>
      <AppSwitcher current={app} onSwitch={switchApp} />
      {sidebarFooter}
    </>
  );
  // Preferences read outside props (calendar maths, timer chime, editor CSS).
  prefs.weekStart = settings.weekStart === "monday" ? 1 : 0;
  prefs.chime = settings.studyChime;
  useEffect(() => void (document.documentElement.dataset.editorSize = settings.editorSize), [settings.editorSize]);
  useEffect(() => {
    const pal = sidebarPalette(settings);
    for (const [k] of SIDEBAR_ITEMS) document.documentElement.style.setProperty(`--oc-ic-${k}`, pal?.[k] ?? "");
  }, [settings.sidebarIcons, settings.sidebarColors]);
  setOpenProbe((entry) => tabs.some((t) => currentPage(t) === entry));
  const neridaHome = homeMode === "nerida" && view === "document" && activePageId === HOME;
  const inDocEditor = view === "document" && (!!activePageId?.startsWith("doc:") || !!activePageId?.startsWith("sketch:") || !!activePageId?.startsWith("mindmap:"));
  useEffect(() => setSidebarCollapsed(inDocEditor), [inDocEditor]);
  const inDocsApp = view === "document" && !!activePageId && isDocEntry(activePageId);
  const inSketchApp = view === "document" && !!activePageId && isSketchEntry(activePageId);
  const inMindmapApp = view === "document" && !!activePageId && (activePageId === MINDMAPS || activePageId.startsWith("mindmap:"));
  const sidebarFooter = (
    <SidebarFooter
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      userName={settings.userName}
      avatar={settings.avatar}
      theme={resolvedTheme}
      onSelectWorkspace={selectWorkspace}
      onNewWorkspace={() => setWsDialog("new")}
      onEditWorkspace={setWsDialog}
      onDeleteWorkspace={setWsToDelete}
      onReorderWorkspaces={reorderWorkspaces}
      onOpenSettings={(page?: string) => setSettingsOpen(page || true)}
      onToggleTheme={() => changeSettings({ theme: resolvedTheme === "dark" ? "light" : "dark" })}
    />
  );

  return (
    <div ref={appRoot} className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      {!inDocEditor && (
      <TitleBar
        tabs={tabInfos}
        activeTabId={activeTabId}
        sidebarCollapsed={sidebarCollapsed}
        canGoBack={!!activeTab && activeTab.index > 0}
        canGoForward={!!activeTab && activeTab.index < activeTab.history.length - 1}
        onBack={() => step(-1)}
        onForward={() => step(1)}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onCloseOtherTabs={closeOtherTabs}
        onCloseTabsToRight={closeTabsToRight}
        onDuplicateTab={duplicateTab}
        onMoveTab={moveTab}
        onNewTab={async () =>
          activeApp === "mindmap" ? openPage(mindmapEntry(await createMindmap(""))) : createPage(null)
        }
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      />
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {/* ---- Navigation sidebar: full, compact icon card, or hidden in the editor ---- */}
        <div
          onClickCapture={(e) => {
            // Compact: clicking the header logo expands the sidebar.
            if (sidebarCollapsed && (e.target as Element).closest("aside > div:first-child")) {
              e.stopPropagation();
              setSidebarCollapsed(false);
            }
          }}
          onMouseOver={(e) => {
            // Compact: icons have no visible label, so show it in a custom tooltip.
            const b = sidebarCollapsed ? (e.target as Element).closest("button, a") : null;
            if (!b) return setRailTip(null);
            if (b.hasAttribute("title")) (b.setAttribute("data-tip", b.getAttribute("title")!), b.removeAttribute("title"));
            const text = b.querySelector("span:not(.oc-keep)")?.textContent?.trim() || b.getAttribute("data-tip");
            const r = b.getBoundingClientRect();
            setRailTip(text ? { text, x: r.right + 10, y: r.top + r.height / 2 } : null);
          }}
          onMouseLeave={() => setRailTip(null)}
          className={`h-full min-w-0 shrink-0 overflow-clip transition-all duration-200 ease-in-out ${
            // Inside a note or editor, collapsing hides the sidebar fully; Home keeps the compact card.
            sidebarCollapsed && (inDocEditor || (view === "document" && !!activePage)) ? "max-w-0" : "max-w-[480px]"
          } oc-sidebar-wrap ${sidebarCollapsed ? "oc-compact" : ""}`}
        >
          {inSketchApp ? (
            <SketchSidebar
              activePath={activePageId?.startsWith("sketch:") ? activePageId.slice(7) : null}
              onOpen={(p) => openPage(sketchEntry(p))}
              onHome={() => setActiveTabId(SKETCH_HOME_TAB)}
              onOpenNewTab={(p) => openInNewTab(sketchEntry(p))}
              footer={footerFor("sketch")}
            />
          ) : inDocsApp ? (
            <DocsSidebar
              activePath={activePageId?.startsWith("doc:") ? activePageId.slice(4) : null}
              onOpen={(p) => openPage(docEntry(p))}
              onHome={() => setActiveTabId(DOCS_HOME_TAB)}
              onOpenNewTab={(p) => openInNewTab(docEntry(p))}
              onRenamed={(from, to) =>
                setTabs((prev) => prev.map((t) => ({ ...t, history: t.history.map((h) => (h === docEntry(from) ? docEntry(to) : h)) })))
              }
              onDeleted={(p) => pruneTabs(new Set([docEntry(p)]))}
              footer={footerFor("docs")}
            />
          ) : inMindmapApp ? (
            <MindmapSidebar
              maps={mindmaps}
              activeId={activePageId?.startsWith("mindmap:") ? activePageId.slice(8) : null}
              onOpen={(id) => navigate(mindmapEntry(id))}
              onGallery={() => setActiveTabId(MM_HOME_TAB)}
              onOpenNewTab={(id) => openInNewTab(mindmapEntry(id))}
              onNew={async () => navigate(mindmapEntry(await createMindmap("")))}
              footer={footerFor("mindmap")}
            />
          ) : neridaHome ? (
            <NeridaSidebar footer={footerFor("notes")} />
          ) : (
            <Sidebar
              pages={livePages}
              allPages={allLivePages}
              view={view}
              onChangeView={setView}
              workspaces={workspaces}
              onMoveToWorkspace={moveToWorkspace}
              homeActive={view === "document" && activePageId === HOME}
              onHome={goHome}
              libraryActive={view === "document" && activePageId === LIBRARY}
              onLibrary={() => {
                setView("document");
                setActiveTabId(HOME_TAB);
                setLibraryOpen(true);
              }}
              onOpenTags={() => setTagsOpen(true)}
              onImport={(files) => void importNotes(files)}
              footer={footerFor("notes")}
              trashedPages={trashedPages}
              activePageId={activePageId}
              onOpenPage={openPage}
              onTogglePin={togglePin}
              onCreatePage={createPage}
              onRenamePage={changeTitle}
              onDuplicatePage={duplicatePage}
              onTrashPage={askTrashPage}
              onRestorePage={restorePage}
              onDeleteForever={deleteForever}
              onRestoreAll={restoreAll}
              onEmptyTrash={emptyTrash}
              onMovePage={movePage}
              onOpenInNewTab={openInNewTab}
            />
          )}
        </div>

        {/* ---- Main area: page header + document canvas ---- */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {!loaded ? (
            <div className="h-full" />
          ) : view === "atlas" ? (
            <SpatialCanvas
              pages={livePages}
              activePageId={activePageId}
              version={linksVersion}
              onOpenPage={(id) => {
                setView("document");
                openPage(id);
              }}
              onOpenInNewTab={(id) => {
                setView("document");
                openInNewTab(id);
              }}
              onCreatePage={() => createPage(null)}
              onTogglePin={togglePin}
              onTrashPage={askTrashPage}
              workspaces={workspaces}
              onMoveToWorkspace={moveToWorkspace}
              workspaceId={activeWorkspaceId}
            />
          ) : view === "calendar" ? (
            <CalendarView
              pages={livePages}
              onOpenPage={setPeekId}
              onCreateOn={(date) => createPage(null, date)}
              onReschedule={(id, date) => {
                const p = pages.find((x) => x.id === id);
                if (p) changeProperties(id, { ...propsOf(p), dueDate: date });
              }}
              onDelete={trashPage}
              onToggleDone={(id) => {
                const p = pages.find((x) => x.id === id);
                if (p) changeProperties(id, { ...propsOf(p), status: p.status === "done" ? "not_started" : "done" });
              }}
            />
          ) : activePageId === SKETCH ? (
            <SketchHome
              key={homeKey}
              onOpen={(p) => openPage(sketchEntry(p))}
              openNow={openNow("sketch:", (p) => sketchTitle(p.slice(7)))}
              onFocusTab={setActiveTabId}
              onCloseTab={closeTab}
            />
          ) : activePageId?.startsWith("sketch:") ? (
            <SketchEditor
              key={activePageId}
              path={activePageId.slice(7)}
              onOpen={(p) => openPage(sketchEntry(p))}
              onSavedAs={(p) => navigate(sketchEntry(p))}
              onHome={() => setActiveTabId(SKETCH_HOME_TAB)}
              onClose={() => activeTabId && closeTab(activeTabId)}
            />
          ) : activePageId === DOCS ? (
            <DocsHome key={homeKey} onOpen={(p) => openPage(docEntry(p))} />
          ) : activePageId?.startsWith("doc:") ? (
            <DocEditor
              key={activePageId}
              path={activePageId.slice(4)}
              onOpenDoc={(p) => openPage(docEntry(p))}
              onSavedAs={(p) => navigate(docEntry(p))}
              onHome={() => setActiveTabId(DOCS_HOME_TAB)}
              onBack={() => {
                setView("document");
                setActiveTabId(lastNotesTab.current ?? HOME_TAB);
              }}
              onCloseDoc={() => activeTabId && closeTab(activeTabId)}
            />
          ) : activePageId === MINDMAPS ? (
            <MindmapGallery
              key={homeKey}
              onOpen={(id) => navigate(mindmapEntry(id))}
              openNow={openNow("mindmap:", (p) => mindmapTitles[p.slice(8)] ?? mindmaps.find((m) => m.id === p.slice(8))?.title ?? "")}
              onFocusTab={setActiveTabId}
              onCloseTab={closeTab}
            />
          ) : activePageId?.startsWith("mindmap:") ? (
            <MindmapView
              mindmapId={activePageId.slice(8)}
              pages={allLivePages}
              onOpenPage={openPage}
              onTitle={(id, title) => setMindmapTitles((prev) => (prev[id] === title ? prev : { ...prev, [id]: title }))}
              onHome={() => setActiveTabId(MM_HOME_TAB)}
            />
          ) : activePageId?.startsWith("pdf:") ? (
            <div className="flex h-full min-h-0">
              <div className="min-w-0 flex-1">
                <PdfReader
                  key={`${activeTabId}:${activePageId}`}
                  docId={activePageId.slice(4)}
                  onBack={() => (activeTab && activeTab.index > 0 ? step(-1) : setActiveTabId(HOME_TAB))}
                />
              </div>
              {neridaOpen && <NeridaPanel pageId={null} pdf={{ id: activePageId.slice(4), name: "this PDF" }} />}
            </div>
          ) : activePageId === LIBRARY ? (
            <LibraryView
              pages={allLivePages}
              mindmaps={mindmaps}
              visitedAt={visitedAt}
              onOpenPage={navigate}
              onOpenMindmap={(id) => navigate(mindmapEntry(id))}
              onNewPage={() => createPage(null)}
            />
          ) : activePageId === HOME ? (
            <div className="relative flex h-full min-h-0 flex-col">
            <HomeSwitch />
            {neridaHome ? (
              <NeridaPanel pageId={null} home />
            ) : homeMode === "dashboard" ? (
            <StudyHome
              key={homeKey}
              userName={settings.userName}
              pages={allLivePages}
              recent={recent}
              tagLibrary={tagLibrary}
              onOpenPage={(id) => (tabs.some((t) => currentPage(t) === id) ? openPage(id) : navigate(id))}
              onNewPage={() => createPage(null)}
              onNewMindmap={async () => navigate(mindmapEntry(await createMindmap("")))}
              onImport={() => void importNotes()}
              onOpenApp={(app) =>
                app === "calendar" ? setView("calendar") : setActiveTabId(app === "docs" ? (lastDocsTab.current ?? DOCS_HOME_TAB) : (lastSketchTab.current ?? SKETCH_HOME_TAB))
              }
              onCreate={(t, tags, d, body) => createTagged(t, tags, d, body as PartialBlock[] | undefined)}
              onSetStatus={(id, done) => {
                const p = pages.find((x) => x.id === id);
                if (p) changeProperties(id, { ...propsOf(p), status: done ? "done" : "not_started" });
              }}
              getDoc={async (id) => (docsRef.current[id] ?? (await loadBlocks(id))) as never}
              setDoc={(id, blocks) => changeDoc(id, blocks as PartialBlock[])}
            />
            ) : (
            <HomeView
              key={homeKey}
              userName={settings.userName}
              pages={allLivePages}
              recent={recent}
              // Already open in a tab? Focus it instead of opening a duplicate.
              onOpenPage={(id) => (tabs.some((t) => currentPage(t) === id) ? openPage(id) : navigate(id))}
              onNewPage={() => createPage(null)}
              mindmaps={recentMaps.map((id) => mindmaps.find((m) => m.id === id)).filter((m): m is MindmapRecord => !!m)}
              totalMindmaps={mindmaps.length}
              onOpenMindmap={(id) => navigate(mindmapEntry(id))}
              onNewMindmap={async () => navigate(mindmapEntry(await createMindmap("")))}
              onImport={() => void importNotes()}
              onChangeView={setView}
            />
            )}
            </div>
          ) : activePage ? (
            <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <PageHeader
                font={pageFonts[activePage.id] ?? "default"}
                onFont={setPageFont}
                page={activePage}
                pages={livePages}
                editedAt={activePage.updatedAt ? Date.parse(activePage.updatedAt) : undefined}
                onNavigate={navigate}
                onTogglePin={togglePin}
                onDuplicate={duplicatePage}
                onTrash={askTrashPage}
                loadBlocks={async (id) => docsRef.current[id] ?? (await loadBlocks(id))}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {/* Mount once the document is loaded: BlockNote reads it only at creation. */}
                {docs[activePage.id] && (
                  <PageEditor
                    key={`${activeTabId}:${activePage.id}`}
                    font={pageFonts[activePage.id]}
                    page={activePage}
                    doc={docs[activePage.id]}
                    onTitleChange={changeTitle}
                    onDocChange={changeDoc}
                    onIconChange={changeIcon}
                    linksVersion={linksVersion}
                    properties={propertiesFor(activePage)}
                  />
                )}
              </div>
            </div>
            {neridaOpen && <NeridaPanel pageId={activePage.id} />}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <kbd className="rounded-md border border-neutral-800 bg-neutral-800/50 px-2 py-1 font-sans text-xs text-neutral-300">
                Ctrl K
              </kbd>
              <p className="text-sm text-neutral-500">
                Search your workspace, or press{" "}
                <kbd className="rounded border border-neutral-700 px-1 font-sans text-[10px]">Ctrl T</kbd>{" "}
                for a new page.
              </p>
            </div>
          )}

          {peekPage && (
            <PagePeek
              center={peekCenter}
              label={
                peekPage.parentId && (
                  <>
                    Add to <span className="text-neutral-200">{allLivePages.find((p) => p.id === peekPage.parentId)?.icon} {allLivePages.find((p) => p.id === peekPage.parentId)?.title || "Untitled"}</span>
                  </>
                )
              }
              onClose={() => setPeekId(null)}
              onOpenFull={() => {
                setView("document");
                openPage(peekPage.id);
                setPeekId(null);
              }}
            >
              {docs[peekPage.id] && (
                <PageEditor
                  key={`peek:${peekPage.id}`}
                  page={peekPage}
                  doc={docs[peekPage.id]}
                  onTitleChange={changeTitle}
                  onDocChange={changeDoc}
                  onIconChange={changeIcon}
                  linksVersion={linksVersion}
                  properties={propertiesFor(peekPage)}
                />
              )}
            </PagePeek>
          )}
        </main>
      </div>

      <UpdateUI />
      <SpellUI />
      {railTip && sidebarCollapsed && (
        <div key={railTip.text} style={{ left: railTip.x, top: railTip.y }} className="oc-rail-tip">
          {railTip.text}
        </div>
      )}
      <NeridaCardsHost />
      <NeridaEditUI />
      <NeridaOutlineUI />
      {savePrompt && (
        <SavePrompt
          path={savePrompt.path}
          proceed={() => {
            savePrompt.proceed();
            setSavePrompt(null);
          }}
          onCancel={() => setSavePrompt(null)}
        />
      )}
      <NeridaDownloadPill hidden={!!settingsOpen || neridaOpen} />
      <ContextMenuHost
        fallback={(e): MenuItem[] => {
          if (isTextField(e.target)) return textFieldMenu(e.target);
          // Everywhere else: app-level commands.
          return [
            {
              label: "New page",
              icon: <Plus className="size-4" />,
              hint: "Ctrl+T",
              onSelect: () => createPage(null),
            },
            {
              label: "Search",
              icon: <Search className="size-4" />,
              hint: "Ctrl+K",
              onSelect: () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)),
            },
            "divider",
            {
              label: sidebarCollapsed ? "Show sidebar" : "Hide sidebar",
              icon: <PanelLeft className="size-4" />,
              hint: "Ctrl+\\",
              onSelect: () => setSidebarCollapsed((v) => !v),
            },
            {
              label: "View",
              icon: <FileText className="size-4" />,
              children: [
                { label: "Document", icon: <FileText className="size-4" />, checked: view === "document", onSelect: () => setView("document") },
                { label: "Atlas", icon: <Network className="size-4" />, checked: view === "atlas", onSelect: () => setView("atlas") },
                { label: "Calendar", icon: <CalendarDays className="size-4" />, checked: view === "calendar", onSelect: () => setView("calendar") },
              ],
            },
            "divider",
            {
              label: "Back",
              icon: <ArrowLeft className="size-4" />,
              hint: "Alt+←",
              disabled: !activeTab || activeTab.index === 0,
              onSelect: () => step(-1),
            },
            {
              label: "Forward",
              icon: <ArrowRight className="size-4" />,
              hint: "Alt+→",
              disabled: !activeTab || activeTab.index >= activeTab.history.length - 1,
              onSelect: () => step(1),
            },
          ];
        }}
      />

      {wsDialog && (
        <WorkspaceDialog
          initial={wsDialog === "new" ? undefined : workspaces.find((w) => w.id === wsDialog)}
          onSave={saveWorkspace}
          onClose={() => setWsDialog(null)}
        />
      )}
      {wsToDelete && (
        <Modal onClose={() => setWsToDelete(null)}>
          <div className="flex flex-col gap-3 p-5">
            <h2 className="text-[15px] font-semibold text-neutral-100">
              Delete “{workspaces.find((w) => w.id === wsToDelete)?.name}”?
            </h2>
            <p className="text-[13px] text-neutral-400">
              Its pages move to Trash, where you can still restore them.
            </p>
            <div className="flex justify-end gap-2">
              <ModalButton onClick={() => setWsToDelete(null)}>Cancel</ModalButton>
              <ModalButton
                variant="danger"
                autoFocus
                onClick={() => {
                  deleteWorkspace(wsToDelete);
                  setWsToDelete(null);
                }}
              >
                Delete workspace
              </ModalButton>
            </div>
          </div>
        </Modal>
      )}
      {tagsOpen && (
        <TagsPanel
          pages={allLivePages}
          library={tagLibrary}
          onCreateTag={createTag}
          onOpenPage={(id) => {
            setView("document");
            openPage(id);
          }}
          onRenameTag={renameTag}
          onDeleteTag={deleteTag}
          onTagColor={(tag, color) => changeTagColor(tag, color)}
          onClose={() => setTagsOpen(false)}
        />
      )}
      <Tooltip />
      {metaAsk && <ImportMetaDialog titles={metaAsk.titles} existingTags={metaAsk.existingTags} newTags={metaAsk.newTags} onDone={metaAsk.resolve} />}
      {dupAsk && (
        <Modal onClose={() => dupAsk.resolve("cancel")} className="w-[440px] p-5">
          <h2 className="text-[15px] font-semibold text-neutral-100">“{dupAsk.title}” is already in Oceanic</h2>
          <p className="mt-1 text-[13px] text-neutral-400">An identical note exists. What should happen?</p>
          <div className="mt-4 flex justify-end gap-2">
            <ModalButton onClick={() => dupAsk.resolve("cancel")}>Cancel</ModalButton>
            <ModalButton onClick={() => dupAsk.resolve("replace")}>Replace existing</ModalButton>
            <ModalButton onClick={() => dupAsk.resolve("copy")}>Import as copy</ModalButton>
            <ModalButton variant="primary" onClick={() => dupAsk.resolve("open")}>Open existing</ModalButton>
          </div>
        </Modal>
      )}
      {importFailures && (
        <Modal onClose={() => setImportFailures(null)} className="w-[440px] p-5">
          <h2 className="text-[15px] font-semibold text-neutral-100">
            {importFailures.count ? `Imported ${importFailures.count} page${importFailures.count === 1 ? "" : "s"}` : "Nothing was imported"}
          </h2>
          <p className="mt-1 text-[13px] text-neutral-400">Couldn't import:</p>
          <ul className="scrollbar-thin mt-2 max-h-60 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02]">
            {importFailures.failed.map((f, i) => (
              <li key={i} className="flex gap-2 border-b border-white/[0.04] px-3 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0 truncate font-medium text-neutral-200">{f.name}</span>
                <span className="ml-auto shrink-0 text-neutral-500">{f.reason}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <ModalButton variant="primary" onClick={() => setImportFailures(null)}>OK</ModalButton>
          </div>
        </Modal>
      )}
      {appLoading && <AppLoader app={appLoading} onLeave={() => {
        setHomeKey((k) => k + 1);
        // Ease the app in under the fading splash instead of a hard cut.
        appRoot.current?.querySelectorAll<HTMLElement>(":scope > :not([data-app-loader])").forEach((el) =>
          el.animate(
            [{ opacity: 0, transform: "scale(0.98)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "none" }],
            { duration: 480, easing: "cubic-bezier(0.2, 0, 0, 1)" },
          ),
        );
      }} onDone={() => setAppLoading(null)} />}
      <DeleteConfirmHost />
      {embedding && (
        <EmbedInNoteModal
          sourceName={embedding.name}
          notes={livePages.map((p) => ({ id: p.id, title: p.title }))}
          onPick={(id) => void embedInto(id)}
          onCreate={(title, parentId) => void createNoteForEmbed(title, parentId)}
          onClose={() => setEmbedding(null)}
        />
      )}
      {appSearchOpen && (
        <SearchModal
          pages={allLivePages}
          workspaces={workspaces}
          onOpenPage={(id) => (setView("document"), openPage(id))}
          onOpenInNewTab={(id) => (setView("document"), openInNewTab(id))}
          onClose={() => setAppSearchOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal settings={settings} onChange={changeSettings} onClose={() => setSettingsOpen(false)} initialPage={typeof settingsOpen === "string" ? settingsOpen : undefined} />
      )}
      {loaded && askName && (
        <NamePrompt
          onSave={(userName) => {
            changeSettings({ userName });
            setAskName(false);
          }}
        />
      )}
      {notice && (
        <Toast key={notice.key} message={notice.text} actionLabel={notice.action?.label} onAction={() => (notice.action?.run(), setNotice(null))} onDismiss={() => setNotice(null)} duration={notice.action ? 8000 : 5000} />
      )}

      {trashToast && (
        <Toast
          key={trashToast.key}
          message="Moved to Trash"
          actionLabel="Undo"
          onAction={() => {
            restorePage(trashToast.pageId);
            setTrashToast(null);
          }}
          onDismiss={() => setTrashToast(null)}
        />
      )}
    </div>
  );
}
