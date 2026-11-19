# Android handoff: export/import + mobile Tags

Branch: `android` (pushed; last commit `0ea20eb`). Nothing from this task is coded yet.

## Decisions (user)
- Export: **one page** (with subpages) from the open page's ⋯ menu → Android **share sheet**.
- Import: **tap a .ocean in Files/WhatsApp opens Oceanic** and imports it.
- Import with date/status/tags: same question as PC (`ImportMetaDialog`), restyled as a **bottom sheet**.
- Tags: make the **Tag manager (Tags & status, `TagsPanel`)** mobile — full screen. Page tag picker / date / status: not in scope.
- Keep code minimal.

## 1. Export (share sheet)
- Build bytes with `buildOceanFile(page.id, pages, loadBlocks, true, true)` (`src/lib/oceanFile.ts`, used in `ExportDialog.tsx:87`).
- Android WebView has no `navigator.share` for files, so add a tiny share bridge:
  - Rust command (mobile only): write bytes to `app.path().app_cache_dir()/share/<title>.ocean`.
  - Kotlin: `ACTION_SEND` intent with a `FileProvider` URI (provider already in `AndroidManifest.xml`; add `<cache-path name="share" path="share/"/>` to `res/xml/file_paths.xml`), `type="application/octet-stream"`, `FLAG_GRANT_READ_URI_PERMISSION`, `Intent.createChooser`.
  - Hook Kotlin via a local Tauri plugin: `tauri::plugin::Builder::new("share").setup(|_, api| { api.register_android_plugin("io.github.mystithedev.oceanic", "SharePlugin")?; Ok(()) })`, class `SharePlugin : Plugin` with `@Command fun share(invoke)` in `gen/android/app/src/main/java/io/github/mystithedev/oceanic/`. Or use a community plugin (`tauri-plugin-sharesheet`) if it builds — less code.
- UI: add **Export** to the ⋯ menu in `src/mobile/MobileShell.tsx` (next to Pin/Duplicate/Trash). Pass an `onExport` handler from `App.tsx`.
- Settings → Data: replace the "Coming soon" rows (`MobileSettings.tsx:224-227`).

## 2. Import (open from Files)
- Manifest already has VIEW intent-filters for `.ocean` / `.omap` (auto-generated) — but `pathPattern` alone doesn't match `content://` URIs from Files/WhatsApp. Add a filter with `android:scheme="content"` + `android:mimeType="application/octet-stream"` (and `*/*` fallback if needed).
- Kotlin `MainActivity`: in `onCreate` and `onNewIntent`, if `intent.action == VIEW`, read `contentResolver.openInputStream(intent.data)` to bytes, and pass to the web side (emit event `open-file-bytes` with base64 + name, or write to cache and emit the path to reuse the existing `open-file` listener in `App.tsx:~1231`, which calls `importNotes([...], true)`).
- `launch_file` / `open-file` are desktop; make sure the mobile path triggers the same `openFile`.
- `ImportMetaDialog` (`metaAsk`, `App.tsx:1969`): on `isMobile`, render it as a bottom sheet (reuse `.ocs-sheet` styles from `src/mobile/mobile-settings.css`). Same for the duplicate ask (`dupAsk`).

## 3. Mobile Tag manager
- `TagsPanel` is opened by `onTags` (`App.tsx:1441`, rendered at `:1954`). On mobile render a new `src/mobile/MobileTags.tsx` instead: full-screen like `MobileSettings` (`.ocs` layout, back button, history back handling — copy the `pushed` counter pattern).
- Rows: tag colour dot + name + page count; tap → sheet: Rename, Colour (dots), Delete (uses `useConfirmDelete`). Section for statuses the same way. Handlers already exist in App.tsx (`editTags`, rename at `:783`, `deleteTag` `:789`, `createTag`). "+ New tag" button at the bottom.

## 4. Test + ship
- Emulator: `npx tauri android dev Oceanic_Phone < /dev/null` from repo root (env: ANDROID_HOME, NDK_HOME=ndk/28.2.13676358, JAVA_HOME=jdk-26, `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`).
- Check: export a page → share sheet → save to Files; tap that file in Files → Oceanic imports, meta sheet shows; Tags rename/recolour/delete; Android back steps out.
- Commit on `android`, push.
