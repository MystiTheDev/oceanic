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
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12189/llama-b12189-bin-win-vulkan-x64.zip",
    sha256: "9d56405579492423833cdde94cf46cae15d38333f585f3957cafebfc6fb0e182",
    size: 37_706_485,
};

// Optional NVIDIA engine (CUDA build + CUDA runtime, ~680 MB). Vulkan often can't see
// laptop NVIDIA GPUs (it picks the integrated GPU), so NVIDIA PCs can add this for speed.
const CUDA: Asset = Asset {
    id: "cuda",
    file: "llama-cuda.zip",
    legacy: "",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12189/llama-b12189-bin-win-cuda-12.4-x64.zip",
    sha256: "7fb106379e565dfa0c6d74c4bfe86c28cadf6227affb84048612893789345e68",
    size: 288_716_448,
};
const CUDART: Asset = Asset {
    id: "cudart",
    file: "cudart.zip",
    legacy: "",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12189/cudart-llama-bin-win-cuda-12.4-x64.zip",
    sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
    size: 391_443_627,
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
    // The Vulkan build replaced the CPU one: a CPU-only install counts as missing so it re-downloads.
    find(&dir(app).ok()?.join("server")).filter(|p| p.with_file_name("ggml-vulkan.dll").exists())
}

/// The NVIDIA (CUDA) engine, once both of its parts are downloaded.
fn cuda_exe(app: &AppHandle) -> Option<PathBuf> {
    let p = dir(app).ok()?.join("cuda").join("llama-server.exe");
    (p.exists() && p.with_file_name("ggml-cuda.dll").exists() && p.with_file_name("cudart64_12.dll").exists()).then_some(p)
}

/// Some NVIDIA drivers install their Vulkan driver file but never register it, so Vulkan
/// apps only see the integrated GPU. Pointing the Vulkan loader at the file (for our
/// process only, no install or restart) makes the NVIDIA card show up.
fn nvidia_vk_json() -> Option<PathBuf> {
    std::fs::read_dir(r"C:\Windows\System32\DriverStore\FileRepository")
        .ok()?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("nv"))
        .map(|e| e.path().join("nv-vk64.json"))
        .filter(|j| j.exists())
        .max_by_key(|j| j.metadata().and_then(|m| m.modified()).ok()) // newest driver
}

