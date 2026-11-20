# Phase 0 audit — Oceanic desktop (main @ bf7922c)

Audit only; no code changed. Method: Vite UI run in the browser pane (`oceanic-web`, port 1420) and clicked through
Home, Sidebar, the Welcome note, the formatting toolbar, the Nerida panel, its intro and model menu, and the theme
toggle; plus a source scan of `src/components` and a full read of the Nerida code (`src/lib/nerida*.ts`,
`NeridaPanel.tsx`, `src-tauri/src/ai.rs`).

**Not covered live:** a Tauri dev build was not run, so the built-in engine, real chat replies, edit proposals,
downloads and Settings → Nerida AI were checked in code only. In the browser the panel only shows
"Nerida runs in the Oceanic desktop app." Phase 2 should repeat a click-through in `npm run tauri dev`.

---

## 1. UI punch list (polish only, current look kept)

Ranked by impact within each area. **H** = users hit it often / looks broken, **M** = noticeable, **L** = nit.

### Cross-cutting (do in Phase 1 groundwork)

| # | Impact | Issue | Where |
|---|---|---|---|
| X1 | H | Native `confirm()` / `alert()` dialogs break the app's look (cloud-model warning, delete model, remove provider, delete concept, unsaved sketch, delete errors). Needs one shared themed confirm dialog. | `NeridaPanel.tsx:345`, `NeridaSettings.tsx:46,252,355`, `SpatialCanvas.tsx:693,1651-1652`, `App.tsx:579`, `lib/confirmDelete.tsx:51` |
| X2 | H | 15 components draw their own `fixed inset-0` overlay instead of `Modal.tsx`; Escape-to-close is only in `Modal`, `ExportDialog`, `SearchModal`. `SettingsModal`, `NeridaEditUI`, `NeridaOutlineUI`, `StudyHome` overlays don't close on Escape. | `AppSwitcher`, `ExportDialog`, `ImageAnnotator`, `MalwareAlert`, `NeridaEditUI`, `NeridaOrb`, `NeridaOutlineUI`, `NeridaPanel`, `PageBanner`, `PageProperties`, `SearchModal`, `SettingsModal`, `SpellUI`, `StudyHome` |
| X3 | H | `Modal.tsx` has no `role="dialog"`/`aria-modal`, no focus trap and no focus return on close. Every dialog inherits this. | `components/Modal.tsx` |
| X4 | M | `outline-none` used with no `focus-visible` ring in 28 components: keyboard users can't see focus on inputs/buttons. Add one shared focus-ring class. | e.g. `NeridaPanel`, `SettingsModal`, `Sidebar`, `PageEditor`, `ExportDialog`, `SearchModal`, `TagPicker` |
| X5 | M | Icon-only buttons often lack `aria-label`/`title` (e.g. NeridaPanel has 27 buttons, few labelled; `StudyHome` 46). | `NeridaPanel.tsx`, `StudyHome.tsx`, `SpatialCanvas.tsx`, `NeridaSettings.tsx` |
| X6 | M | Token drift: radius uses md/lg/xl/2xl/full plus arbitrary `[3px] [4px] [5px] [26px]`; shadows use sm→2xl plus 5 arbitrary values; 15+ font sizes (`10px`…`28px`, incl. `10.5/11.5/12.5/13.5px`). Define a small scale (radius: control/card/panel; shadow: menu/dialog; type: 11/12/13/14/15+) and map old values to it without changing the look. | all `src/components` |
| X7 | M | Very few loading states (6 spinner/skeleton uses in all components). Async lists (Library, Search, Nerida chat history, model lists) pop in. | `LibraryView`, `SearchModal`, `NeridaSettings` (`listModels`) |
| X8 | L | 204 ad-hoc `transition` usages with mixed durations; pick 2 durations/easings. | all |

### Home / Sidebar

