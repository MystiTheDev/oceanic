//! Nerida — Oceanic's AI. The built-in engine is llama.cpp's prebuilt
//! `llama-server`, downloaded (with the model) on first use and run as a
//! hidden local process. It speaks the OpenAI chat API, so `ai_chat` also
//! works against Ollama or any OpenAI-compatible provider.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

struct Asset {
    id: &'static str,
    file: &'static str,
    /// File of the previous model for this slot; still used until the new one is downloaded.
    legacy: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
}

const SERVER: Asset = Asset {
    id: "server",
    file: "llama-server.zip",
    legacy: "",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12189/llama-b12189-bin-win-cpu-x64.zip",
    sha256: "f912ea5e3e397c63405c81e732131ab0fa6e72411c80546bb5ad643f7dd82aac",
    size: 24_749_596,
};

// Chosen by benchmark on real notes (Nov 2026): Qwen3.5 replaced Qwen2.5, which
// copied notes back or stopped after the first section.
// Nerida Lite (Qwen3.5-0.8B) was retired; only Nerida AI remains.
const MODELS: [Asset; 1] = [
    Asset {
        id: "plus",
        file: "nerida-plus-q35-2b.gguf",
        legacy: "nerida-plus.gguf", // Qwen2.5-1.5B
        url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
        sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
        size: 1_280_835_840,
    },
];

/// The model file to run: the current one, or the previous version until it's updated.
fn model_file(d: &Path, a: &Asset) -> Option<PathBuf> {
    [a.file, a.legacy].into_iter().filter(|f| !f.is_empty()).map(|f| d.join(f)).find(|p| p.exists())
}

#[derive(Default)]
pub struct Ai {
    /// (model id, port, process)
    server: Mutex<Option<(String, u16, Child)>>,
    stop_chat: AtomicBool,
    stop_download: AtomicBool,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("nerida");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn server_exe(app: &AppHandle) -> Option<PathBuf> {
    fn find(p: &Path) -> Option<PathBuf> {
        for e in std::fs::read_dir(p).ok()?.flatten() {
            let path = e.path();
            if path.is_dir() {
                if let Some(f) = find(&path) {
                    return Some(f);
                }
            } else if path.file_name().is_some_and(|n| n == "llama-server.exe") {
                return Some(path);
            }
        }
        None
    }
    find(&dir(app).ok()?.join("server"))
}

fn asset(id: &str) -> Result<&'static Asset, String> {
    if id == "server" {
        return Ok(&SERVER);
    }
    MODELS.iter().find(|m| m.id == id).ok_or_else(|| format!("Unknown item {id}"))
}

#[derive(Serialize)]
pub struct ModelInfo {
    id: &'static str,
    size: u64,
    installed: bool,
    /// Only the previous model version is on disk: offer the update.
    outdated: bool,
}

#[derive(Serialize)]
pub struct AiStatus {
    server: bool,
    models: Vec<ModelInfo>,
    running: Option<String>,
    /// Nerida Lite files were found and deleted during this call.
    lite_removed: bool,
}

#[tauri::command]
pub fn ai_status(app: AppHandle, state: State<Ai>) -> Result<AiStatus, String> {
    let d = dir(&app)?;
    // Nerida Lite is retired: delete its files and tell the app once.
    let lite_removed = ["nerida-lite-q35-0.8b.gguf", "nerida-lite.gguf"]
        .iter()
        .filter(|f| std::fs::remove_file(d.join(f)).is_ok())
        .count()
        > 0;
    Ok(AiStatus {
        lite_removed,
        server: server_exe(&app).is_some(),
        models: MODELS
            .iter()
            .map(|m| ModelInfo { id: m.id, size: m.size, installed: model_file(&d, m).is_some(), outdated: !d.join(m.file).exists() && d.join(m.legacy).exists() })
            .collect(),
        running: state.server.lock().unwrap().as_ref().map(|s| s.0.clone()),
    })
}

