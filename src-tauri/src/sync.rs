//! LAN sync, phase 7a: pairing and an encrypted test connection.
//!
//! Wire format: every frame is a u16 big-endian length plus bytes. A
//! connection starts with one plaintext JSON frame ("pair" or "hello"), the
//! server answers with a JSON status frame, then a Noise NNpsk0 handshake
//! runs with the pairing key as the PSK. A wrong key fails the handshake.
//!
//! Pairing: the laptop opens a 2-minute window with a 6-digit code and
//! announces itself over mDNS. The phone sends a SPAKE2 message; both sides
//! turn the code into the same 32-byte key, so a guess can't be checked
//! offline. Three wrong codes close the window.

use crate::db::Db;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::Rng;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

pub const PORT: u16 = 47823;
const SERVICE: &str = "_oceanic._tcp.local.";
const NOISE: &str = "Noise_NNpsk0_25519_ChaChaPoly_BLAKE2s";
const PAIR_ID: &[u8] = b"oceanic-pair-v1";
const PAIR_WINDOW: Duration = Duration::from_secs(120);

struct Pairing {
    code: String,
    until: Instant,
    fails: u8,
    mdns: Option<mdns_sd::ServiceDaemon>,
}

#[derive(Default)]
pub struct Sync {
    pairing: Mutex<Option<Pairing>>,
    listen_error: Mutex<Option<String>>,
}

#[cfg(target_os = "android")]
pub struct SyncPlugin(pub tauri::plugin::PluginHandle<tauri::Wry>);

#[derive(Serialize)]
pub struct Peer {
    id: String,
    name: String,
    addr: String,
}

type Res<T> = Result<T, String>;

// ------------------------------------------------------------------ storage

fn ensure(conn: &Connection) -> Res<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_peers (
           id   TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           key  BLOB NOT NULL,
           addr TEXT NOT NULL DEFAULT ''
         );",
    )
    .map_err(|e| e.to_string())
}

fn device_id(conn: &Connection) -> String {
    if let Some(id) = crate::db::read_setting(conn, "syncDeviceId") {
        return id;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = crate::db::write_setting(conn, "syncDeviceId", &id);
    id
}

fn peers(conn: &Connection) -> Res<Vec<Peer>> {
    ensure(conn)?;
    let mut st = conn.prepare("SELECT id, name, addr FROM sync_peers ORDER BY name").map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| Ok(Peer { id: r.get(0)?, name: r.get(1)?, addr: r.get(2)? }))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

fn peer_key(conn: &Connection, id: &str) -> Option<Vec<u8>> {
    ensure(conn).ok()?;
    conn.query_row("SELECT key FROM sync_peers WHERE id = ?1", [id], |r| r.get(0)).optional().ok()?
}

fn save_peer(conn: &Connection, id: &str, name: &str, key: &[u8], addr: &str) -> Res<()> {
    ensure(conn)?;
    conn.execute(
        "INSERT INTO sync_peers (id, name, key, addr) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = ?2, key = ?3, addr = ?4",
        params![id, name, key, addr],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn device_name(app: &AppHandle) -> String {
    #[cfg(target_os = "android")]
    if let Ok(v) = app.state::<SyncPlugin>().0.run_mobile_plugin::<Value>("deviceName", json!({})) {
        if let Some(n) = v.get("name").and_then(Value::as_str) {
            return n.to_string();
        }
    }
    let _ = app;
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Oceanic".into())
}

/// This device's LAN address (no packet is sent; it only picks a route).
fn local_ip() -> Option<IpAddr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:9").ok()?;
    Some(s.local_addr().ok()?.ip())
}

// ------------------------------------------------------------------ framing

fn send(s: &mut TcpStream, b: &[u8]) -> std::io::Result<()> {
    s.write_all(&(b.len() as u16).to_be_bytes())?;
    s.write_all(b)
}

fn recv(s: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut n = [0u8; 2];
    s.read_exact(&mut n)?;
    let mut b = vec![0u8; u16::from_be_bytes(n) as usize];
    s.read_exact(&mut b)?;
    Ok(b)
}

fn send_json(s: &mut TcpStream, v: Value) -> std::io::Result<()> {
    send(s, v.to_string().as_bytes())
}

fn recv_json(s: &mut TcpStream) -> std::io::Result<Value> {
    serde_json::from_slice(&recv(s)?).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// Encrypted channel after the Noise handshake.
struct Channel {
    s: TcpStream,
    t: snow::TransportState,
}

impl Channel {
    fn open(mut s: TcpStream, key: &[u8], initiator: bool) -> Res<Channel> {
        let key: &[u8; 32] = key.try_into().map_err(|_| "bad-key".to_string())?;
        let b = snow::Builder::new(NOISE.parse().unwrap()).psk(0, key).map_err(|e| e.to_string())?;
        let mut hs = if initiator { b.build_initiator() } else { b.build_responder() }.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 1024];
        let io = |e: std::io::Error| e.to_string();
        if initiator {
            let n = hs.write_message(&[], &mut buf).map_err(|e| e.to_string())?;
            send(&mut s, &buf[..n]).map_err(io)?;
            hs.read_message(&recv(&mut s).map_err(io)?, &mut buf).map_err(|e| e.to_string())?;
        } else {
            hs.read_message(&recv(&mut s).map_err(io)?, &mut buf).map_err(|_| "bad-key".to_string())?;
            let n = hs.write_message(&[], &mut buf).map_err(|e| e.to_string())?;
            send(&mut s, &buf[..n]).map_err(io)?;
        }
        Ok(Channel { s, t: hs.into_transport_mode().map_err(|e| e.to_string())? })
    }

    fn send(&mut self, msg: &[u8]) -> Res<()> {
        let mut buf = vec![0u8; msg.len() + 16];
        let n = self.t.write_message(msg, &mut buf).map_err(|e| e.to_string())?;
        send(&mut self.s, &buf[..n]).map_err(|e| e.to_string())
    }

    fn recv(&mut self) -> Res<Vec<u8>> {
        let c = recv(&mut self.s).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; c.len()];
        let n = self.t.read_message(&c, &mut buf).map_err(|e| e.to_string())?;
        buf.truncate(n);
        Ok(buf)
    }
}

// ------------------------------------------------------------------ server

/// Listens on PORT for pairing and test connections, on both devices.
pub fn start_listener(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let l = match TcpListener::bind(("0.0.0.0", PORT)) {
            Ok(l) => l,
            Err(e) => {
                *app.state::<Sync>().listen_error.lock().unwrap() = Some(format!("Can't listen on port {PORT}: {e}"));
                return;
            }
        };
        for s in l.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = s.set_read_timeout(Some(Duration::from_secs(10)));
                let _ = serve(&app, s);
            });
        }
    });
}

