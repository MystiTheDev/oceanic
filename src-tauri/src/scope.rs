//! File-system scope for the custom file commands.
//!
//! The webview may only name paths that the user granted: folders and files
//! picked in a native dialog run from Rust (`pick_open` / `pick_save`), the
//! file Oceanic was launched with, and the app's own default folders. Grants
//! are kept in `scope.json` under the config dir, which no command lets the
//! webview write, so script running in the page can't widen them.
//!
//! - File grants expire after 90 days without use; folder grants last until
//!   the user clears them (Settings → Forget folder access).
//! - Reads and writes go through `read` / `write` / `write_atomic`, which check
//!   the file actually opened (its final path, after links) is still allowed, so
//!   swapping the path for a link between the check and the open doesn't work.

use std::io::{Read as _, Write as _};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Granted files kept between launches (recent docs, sketches, imports).
const MAX_FILES: usize = 500;
/// A granted file unused this long is forgotten.
const FILE_TTL_SECS: u64 = 90 * 24 * 3600;
/// `move_storage` only accepts the folder picked in Settings this recently.
const STORAGE_PICK_TTL: Duration = Duration::from_secs(10 * 60);

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct FileGrant {
    path: PathBuf,
    /// Unix seconds of the last use.
    used: u64,
}

/// `scope.json` before grant expiry stored files as bare paths.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum SavedFile {
    Grant(FileGrant),
    Path(PathBuf),
}

#[derive(Default, serde::Deserialize)]
struct Saved {
    #[serde(default)]
    roots: Vec<PathBuf>,
    #[serde(default)]
    files: Vec<SavedFile>,
}

#[derive(serde::Serialize)]
struct SavedOut<'a> {
    roots: &'a [PathBuf],
    files: &'a [FileGrant],
}

pub struct Scope {
    /// The app's own folders: always allowed, never saved or forgotten.
    builtin: Vec<PathBuf>,
    roots: Mutex<Vec<PathBuf>>,
    files: Mutex<Vec<FileGrant>>,
    /// Folder picked for the database in Settings, and when.
    storage_pick: Mutex<Option<(PathBuf, Instant)>>,
    store: PathBuf,
}

/// Absolute path with `.`/`..` resolved and symlinks followed where the path
/// exists. A path that doesn't exist yet (a Save As target) resolves through
/// its parent folder. Relative paths and `..` that can't be resolved are refused.
fn resolve(p: &Path) -> Option<PathBuf> {
    if !p.is_absolute() {
        return None;
    }
    if let Ok(c) = dunce::canonicalize(p) {
        return Some(c);
    }
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    let parent = dunce::canonicalize(p.parent()?).ok()?;
    Some(parent.join(p.file_name()?))
}

/// Windows paths compare case-insensitively.
fn key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    if cfg!(windows) { s.to_lowercase() } else { s }
}

fn under(p: &Path, root: &Path) -> bool {
    let (p, r) = (key(p), key(root));
    let r = r.trim_end_matches('\\');
    p == r || p.starts_with(&format!("{r}\\"))
}

/// Where an open file really is (links followed), from its handle.
#[cfg(windows)]
fn final_path(f: &std::fs::File) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED};
    let mut buf = vec![0u16; 1024];
    let n = unsafe { GetFinalPathNameByHandleW(HANDLE(f.as_raw_handle()), &mut buf, FILE_NAME_NORMALIZED) } as usize;
    if n == 0 || n > buf.len() {
        return None;
    }
    let p = PathBuf::from(std::ffi::OsString::from_wide(&buf[..n]));
    Some(dunce::simplified(&p).to_path_buf())
}

#[cfg(not(windows))]
fn final_path(_f: &std::fs::File) -> Option<PathBuf> {
    None
}

impl Scope {
    /// `legacy` gives the folders and files saved in app settings before this
    /// scope existed; it's read only once, when `scope.json` doesn't exist yet.
    pub fn load(app: &AppHandle, legacy: impl FnOnce() -> (Vec<String>, Vec<String>)) -> tauri::Result<Self> {
        let store = app.path().app_config_dir()?.join("scope.json");
        let first_run = !store.exists();
        let saved: Saved = std::fs::read_to_string(&store).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let docs = app.path().document_dir()?;
        let builtin: Vec<PathBuf> = [docs.join("Oceanic Docs"), docs.join("Oceanic Sketch"), app.path().app_data_dir()?.join("assets")]
            .into_iter()
            .filter_map(|d| {
                let _ = std::fs::create_dir_all(&d);
                resolve(&d)
            })
            .collect();
        let scope = Scope { builtin, roots: Mutex::new(Vec::new()), files: Mutex::new(Vec::new()), storage_pick: Mutex::new(None), store };
        for r in saved.roots {
            scope.add_root(&r, false);
        }
        let cutoff = now().saturating_sub(FILE_TTL_SECS);
        for f in saved.files.into_iter().rev() {
            let g = match f {
                SavedFile::Grant(g) => g,
                SavedFile::Path(path) => FileGrant { path, used: now() }, // old format: start the clock now
            };
            if g.used >= cutoff {
                scope.insert_file(&g.path, g.used);
            }
        }
        if first_run {
            let (roots, files) = legacy();
            for r in roots {
                scope.add_root(Path::new(&r), false);
            }
            for f in files {
                scope.add_file(Path::new(&f), false);
            }
        }
        scope.persist();
        Ok(scope)
    }

