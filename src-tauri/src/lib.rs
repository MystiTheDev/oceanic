#[cfg(desktop)]
mod ai;
mod db;
mod scope;
mod amsi;

use scope::Scope;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(desktop)]
use tauri::WindowEvent;
use tauri_plugin_notification::NotificationExt;

/* ---------------------------------------------------------------- storage */

/// Set by `finish_splash` once the frontend has loaded its workspace; the
/// splash watcher thread (spawned in setup) uses it to decide whether the
/// splash page needs a forced dismissal.
static SPLASH_READY: AtomicBool = AtomicBool::new(false);

const SPLASH_FINISH_JS: &str =
    "window.__oceanicFinish = true; window.dispatchEvent(new Event('oceanic:finish'))";

/// The frontend reports it finished loading. The splash page runs its own
/// full timeline and then closes itself via `close_splash`; this just makes
/// sure its finish flag/event is set even if that page booted late.
#[tauri::command]
fn finish_splash(app: AppHandle) {
    SPLASH_READY.store(true, Ordering::Relaxed);
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.eval(SPLASH_FINISH_JS);
    }
    // Android/iOS: no splash window, so reveal the page once it has loaded.
    #[cfg(mobile)]
    show_main(&app);
}

/// The splash page calls this when its sequence is done: close it and reveal
/// the app window.
#[tauri::command]
fn close_splash(app: AppHandle) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    show_main(&app);
}

/// The splash starts its zoom-out: show the app behind it (it fades in) while
/// the splash, kept on top, finishes and then closes via `close_splash`.
#[tauri::command]
fn reveal_main(app: AppHandle) {
    #[cfg(mobile)]
    show_main(&app);
    #[cfg(desktop)]
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.set_always_on_top(true);
    }
    #[cfg(desktop)]
    show_main(&app);
    #[cfg(desktop)]
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.set_focus();
    }
    // Close it ourselves once its zoom-out has played, rather than waiting on the page.
    #[cfg(desktop)]
    let handle = app.clone();
    #[cfg(desktop)]
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(900));
        if let Some(splash) = handle.get_webview_window("splash") {
            let _ = splash.close();
        }
    });
}

/// Where the database lives: the folder chosen in Settings (recorded in
/// `storage.json` under the config dir), else the per-user app data dir.
pub(crate) fn storage_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    let config = app.path().app_config_dir()?.join("storage.json");
    let custom = std::fs::read_to_string(config)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("dir").and_then(|d| d.as_str()).map(PathBuf::from));
    match custom {
        Some(dir) if dir.join("oceanic.db").exists() => Ok(dir),
        _ => app.path().app_data_dir(),
    }
}

