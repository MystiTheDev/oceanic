mod ai;
mod db;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
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
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.set_always_on_top(true);
    }
    show_main(&app);
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.set_focus();
    }
    // Close it ourselves once its zoom-out has played, rather than waiting on the page.
    let handle = app.clone();
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
fn move_storage(app: AppHandle, db: State<db::Db>, dir: String) -> Result<(), String> {
    let dir = PathBuf::from(dir);
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
fn import_audio(app: AppHandle, src: String) -> Result<AudioAsset, String> {
    let name = PathBuf::from(&src).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let target = audio_target(&app, &name)?;
    std::fs::copy(&src, &target).map_err(|e| e.to_string())?;
    Ok(AudioAsset { path: target.to_string_lossy().into_owned(), name })
}

/// Same, for a file dropped onto the page (the webview only has its bytes).
#[tauri::command]
fn import_audio_bytes(app: AppHandle, name: String, data: Vec<u8>) -> Result<AudioAsset, String> {
    let target = audio_target(&app, &name)?;
    std::fs::write(&target, data).map_err(|e| e.to_string())?;
    Ok(AudioAsset { path: target.to_string_lossy().into_owned(), name })
}

/// Any file BlockNote's media blocks upload (video, image, audio, file):
/// copied into the assets folder, keeping its extension.
#[tauri::command]
fn import_file_bytes(app: AppHandle, name: String, data: Vec<u8>) -> Result<AudioAsset, String> {
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();
    let target = assets_dir(&app)?.join(format!("{}{ext}", uuid::Uuid::new_v4()));
    std::fs::write(&target, data).map_err(|e| e.to_string())?;
    Ok(AudioAsset { path: target.to_string_lossy().into_owned(), name })
}

/* -------------------------------------------------------------------- pdf */

fn pdf_target(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(assets_dir(app)?.join(format!("{}.pdf", uuid::Uuid::new_v4())))
}

/// Copies a PDF picked in the file dialog into the assets folder and records it.
#[tauri::command]
fn import_pdf(app: AppHandle, db: State<db::Db>, src: String) -> Result<db::PdfDoc, String> {
    let name = PathBuf::from(&src).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let target = pdf_target(&app)?;
    std::fs::copy(&src, &target).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    db::insert_pdf(&conn, &target.to_string_lossy(), &name).map_err(db::err)
}

/// Same, for a dropped or pasted PDF (base64: PDFs are often large).
#[tauri::command]
fn import_pdf_bytes(app: AppHandle, db: State<db::Db>, name: String, data: String) -> Result<db::PdfDoc, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let target = pdf_target(&app)?;
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    db::insert_pdf(&conn, &target.to_string_lossy(), &name).map_err(db::err)
}

/// The card's page-1 preview (PNG as base64), stored next to the PDF.
#[tauri::command]
fn save_pdf_thumb(app: AppHandle, db: State<db::Db>, id: String, data: String) -> Result<String, String> {
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
fn docs_list(dir: String) -> Result<Vec<DocFile>, String> {
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
fn docs_read(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(STANDARD.encode(bytes))
}

/// Atomic save: write a temp file next to it, then rename over the original.
#[tauri::command]
fn docs_write(path: String, data: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let tmp = format!("{path}.oceanic-tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// A free path "<dir>/<name>.docx" (adds " 2", " 3"… if taken).
#[tauri::command]
fn docs_free_path(dir: String, name: String) -> String {
    let base = PathBuf::from(&dir);
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
fn docs_rename(path: String, name: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let clean: String = name.chars().filter(|c| !r#"<>:"/\|?*"#.contains(*c)).collect();
    let target = src.with_file_name(format!("{}.docx", clean.trim()));
    if target.exists() && target != src {
        return Err("A document with that name already exists".into());
    }
    std::fs::rename(&src, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

/// Moves a doc to the Recycle Bin.
#[tauri::command]
fn docs_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// "Name copy.docx" next to the original; returns its path.
#[tauri::command]
fn docs_duplicate(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let dir = src.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let target = docs_free_path(dir, format!("{stem} copy"));
    std::fs::copy(&src, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Opens File Explorer with the doc selected.
#[tauri::command]
fn docs_reveal(path: String) -> Result<(), String> {
    std::process::Command::new("explorer").arg(format!("/select,{path}")).spawn().map_err(|e| e.to_string())?;
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
fn sketch_list(dir: String) -> Result<Vec<DocFile>, String> {
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

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // The page starts transparent (index.html) and fades in once revealed.
        let _ = w.eval("document.documentElement.classList.add('oc-reveal')");
    }
}

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

#[derive(serde::Deserialize)]
struct RecentItem {
    id: String,
    title: String,
}

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
    let menu = tray_menu(&app, &items, &docs.unwrap_or_default(), &today.unwrap_or_default()).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

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
fn launch_file() -> Option<String> {
    oceanic_file_arg(&std::env::args().collect::<Vec<_>>())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the FIRST plugin: on a second launch of the executable
        // (desktop shortcut, taskbar, …) the new process forwards to this
        // running one and exits immediately.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handoff_existing_app(app);
            // Double-clicked .ocean / .omap while Oceanic runs: open it here.
            if let Some(file) = oceanic_file_arg(&args) {
                let _ = app.emit("open-file", file);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // Remember the main window's size, position and maximized state between launches.
        // Visibility is left alone: the splash decides when the window appears.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["splash"])
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = storage_dir(app.handle())?;
            let conn = db::open(&dir)?;
            app.manage(db::Db(Mutex::new(conn)));
            build_tray(app.handle())?;

            // Splash watcher: the splash page runs its own timeline and calls
            // `close_splash` when done. This thread only covers failure
            // paths: a page that never signalled, or a stuck/blank page.
            let handle = app.handle().clone();
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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Only the main window hides to the tray; other windows
                // (the splash) close normally.
                if window.label() == "main" {
                    on_close_requested(window, api);
                }
            }
        })
        .manage(ai::Ai::default())
        .invoke_handler(tauri::generate_handler![
            ai::ai_status,
            ai::ai_download,
            ai::ai_cancel_download,
            ai::ai_delete_model,
            ai::ai_start,
            ai::ai_gpus,
            ai::ai_chat,
            ai::ai_stop,
            ai::ai_set_key,
            ai::ai_list_models,
            ai::web_get,
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
            db::get_pdf_text,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                ai::shutdown(&app.state::<ai::Ai>());
            }
        });
}
