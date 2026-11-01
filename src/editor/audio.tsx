/* ---------------------------------------------------------------------------
 * Lecture audio: a Notion-style player block for local files, and inline
 * [mm:ss] timestamp chips that seek the player they were taken from.
 * ------------------------------------------------------------------------ */
import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { Music, Pause, Play } from "lucide-react";

type AudioAsset = { path: string; name: string };

/** Live players by block id, so timestamp chips can reach them. */
const players = new Map<string, HTMLAudioElement>();

const SPEEDS = [1, 1.25, 1.5, 2];
export const fmtTime = (s: number) => {
  if (!Number.isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m.toString().padStart(2, "0")}:${sec}`;
};

/** Stored `src` → playable URL: asset protocol in the app, data URL in the browser preview. */
const playable = (src: string) => (src.startsWith("data:") ? src : isTauri() ? convertFileSrc(src) : src);

/* ------------------------------------------------------------- importing */
export const isAudioFile = (f: File) => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac|flac|webm|opus)$/i.test(f.name);

/** Native picker → copy into Oceanic's assets folder. */
export async function pickAudio(): Promise<AudioAsset | null> {
  if (!isTauri()) {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "audio/*" });
    const file = await new Promise<File | undefined>((r) => {
      input.onchange = () => r(input.files?.[0]);
      input.click();
    });
    return file ? importAudioFile(file) : null;
  }
  const path = await open({
    title: "Add audio",
    filters: [{ name: "Audio", extensions: ["mp3", "m4a", "wav", "ogg", "aac", "flac", "webm", "opus"] }],
  });
  return typeof path === "string" ? invoke<AudioAsset>("import_audio", { src: path }) : null;
}

/** A dropped file: the webview only has its bytes. */
export async function importAudioFile(file: File): Promise<AudioAsset> {
  if (!isTauri()) {
    const data = await new Promise<string>((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result as string);
      fr.readAsDataURL(file);
    });
    return { path: data, name: file.name };
  }
  const data = Array.from(new Uint8Array(await file.arrayBuffer()));
  return invoke<AudioAsset>("import_audio_bytes", { name: file.name, data });
}

/**
 * BlockNote `uploadFile` for the built-in Video / Image / Audio / File blocks:
 * copy into the assets folder and hand back a URL the webview can load.
 */
export async function uploadFile(file: File): Promise<string> {
  if (!isTauri()) {
    return new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result as string);
      fr.readAsDataURL(file);
    });
  }
  const data = Array.from(new Uint8Array(await file.arrayBuffer()));
  const asset = await invoke<AudioAsset>("import_file_bytes", { name: file.name, data });
  return convertFileSrc(asset.path);
}

/* ----------------------------------------------------------------- block */
export const LectureAudio = createReactBlockSpec(
  { type: "lectureAudio", propSchema: { src: { default: "" }, name: { default: "" } }, content: "none" },
  {
    render: function LectureAudioView({ block, editor }) {
      const ref = useRef<HTMLAudioElement>(null);
      const [playing, setPlaying] = useState(false);
      const [time, setTime] = useState(0);
      const [duration, setDuration] = useState(0);
      const [speed, setSpeed] = useState(1);
      const { src, name } = block.props;

      useEffect(() => {
        const el = ref.current;
        if (!el) return;
        players.set(block.id, el);
        return () => void (players.get(block.id) === el && players.delete(block.id));
      }, [block.id]);

      if (!src) {
        return (
          <button
            type="button"
            contentEditable={false}
            className="oc-audio-empty"
            onClick={async () => {
              const asset = await pickAudio().catch(() => null);
              if (asset) editor.updateBlock(block, { props: { src: asset.path, name: asset.name } } as never);
            }}
          >
            <Music size={16} /> Add an audio file
          </button>
        );
      }

      const toggle = () => (ref.current?.paused ? ref.current.play() : ref.current?.pause());
      const pct = duration ? (time / duration) * 100 : 0;
      return (
        <div className="oc-audio" contentEditable={false}>
          <div className="oc-audio-name">
            <Music size={14} />
            <span>{name || "Audio"}</span>
          </div>
          <div className="oc-audio-bar">
            <button type="button" className="oc-audio-play" onClick={toggle} title={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
            <span className="oc-audio-time">
              {fmtTime(time)} / {fmtTime(duration)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              onChange={(e) => ref.current && (ref.current.currentTime = Number(e.target.value))}
              className="oc-audio-seek"
              style={{ "--oc-pct": `${pct}%` } as React.CSSProperties}
            />
            <button
              type="button"
              className="oc-audio-speed"
              title="Playback speed"
              onClick={() => {
                const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                setSpeed(next);
                if (ref.current) ref.current.playbackRate = next;
              }}
            >
              {speed}x
            </button>
          </div>
          <audio
            ref={ref}
            src={playable(src)}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />
        </div>
      );
    },
  },
);

/* ------------------------------------------------------------- timestamp */
export const Timestamp = createReactInlineContentSpec(
  { type: "timestamp", propSchema: { seconds: { default: 0 }, audioId: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent }) => {
      const { seconds, audioId } = inlineContent.props;
      return (
        <span
          className="oc-timestamp"
          contentEditable={false}
          title="Jump to this moment"
          onClick={() => {
            const el = players.get(audioId);
            if (!el) return;
            el.currentTime = seconds;
            void el.play();
            el.closest(".bn-block-outer")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }}
        >
          [{fmtTime(seconds)}]
        </span>
      );
    },
  },
);

/** Ctrl+Shift+T: a chip for the current time of the nearest player above the cursor. */
export function insertTimestamp(editor: any): boolean {
  const cursor = editor.getTextCursorPosition().block;
  const flat: any[] = [];
  const walk = (bs: any[]) => bs.forEach((b) => (flat.push(b), walk(b.children)));
  walk(editor.document);
  const at = flat.findIndex((b) => b.id === cursor.id);
  const audio = flat.slice(0, at + 1).reverse().find((b) => b.type === "lectureAudio" && b.props.src)
    ?? flat.find((b) => b.type === "lectureAudio" && b.props.src);
  const el = audio && players.get(audio.id);
  if (!el) return false;
  editor.insertInlineContent([
    { type: "timestamp", props: { seconds: Math.floor(el.currentTime), audioId: audio.id } },
    " ",
  ]);
  return true;
}