#[tauri::command]
fn get_storage_path(app: AppHandle) -> Result<String, String> {
    storage_dir(&app)
        .map(|d| d.join("oceanic.db").to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// Copies the database into `dir`, remembers it, and relaunches on the copy.
/// The old file is left in place as a backup.
#[tauri::command]
fn move_storage(app: AppHandle, db: State<db::Db>, scope: State<Scope>, dir: String) -> Result<(), String> {
    let dir = scope.take_storage_pick(std::path::Path::new(&dir))?;
    {
        let conn = db.0.lock().unwrap();
        db::copy_database_to(&conn, &dir)?;
    }
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let json = serde_json::json!({ "dir": dir.to_string_lossy() }).to_string();
    std::fs::write(config_dir.join("storage.json"), json).map_err(|e| e.to_string())?;
    app.restart();
}

/* ----------------------------------------------------------------- assets */

#[derive(serde::Serialize)]
struct AudioAsset {
    /// Absolute path of the copy in the app's assets folder.
    path: String,
    name: String,
}

const AUDIO_EXT: &[&str] = &["mp3", "m4a", "wav", "ogg", "aac", "flac", "webm", "opus"];

/// Extensions kept as-is for files added to notes (media and documents). Anything else is saved as `.bin`.
const UPLOAD_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic",
    "mp3", "m4a", "wav", "ogg", "aac", "flac", "webm", "opus",
    "mp4", "mov", "m4v", "mkv", "avi",
    "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf",
    "txt", "md", "csv", "json", "zip", "7z", "rar", "epub",
];

fn assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn audio_target(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !AUDIO_EXT.contains(&ext.as_str()) {
        return Err(format!("Not a supported audio file: {name}"));
    }
    Ok(assets_dir(app)?.join(format!("{}.{ext}", uuid::Uuid::new_v4())))
}

/// Copies an audio file picked in the file dialog into the assets folder, so
/// the note keeps working if the original moves.
#[tauri::command]
async fn import_audio(app: AppHandle, scope: State<'_, Scope>, src: String) -> Result<AudioAsset, String> {
    let src = scope.check(&src)?;
    let name = PathBuf::from(&src).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let target = audio_target(&app, &name)?;
    let data = scope.read(&src)?;
    amsi::check(&app, &name, &data)?;
    std::fs::write(&target, data).map_err(|e| e.to_string())?;
    Ok(AudioAsset { path: target.to_string_lossy().into_owned(), name })
}

/// Same, for a file dropped onto the page (the webview only has its bytes).
#[tauri::command]
async fn import_audio_bytes(app: AppHandle, name: String, data: Vec<u8>) -> Result<AudioAsset, String> {
    let target = audio_target(&app, &name)?;
    amsi::check(&app, &name, &data)?;
    std::fs::write(&target, data).map_err(|e| e.to_string())?;
    Ok(AudioAsset { path: target.to_string_lossy().into_owned(), name })
}

/// Any file BlockNote's media blocks upload (video, image, audio, file):
/// copied into the assets folder, keeping its extension.
#[tauri::command]
async fn import_file_bytes(app: AppHandle, name: String, data: Vec<u8>) -> Result<AudioAsset, String> {
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    // Pages and programs are stored inert (.bin): the asset protocol would serve an .html as a
    // live page, and an .exe/.bat could be launched from the assets folder.
    let ext = if UPLOAD_EXT.contains(&ext.as_str()) { format!(".{ext}") } else { ".bin".into() };
    let target = assets_dir(&app)?.join(format!("{}{ext}", uuid::Uuid::new_v4()));
    amsi::check(&app, &name, &data)?;
    std::fs::write(&target, data).map_err(|e| e.to_string())?;
    Ok(AudioAsset { path: target.to_string_lossy().into_owned(), name })
}

/* -------------------------------------------------------------------- pdf */

fn pdf_target(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(assets_dir(app)?.join(format!("{}.pdf", uuid::Uuid::new_v4())))
}

/// Copies a PDF picked in the file dialog into the assets folder and records it.
#[tauri::command]
async fn import_pdf(app: AppHandle, db: State<'_, db::Db>, scope: State<'_, Scope>, src: String) -> Result<db::PdfDoc, String> {
    let src = scope.check(&src)?;
    let name = PathBuf::from(&src).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let target = pdf_target(&app)?;
    let data = scope.read(&src)?;
    amsi::check(&app, &name, &data)?;
    std::fs::write(&target, data).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    db::insert_pdf(&conn, &target.to_string_lossy(), &name).map_err(db::err)
}

/// Same, for a dropped or pasted PDF (base64: PDFs are often large).
#[tauri::command]
async fn import_pdf_bytes(app: AppHandle, db: State<'_, db::Db>, name: String, data: String) -> Result<db::PdfDoc, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let target = pdf_target(&app)?;
    amsi::check(&app, &name, &bytes)?;
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    db::insert_pdf(&conn, &target.to_string_lossy(), &name).map_err(db::err)
}

/// The card's page-1 preview (PNG as base64), stored next to the PDF.
#[tauri::command]
fn save_pdf_thumb(app: AppHandle, db: State<db::Db>, id: String, data: String) -> Result<String, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid id".into());
    }
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let target = assets_dir(&app)?.join(format!("{id}.thumb.png"));
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    let path = target.to_string_lossy().into_owned();
    let conn = db.0.lock().unwrap();
    db::set_pdf_thumb(&conn, &id, &path).map_err(db::err)?;
    Ok(path)
}

/* ------------------------------------------------------------------- docs */

#[derive(serde::Serialize)]
struct DocFile {
    name: String,
    path: String,
    modified: u64,
}

/// Oceanic Docs: the .docx files in the user's Docs folder, newest first.
#[tauri::command]
fn docs_list(scope: State<Scope>, dir: String) -> Result<Vec<DocFile>, String> {
    let dir = scope.check_dir(&dir)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let is_docx = path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("docx")).unwrap_or(false);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        // Skip Word's "~$" lock files.
        if !is_docx || name.starts_with("~$") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(DocFile { name, path: path.to_string_lossy().into_owned(), modified });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