    fn persist(&self) {
        let roots = self.roots.lock().unwrap().clone();
        let files = self.files.lock().unwrap().clone();
        if let Some(dir) = self.store.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&SavedOut { roots: &roots, files: &files }) {
            let _ = std::fs::write(&self.store, json);
        }
    }

    fn allowed_root(&self, p: &Path) -> bool {
        self.builtin.iter().any(|r| under(p, r)) || self.roots.lock().unwrap().iter().any(|r| under(p, r))
    }

    fn add_root(&self, p: &Path, save: bool) {
        let Some(p) = resolve(p) else { return };
        if self.allowed_root(&p) {
            return;
        }
        self.roots.lock().unwrap().push(p);
        if save {
            self.persist();
        }
    }

    fn insert_file(&self, p: &Path, used: u64) {
        let Some(p) = resolve(p) else { return };
        let mut files = self.files.lock().unwrap();
        let k = key(&p);
        files.retain(|f| key(&f.path) != k);
        files.insert(0, FileGrant { path: p, used });
        files.truncate(MAX_FILES);
    }

    pub fn add_file(&self, p: &Path, save: bool) {
        self.insert_file(p, now());
        if save {
            self.persist();
        }
    }

    /// The resolved path when `p` is inside a granted folder or is a granted file.
    pub fn check(&self, p: impl AsRef<Path>) -> Result<PathBuf, String> {
        let p = p.as_ref();
        let denied = || format!("Oceanic isn't allowed to use this location: {}", p.display());
        let r = resolve(p).ok_or_else(denied)?;
        if self.allowed_root(&r) {
            return Ok(r);
        }
        let k = key(&r);
        let refreshed = {
            let mut files = self.files.lock().unwrap();
            let Some(g) = files.iter_mut().find(|f| key(&f.path) == k) else { return Err(denied()) };
            // Using a file keeps its grant; saved at most once a day per file.
            let stale = now().saturating_sub(g.used) > 24 * 3600;
            g.used = now();
            stale
        };
        if refreshed {
            self.persist();
        }
        Ok(r)
    }

    /// A folder must itself be granted (or sit inside a granted folder).
    pub fn check_dir(&self, p: impl AsRef<Path>) -> Result<PathBuf, String> {
        let r = resolve(p.as_ref()).ok_or("Invalid folder")?;
        if self.allowed_root(&r) {
            Ok(r)
        } else {
            Err(format!("Oceanic isn't allowed to use this folder: {}", p.as_ref().display()))
        }
    }

    /// After opening: the file really opened must still be allowed (no link swapped in meanwhile).
    fn verify_open(&self, f: &std::fs::File, path: &Path) -> Result<(), String> {
        match final_path(f) {
            Some(real) if self.allowed_root(&real) || self.files.lock().unwrap().iter().any(|g| key(&g.path) == key(&real)) => Ok(()),
            Some(_) => Err(format!("Oceanic isn't allowed to use this location: {}", path.display())),
            None if cfg!(windows) => Err("Couldn't confirm where this file is".into()),
            None => Ok(()),
        }
    }

    /// Reads a granted file.
    pub fn read(&self, path: impl AsRef<Path>) -> Result<Vec<u8>, String> {
        let p = self.check(path.as_ref())?;
        let mut f = std::fs::File::open(&p).map_err(|e| e.to_string())?;
        self.verify_open(&f, &p)?;
        let mut out = Vec::new();
        f.read_to_end(&mut out).map_err(|e| e.to_string())?;
        Ok(out)
    }

    /// Replaces a granted file's contents (created if missing).
    pub fn write(&self, path: impl AsRef<Path>, data: &[u8]) -> Result<(), String> {
        let p = self.check(path.as_ref())?;
        // No truncate on open: nothing is changed until the opened file is confirmed.
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(false).open(&p).map_err(|e| e.to_string())?;
        self.verify_open(&f, &p)?;
        f.set_len(0).map_err(|e| e.to_string())?;
        f.write_all(data).map_err(|e| e.to_string())
    }

    /// Atomic save: a fresh temp file next to it (create_new, so a planted link can't be reused),
    /// confirmed, written, then renamed over the original.
    pub fn write_atomic(&self, path: impl AsRef<Path>, data: &[u8]) -> Result<(), String> {
        let p = self.check(path.as_ref())?;
        let tmp = PathBuf::from(format!("{}.{}.oceanic-tmp", p.display(), uuid::Uuid::new_v4().simple()));
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| e.to_string())?;
        let done = (|| {
            match final_path(&f) {
                Some(real) if real.parent().is_some_and(|d| key(d) == key(p.parent().unwrap_or(&p))) => {}
                None if !cfg!(windows) => {}
                _ => return Err(format!("Oceanic isn't allowed to use this location: {}", p.display())),
            }
            f.write_all(data).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
            drop(f);
            std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
        })();
        if done.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        done
    }

    /// The database may only move to the folder just picked for it in Settings (once).
    pub fn take_storage_pick(&self, dir: &Path) -> Result<PathBuf, String> {
        let r = resolve(dir).ok_or("Invalid folder")?;
        match self.storage_pick.lock().unwrap().take() {
            Some((p, at)) if key(&p) == key(&r) && at.elapsed() < STORAGE_PICK_TTL => Ok(r),
            _ => Err("Choose the folder again in Settings → Storage".into()),
        }
    }
}

