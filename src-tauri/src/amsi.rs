//! Malware scan for anything brought into Oceanic, offline, with the antivirus
//! already on the PC. Two layers:
//!  1. AMSI (Windows Antimalware Scan Interface): instant, in memory; catches
//!     malicious scripts and text, but not most malicious binaries.
//!  2. Windows Defender's file scanner (MpCmdRun): the bytes are written to a
//!     private temp file and scanned like any file, archives included, so one
//!     scan covers everything inside a zip. Skipped when Defender isn't there.
//! Verdicts are cached by SHA-256, so opening the same file again is instant.
//! On a detection the app gets a `malware-detected` event (the warning) and
//! the import fails.

use std::collections::HashMap;
use std::sync::Mutex;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Clean,
    Malware,
    /// No antivirus answered (none installed, turned off, or not Windows).
    Unavailable,
}

static CACHE: Mutex<Option<HashMap<[u8; 32], Verdict>>> = Mutex::new(None);

/* ------------------------------------------------------------------- AMSI */

#[cfg(windows)]
fn amsi(name: &str, data: &[u8]) -> Verdict {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Antimalware::*;
    let Ok(len) = u32::try_from(data.len()) else { return Verdict::Unavailable };
    unsafe {
        let app = HSTRING::from("Oceanic");
        let Ok(ctx) = AmsiInitialize(PCWSTR(app.as_ptr())) else { return Verdict::Unavailable };
        let session = AmsiOpenSession(ctx).ok();
        let content = HSTRING::from(name);
        let result = AmsiScanBuffer(ctx, data.as_ptr().cast(), len, PCWSTR(content.as_ptr()), session);
        if let Some(s) = session {
            AmsiCloseSession(ctx, s);
        }
        AmsiUninitialize(ctx);
        match result {
            // AmsiResultIsMalware: 32768 and above means "detected".
            Ok(r) if r.0 >= AMSI_RESULT_DETECTED.0 => Verdict::Malware,
            Ok(_) => Verdict::Clean,
            Err(_) => Verdict::Unavailable,
        }
    }
}

/* -------------------------------------------------------- Defender (file) */

#[cfg(windows)]
fn mpcmdrun() -> Option<std::path::PathBuf> {
    // The platform folder holds the up-to-date engine; Program Files has the inbox copy.
    let platform = std::path::Path::new(r"C:\ProgramData\Microsoft\Windows Defender\Platform");
    let newest = std::fs::read_dir(platform)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path().join("MpCmdRun.exe"))
        .filter(|p| p.exists())
        .max();
    newest.or_else(|| {
        let p = std::path::PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into())).join(r"Windows Defender\MpCmdRun.exe");
        p.exists().then_some(p)
    })
}

#[cfg(windows)]
fn defender(app: &AppHandle, name: &str, data: &[u8]) -> Verdict {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Some(exe) = mpcmdrun() else { return Verdict::Unavailable };
    let Ok(dir) = app.path().app_cache_dir().map(|d| d.join("scan")) else { return Verdict::Unavailable };
    if std::fs::create_dir_all(&dir).is_err() {
        return Verdict::Unavailable;
    }
    // Same extension as the original: some detections depend on the file type.
    let ext: String = std::path::Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("bin").chars().filter(|c| c.is_ascii_alphanumeric()).take(10).collect();
    let file = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), if ext.is_empty() { "bin" } else { &ext }));
    // Real-time protection may block or remove the file as it's written: that's a detection too.
    if std::fs::write(&file, data).is_err() {
        return Verdict::Malware;
    }
    let status = std::process::Command::new(exe)
        .args(["-Scan", "-ScanType", "3", "-DisableRemediation", "-File"])
        .arg(&file)
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    let gone = !file.exists();
    let _ = std::fs::remove_file(&file);
    match status {
        // MpCmdRun: 0 = no threats, 2 = threats found.
        Ok(s) if s.code() == Some(2) => Verdict::Malware,
        _ if gone => Verdict::Malware,
        Ok(s) if s.code() == Some(0) => Verdict::Clean,
        _ => Verdict::Unavailable,
    }
}

/* ----------------------------------------------------------------- shared */

/// `quick` = AMSI only (files inside a zip that was already file-scanned as a whole).
fn scan(app: &AppHandle, name: &str, data: &[u8], quick: bool) -> Verdict {
    if data.is_empty() {
        return Verdict::Clean;
    }
    let hash: [u8; 32] = Sha256::digest(data).into();
    if let Some(v) = CACHE.lock().unwrap().as_ref().and_then(|c| c.get(&hash).copied()) {
        if v == Verdict::Malware || !quick {
            return v;
        }
    }
    #[cfg(windows)]
    let v = match amsi(name, data) {
        Verdict::Malware => Verdict::Malware,
        a if quick => a,
        a => match defender(app, name, data) {
            Verdict::Unavailable => a,
            d => d,
        },
    };
    #[cfg(not(windows))]
    let v = {
        let _ = (app, name, quick);
        Verdict::Unavailable
    };
    if v != Verdict::Unavailable && !quick {
        CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(hash, v);
    }
    v
}

/// Scans `data`; on a detection shows the warning and returns an error that stops the import.
pub fn check(app: &AppHandle, name: &str, data: &[u8]) -> Result<(), String> {
    if scan(app, name, data, false) != Verdict::Malware {
        return Ok(());
    }
    let _ = app.emit("malware-detected", name.to_string());
    Err(format!("MALWARE: {name} was blocked because your antivirus flagged it as malware."))
}

/// Scan from the page (note imports, zip contents). Raw bytes in the body, the file name in
/// the `x-name` header (URI-encoded); `x-quick: 1` = AMSI only. Runs off the main thread:
/// the file scan takes a second or two.
#[tauri::command]
pub async fn scan_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Verdict, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("Expected raw bytes".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let name = header("x-name").map(|v| percent_decode(&v)).unwrap_or_else(|| "file".into());
    let quick = header("x-quick").as_deref() == Some("1");
    let data = data.clone();
    let app2 = app.clone();
    let n = name.clone();
    let verdict = tauri::async_runtime::spawn_blocking(move || scan(&app2, &n, &data, quick)).await.map_err(|e| e.to_string())?;
    if verdict == Verdict::Malware {
        let _ = app.emit("malware-detected", name);
    }
    Ok(verdict)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