/// Read as base64: raw byte arrays serialize to ~4x-size JSON over IPC,
/// which made large docs (.docx with images) slow to open and save.
async fn docs_read(app: AppHandle, scope: State<'_, Scope>, path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);
    let bytes = scope.read(&path)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    amsi::check(&app, &name, &bytes)?;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(STANDARD.encode(bytes))
}

/// Atomic save: write a temp file next to it, then rename over the original.
#[tauri::command]
fn docs_write(scope: State<Scope>, path: String, data: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    scope.write_atomic(&path, &bytes)
}

/// A free path "<dir>/<name>.docx" (adds " 2", " 3"… if taken).
#[tauri::command]
fn docs_free_path(scope: State<Scope>, dir: String, name: String) -> Result<String, String> {
    scope.check_dir(&dir)?;
    Ok(free_path(PathBuf::from(&dir), &name))
}

fn free_path(base: PathBuf, name: &str) -> String {
    let name: String = name.chars().filter(|c| !r#"<>:"/|?*"#.contains(*c)).collect();
    let mut n = 1;
    loop {
        let file = if n == 1 { format!("{name}.docx") } else { format!("{name} {n}.docx") };
        let p = base.join(file);
        if !p.exists() {
            return p.to_string_lossy().into_owned();
        }
        n += 1;
    }
}

/// Renames a doc in place (same folder); returns the new path.
#[tauri::command]
fn docs_rename(scope: State<Scope>, path: String, name: String) -> Result<String, String> {
    let src = scope.check(&path)?;
    let clean: String = name.chars().filter(|c| !r#"<>:"/\|?*"#.contains(*c)).collect();
    let target = src.with_file_name(format!("{}.docx", clean.trim()));
    if target.exists() && target != src {
        return Err("A document with that name already exists".into());
    }
    std::fs::rename(&src, &target).map_err(|e| e.to_string())?;
    scope.add_file(&target, true);
    Ok(target.to_string_lossy().into_owned())
}

/// Moves a doc to the Recycle Bin.
#[tauri::command]
fn docs_trash(scope: State<Scope>, path: String) -> Result<(), String> {
    let path = scope.check(&path)?;
    #[cfg(desktop)]
    return trash::delete(&path).map_err(|e| e.to_string());
    #[cfg(mobile)]
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// "Name copy.docx" next to the original; returns its path.
#[tauri::command]
fn docs_duplicate(scope: State<Scope>, path: String) -> Result<String, String> {
    let src = scope.check(&path)?;
    let dir = src.parent().map(PathBuf::from).unwrap_or_default();
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let target = free_path(dir, &format!("{stem} copy"));
    std::fs::copy(&src, &target).map_err(|e| e.to_string())?;
    scope.add_file(std::path::Path::new(&target), true);
    Ok(target)
}

/// Opens File Explorer with the doc selected.
#[tauri::command]
fn docs_reveal(scope: State<Scope>, path: String) -> Result<(), String> {
    let path = scope.check(&path)?;
    std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Documents\Oceanic Docs, created on first use.
#[tauri::command]
fn docs_default_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Oceanic Docs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/* ----------------------------------------------------------------- sketch */

/// Oceanic Sketch: the images (.png/.jpg) in its folder, newest first.
#[tauri::command]
fn sketch_list(scope: State<Scope>, dir: String) -> Result<Vec<DocFile>, String> {
    let dir = scope.check_dir(&dir)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
        if !["png", "jpg", "jpeg"].contains(&ext.as_str()) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        out.push(DocFile { name, path: path.to_string_lossy().into_owned(), modified });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

/// Documents\Oceanic Sketch, created on first use.
#[tauri::command]
fn sketch_default_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Oceanic Sketch");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/* ------------------------------------------------------------------- tray */

#[cfg(mobile)]
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("document.documentElement.classList.add('oc-reveal')");
    }
}

#[cfg(desktop)]
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // The page starts transparent (index.html) and fades in once revealed.
        let _ = w.eval("document.documentElement.classList.add('oc-reveal')");
    }
}

#[cfg(desktop)]
/// Tray left-click: hide only when Oceanic is already in front; if it's hidden,
/// minimised or behind other windows, bring it to the front instead.
fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let in_front = w.is_visible().unwrap_or(false)
            && !w.is_minimized().unwrap_or(false)
            && w.is_focused().unwrap_or(false);
        if in_front {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

#[cfg(desktop)]
/// A second launch of the Oceanic executable (desktop shortcut, taskbar, …)
/// lands here inside the FIRST instance. If the main window is already
/// visible, restore + focus it; if the app is still initializing behind the
/// splash (main hidden), tell the user it's already starting instead of
/// yanking the main window out from under the splash sequence.
fn handoff_existing_app(app: &AppHandle) {
    // Only the splash means "still starting"; hidden in tray → bring it back.
    if app.get_webview_window("splash").is_none() {
        show_main(app);
        return;
    }
    // Still initializing (splash running) or window briefly unavailable.
    let _ = app
        .notification()
        .builder()
        .title("Oceanic")
        .body("Oceanic is already starting…")
        .show();
}

/// Desktop notification (Nerida finished while the app was in the background).
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[derive(serde::Deserialize)]
struct RecentItem {
    id: String,
    title: String,
}

#[cfg(desktop)]
/// Tray menu, grouped: show · create/search · apps & views · quit.
fn tray_menu(app: &AppHandle, recent: &[RecentItem], docs: &[RecentItem], today: &[RecentItem]) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let recent_items = recent
        .iter()
        .map(|r| MenuItem::with_id(app, format!("recent:{}", r.id), &r.title, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let empty = MenuItem::with_id(app, "recent-none", "No recent pages", false, None::<&str>)?;
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = if recent_items.is_empty() {
        vec![&empty]
    } else {
        recent_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect()
    };
    let recent_menu = Submenu::with_items(app, "Recent pages", true, &refs)?;
    // Recent Oceanic Docs files (ids are file paths).
    let doc_items = docs
        .iter()
        .map(|r| MenuItem::with_id(app, format!("doc:{}", r.id), &r.title, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let no_docs = MenuItem::with_id(app, "docs-none", "No recent documents", false, None::<&str>)?;
    let doc_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = if doc_items.is_empty() {
        vec![&no_docs]
    } else {
        doc_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect()
    };
    let docs_menu = Submenu::with_items(app, "Recent documents", true, &doc_refs)?;
    // Pages due today (ids are page ids, opened like recent pages).
    let today_items = today
        .iter()
        .map(|r| MenuItem::with_id(app, format!("recent:{}", r.id), &r.title, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let no_today = MenuItem::with_id(app, "today-none", "Nothing due today", false, None::<&str>)?;
    let today_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = if today_items.is_empty() {
        vec![&no_today]
    } else {
        today_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect()
    };
    let today_menu = Submenu::with_items(app, "Today's agenda", true, &today_refs)?;
    let new_menu = Submenu::with_items(
        app,
        "New",
        true,
        &[&item("new_page", "Page")?, &item("new_doc", "Document (Oceanic Docs)")?, &item("new_sketch", "Sketch (Oceanic Sketch)")?, &item("new_mindmap", "Mindmap")?],
    )?;
    Menu::with_items(
        app,
        &[
            &item("show", "Show Oceanic")?,
            &PredefinedMenuItem::separator(app)?,
            &new_menu,
            &item("search", "Search…")?,
            &item("nerida", "Open Nerida")?,
            &today_menu,
            &PredefinedMenuItem::separator(app)?,
            &item("mindmap", "Oceanic Mindmap")?,
            &item("docs", "Oceanic Docs")?,
            &item("sketch", "Oceanic Sketch")?,
            &item("calendar", "Calendar")?,
            &PredefinedMenuItem::separator(app)?,
            &recent_menu,
            &docs_menu,
            &PredefinedMenuItem::separator(app)?,
            &item("settings", "Settings")?,
            &item("check_updates", "Check for updates…")?,
            &item("quit", "Quit Oceanic")?,
        ],
    )
}

/// The app sends its last opened pages so the tray's "Recent pages" stays current.
#[tauri::command]
fn set_tray_recent(app: AppHandle, items: Vec<RecentItem>, docs: Option<Vec<RecentItem>>, today: Option<Vec<RecentItem>>) -> Result<(), String> {
    #[cfg(mobile)]
    let _ = (app, items, docs, today);
    #[cfg(desktop)]
    let menu = tray_menu(&app, &items, &docs.unwrap_or_default(), &today.unwrap_or_default()).map_err(|e| e.to_string())?;
    #[cfg(desktop)]
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app, &[], &[], &[])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Oceanic")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "show" => show_main(app),
                "quit" => app.exit(0),
                "new_page" | "search" | "nerida" | "mindmap" | "calendar" | "new_doc" | "new_sketch" | "new_mindmap" | "docs" | "sketch" | "settings" | "check_updates" => {
                    show_main(app);
                    let _ = app.emit("tray-action", id);
                }
                _ => {
                    if let Some(page) = id.strip_prefix("recent:") {
                        show_main(app);
                        let _ = app.emit("tray-open-page", page);
                    } else if let Some(path) = id.strip_prefix("doc:") {
                        show_main(app);
                        let _ = app.emit("tray-open-page", format!("doc:{path}"));
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(desktop)]
/// The window's X hides to the tray unless "close to tray" is turned off in
/// Settings. The first time, a notification says Oceanic is still running.
fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    let app = window.app_handle();
    let db = app.state::<db::Db>();
    let conn = db.0.lock().unwrap();
    if db::read_setting(&conn, "closeToTray").as_deref() == Some("false") {
        return;
    }
    api.prevent_close();
    let _ = window.hide();
    if db::read_setting(&conn, "trayNoticeShown").is_none() {
        let _ = db::write_setting(&conn, "trayNoticeShown", "true");
        let _ = app
            .notification()
            .builder()
            .title("Oceanic is still running")
            .body("It's in the system tray. Right-click the tray icon and choose Quit to exit.")
            .show();
    }
}

/// The first .ocean / .omap path in a command line (Windows passes the double-clicked file).
fn oceanic_file_arg(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| {
        let l = a.to_ascii_lowercase();
        l.ends_with(".ocean") || l.ends_with(".omap")
    }).cloned()
}

/// File Oceanic was launched with (if any), for the app to open once it's ready.
#[tauri::command]
fn launch_file(scope: State<Scope>) -> Option<String> {
    let f = oceanic_file_arg(&std::env::args().collect::<Vec<_>>())?;
    scope.add_file(std::path::Path::new(&f), true);
    Some(f)
}

#[cfg(target_os = "android")]
struct ApkUpdater(tauri::plugin::PluginHandle<tauri::Wry>);

/// Downloads a release APK (progress 0-100, or -1 if unknown) and opens the installer.
/// Fails with "needs-permission" after sending the user to "Install unknown apps".
#[tauri::command]
#[allow(unused_variables)]
async fn apk_install(app: AppHandle, url: String, on_progress: tauri::ipc::Channel<serde_json::Value>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return app
        .state::<ApkUpdater>()
        .0
        .run_mobile_plugin::<()>("install", serde_json::json!({ "url": url, "onProgress": on_progress }))
        .map_err(|e| e.to_string());
    #[cfg(not(target_os = "android"))]
    Err("Android only".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Desktop-only plugins: single instance, window state, self-updater.
    #[cfg(desktop)]
    let builder = builder
        // Must be the FIRST plugin: on a second launch of the executable
        // (desktop shortcut, taskbar, …) the new process forwards to this
        // running one and exits immediately.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handoff_existing_app(app);
            // Double-clicked .ocean / .omap while Oceanic runs: open it here.
            if let Some(file) = oceanic_file_arg(&args) {
                app.state::<Scope>().add_file(std::path::Path::new(&file), true);
                let _ = app.emit("open-file", file);
            }
        }))
        // Remember the main window's size, position and maximized state between launches.
        // Visibility is left alone: the splash decides when the window appears.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["splash"])
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build());
    // Android: share sheet for export, .ocean files opened from other apps.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("share")
            .setup(|_, api| {
                api.register_android_plugin("io.github.mystithedev.oceanic", "SharePlugin")?;
                Ok(())
            })
            .build(),
    );
    // Android self-updater: Kotlin side in gen/android (UpdaterPlugin.kt).
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("apk-updater")
            .setup(|app, api| {
                app.manage(ApkUpdater(api.register_android_plugin("io.github.mystithedev.oceanic", "UpdaterPlugin")?));
                Ok(())
            })
            .build(),
    );
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = storage_dir(app.handle())?;
            let conn = db::open(&dir)?;
            let legacy = || {
                let get = |k: &str| conn.query_row("SELECT value FROM settings WHERE key = ?1", [k], |r| r.get::<_, String>(0)).ok();
                let list = |k: &str| get(k).and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok()).unwrap_or_default();
                let roots = ["docsFolder", "sketchFolder"].iter().filter_map(|k| get(k)).collect();
                let files = [list("recentDocs"), list("recentSketches")].concat();
                (roots, files)
            };
            app.manage(Scope::load(app.handle(), legacy)?);
            app.manage(db::Db(Mutex::new(conn)));
            #[cfg(desktop)]
            app.manage(ai::Ai::default());
            #[cfg(desktop)]
            build_tray(app.handle())?;

            // Splash watcher: the splash page runs its own timeline and calls
            // `close_splash` when done. This thread only covers failure
            // paths: a page that never signalled, or a stuck/blank page.
            #[cfg(desktop)]
            let handle = app.handle().clone();
            #[cfg(desktop)]
            std::thread::spawn(move || {
                // Give the app ample time to load before treating the splash
                // as stuck (the page auto-leaves after 12s on its own too).
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
                loop {
                    if handle.get_webview_window("splash").is_none() {
                        break;
                    }
                    if std::time::Instant::now() >= deadline {
                        if let Some(splash) = handle.get_webview_window("splash") {
                            let _ = splash.eval(SPLASH_FINISH_JS);
                            std::thread::sleep(std::time::Duration::from_millis(700));
                        }
                        if let Some(splash) = handle.get_webview_window("splash") {
                            let _ = splash.close();
                        }
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                show_main(&handle);
            });
            Ok(())
        })
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            let (window, event) = (_window, _event);
            #[cfg(desktop)]
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Only the main window hides to the tray; other windows
                // (the splash) close normally.
                if window.label() == "main" {
                    on_close_requested(window, api);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            apk_install,
            #[cfg(desktop)]
            ai::ai_status,
            #[cfg(desktop)]
            ai::ai_download,
            #[cfg(desktop)]
            ai::ai_cancel_download,
            #[cfg(desktop)]
            ai::ai_delete_model,
            #[cfg(desktop)]
            ai::ai_start,
            #[cfg(desktop)]
            ai::ai_gpus,
            #[cfg(desktop)]
            ai::ai_chat,
            #[cfg(desktop)]
            ai::ai_stop,
            #[cfg(desktop)]
            ai::ai_set_key,
            #[cfg(desktop)]
            ai::ai_list_models,
            #[cfg(desktop)]
            ai::web_get,
            scope::pick_open,
            scope::pick_save,
            scope::scope_info,
            scope::scope_forget,
            amsi::scan_bytes,
            db::get_pages,
            db::get_trashed_pages,
            db::get_page,
            db::create_page,
            db::save_page,
            db::rename_page,
            db::set_page_icon,
            db::toggle_pin_page,
            db::delete_page,
            db::restore_page,
            db::delete_page_forever,
            db::duplicate_page,
            db::update_page_parent,
            db::set_page_properties,
            db::get_pages_in_range,
            db::write_export_file,
            db::get_backlinks,
            db::get_links,
            db::get_canvas_positions,
            db::save_canvas_positions,
            db::get_canvas_edges,
            db::connect_pages,
            db::update_canvas_edge,
            db::delete_canvas_edge,
            db::list_concepts,
            db::get_page_previews,
            db::create_concept,
            db::update_concept,
            db::delete_concept,
            db::list_concept_resources,
            db::attach_resource,
            db::detach_resource,
            db::list_concept_groups,
            db::create_concept_group,
            db::update_concept_group,
            db::delete_concept_group,
            db::set_concept_group,
            db::layout_concept_group,
            db::set_page_group,
            db::get_tabs,
            db::save_tabs,
            db::get_workspaces,
            db::create_workspace,
            db::update_workspace,
            db::reorder_workspaces,
            db::delete_workspace,
            db::move_page_to_workspace,
            db::get_settings,
            db::search_pages,
            db::get_all_mindmaps,
            db::get_mindmap_by_id,
            db::create_mindmap,
            db::save_mindmap,
            db::delete_mindmap,
            db::set_setting,
            get_storage_path,
            finish_splash,
            close_splash,
            reveal_main,
            move_storage,
            import_audio,
            docs_list,
            docs_read,
            docs_write,
            docs_free_path,
            docs_rename,
            docs_trash,
            docs_duplicate,
            docs_reveal,
            docs_default_dir,
            sketch_list,
            launch_file,
            sketch_default_dir,
            set_tray_recent,
            import_audio_bytes,
            import_file_bytes,
            import_pdf,
            import_pdf_bytes,
            save_pdf_thumb,
            db::get_pdf_doc,
            db::save_pdf_doc_state,
            db::get_pdf_annotations,
            db::save_pdf_annotation,
            db::delete_pdf_annotation,
            db::batch_pdf_annotations,
            db::save_pdf_text,
            notify,
            db::get_pdf_text,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = _event {
                let app = _app;
                ai::shutdown(&app.state::<ai::Ai>());
            }
        });
}