/* ---------------------------------------------------------------- dialogs */

#[derive(serde::Deserialize)]
pub struct Filter {
    name: String,
    extensions: Vec<String>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PickOptions {
    title: Option<String>,
    #[serde(default)]
    filters: Vec<Filter>,
    #[serde(default)]
    directory: bool,
    #[serde(default)]
    multiple: bool,
    default_path: Option<String>,
    /// "storage": the folder is for the database (Settings → Storage), see `take_storage_pick`.
    purpose: Option<String>,
}

fn to_path(f: FilePath) -> Option<PathBuf> {
    f.into_path().ok()
}

fn builder(app: &AppHandle, o: &PickOptions) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut d = app.dialog().file();
    if let Some(t) = &o.title {
        d = d.set_title(t);
    }
    for f in &o.filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        d = d.add_filter(&f.name, &exts);
    }
    if let Some(p) = o.default_path.as_deref().map(PathBuf::from) {
        if p.is_dir() {
            d = d.set_directory(p);
        } else {
            if let Some(parent) = p.parent().filter(|x| x.is_dir()) {
                d = d.set_directory(parent);
            }
            if let Some(name) = p.file_name() {
                d = d.set_file_name(name.to_string_lossy());
            }
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        d = d.set_parent(&w);
    }
    d
}

/// Native Open dialog; whatever the user picks is granted. Returns a path,
/// a list of paths (`multiple`) or null, like the dialog plugin's `open`.
#[tauri::command]
pub async fn pick_open(app: AppHandle, scope: State<'_, Scope>, options: PickOptions) -> Result<serde_json::Value, String> {
    let d = builder(&app, &options);
    let out = if options.directory {
        let Some(p) = d.blocking_pick_folder().and_then(to_path) else { return Ok(serde_json::Value::Null) };
        if options.purpose.as_deref() == Some("storage") {
            // Not a general grant: only good for one move_storage call.
            *scope.storage_pick.lock().unwrap() = resolve(&p).map(|r| (r, Instant::now()));
        } else {
            scope.add_root(&p, true);
        }
        serde_json::json!(p)
    } else if options.multiple {
        let Some(ps) = d.blocking_pick_files() else { return Ok(serde_json::Value::Null) };
        let ps: Vec<PathBuf> = ps.into_iter().filter_map(to_path).collect();
        for p in &ps {
            scope.add_file(p, false);
        }
        scope.persist();
        serde_json::json!(ps)
    } else {
        let Some(p) = d.blocking_pick_file().and_then(to_path) else { return Ok(serde_json::Value::Null) };
        scope.add_file(&p, true);
        serde_json::json!(p)
    };
    Ok(out)
}

/// Native Save dialog; the chosen path is granted. `ensure_ext` is appended
/// (and granted) when the typed name has none of the filter extensions.
#[tauri::command]
pub async fn pick_save(app: AppHandle, scope: State<'_, Scope>, options: PickOptions, ensure_ext: Option<String>) -> Result<Option<String>, String> {
    let Some(mut p) = builder(&app, &options).blocking_save_file().and_then(to_path) else { return Ok(None) };
    if let Some(ext) = ensure_ext {
        let has = p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase());
        let ok = options.filters.iter().flat_map(|f| &f.extensions).any(|x| Some(x.to_lowercase()) == has);
        if !ok {
            let mut s = p.into_os_string();
            s.push(format!(".{ext}"));
            p = PathBuf::from(s);
        }
    }
    scope.add_file(&p, true);
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// How many folders and files Oceanic remembers (Settings → Privacy).
#[derive(serde::Serialize)]
pub struct ScopeInfo {
    folders: Vec<String>,
    files: usize,
}

#[tauri::command]
pub fn scope_info(scope: State<'_, Scope>) -> ScopeInfo {
    ScopeInfo { folders: scope.roots.lock().unwrap().iter().map(|p| p.to_string_lossy().into_owned()).collect(), files: scope.files.lock().unwrap().len() }
}

/// Forgets every folder and file the user granted (the app's own folders stay).
/// They're asked for again the next time they're used.
#[tauri::command]
pub fn scope_forget(scope: State<'_, Scope>) {
    scope.roots.lock().unwrap().clear();
    scope.files.lock().unwrap().clear();
    scope.persist();
}