| # | Impact | Issue | Where |
|---|---|---|---|
| H1 | M | "Recently visited" empty state is a plain bordered box with grey text; no icon or action ("New page"). | `HomeView.tsx` |
| H2 | M | A favourited note appears twice in the sidebar (Favorites and Pages) with identical rows; no visual cue it's the same note (active highlight shows on both). | `Sidebar.tsx` |
| H3 | M | Sidebar footer: theme toggle sits on the user row where users expect Settings; Settings is only reachable via "Workspace options". Make the gear/settings entry obvious; theme toggle switches instantly with no transition. | `SidebarFooter.tsx:66,170` |
| H4 | L | "MORE APPS" row icons are tiny and crowded next to the label. | `SidebarFooter.tsx` / `AppSwitcher.tsx` |
| H5 | L | Sidebar view tabs (pages / atlas / calendar icons) have no labels or tooltips visible. | `Sidebar.tsx`, `SidebarIcons.tsx` |

### Note editor

| # | Impact | Issue | Where |
|---|---|---|---|
| E1 | H | Selecting the first paragraph shows the formatting toolbar on top of the Date/Status/Tags property rows (overlapping, half-transparent). Toolbar needs to flip below or offset when properties are above. | `PageEditor.tsx` (formatting toolbar), `PageProperties.tsx` |
| E2 | M | Toolbar overflow/menus mix button sizes and icon weights with the block-handle menu. | `ToolbarOverflow.tsx`, `BlockHandleMenu.tsx`, `FontButton.tsx` |
| E3 | M | Property rows show "Empty" in the same grey for every field; no hover affordance that they're editable. | `PageProperties.tsx` |
| E4 | M | Nerida edit dialogs (Improve / Grammar / custom, Outline) have no Escape, no focus on open, and stream into a box with no "working" indicator besides text appearing. | `NeridaEditUI.tsx`, `NeridaOutlineUI.tsx` |
| E5 | L | Pending AI edits are shown by blue background only; colour-only cue. | `PageEditor.tsx` (`paintTable`, pending blocks) |
| E6 | L | Outline toggle at the right edge is an unlabeled "=" glyph. | `PageOutline.tsx` |

### Nerida chat (panel + Home view + model menu)

| # | Impact | Issue | Where |
|---|---|---|---|
| N1 | H | Errors show as a red bar at the top while the composer at the bottom says "Download Nerida to start": two conflicting states, big empty middle. Needs one empty/error state in the middle with the right action. | `NeridaPanel.tsx` |
| N2 | H | Cloud consent is a native `confirm()` (see X1). | `NeridaPanel.tsx:345` |
| N3 | M | Composer row: attach, globe, model pill, effort pill and send are different heights/radii; model pill gets a white ring when focused that no other control has. | `NeridaPanel.tsx`, `NeridaModelMenu.tsx`, `NeridaEffort.tsx` |
| N4 | M | Model menu: "Nerida BETA" header, check mark and the three action rows use different paddings; no keyboard arrow navigation. | `NeridaModelMenu.tsx` |
| N5 | M | "Meet Nerida" intro sits over the dimmed note, not centred in the panel it introduces. | `NeridaIntro.tsx` |
| N6 | M | Step list ("Reading 2 notes", "Writing answer") has no spinner on the live step; Stop button visibility while busy should be checked in Tauri. | `NeridaPanel.tsx` (`steps`) |
| N7 | L | @-mention and / menus: highlighted row uses `bg-white/[0.07]` (invisible in light theme). | `NeridaPanel.tsx:530` |
| N8 | L | Home ↔ Nerida switch at top right has no transition; Nerida Home mirrors panel layout with slightly different spacing. | `HomeView.tsx`, `NeridaHome.tsx` |

### Settings and dialogs

| # | Impact | Issue | Where |
|---|---|---|---|
| S1 | H | Settings modal: no Escape close, no focus trap (X2/X3). | `SettingsModal.tsx` |
| S2 | M | Nerida settings: download / delete / provider actions use native confirm; download progress lives only in a pill. | `NeridaSettings.tsx` |
| S3 | M | Provider form: no inline validation for base URL / API key; errors from `listModels` appear as raw strings. | `NeridaSettings.tsx` |
| S4 | M | `ExportDialog`, `WorkspaceDialog`, `ImportMetaDialog`, `PromoteDialog`, `NamePrompt` each style their header, footer and buttons slightly differently; use one dialog shell with primary/secondary buttons. | those files |
| S5 | L | Secondary "Delete" link-buttons (`text-[12.5px] px-2.5 py-1`) vs other dialogs' buttons — sizes differ. | `NeridaSettings.tsx:355` |