fn serve(app: &AppHandle, mut s: TcpStream) -> Res<()> {
    let from_ip = s.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let hello = recv_json(&mut s).map_err(|e| e.to_string())?;
    let db = app.state::<Db>();
    let me = device_id(&db.0.lock().unwrap());
    match hello["t"].as_str() {
        Some("pair") => serve_pair(app, s, &hello, &me, &from_ip),
        Some("hello") => {
            let from = hello["from"].as_str().unwrap_or("");
            let key = peer_key(&db.0.lock().unwrap(), from);
            let key = match (hello["to"].as_str() == Some(me.as_str()), key) {
                (true, Some(k)) => k,
                _ => {
                    let _ = send_json(&mut s, json!({ "t": "err", "e": "This device isn't paired with it anymore. Pair again." }));
                    return Ok(());
                }
            };
            send_json(&mut s, json!({ "t": "ok" })).map_err(|e| e.to_string())?;
            let mut ch = Channel::open(s, &key, false)?;
            if ch.recv()? == b"ping" {
                ch.send(b"pong")?;
                let conn = db.0.lock().unwrap();
                let _ = conn.execute("UPDATE sync_peers SET addr = ?1 WHERE id = ?2", params![from_ip, from]);
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn serve_pair(app: &AppHandle, mut s: TcpStream, hello: &Value, me: &str, from_ip: &str) -> Res<()> {
    let st = app.state::<Sync>();
    let code = {
        let p = st.pairing.lock().unwrap();
        p.as_ref().filter(|p| p.until > Instant::now()).map(|p| p.code.clone())
    };
    let Some(code) = code else {
        let _ = send_json(&mut s, json!({ "t": "err", "e": "Pairing isn't open on the laptop. Open Settings → Sync → Pair a phone there first." }));
        return Ok(());
    };
    let their = B64.decode(hello["msg"].as_str().unwrap_or("")).map_err(|e| e.to_string())?;
    let (spake, out) = Spake2::<Ed25519Group>::start_symmetric(&Password::new(code.as_bytes()), &Identity::new(PAIR_ID));
    let key = spake.finish(&their).map_err(|e| format!("{e:?}"))?;
    let name = device_name(app);
    send_json(&mut s, json!({ "t": "ok", "id": me, "name": name, "msg": B64.encode(out) })).map_err(|e| e.to_string())?;
    let mut ch = match Channel::open(s, &key, false) {
        Ok(ch) => ch,
        Err(e) => {
            if e == "bad-key" {
                let mut p = st.pairing.lock().unwrap();
                if let Some(pp) = p.as_mut() {
                    pp.fails += 1;
                    if pp.fails >= 3 {
                        stop_pairing(&mut p);
                        let _ = app.emit("sync-pair-closed", "Too many wrong codes. Start pairing again.");
                    }
                }
            }
            return Err(e);
        }
    };
    if ch.recv()? != b"pair-ok" {
        return Err("bad confirm".into());
    }
    let peer_id = hello["id"].as_str().unwrap_or_default().to_string();
    let peer_name = hello["name"].as_str().unwrap_or("Phone").to_string();
    save_peer(&app.state::<Db>().0.lock().unwrap(), &peer_id, &peer_name, &key, from_ip)?;
    ch.send(b"pair-ok")?;
    stop_pairing(&mut st.pairing.lock().unwrap());
    let _ = app.emit("sync-paired", peer_name);
    Ok(())
}

fn stop_pairing(p: &mut Option<Pairing>) {
    if let Some(mdns) = p.take().and_then(|p| p.mdns) {
        let _ = mdns.shutdown();
    }
}

// ------------------------------------------------------------------ client

fn connect(addr: &str) -> Res<TcpStream> {
    let target: SocketAddr = if addr.contains(':') { addr.parse() } else { format!("{addr}:{PORT}").parse() }
        .map_err(|_| format!("“{addr}” isn't a valid address."))?;
    let s = TcpStream::connect_timeout(&target, Duration::from_secs(4))
        .map_err(|_| "Can't reach the other device. Check both are on the same Wi-Fi and Oceanic is open on it.".to_string())?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(10)));
    Ok(s)
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn sync_info(app: AppHandle, db: State<Db>, st: State<Sync>) -> Res<Value> {
    let conn = db.0.lock().unwrap();
    let pairing = st.pairing.lock().unwrap();
    let pairing = pairing.as_ref().filter(|p| p.until > Instant::now()).map(|p| json!({ "code": p.code, "secondsLeft": (p.until - Instant::now()).as_secs() }));
    Ok(json!({
        "id": device_id(&conn),
        "name": device_name(&app),
        "ip": local_ip().map(|i| i.to_string()),
        "port": PORT,
        "peers": peers(&conn)?,
        "pairing": pairing,
        "listenError": *st.listen_error.lock().unwrap(),
    }))
}

/// Opens the 2-minute pairing window (laptop side) and announces it over mDNS.
#[tauri::command]
pub fn sync_pair_start(app: AppHandle, db: State<Db>, st: State<Sync>) -> Res<String> {
    let code = format!("{:06}", rand::thread_rng().gen_range(0..1_000_000));
    let id = device_id(&db.0.lock().unwrap());
    let name = device_name(&app);
    let mdns = mdns_sd::ServiceDaemon::new().ok().and_then(|d| {
        let host = format!("oceanic-{}.local.", &id[..8]);
        let info = mdns_sd::ServiceInfo::new(SERVICE, &name, &host, "", PORT, [("id", id.as_str())].as_slice()).ok()?.enable_addr_auto();
        d.register(info).ok()?;
        Some(d)
    });
    let mut p = st.pairing.lock().unwrap();
    stop_pairing(&mut p);
    *p = Some(Pairing { code: code.clone(), until: Instant::now() + PAIR_WINDOW, fails: 0, mdns });
    Ok(code)
}

#[tauri::command]
pub fn sync_pair_cancel(st: State<Sync>) {
    stop_pairing(&mut st.pairing.lock().unwrap());
}

/// Looks for laptops in pairing mode on this network for about 3 seconds.
#[tauri::command]
pub async fn sync_discover(app: AppHandle) -> Res<Vec<Value>> {
    #[cfg(target_os = "android")]
    let _ = app.state::<SyncPlugin>().0.run_mobile_plugin::<()>("multicast", json!({ "on": true }));
    let found = tauri::async_runtime::spawn_blocking(|| -> Res<Vec<Value>> {
        let d = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
        let rx = d.browse(SERVICE).map_err(|e| e.to_string())?;
        let end = Instant::now() + Duration::from_secs(3);
        let mut out: Vec<Value> = vec![];
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            let Ok(ev) = rx.recv_timeout(left) else { break };
            if let mdns_sd::ServiceEvent::ServiceResolved(info) = ev {
                let Some(ip) = info.get_addresses_v4().into_iter().next() else { continue };
                let name = info.get_fullname().trim_end_matches(SERVICE).trim_end_matches('.').to_string();
                let addr = format!("{ip}:{}", info.get_port());
                if !out.iter().any(|v| v["addr"] == addr) {
                    out.push(json!({ "name": name, "addr": addr }));
                }
            }
        }
        let _ = d.shutdown();
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(target_os = "android")]
    let _ = app.state::<SyncPlugin>().0.run_mobile_plugin::<()>("multicast", json!({ "on": false }));
    let _ = &app;
    found
}

/// Phone side: pair with the laptop at `addr` using its 6-digit code.
#[tauri::command]
pub async fn sync_pair_join(app: AppHandle, addr: String, code: String) -> Res<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (me, name) = (device_id(&app.state::<Db>().0.lock().unwrap()), device_name(&app));
        let mut s = connect(&addr)?;
        let (spake, out) = Spake2::<Ed25519Group>::start_symmetric(&Password::new(code.trim().as_bytes()), &Identity::new(PAIR_ID));
        let io = |e: std::io::Error| e.to_string();
        send_json(&mut s, json!({ "t": "pair", "id": me, "name": name, "msg": B64.encode(out) })).map_err(io)?;
        let r = recv_json(&mut s).map_err(io)?;
        if r["t"] != "ok" {
            return Err(r["e"].as_str().unwrap_or("Pairing failed.").to_string());
        }
        let their = B64.decode(r["msg"].as_str().unwrap_or("")).map_err(|e| e.to_string())?;
        let key = spake.finish(&their).map_err(|e| format!("{e:?}"))?;
        let wrong = || "That code didn't match. Check the code on the laptop and try again.".to_string();
        let mut ch = Channel::open(s, &key, true).map_err(|_| wrong())?;
        ch.send(b"pair-ok")?;
        if ch.recv().map_err(|_| wrong())? != b"pair-ok" {
            return Err(wrong());
        }
        let peer = r["name"].as_str().unwrap_or("Laptop").to_string();
        save_peer(&app.state::<Db>().0.lock().unwrap(), r["id"].as_str().unwrap_or_default(), &peer, &key, &addr)?;
        Ok(peer)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Encrypted ping to a paired device.
#[tauri::command]
pub async fn sync_test(app: AppHandle, id: String) -> Res<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let (me, key, addr) = {
            let conn = db.0.lock().unwrap();
            let addr: Option<String> = conn.query_row("SELECT addr FROM sync_peers WHERE id = ?1", [&id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
            (device_id(&conn), peer_key(&conn, &id), addr)
        };
        let (Some(key), Some(addr)) = (key, addr) else { return Err("That device isn't paired.".into()) };
        if addr.is_empty() {
            return Err("No address known for that device yet.".into());
        }
        let mut s = connect(&addr)?;
        let io = |e: std::io::Error| e.to_string();
        send_json(&mut s, json!({ "t": "hello", "from": me, "to": id })).map_err(io)?;
        let r = recv_json(&mut s).map_err(io)?;
        if r["t"] != "ok" {
            return Err(r["e"].as_str().unwrap_or("The other device refused the connection.").to_string());
        }
        let bad = |_| "The other device has a different key. Unpair and pair again.".to_string();
        let mut ch = Channel::open(s, &key, true).map_err(bad)?;
        ch.send(b"ping")?;
        if ch.recv().map_err(bad)? != b"pong" {
            return Err("Unexpected reply.".into());
        }
        Ok("Connected".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Removes a paired device on this side only (key rotation comes in 7e).
#[tauri::command]
pub fn sync_unpair(db: State<Db>, id: String) -> Res<()> {
    let conn = db.0.lock().unwrap();
    ensure(&conn)?;
    conn.execute("DELETE FROM sync_peers WHERE id = ?1", [id]).map(|_| ()).map_err(|e| e.to_string())
}