fn engine_cmd(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    if let Some(j) = nvidia_vk_json() {
        cmd.env("VK_ADD_DRIVER_FILES", j);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

#[derive(Serialize, Clone)]
pub struct Gpu {
    /// llama.cpp device id, e.g. "Vulkan1".
    id: String,
    name: String,
    mem_mib: u64,
}

/// Graphics cards the Vulkan engine can use ("  Vulkan1: NVIDIA GeForce … (3962 MiB, 3367 MiB free)").
fn list_gpus(app: &AppHandle) -> Vec<Gpu> {
    let Some(exe) = server_exe(app) else { return vec![] };
    let Ok(out) = engine_cmd(&exe).arg("--list-devices").output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .chain(String::from_utf8_lossy(&out.stderr).lines())
        .filter_map(|l| {
            let (id, rest) = l.trim().split_once(": ")?;
            let (name, mem) = rest.rsplit_once(" (")?;
            let mem_mib = mem.split(' ').next()?.parse().ok()?;
            id.starts_with("Vulkan").then(|| Gpu { id: id.into(), name: name.into(), mem_mib })
        })
        .collect()
}

#[tauri::command]
pub async fn ai_gpus(app: AppHandle) -> Vec<Gpu> {
    tauri::async_runtime::spawn_blocking(move || list_gpus(&app)).await.unwrap_or_default()
}

/// NVIDIA driver installed (it ships nvidia-smi).
fn has_nvidia() -> bool {
    Path::new(r"C:\Windows\System32\nvidia-smi.exe").exists()
}

fn asset(id: &str) -> Result<&'static Asset, String> {
    match id {
        "server" => return Ok(&SERVER),
        "cuda" => return Ok(&CUDA),
        "cudart" => return Ok(&CUDART),
        _ => {}
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
    /// NVIDIA GPU present / NVIDIA engine downloaded.
    nvidia: bool,
    cuda: bool,
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
        nvidia: has_nvidia(),
        cuda: cuda_exe(&app).is_some(),
        models: MODELS
            .iter()
            .map(|m| ModelInfo { id: m.id, size: m.size, installed: model_file(&d, m).is_some(), outdated: !d.join(m.file).exists() && d.join(m.legacy).exists() })
            .collect(),
        running: state.server.lock().unwrap().as_ref().map(|s| s.0.split('|').next().unwrap_or_default().to_string()), // "model|gpu" → model
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

    if item == "server" || item == "cuda" || item == "cudart" {
        // The CUDA runtime goes next to the CUDA engine; a new engine replaces its folder.
        let out = d.join(if item == "server" { "server" } else { "cuda" });
        if item != "cudart" {
            let _ = std::fs::remove_dir_all(&out);
        }
        std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        let f = std::fs::File::open(&part).map_err(|e| e.to_string())?;
        zip::ZipArchive::new(f).and_then(|mut z| z.extract(&out)).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&part);
        if item == "cudart" {
            shutdown(&state); // next start uses the NVIDIA engine
        }
    } else {
        std::fs::rename(&part, d.join(a.file)).map_err(|e| e.to_string())?;
        // Updated: drop the previous version (stop it first if it's the one running).
        if d.join(a.legacy).exists() {
            if state.server.lock().unwrap().as_ref().is_some_and(|s| s.0.starts_with(&format!("{item}|"))) {
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
    if model == "cuda" {
        // Optional NVIDIA engine: stop it if running, then remove its folder.
        shutdown(&state);
        return std::fs::remove_dir_all(dir(&app)?.join("cuda")).map_err(|e| e.to_string());
    }
    let a = asset(&model)?;
    if state.server.lock().unwrap().as_ref().is_some_and(|s| s.0.starts_with(&format!("{model}|"))) {
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
pub async fn ai_start(app: AppHandle, state: State<'_, Ai>, model: String, gpu: String) -> Result<String, String> {
    // gpu: "auto" | "cpu" | "cuda" | a Vulkan device id from ai_gpus. A different choice restarts the engine.
    let gpus = if gpu == "auto" { list_gpus(&app) } else { vec![] };
    let port = {
        let mut guard = state.server.lock().unwrap();
        if let Some((m, port, child)) = guard.as_mut() {
            if *m == format!("{model}|{gpu}") && child.try_wait().ok().flatten().is_none() {
                return Ok(format!("http://127.0.0.1:{port}/v1"));
            }
        }
        if let Some((_, _, mut child)) = guard.take() {
            let _ = child.kill();
        }
        // Auto: NVIDIA engine if downloaded, else an NVIDIA card, else the first card (one card only:
        // splitting a small model across two GPUs is slower).
        let pick = match gpu.as_str() {
            "auto" if cuda_exe(&app).is_some() => "cuda".to_string(),
            "auto" => gpus.iter().find(|g| g.name.contains("NVIDIA")).or(gpus.first()).map_or("cpu".into(), |g| g.id.clone()),
            "cuda" if cuda_exe(&app).is_none() => "auto".into(),
            g => g.to_string(),
        };
        let exe = if pick == "cuda" { cuda_exe(&app) } else { server_exe(&app) }.ok_or("Nerida's engine isn't installed yet.")?;
        let gguf = model_file(&dir(&app)?, asset(&model)?).ok_or("This model isn't downloaded yet.")?;
        let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map_err(|e| e.to_string())?.port();
        let mut cmd = engine_cmd(&exe);
        cmd.arg("-m").arg(&gguf).args(["--host", "127.0.0.1", "--port", &port.to_string(), "-c", "8192", "--jinja"]);
        // Flash attention: fast on CUDA, but on Vulkan it falls back to the CPU (much slower prompt reading).
        match pick.as_str() {
            "cpu" => cmd.args(["-ngl", "0"]),
            "cuda" => cmd.args(["-ngl", "99", "-fa", "on"]),
            "auto" => cmd.args(["-ngl", "99", "-fa", "off"]),
            dev => cmd.args(["-ngl", "99", "-fa", "off", "--device", dev]),
        };
        let child = cmd.spawn().map_err(|e| match e.raw_os_error() {
            // 2 = file gone, 5 = access denied, 225 = Windows flagged it as a virus.
            Some(2 | 5 | 225) => "Your antivirus blocked or removed Nerida's engine (llama-server.exe, the official llama.cpp program). \
                Add Oceanic's nerida folder to your antivirus exclusions, then download the engine again from Settings → Nerida AI."
                .to_string(),
            _ => format!("Couldn't start Nerida: {e}"),
        })?;
        *guard = Some((format!("{model}|{gpu}"), port, child));
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
    // Thinking (reasoning_content) is sent wrapped in <think>…</think> before the answer.
    let mut thinking = false;
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
                let delta = &v["choices"][0]["delta"];
                if let Some(t) = delta["reasoning_content"].as_str() {
                    let _ = on_token.send(if thinking { t.to_string() } else { format!("<think>{t}") });
                    thinking = true;
                }
                if let Some(t) = delta["content"].as_str() {
                    let _ = on_token.send(if thinking { format!("</think>{t}") } else { t.to_string() });
                    thinking = false;
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