---

## 2. Nerida AI — what exists today

### Providers and models (`src/lib/nerida.ts`, `ai.rs`)
- Model refs: `nerida:plus` (built-in), `ollama:<model>` (`http://127.0.0.1:11434/v1`), `custom:<providerId>:<model>` (presets: OpenAI, OpenRouter, Groq, Gemini (OpenAI-compat), LM Studio, Custom).
- API keys in OS keyring (`ai_set_key`), only sent to the origin they were saved for. Cloud models need a one-time consent.
- All providers go through one Rust command `ai_chat`: POST `/chat/completions`, `stream: true`, SSE parsed; `reasoning_content` wrapped as `<think>…</think>`. **No `tools`, `tool_choice`, `response_format` or `grammar` fields are ever sent.** `extra` passes sampler settings only.
- Built-in sampling: temp 0.2, top_p 0.9, top_k 20, min_p 0.05, repeat_penalty 1.1, `chat_template_kwargs.enable_thinking` = Thinking toggle. Effort (Fast/Balanced/Deep) = max_tokens 400/1024/4096 and note budget 6k/14k/14k chars.
- Chat history is sent in full each turn (no trimming) against an 8k context.

### Built-in engine (`ai.rs::ai_start`)
- llama.cpp `llama-server` **b12189**, Vulkan build by default; optional CUDA 12.4 build + cudart (~680 MB).
- Model: **Qwen3.5-2B Q4_K_M** (unsloth GGUF, 1.28 GB). Vision add-on: Qwen3.5-2B mmproj F16 (scanned PDFs).
- Flags: `-m <gguf> --host 127.0.0.1 --port <random> -c 8192 --jinja -np 1 --cache-reuse 256`, random API key; vision adds `--mmproj … --image-max-tokens 512`; GPU: cpu `-ngl 0`, cuda `-ngl 99 -fa on`, auto/Vulkan `-ngl 99 -fa off [--device X]`.
- **`--jinja` is on** (so OpenAI-style `tools` would be accepted by the server). **No GBNF grammars or JSON schema** are used anywhere.
- One server process, restarted when model/GPU changes; killed on app exit.

### Context and related notes
- `relatedNotes(pageId)`: open note + direct children + outgoing links + backlinks. `@`-mentions add notes; chips can be excluded.
- `buildContext`: BlockNote JSON → plain text (`docText`), split into paragraphs; over budget, keeps paragraphs by keyword overlap / √length (no embeddings).
- With no note attached, `searchNotes` runs the app's page search per keyword and takes top 3 notes (≥2 word hits).
- `neridaGuard.SourceBook`: sources fenced in numbered `<source>` tags with a per-request id, injection lines scrubbed, replies cite `[n]` and a footer lists sources (titles only, not clickable links to notes).
- Prompt layout: system (IDENTITY + FEATURES + STYLE + NO_EDIT, optional tutor/Fast), notes put into the **last user message**, request last.

### Pre-answer "tools" (`neridaTools.ts`) — app-run, not model-called
- `calc` (safe arithmetic parser), `convert` (units, temperature, days-until via `findDate`), `define` (dictionaryapi.dev), `searchWeb` (Wikipedia → DuckDuckGo HTML fallback; only when the globe is on **and** the model is built-in). Results injected as "Exact results worked out by the app".
- `web_get` is host-allow-listed: en.wikipedia.org, html.duckduckgo.com, api.dictionaryapi.dev.
- `neridaTask.detectTask`: regex date + "remind me" → task card (`NeridaTaskCard`), nothing saved until confirmed.

### Edit flows
- `neridaEdit.ts` (editor selection): Improve, Grammar, Custom, Fix spelling (offline spellchecker, no model), Synonyms, Continue writing, Essay outline, Essay feedback. Text fenced with per-request id; chatter stripped; output defused by `neridaSafeMarkdown`; `editWarning` flags steered/meaning-changing results.
- `neridaChatEdit.ts` (chat "change my note"): regex `isEditRequest` → numbered blocks → model returns `REPLACE n:` / `ADD AFTER n:` / `TABLE:` lines → `parseEdits` → proposals applied highlighted in blue; Accept/Reject in note or chat. `markAllDone` ticks checklists with no model call. Asks "which part?" when target unclear. Only works on the note open next to the panel.

