/**
 * Settings on phones: a full-screen grouped list; each row opens its own
 * screen. Choices open a bottom sheet with radio options. Android's back
 * gesture steps back one screen at a time.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Database, GripVertical, Info, Palette, PenLine, CalendarDays, Trash2, Vibrate } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ACCENTS, Avatar, type AppSettings } from "../components/SettingsModal";
import { AvatarCropper, AvatarViewer } from "../components/AvatarCropper";
import { setAskBeforeDelete, useConfirmDelete } from "../lib/confirmDelete";
import { HOME_SECTIONS, buzz, setMobilePref, useMobilePrefs, type HomeSection } from "./mobilePrefs";
import { checkForUpdates } from "./MobileUpdater";
import "./mobile-settings.css";

type Screen = "main" | "profile" | "appearance" | "editor" | "calendar" | "data" | "deleting" | "about";
type Choice = { title: string; value: string; options: [string, string][]; pick: (v: string) => void };

type Props = {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  pageCount: number;
  onImport: () => void;
  trashCount: number;
};


function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} className={`ocs-switch ${on ? "on" : ""}`} onClick={() => (buzz(), onChange(!on))}>
      <span />
    </button>
  );
}

/** One Home widget row: drag by the handle, switch to show or hide. */
function HomeRow({ id, hidden }: { id: HomeSection; hidden: HomeSection[] }) {
  const drag = useDragControls();
  const on = !hidden.includes(id);
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={drag} className="ocs-row ocs-reorder" whileDrag={{ scale: 1.02, boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }} onDragEnd={() => buzz()}>
      <span className="ocs-grip" onPointerDown={(e) => (buzz(), drag.start(e))} aria-label="Drag to reorder">
        <GripVertical size={18} />
      </span>
      <span className="ocs-title">{HOME_SECTIONS[id]}</span>
      <Switch on={on} onChange={(v) => setMobilePref({ homeHidden: v ? hidden.filter((h) => h !== id) : [...hidden, id] })} />
    </Reorder.Item>
  );
}

function Row({ icon, title, value, onClick, children }: { icon?: ReactNode; title: string; value?: string; onClick?: () => void; children?: ReactNode }) {
  const body = (
    <>
      {icon && <span className="ocs-icon">{icon}</span>}
      <span className="ocs-title">{title}</span>
      {value && <span className="ocs-value">{value}</span>}
      {children}
      {onClick && !children && <ChevronRight size={18} className="ocs-chev" />}
    </>
  );
  return onClick ? (
    <button className="ocs-row" onClick={() => (buzz(), onClick())}>
      {body}
    </button>
  ) : (
    <div className="ocs-row">{body}</div>
  );
}

const label = (opts: [string, string][], v: string) => opts.find(([k]) => k === v)?.[1] ?? v;

const THEMES: [string, string][] = [["system", "Use phone setting"], ["light", "Light"], ["dark", "Dark"]];
const SIZES: [string, string][] = [["small", "Small"], ["default", "Default"], ["large", "Large"]];
const WEEK: [string, string][] = [["sunday", "Sunday"], ["monday", "Monday"]];