/// Downloads `item` ("server" or "plus"), verifies its SHA-256 and
/// installs it. Progress is sent as `[received, total]`.
#[tauri::command]
pub async fn ai_download(app: AppHandle, state: State<'_, Ai>, item: String, on_progress: Channel<(u64, u64)>) -> Result<(), String> {
    let a = asset(&item)?;
    let d = dir(&app)?;
    let part = d.join(format!("{}.part", a.file));
    state.stop_download.store(false, Ordering::Relaxed);

    let res = reqwest::get(a.url).await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let total = res.content_length().unwrap_or(a.size);
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let (mut got, mut last) = (0u64, 0u64);
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if state.stop_download.load(Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(&part);
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hash.update(&chunk);
        got += chunk.len() as u64;
        if got - last > 1 << 20 || got == total {
            last = got;
            let _ = on_progress.send((got, total));
        }
    }
    drop(file);
    if format!("{:x}", hash.finalize()) != a.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err("Download was corrupted (checksum mismatch). Please try again.".into());
    }

    if item == "server" {
        let out = d.join("server");
        let _ = std::fs::remove_dir_all(&out);
        std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        let f = std::fs::File::open(&part).map_err(|e| e.to_string())?;
        zip::ZipArchive::new(f).and_then(|mut z| z.extract(&out)).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&part);
    } else {
        std::fs::rename(&part, d.join(a.file)).map_err(|e| e.to_string())?;
        // Updated: drop the previous version (stop it first if it's the one running).
        if d.join(a.legacy).exists() {
            if state.server.lock().unwrap().as_ref().is_some_and(|s| s.0 == item) {
                shutdown(&state);
            }
            let _ = std::fs::remove_file(d.join(a.legacy));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ai_cancel_download(state: State<Ai>) {
    state.stop_download.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn ai_delete_model(app: AppHandle, state: State<Ai>, model: String) -> Result<(), String> {
    let a = asset(&model)?;
    if state.server.lock().unwrap().as_ref().is_some_and(|s| s.0 == model) {
        shutdown(&state);
    }
    let d = dir(&app)?;
    for f in [a.file, a.legacy] {
        if d.join(f).exists() {
            std::fs::remove_file(d.join(f)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Starts (or reuses) the local engine for `model`; returns its base URL.
#[tauri::command]
pub async fn ai_start(app: AppHandle, state: State<'_, Ai>, model: String) -> Result<String, String> {
    let port = {
        let mut guard = state.server.lock().unwrap();
        if let Some((m, port, child)) = guard.as_mut() {
            if *m == model && child.try_wait().ok().flatten().is_none() {
                return Ok(format!("http://127.0.0.1:{port}/v1"));
            }
        }
        if let Some((_, _, mut child)) = guard.take() {
            let _ = child.kill();
        }
        let exe = server_exe(&app).ok_or("Nerida's engine isn't installed yet.")?;
        let gguf = model_file(&dir(&app)?, asset(&model)?).ok_or("This model isn't downloaded yet.")?;
        let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map_err(|e| e.to_string())?.port();
        let mut cmd = Command::new(&exe);
        cmd.arg("-m").arg(&gguf).args(["--host", "127.0.0.1", "--port", &port.to_string(), "-c", "8192", "--jinja"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let child = cmd.spawn().map_err(|e| match e.raw_os_error() {
            // 2 = file gone, 5 = access denied, 225 = Windows flagged it as a virus.
            Some(2 | 5 | 225) => "Your antivirus blocked or removed Nerida's engine (llama-server.exe, the official llama.cpp program). \
                Add Oceanic's nerida folder to your antivirus exclusions, then download the engine again from Settings → Nerida AI."
                .to_string(),
            _ => format!("Couldn't start Nerida: {e}"),
        })?;
        *guard = Some((model, port, child));
        port
    };

    let url = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    for _ in 0..240 {
        if client.get(format!("{url}/health")).send().await.is_ok_and(|r| r.status().is_success()) {
            return Ok(format!("{url}/v1"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Err("Nerida took too long to start.".into())
}

/* ---- API keys live in the OS keychain (Windows Credential Manager), never in files. */
fn key_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("oceanic-nerida", id).map_err(|e| e.to_string())
}

fn get_key(id: Option<&str>) -> Option<String> {
    key_entry(id?).ok()?.get_password().ok()
}

/// Saves (or with `None`, deletes) the API key for provider `id`.
#[tauri::command]
pub fn ai_set_key(id: String, key: Option<String>) -> Result<(), String> {
    let e = key_entry(&id)?;
    match key.filter(|k| !k.is_empty()) {
        Some(k) => e.set_password(&k).map_err(|e| e.to_string()),
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        },
    }
}

/// Model ids offered by an OpenAI-compatible server (`GET {base}/models`).
/// Used to detect Ollama and to fill a provider's model list.
#[tauri::command]
pub async fn ai_list_models(base_url: String, key_id: Option<String>) -> Result<Vec<String>, String> {
    let mut req = reqwest::Client::new()
        .get(format!("{}/models", base_url.trim_end_matches('/')))
        .timeout(std::time::Duration::from_secs(8));
    if let Some(k) = get_key(key_id.as_deref()) {
        req = req.bearer_auth(k);
    }
    let v: serde_json::Value = req.send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(|s| s.trim_start_matches("models/").to_string())).collect();
    ids.sort();
    Ok(ids)
}

/// Streams an OpenAI-style chat completion from `base_url` (e.g. `…/v1`),
/// sending each text piece through `on_token`. Works for the built-in engine,
/// Ollama and any OpenAI-compatible API; `key_id` names a keychain entry.
#[tauri::command]
pub async fn ai_chat(
    state: State<'_, Ai>,
    base_url: String,
    key_id: Option<String>,
    model: String,
    messages: serde_json::Value,
    // Extra request fields, e.g. turning off Qwen3.5's thinking for the built-in engine.
    extra: Option<serde_json::Value>,
    on_token: Channel<String>,
) -> Result<(), String> {
    state.stop_chat.store(false, Ordering::Relaxed);
    let mut req = reqwest::Client::new()
        .post(format!("{}/chat/completions", base_url.trim_end_matches('/')))
        .json(&{
            let mut body = serde_json::json!({ "model": model, "messages": messages, "stream": true });
            if let (Some(b), Some(serde_json::Value::Object(x))) = (body.as_object_mut(), extra) {
                b.extend(x);
            }
            body
        });
    if let Some(k) = get_key(key_id.as_deref()) {
        req = req.bearer_auth(k);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("{}: {}", res.status(), res.text().await.unwrap_or_default()));
    }
    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        if state.stop_chat.load(Ordering::Relaxed) {
            break;
        }
        buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| e.to_string())?));
        while let Some(i) = buf.find('\n') {
            let line: String = buf.drain(..=i).collect();
            let Some(data) = line.trim().strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                return Ok(());
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(t) = v["choices"][0]["delta"]["content"].as_str() {
                    let _ = on_token.send(t.to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ai_stop(state: State<Ai>) {
    state.stop_chat.store(true, Ordering::Relaxed);
}

/// Kills the engine process (on app exit or model removal).
pub fn shutdown(state: &Ai) {
    if let Some((_, _, mut child)) = state.server.lock().unwrap().take() {
        let _ = child.kill();
    }
}

/// GET an https page as text (web search for Nerida AI; avoids CORS in the webview).
#[tauri::command]
pub async fn web_get(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("only https".into());
    }
    let res = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Oceanic study app)")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = res.error_for_status().map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    Ok(text.chars().take(400_000).collect())
}