### Study (`neridaStudy.ts`)
- Model gets **one sentence at a time** and writes one Q whose answer must be copied from that sentence (else dropped). App builds cloze, true/false and MCQ distractors from real answers. `generateCards` → note's "Flashcards" toggle; `generateQuestions` → tests. Difficulty easy/medium/hard. Slow (one call per fact) but grounded.

### Files and PDFs
- `neridaPdf`: page-tagged text, best-matching pages for a question, `pageRange("pages 2-5")`, chunked summaries, garbled-scan detection, vision OCR per page (saved).
- `neridaFiles`: .pdf/.docx/.txt/.md/.csv/.json/.html text extraction; header comment says the attach button is "not wired yet" but `NeridaPanel` imports and uses it — verify in Tauri.

---

## 3. Gaps per later phase

**Phase 1 — Shared UI groundwork:** themed `ConfirmDialog` (replace all `confirm/alert`), one `Dialog` shell (role, focus trap, Escape, focus return), focus-ring utility, radius/shadow/type tokens, `Spinner`/`Skeleton`/`EmptyState`, labelled `IconButton`.

**Phase 2 — UI polish:** items H1–H5, E1–E6, N1–N8, S1–S5 above. Tauri click-through still owed.

**Phase 3 — Smarter note context:**
- `searchNotes` is keyword-AND per word, top 3, and skipped whenever any note is attached; no ranking by title, recency or tags; no embeddings/BM25.
- Context selection is per-paragraph keyword overlap; headings above a kept paragraph are lost.
- Source footer lists titles only: make `[n]` / footer entries clickable links that open the note (and scroll to the block).
- History not trimmed to fit 8k context; long chats will overflow or push notes out.
- `relatedNotes` ignores tags, siblings, and folder.

**Phase 4 — Editor AI actions:** Improve/Grammar/Custom exist but no Shorten, Lengthen, Simplify, Tone, Translate, Summarize-selection; no `/ai` slash command in the editor (only the Nerida panel has `/`); no side-by-side or inline diff preview (result replaces/inserts after the dialog; chat edits show blue blocks, not a word diff).

**Phase 4.5 — Agent tools:** nothing model-called exists. `ai_chat` must pass `tools`/`tool_choice` and parse `delta.tool_calls` (streamed, partial JSON) — currently only `content`/`reasoning_content` are read. Need a tool registry + loop in TS, Accept/Reject cards (`NeridaTaskCard` and edit proposals are reusable patterns), and undo. Existing app events to wrap: `NERIDA_NOTE` (create note), `PROPOSE` (edit), `saveCards`, `NERIDA_TASK`, `api.searchPages`, `api.getPage`, trash APIs. Missing: rename/move/tag/link/folder/mindmap/calendar entry points callable from lib code. Ollama and cloud providers support `tools` natively; built-in needs Phase 8.

**Phase 5 — Study AI:** one-call-per-sentence is slow; no explanation of wrong answers, no spaced-repetition-aware generation (`srs.ts` not consulted), no "quiz me on weak cards", no mind-map generation from notes.

**Phase 6 — Speed and models:** single model (Qwen3.5-2B Q4); no model choice by RAM/GPU; `-c 8192` fixed; `-np 1` means the panel and editor actions queue; no warm-up at app start (first message waits for "Waking up"); no prompt caching across turns beyond `--cache-reuse 256`; history resent uncompressed.

**Phase 7 — Check and ship:** no automated tests found for the nerida libs; `neridaFiles.ts` comment is stale.

**Phase 8 — Built-in tool-calling reliability:** `--jinja` already on (good); no GBNF/`json_schema`; no router step; would need a narrowed tool list per request, few-shot examples, validation + retry, and regex "app shortcuts" (the `detectTask`/`isEditRequest`/`markAllDone` pattern already does this for three intents). A 2B model will be the weak point; grammar-constrained `{"tool":…,"args":…}` output is the safest route.