export function MobileSettings({ settings, onChange, onClose, pageCount, trashCount, onImport }: Props) {
  const [stack, setStack] = useState<Screen[]>(["main"]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [version, setVersion] = useState("");
  const [updateState, setUpdateState] = useState("");
  const prefs = useMobilePrefs();
  const { ask } = useConfirmDelete();
  const screen = stack[stack.length - 1];

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Each screen or sheet is one history entry, so Android back closes the top one.
  // Entries are only added when going deeper; a back press already removed its own.
  const depth = stack.length + (choice ? 1 : 0);
  const pushed = useRef(0);
  const state = useRef({ choice, stack, onClose });
  state.current = { choice, stack, onClose };
  useEffect(() => {
    while (pushed.current < depth) {
      history.pushState({ ocSettings: ++pushed.current }, "");
    }
  }, [depth]);
  useEffect(() => {
    const onPop = () => {
      if (document.querySelector(".oc-avatar-view")) return; // that back step closes the photo viewer
      pushed.current--;
      const { choice, stack, onClose } = state.current;
      if (choice) setChoice(null);
      else if (stack.length > 1) setStack((s) => s.slice(0, -1));
      else onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const back = () => history.back();
  const open = (s: Screen) => setStack((st) => [...st, s]);

  const titles: Record<Screen, string> = {
    main: "Settings", profile: "Profile", appearance: "Appearance", editor: "Editor", calendar: "Calendar",
    data: "Data & backup", deleting: "Deleting", about: "About",
  };

  const [crop, setCrop] = useState<File | null>(null);
  const [viewing, setViewing] = useState(false);
  let body: ReactNode;
  if (screen === "main") {
    body = (
      <>
        <section className="ocs-group">
          <button className="ocs-row ocs-me" onClick={() => (buzz(), open("profile"))}>
            <Avatar name={settings.userName} avatar={settings.avatar} size={48} />
            <span className="ocs-title">
              {settings.userName || "Add your name"}
              <em>Name and photo</em>
            </span>
            <ChevronRight size={18} className="ocs-chev" />
          </button>
        </section>
        <section className="ocs-group">
          <Row icon={<Palette size={19} />} title="Appearance" onClick={() => open("appearance")} />
          <Row icon={<PenLine size={19} />} title="Editor" onClick={() => open("editor")} />
          <Row icon={<CalendarDays size={19} />} title="Calendar" onClick={() => open("calendar")} />
        </section>
        <section className="ocs-group">
          <Row icon={<Database size={19} />} title="Data & backup" onClick={() => open("data")} />
          <Row icon={<Trash2 size={19} />} title="Deleting" onClick={() => open("deleting")} />
          <Row icon={<Info size={19} />} title="About" value={version && `v${version}`} onClick={() => open("about")} />
        </section>
      </>
    );
  } else if (screen === "profile") {
    body = (
      <>
        <div className="ocs-photo">
          <button aria-label="View photo" disabled={!settings.avatar.startsWith("data:")} onClick={() => (buzz(), setViewing(true))}>
            <Avatar name={settings.userName} avatar={settings.avatar} size={96} />
          </button>
          <label className="ocs-link">
            Choose photo
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setCrop(f);
              }}
            />
          </label>
          {settings.avatar && (
            <button className="ocs-link ocs-quiet" onClick={() => onChange({ avatar: "" })}>
              Remove photo
            </button>
          )}
        </div>
        <section className="ocs-group">
          <label className="ocs-row">
            <span className="ocs-title">Name</span>
            <input className="ocs-input" value={settings.userName} placeholder="Your name" onChange={(e) => onChange({ userName: e.target.value })} />
          </label>
        </section>
      </>
    );
  } else if (screen === "appearance") {
    body = (
      <>
        <section className="ocs-group">
          <Row title="Theme" value={label(THEMES, settings.theme)} onClick={() => setChoice({ title: "Theme", value: settings.theme, options: THEMES, pick: (v) => onChange({ theme: v as AppSettings["theme"] }) })} />
          <Row title="Reduce animations">
            <Switch on={prefs.reduceMotion} onChange={(on) => setMobilePref({ reduceMotion: on })} />
          </Row>
          <Row title="Vibrate on tap">
            <Switch on={prefs.haptics} onChange={(on) => setMobilePref({ haptics: on })} />
          </Row>
        </section>
        <h3 className="ocs-head">Accent colour</h3>
        <section className="ocs-group ocs-colors">
          {ACCENTS.map((c) => (
            <button key={c} aria-label={c} style={{ background: c }} onClick={() => (buzz(), onChange({ accent: c }))}>
              {settings.accent.toLowerCase() === c && <Check size={18} color="#fff" />}
            </button>
          ))}
          <label aria-label="Custom colour" className="ocs-custom">
            <input type="color" value={settings.accent} onChange={(e) => onChange({ accent: e.target.value })} />
          </label>
        </section>
        <h3 className="ocs-head">Home screen</h3>
        <Reorder.Group as="section" axis="y" values={prefs.homeOrder} onReorder={(o) => setMobilePref({ homeOrder: o })} className="ocs-group">
          {prefs.homeOrder.map((id) => (
            <HomeRow key={id} id={id} hidden={prefs.homeHidden} />
          ))}
        </Reorder.Group>
        <p className="ocs-note">Drag ≡ to reorder Home. Search and New page / New task stay on top.</p>
        <p className="ocs-note"><Vibrate size={13} /> Animations and vibration apply to this phone only.</p>
      </>
    );
  } else if (screen === "editor") {
    body = (
      <section className="ocs-group">
        <Row title="Text size" value={label(SIZES, settings.editorSize)} onClick={() => setChoice({ title: "Text size", value: settings.editorSize, options: SIZES, pick: (v) => onChange({ editorSize: v as AppSettings["editorSize"] }) })} />
      </section>
    );
  } else if (screen === "calendar") {
    body = (
      <section className="ocs-group">
        <Row title="Start week on" value={label(WEEK, settings.weekStart)} onClick={() => setChoice({ title: "Start week on", value: settings.weekStart, options: WEEK, pick: (v) => onChange({ weekStart: v as AppSettings["weekStart"] }) })} />
      </section>
    );
  } else if (screen === "data") {
    body = (
      <>
        <section className="ocs-group">
          <Row title="Pages" value={String(pageCount)} />
          <Row title="In Trash" value={String(trashCount)} />
          <Row title="Stored" value="On this phone only" />
        </section>
        <section className="ocs-group">
          <Row title="Import .ocean" onClick={onImport} />
        </section>
        <p className="ocs-note">Export: long-press a page → Share as .ocean. You can also open a .ocean file from Files or a chat.</p>
        <p className="ocs-note">Uninstalling Oceanic deletes its notes. Export the ones you want to keep first.</p>
      </>
    );
  } else if (screen === "deleting") {
    body = (
      <>
        <section className="ocs-group">
          <Row title="Ask before deleting">
            <Switch on={ask.notes} onChange={(on) => setAskBeforeDelete("notes", on)} />
          </Row>
        </section>
        <p className="ocs-note">Deleted pages go to Trash first. Open Trash from your profile on Home.</p>
      </>
    );
  } else {
    body = (
      <>
        <div className="ocs-about">
          <img src="/logo-shell.png" alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
          <strong>Oceanic</strong>
          <span>Version {version || "…"}</span>
        </div>
        <section className="ocs-group">
          <Row
            title="Check for updates"
            value={updateState}
            onClick={async () => {
              setUpdateState("Checking…");
              const r = await checkForUpdates();
              setUpdateState(r === "none" ? "Up to date" : r === "error" ? "Couldn't check" : "");
            }}
          />
          <Row title="Report a bug" onClick={() => void openUrl("https://github.com/MystiTheDev/oceanic/issues")} />
        </section>
        <p className="ocs-note">Oceanic checks for updates once a day. Updating installs the new APK over this one; your notes stay.</p>
      </>
    );
  }

  return (
    <div className="ocs">
      <header className="ocs-bar">
        <button className="ocs-back" aria-label="Back" onClick={back}>
          <ChevronLeft size={24} />
        </button>
        <h1>{titles[screen]}</h1>
      </header>
      <div className="ocs-scroll" key={screen}>
        {body}
      </div>
      {choice && (
        <div className="ocs-sheet-bg" onClick={back}>
          <div className="ocs-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ocs-grab" />
            <h2>{choice.title}</h2>
            {choice.options.map(([v, l]) => (
              <button
                key={v}
                className="ocs-radio"
                onClick={() => {
                  buzz();
                  choice.pick(v);
                  back();
                }}
              >
                <span className={`ocs-dot ${v === choice.value ? "on" : ""}`} />
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      {crop && <AvatarCropper file={crop} phone onDone={(avatar) => (onChange({ avatar }), setCrop(null))} onCancel={() => setCrop(null)} />}
      {viewing && <AvatarViewer src={settings.avatar} onClose={() => setViewing(false)} />}
    </div>
  );
}
