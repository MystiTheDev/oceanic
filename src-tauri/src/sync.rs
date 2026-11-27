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
    /// mDNS announcement while on a trusted network (desktop).
    announce: Mutex<Option<mdns_sd::ServiceDaemon>>,
    /// Network key trusted "just this time".
    once: Mutex<Option<String>>,
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

/// Synced tables and their last-write-wins fields. `ydoc` (the page body as
/// a Yjs doc) merges instead; `content` only syncs for pages without one yet.
const TABLES: &[(&str, &[&str])] = &[
    ("pages", &["title", "icon", "content", "ydoc", "parent_id", "tags", "status", "due_date", "is_pinned", "sort_order", "is_archived", "archived_at", "workspace_id"]),
    ("workspaces", &["name", "icon", "color", "sort_order"]),
];

// ------------------------------------------------------------------ storage

static READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Sync tables plus the triggers that stamp every synced field change with a
/// hybrid clock (`hlc`, ms since 1970, bumped past the last seen value) and a
/// local sequence number (`seq`). A peer's `sent` is the last seq it acked, so
/// clock rows past it are the change queue for that peer.
fn ensure(conn: &Connection) -> Res<()> {
    use std::sync::atomic::Ordering;
    if READY.load(Ordering::Relaxed) {
        return Ok(());
    }
    let e = |e: rusqlite::Error| e.to_string();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_peers (
           id   TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           key  BLOB NOT NULL,
           addr TEXT NOT NULL DEFAULT ''
         );
         CREATE TABLE IF NOT EXISTS sync_state (
           k INTEGER PRIMARY KEY CHECK (k = 0),
           hlc INTEGER NOT NULL, seq INTEGER NOT NULL, applying INTEGER NOT NULL, dev TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS sync_clock (
           tbl TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL,
           hlc INTEGER NOT NULL, dev TEXT NOT NULL, seq INTEGER NOT NULL,
           PRIMARY KEY (tbl, id, field)
         );
         CREATE INDEX IF NOT EXISTS idx_sync_clock_seq ON sync_clock(seq);
         CREATE TABLE IF NOT EXISTS sync_log (
           at INTEGER NOT NULL, peer TEXT NOT NULL,
           added INTEGER NOT NULL, edited INTEGER NOT NULL, deleted INTEGER NOT NULL, error TEXT
         );
         CREATE TABLE IF NOT EXISTS sync_networks (
           key TEXT PRIMARY KEY, name TEXT NOT NULL, trust TEXT NOT NULL
         );",
    )
    .map_err(e)?;
    let _ = conn.execute("ALTER TABLE sync_peers ADD COLUMN sent INTEGER NOT NULL DEFAULT 0", []);
    let dev = device_id(conn);
    conn.execute("INSERT OR IGNORE INTO sync_state VALUES (0, 0, 0, 0, ?1)", [&dev]).map_err(e)?;
    conn.execute("UPDATE sync_state SET applying = 0", []).map_err(e)?;
    let bump = "UPDATE sync_state SET hlc = MAX(hlc + 1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)), seq = seq + 1";
    let mut sql = String::new();
    for (tbl, fields) in TABLES {
        let stamp = |f: &str, cond: &str| format!("INSERT OR REPLACE INTO sync_clock SELECT '{tbl}', NEW.id, '{f}', hlc, dev, seq FROM sync_state {cond};");
        let on = "WHEN (SELECT applying FROM sync_state) = 0";
        let ins: String = fields.iter().map(|f| stamp(f, "")).collect();
        let upd: String = fields
            .iter()
            .map(|f| {
                let c = format!("WHERE OLD.{f} IS NOT NEW.{f}");
                format!("{bump} {c}; {}", stamp(f, &c))
            })
            .collect();
        sql += &format!(
            "DROP TRIGGER IF EXISTS sync_{tbl}_ins; DROP TRIGGER IF EXISTS sync_{tbl}_upd; DROP TRIGGER IF EXISTS sync_{tbl}_del;
             CREATE TRIGGER sync_{tbl}_ins AFTER INSERT ON {tbl} {on} BEGIN {bump}; {ins} END;
             CREATE TRIGGER sync_{tbl}_upd AFTER UPDATE ON {tbl} {on} BEGIN {upd} END;
             CREATE TRIGGER sync_{tbl}_del AFTER DELETE ON {tbl} {on} BEGIN {bump};
               DELETE FROM sync_clock WHERE tbl = '{tbl}' AND id = OLD.id;
               INSERT INTO sync_clock SELECT '{tbl}', OLD.id, '_del', hlc, dev, seq FROM sync_state; END;"
        );
        // Rows from before sync existed get clock 0, so the first sync sends them all.
        for f in *fields {
            sql += &format!("INSERT OR IGNORE INTO sync_clock SELECT '{tbl}', id, '{f}', 0, '{dev}', 1 FROM {tbl};");
        }
    }
    sql += "UPDATE sync_state SET seq = MAX(seq, 1);";
    conn.execute_batch(&format!("BEGIN; {sql} COMMIT;")).map_err(e)?;
    READY.store(true, Ordering::Relaxed);
    Ok(())
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

    /// Sends a message of any size: chunks of up to 60 000 bytes, each led by
    /// a flag byte (1 = more chunks follow), since a Noise frame caps at 64 KiB.
    fn send(&mut self, msg: &[u8]) -> Res<()> {
        let chunks: Vec<&[u8]> = if msg.is_empty() { vec![msg] } else { msg.chunks(60_000).collect() };
        for (i, c) in chunks.iter().enumerate() {
            let mut plain = vec![(i + 1 < chunks.len()) as u8];
            plain.extend_from_slice(c);
            let mut buf = vec![0u8; plain.len() + 16];
            let n = self.t.write_message(&plain, &mut buf).map_err(|e| e.to_string())?;
            send(&mut self.s, &buf[..n]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn recv(&mut self) -> Res<Vec<u8>> {
        let mut out = vec![];
        loop {
            let c = recv(&mut self.s).map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; c.len()];
            let n = self.t.read_message(&c, &mut buf).map_err(|e| e.to_string())?;
            let (&more, body) = buf[..n].split_first().ok_or("empty frame")?;
            out.extend_from_slice(body);
            if more == 0 {
                return Ok(out);
            }
        }
    }
}

// ------------------------------------------------------------------ server

/// Listens on PORT for pairing and test connections, on both devices.
pub fn start_listener(app: &AppHandle) {
    if let Err(e) = ensure(&app.state::<Db>().0.lock().unwrap()) {
        eprintln!("sync setup failed: {e}");
    }
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
            if from == me {
                // An emulator's saved address can lead back to this laptop.
                let _ = send_json(&mut s, json!({ "t": "err", "e": "That address leads back to this device. Start the sync from the other device." }));
                return Ok(());
            }
            let key = match (hello["to"].as_str() == Some(me.as_str()), key) {
                (true, Some(k)) => k,
                _ => {
                    let _ = send_json(&mut s, json!({ "t": "err", "e": "This device isn't paired with it anymore. Pair again." }));
                    return Ok(());
                }
            };
            send_json(&mut s, json!({ "t": "ok" })).map_err(|e| e.to_string())?;
            let mut ch = Channel::open(s, &key, false)?;
            let msg = ch.recv()?;
            let _ = db.0.lock().unwrap().execute("UPDATE sync_peers SET addr = ?1 WHERE id = ?2", params![from_ip, from]);
            if msg == b"ping" {
                return ch.send(b"pong");
            }
            if msg == b"unpair" {
                let _ = db.0.lock().unwrap().execute("DELETE FROM sync_peers WHERE id = ?1", [from]);
                let _ = app.emit("sync-applied", ());
                return Ok(());
            }
            serve_sync(app, ch, from, &msg)
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
    let ip = local_ip();
    let pairing = pairing.as_ref().filter(|p| p.until > Instant::now()).map(|p| {
        // QR for the phone's camera: same address and code, same 2-minute life.
        let qr = ip.and_then(|ip| qrcode::QrCode::new(format!("oceanic://pair?a={ip}:{PORT}&c={}", p.code)).ok()).map(|q| {
            q.render::<qrcode::render::svg::Color>().min_dimensions(180, 180).build()
        });
        json!({ "code": p.code, "secondsLeft": (p.until - Instant::now()).as_secs(), "qr": qr })
    });
    let peer_list = peers(&conn)?;
    let peer_count = peer_list.len();
    let min_sent: i64 = conn.query_row("SELECT IFNULL(MIN(sent), 0) FROM sync_peers", [], |r| r.get(0)).unwrap_or(0);
    let pending: i64 = conn.query_row("SELECT COUNT(*) FROM sync_clock WHERE seq > ?1", [min_sent], |r| r.get(0)).unwrap_or(0);
    let listen_error = st.listen_error.lock().unwrap().clone();
    let last_error: Option<String> = conn.query_row("SELECT error FROM sync_log WHERE error IS NOT NULL ORDER BY at DESC LIMIT 1", [], |r| r.get(0)).optional().unwrap_or(None);
    let offline = peer_count == 0 || !on_trusted(&app);
    let state = |max_seq: i64| -> &'static str {
        if offline { "offline" }
        else if listen_error.is_some() || (last_error.is_some() && max_seq > min_sent) { "error" }
        else if max_seq > min_sent { "pending" }
        else { "synced" }
    };
    let global = state(if pending > 0 { min_sent + 1 } else { min_sent });
    let mut notes = serde_json::Map::new();
    if let Ok(mut q) = conn.prepare("SELECT id, MAX(seq) FROM sync_clock WHERE tbl = 'pages' GROUP BY id") {
        if let Ok(rows) = q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
            for row in rows.flatten() {
                notes.insert(row.0, json!(state(row.1)));
            }
        }
    }
    Ok(json!({
        "id": device_id(&conn),
        "name": device_name(&app),
        "ip": ip.map(|i| i.to_string()),
        "port": PORT,
        "peers": peer_list,
        "pairing": pairing,
        "listenError": listen_error,
        "pending": pending,
        "status": global,
        "notes": notes,
        "log": sync_log(&conn),
        "auto": crate::db::read_setting(&conn, "syncAuto").as_deref() != Some("0"),
        "notify": crate::db::read_setting(&conn, "syncNotify").as_deref() != Some("0"),
        "hold": crate::db::read_setting(&conn, "syncHold").as_deref() != Some("0"),
        "holdMb": hold_mb(&conn),
    }))
}

/// Opens the 2-minute pairing window (laptop side) and announces it over mDNS.
#[tauri::command]
pub fn sync_pair_start(app: AppHandle, db: State<Db>, st: State<Sync>) -> Res<String> {
    let code = format!("{:06}", rand::thread_rng().gen_range(0..1_000_000));
    let id = device_id(&db.0.lock().unwrap());
    let name = device_name(&app);
    // Already announced on a trusted network: don't register twice.
    let mdns = if st.announce.lock().unwrap().is_some() { None } else { announce(&id, &name) };
    let mut p = st.pairing.lock().unwrap();
    stop_pairing(&mut p);
    *p = Some(Pairing { code: code.clone(), until: Instant::now() + PAIR_WINDOW, fails: 0, mdns });
    Ok(code)
}

fn announce(id: &str, name: &str) -> Option<mdns_sd::ServiceDaemon> {
    let d = mdns_sd::ServiceDaemon::new().ok()?;
    let host = format!("oceanic-{}.local.", &id[..8]);
    let info = mdns_sd::ServiceInfo::new(SERVICE, name, &host, "", PORT, [("id", id)].as_slice()).ok()?.enable_addr_auto();
    d.register(info).ok()?;
    Some(d)
}

#[tauri::command]
pub fn sync_pair_cancel(st: State<Sync>) {
    stop_pairing(&mut st.pairing.lock().unwrap());
}

/// Looks for laptops in pairing mode on this network for about 3 seconds.
#[tauri::command]
pub async fn sync_discover(app: AppHandle) -> Res<Vec<Value>> {
    tauri::async_runtime::spawn_blocking(move || browse(&app, None)).await.map_err(|e| e.to_string())?
}

/// mDNS browse for about 3 seconds: [{ name, addr, id }]. With `want`, stops
/// once the device with that ID is found.
fn browse(app: &AppHandle, want: Option<&str>) -> Res<Vec<Value>> {
    #[cfg(target_os = "android")]
    let _ = app.state::<SyncPlugin>().0.run_mobile_plugin::<()>("multicast", json!({ "on": true }));
    let found = (|| -> Res<Vec<Value>> {
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
                let id = info.get_property_val_str("id").unwrap_or("").to_string();
                if !out.iter().any(|v| v["addr"] == addr) {
                    let hit = want == Some(id.as_str());
                    out.push(json!({ "name": name, "addr": addr, "id": id }));
                    if hit {
                        break;
                    }
                }
            }
        }
        let _ = d.shutdown();
        Ok(out)
    })();
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
        let mut ch = dial(&app, &id)?;
        ch.send(b"ping")?;
        if ch.recv()? != b"pong" {
            return Err("Unexpected reply.".into());
        }
        Ok("Connected".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Unpairs a device: its key is deleted here, so it can't connect again.
/// If it's reachable it is told to forget this device too; if it's offline,
/// its next connection is simply rejected. Pairing again makes a new key.
#[tauri::command]
pub async fn sync_unpair(app: AppHandle, id: String) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(mut ch) = dial(&app, &id) {
            let _ = ch.send(b"unpair");
        }
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        ensure(&conn)?;
        conn.execute("DELETE FROM sync_peers WHERE id = ?1", [id]).map(|_| ()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn sync_log(conn: &Connection) -> Vec<Value> {
    let Ok(mut st) = conn.prepare("SELECT at, peer, added, edited, deleted, error FROM sync_log ORDER BY at DESC LIMIT 20") else { return vec![] };
    st.query_map([], |r| {
        Ok(json!({ "at": r.get::<_, i64>(0)?, "peer": r.get::<_, String>(1)?, "added": r.get::<_, i64>(2)?,
                   "edited": r.get::<_, i64>(3)?, "deleted": r.get::<_, i64>(4)?, "error": r.get::<_, Option<String>>(5)? }))
    })
    .map(|it| it.flatten().collect())
    .unwrap_or_default()
}

// ------------------------------------------------------------------ 7b: metadata sync
//
// The initiator sends {"t":"sync","rows":[...]}, the other side applies them
// and answers with its own rows, the initiator applies those and sends "done".
// Each side then moves that peer's `sent` mark to the seq it had sent. A row
// is [table, id, field, value, hlc, device]; field "_del" is a tombstone.
// Trash wins: is_archived is its own field, so edits elsewhere never untrash,
// and a tombstone beats every field edit.

type Stats = (u32, u32, u32);

/// Merges a peer's Yjs update into ours. Returns the merged doc, or None when
/// it adds nothing.
pub fn ymerge(local: Option<&[u8]>, remote: &[u8]) -> Res<Option<Vec<u8>>> {
    use yrs::{updates::decoder::Decode, ReadTxn, StateVector, Transact, Update};
    fn add(t: &mut yrs::TransactionMut, b: &[u8]) -> Res<()> {
        t.apply_update(Update::decode_v1(b).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }
    let doc = yrs::Doc::new();
    let mut t = doc.transact_mut();
    if let Some(l) = local {
        add(&mut t, l)?;
    }
    let before = t.encode_state_as_update_v1(&StateVector::default());
    add(&mut t, remote)?;
    let after = t.encode_state_as_update_v1(&StateVector::default());
    Ok((local.is_none() || after != before).then_some(after))
}

fn sql_json(v: rusqlite::types::Value) -> Value {
    use rusqlite::types::Value as V;
    match v {
        V::Null => Value::Null,
        V::Integer(i) => json!(i),
        V::Real(f) => json!(f),
        V::Text(t) => json!(t),
        V::Blob(b) => json!(B64.encode(b)),
    }
}

fn json_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(V::Integer).unwrap_or_else(|| V::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(t) => V::Text(t.clone()),
        other => V::Text(other.to_string()),
    }
}

fn field_of(tbl: &str, field: &str) -> Option<&'static str> {
    TABLES.iter().find(|(t, _)| *t == tbl)?.1.iter().find(|f| **f == field).copied()
}

/// The change queue for a peer: clock rows past its `sent` mark, with values.
fn outgoing(conn: &Connection, peer: &str) -> Res<(Vec<Value>, i64)> {
    ensure(conn)?;
    let e = |e: rusqlite::Error| e.to_string();
    let snap: i64 = conn.query_row("SELECT seq FROM sync_state", [], |r| r.get(0)).map_err(e)?;
    let sent: i64 = conn.query_row("SELECT sent FROM sync_peers WHERE id = ?1", [peer], |r| r.get(0)).map_err(e)?;
    let mut st = conn.prepare("SELECT tbl, id, field, hlc, dev FROM sync_clock WHERE seq > ?1 AND seq <= ?2").map_err(e)?;
    let clocks = st
        .query_map([sent, snap], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?)))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    let mut rows = vec![];
    for (tbl, id, field, hlc, dev) in clocks {
        let val = if field == "_del" {
            Value::Null
        } else {
            let Some(f) = field_of(&tbl, &field) else { continue };
            // A page with a Yjs doc sends the doc, not its JSON copy.
            if tbl == "pages" && f == "content" && conn.query_row("SELECT ydoc IS NOT NULL FROM pages WHERE id = ?1", [&id], |r| r.get(0)).optional().map_err(e)? == Some(true) {
                continue;
            }
            let v: Option<rusqlite::types::Value> =
                conn.query_row(&format!("SELECT {f} FROM {tbl} WHERE id = ?1"), [&id], |r| r.get(0)).optional().map_err(e)?;
            let Some(v) = v else { continue };
            if v == rusqlite::types::Value::Null && f == "ydoc" {
                continue;
            }
            sql_json(v)
        };
        rows.push(json!([tbl, id, field, val, hlc, dev]));
    }
    Ok((rows, snap))
}

/// Applies a peer's rows: newer (hlc, device) wins per field, a tombstone
/// beats everything, and a missing row is created (new pages arrive whole).
/// Returns pages added, edited and deleted.
fn apply(conn: &Connection, rows: &[Value]) -> Res<Stats> {
    use std::collections::HashSet;
    ensure(conn)?;
    let e = |e: rusqlite::Error| e.to_string();
    let tx = conn.unchecked_transaction().map_err(e)?;
    tx.execute("UPDATE sync_state SET applying = 1", []).map_err(e)?;
    let (mut added, mut edited, mut deleted): (HashSet<(String, String)>, HashSet<(String, String)>, u32) = Default::default();
    let mut max_hlc = 0i64;
    for r in rows {
        let (Some(tbl), Some(id), Some(field), Some(hlc), Some(dev)) = (r[0].as_str(), r[1].as_str(), r[2].as_str(), r[4].as_i64(), r[5].as_str()) else { continue };
        if !TABLES.iter().any(|(t, _)| *t == tbl) {
            continue;
        }
        max_hlc = max_hlc.max(hlc);
        let stamp = |f: &str| -> Res<()> {
            tx.execute("UPDATE sync_state SET seq = seq + 1", []).map_err(e)?;
            tx.execute("INSERT OR REPLACE INTO sync_clock SELECT ?1, ?2, ?3, ?4, ?5, seq FROM sync_state", params![tbl, id, f, hlc, dev]).map_err(e)?;
            Ok(())
        };
        let tomb = tx
            .query_row("SELECT 1 FROM sync_clock WHERE tbl = ?1 AND id = ?2 AND field = '_del'", params![tbl, id], |_| Ok(()))
            .optional()
            .map_err(e)?
            .is_some();
        if field == "_del" {
            if !tomb {
                if tbl == "pages" {
                    deleted += tx.execute("DELETE FROM pages WHERE id = ?1", [id]).map_err(e)? as u32;
                } else {
                    tx.execute(&format!("DELETE FROM {tbl} WHERE id = ?1"), [id]).map_err(e)?;
                }
                tx.execute("DELETE FROM sync_clock WHERE tbl = ?1 AND id = ?2", params![tbl, id]).map_err(e)?;
                stamp("_del")?;
            }
            continue;
        }
        let Some(f) = field_of(tbl, field) else { continue };
        let local: Option<(i64, String)> = tx
            .query_row("SELECT hlc, dev FROM sync_clock WHERE tbl = ?1 AND id = ?2 AND field = ?3", params![tbl, id, f], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(e)?;
        let ydoc = f == "ydoc";
        let remote_doc = if ydoc { r[3].as_str().and_then(|s| B64.decode(s).ok()) } else { None };
        if tomb || (ydoc && remote_doc.is_none()) || (!ydoc && local.as_ref().is_some_and(|(h, d)| (*h, d.as_str()) >= (hlc, dev))) {
            continue;
        }
        let key = (tbl.to_string(), id.to_string());
        let exists = tx.query_row(&format!("SELECT 1 FROM {tbl} WHERE id = ?1"), [id], |_| Ok(())).optional().map_err(e)?.is_some();
        if !exists {
            let cols = if tbl == "workspaces" { "(id, name) VALUES (?1, '')" } else { "(id) VALUES (?1)" };
            tx.execute(&format!("INSERT INTO {tbl} {cols}"), [id]).map_err(e)?;
            added.insert(key.clone());
        }
        if let Some(theirs) = remote_doc {
            // Body text: merge both docs; the app then rebuilds `content` from it.
            let mine: Option<Vec<u8>> = tx.query_row("SELECT ydoc FROM pages WHERE id = ?1", [id], |r| r.get(0)).map_err(e)?;
            let Some(m) = ymerge(mine.as_deref(), &theirs)? else { continue };
            crate::db::snapshot_version(&tx, id, "").map_err(e)?;
            tx.execute("UPDATE pages SET ydoc = ?2, content_stale = 1 WHERE id = ?1", params![id, m]).map_err(e)?;
            let h = local.map_or(hlc, |(h, _)| h.max(hlc));
            tx.execute("UPDATE sync_state SET seq = seq + 1", []).map_err(e)?;
            tx.execute("INSERT OR REPLACE INTO sync_clock SELECT 'pages', ?1, 'ydoc', ?2, ?3, seq FROM sync_state", params![id, h, dev]).map_err(e)?;
        } else {
            tx.execute(&format!("UPDATE {tbl} SET {f} = ?2 WHERE id = ?1"), params![id, json_sql(&r[3])]).map_err(e)?;
            if f == "content" {
                // Old-style body edit: the editor replays it into the Yjs doc.
                tx.execute("UPDATE pages SET ydoc_stale = 1 WHERE id = ?1 AND ydoc IS NOT NULL", [id]).map_err(e)?;
            }
            stamp(f)?;
        }
        if !added.contains(&key) {
            edited.insert(key);
        }
    }
    tx.execute("UPDATE sync_state SET applying = 0, hlc = MAX(hlc, ?1)", [max_hlc]).map_err(e)?;
    tx.commit().map_err(e)?;
    for (_, id) in added.iter().chain(edited.iter()).filter(|(t, _)| t == "pages") {
        crate::db::index_page(conn, id).map_err(e)?;
    }
    if deleted > 0 {
        crate::db::prune_orphans(conn).map_err(e)?;
    }
    let pages = |s: &HashSet<(String, String)>| s.iter().filter(|(t, _)| t == "pages").count() as u32;
    Ok((pages(&added), pages(&edited), deleted))
}

fn log(conn: &Connection, peer: &str, r: &Res<Stats>) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let ((a, ed, d), err) = match r {
        Ok(s) => (*s, None),
        Err(x) => ((0, 0, 0), Some(x.clone())),
    };
    let _ = conn.execute("INSERT INTO sync_log VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![now, peer, a, ed, d, err]);
    let _ = conn.execute("DELETE FROM sync_log WHERE rowid NOT IN (SELECT rowid FROM sync_log ORDER BY at DESC LIMIT 50)", []);
}

fn rows_of(msg: &[u8]) -> Res<Vec<Value>> {
    let v: Value = serde_json::from_slice(msg).map_err(|e| e.to_string())?;
    Ok(v["rows"].as_array().cloned().unwrap_or_default())
}

fn peer_name(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT name FROM sync_peers WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_else(|_| "Device".into())
}

/// Answering side of "Sync now".
fn serve_sync(app: &AppHandle, mut ch: Channel, peer: &str, msg: &[u8]) -> Res<()> {
    let _ = ch.s.set_read_timeout(Some(Duration::from_secs(120)));
    let db = app.state::<Db>();
    let r = (|| {
        let theirs = rows_of(msg)?;
        let (mine, snap) = outgoing(&db.0.lock().unwrap(), peer)?;
        let stats = apply(&db.0.lock().unwrap(), &theirs)?;
        ch.send(json!({ "rows": mine }).to_string().as_bytes())?;
        if ch.recv()? != b"done" {
            return Err("The other device stopped mid-sync.".to_string());
        }
        db.0.lock().unwrap().execute("UPDATE sync_peers SET sent = ?1 WHERE id = ?2", params![snap, peer]).map_err(|e| e.to_string())?;
        swap_files(app, &mut ch, false)?;
        Ok(stats)
    })();
    let conn = db.0.lock().unwrap();
    log(&conn, &peer_name(&conn, peer), &r);
    drop(conn);
    let _ = app.emit("sync-applied", ());
    r.map(|_| ())
}

/// Opens an encrypted channel to a paired device (the 7a hello/auth path).
fn dial(app: &AppHandle, id: &str) -> Res<Channel> {
    let db = app.state::<Db>();
    let (me, key, addr) = {
        let conn = db.0.lock().unwrap();
        let addr: Option<String> = conn.query_row("SELECT addr FROM sync_peers WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
        (device_id(&conn), peer_key(&conn, id), addr)
    };
    let (Some(key), Some(addr)) = (key, addr) else { return Err("That device isn't paired.".into()) };
    if addr.is_empty() {
        return Err("No address known for that device yet.".into());
    }
    // Last address failed: look the peer up over mDNS (trusted networks only).
    let mut s = match connect(&addr) {
        Ok(s) => s,
        Err(e) => {
            let found = if on_trusted(app) { browse(app, Some(id)).unwrap_or_default() } else { vec![] };
            let Some(addr) = found.iter().find(|v| v["id"] == id).and_then(|v| v["addr"].as_str()) else { return Err(e) };
            db.0.lock().unwrap().execute("UPDATE sync_peers SET addr = ?1 WHERE id = ?2", params![addr, id]).map_err(|e| e.to_string())?;
            connect(addr)?
        }
    };
    let io = |e: std::io::Error| e.to_string();
    send_json(&mut s, json!({ "t": "hello", "from": me, "to": id })).map_err(io)?;
    let r = recv_json(&mut s).map_err(io)?;
    if r["t"] != "ok" {
        return Err(r["e"].as_str().unwrap_or("The other device refused the connection.").to_string());
    }
    Channel::open(s, &key, true).map_err(|_| "The other device has a different key. Unpair and pair again.".to_string())
}

/// "Sync now": swaps changes with a paired device. Returns pages added, edited, deleted here.
#[tauri::command]
pub async fn sync_now(app: AppHandle, id: String) -> Res<Value> {
    tauri::async_runtime::spawn_blocking(move || sync_peer(&app, &id, false).map(|(a, e, d)| json!({ "added": a, "edited": e, "deleted": d })))
        .await
        .map_err(|e| e.to_string())?
}

/// One sync with a peer. `quiet` (background runs) doesn't log failures.
fn sync_peer(app: &AppHandle, id: &str, quiet: bool) -> Res<Stats> {
    let db = app.state::<Db>();
    let r = (|| {
        let (mine, snap) = outgoing(&db.0.lock().unwrap(), id)?;
        let mut ch = dial(app, id)?;
        let _ = ch.s.set_read_timeout(Some(Duration::from_secs(120)));
        ch.send(json!({ "t": "sync", "rows": mine }).to_string().as_bytes())?;
        let theirs = rows_of(&ch.recv()?)?;
        let stats = apply(&db.0.lock().unwrap(), &theirs)?;
        ch.send(b"done")?;
        db.0.lock().unwrap().execute("UPDATE sync_peers SET sent = ?1 WHERE id = ?2", params![snap, id]).map_err(|e| e.to_string())?;
        swap_files(app, &mut ch, true)?;
        Ok(stats)
    })();
    if !(quiet && r.is_err()) {
        let conn = db.0.lock().unwrap();
        log(&conn, &peer_name(&conn, id), &r);
        drop(conn);
        let _ = app.emit("sync-applied", ());
    }
    r
}

// ------------------------------------------------------------ files

/// Attachments (app_data/assets) follow the text in the same session, in
/// 256 KB chunks. Asking for chunk n acknowledges chunk n-1. A partial file
/// waits as `<name>.part`, and the next sync resumes from its size.
const CHUNK: u64 = 256 * 1024;

fn hold_mb(conn: &Connection) -> u64 {
    crate::db::read_setting(conn, "syncHoldMb").and_then(|v| v.parse().ok()).unwrap_or(10)
}

/// Complete files in the assets folder: [[name, size]].
fn list_files(dir: &std::path::Path) -> Vec<(String, u64)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten()
        .filter_map(|e| {
            let m = e.metadata().ok().filter(|m| m.is_file())?;
            let n = e.file_name().into_string().ok().filter(|n| !n.ends_with(".part"))?;
            Some((n, m.len()))
        })
        .collect()
}

/// Phone hosting a hotspot (metered), or a laptop on one (typical gateways).
fn hotspot(app: &AppHandle) -> bool {
    const GW: [&str; 2] = ["192.168.43.1", "172.20.10.1"];
    #[cfg(target_os = "android")]
    {
        let v = app.state::<SyncPlugin>().0.run_mobile_plugin::<Value>("network", json!({})).unwrap_or_default();
        return v["metered"].as_bool() == Some(true) || GW.contains(&v["gateway"].as_str().unwrap_or(""));
    }
    #[cfg(windows)]
    {
        let _ = app;
        return win_gateway().is_some_and(|g| GW.contains(&g.as_str()));
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, GW);
        false
    }
}

fn swap_files(app: &AppHandle, ch: &mut Channel, first: bool) -> Res<()> {
    let dir = crate::assets_dir(app)?;
    let mine = list_files(&dir);
    // The hotspot check runs only after the lists are swapped, and only when
    // there is something to pull, so it can't hold up the other device.
    let hello = json!({ "files": mine }).to_string();
    let tag = |step: String| move |e: String| format!("Attachments ({step}, {}): {e}", if first { "started here" } else { "answering" });
    let theirs: Value = (|| -> Res<Value> {
        if first {
            ch.send(hello.as_bytes())?;
            serde_json::from_slice(&ch.recv()?).map_err(|e| e.to_string())
        } else {
            let t = serde_json::from_slice(&ch.recv()?).map_err(|e| e.to_string())?;
            ch.send(hello.as_bytes())?;
            Ok(t)
        }
    })()
    .map_err(tag("file list".into()))?;
    let mut want: Vec<(String, u64)> = serde_json::from_value::<Vec<(String, u64)>>(theirs["files"].clone())
        .unwrap_or_default()
        .into_iter()
        .filter(|(n, _)| !mine.iter().any(|(m, _)| m == n))
        // Only attachment types Oceanic itself stores (others would be .bin), within a sane size.
        .filter(|(n, s)| {
            let ext = std::path::Path::new(n).extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
            *s <= MAX_SYNC_FILE && (ext == "bin" || crate::UPLOAD_EXT.contains(&ext.as_str()))
        })
        .collect();
    if !want.is_empty() && hotspot(app) {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        if crate::db::read_setting(&conn, "syncHold").as_deref() != Some("0") {
            let l = hold_mb(&conn) * 1024 * 1024;
            want.retain(|(_, s)| *s <= l);
        }
    }
    let pull = |ch: &mut Channel| pull_files(ch, &dir, &want).map_err(tag(format!("receiving {} files", want.len())));
    let serve = |ch: &mut Channel| serve_files(ch, &dir, &mine).map_err(tag("sending files".into()));
    if first {
        pull(ch)?;
        serve(ch)?;
    } else {
        serve(ch)?;
        pull(ch)?;
    }
    // Virus-scan what arrived (like any other import); a flagged file is deleted.
    for (name, _) in &want {
        let p = dir.join(name);
        let Ok(meta) = std::fs::metadata(&p) else { continue };
        if meta.len() <= MAX_SCAN {
            if let Ok(data) = std::fs::read(&p) {
                if crate::amsi::check(app, name, &data).is_err() {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
    }
    Ok(())
}

/// Largest attachment accepted from the other device.
const MAX_SYNC_FILE: u64 = 512 * 1024 * 1024;
/// Larger files skip the in-memory virus scan.
const MAX_SCAN: u64 = 64 * 1024 * 1024;

fn pull_files(ch: &mut Channel, dir: &std::path::Path, want: &[(String, u64)]) -> Res<()> {
    let e = |e: std::io::Error| e.to_string();
    for (name, size) in want {
        // Only plain file names from the other side.
        if std::path::Path::new(name).file_name().and_then(|n| n.to_str()) != Some(name.as_str()) {
            continue;
        }
        let part = dir.join(format!("{name}.part"));
        let mut at = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0) / CHUNK * CHUNK;
        let mut f = std::fs::OpenOptions::new().create(true).write(true).truncate(false).open(&part).map_err(e)?;
        f.set_len(at).map_err(e)?;
        use std::io::Seek;
        f.seek(std::io::SeekFrom::Start(at)).map_err(e)?;
        while at < *size {
            ch.send(json!({ "get": name, "n": at / CHUNK }).to_string().as_bytes())?;
            let data = ch.recv()?;
            if data.is_empty() {
                break;
            }
            f.write_all(&data).map_err(e)?;
            at += data.len() as u64;
        }
        drop(f);
        if at >= *size {
            std::fs::rename(&part, dir.join(name)).map_err(e)?;
        } else {
            let _ = std::fs::remove_file(&part); // gone on the other side
        }
    }
    ch.send(br#"{"end":true}"#)
}

fn serve_files(ch: &mut Channel, dir: &std::path::Path, mine: &[(String, u64)]) -> Res<()> {
    loop {
        let m: Value = serde_json::from_slice(&ch.recv()?).map_err(|e| e.to_string())?;
        if m["end"].as_bool() == Some(true) {
            return Ok(());
        }
        let name = m["get"].as_str().unwrap_or("");
        let mut data = vec![];
        if mine.iter().any(|(n, _)| n == name) {
            if let Ok(mut f) = std::fs::File::open(dir.join(name)) {
                use std::io::Seek;
                let _ = f.seek(std::io::SeekFrom::Start(m["n"].as_u64().unwrap_or(0) * CHUNK));
                let _ = f.take(CHUNK).read_to_end(&mut data);
            }
        }
        ch.send(&data)?;
    }
}

// ------------------------------------------------------------ background

/// The current network as (key, display name): Wi-Fi name, else the
/// router's BSSID or the gateway address.
fn network(app: &AppHandle) -> Option<(String, String)> {
    #[cfg(target_os = "android")]
    {
        let v = app.state::<SyncPlugin>().0.run_mobile_plugin::<Value>("network", json!({})).ok()?;
        let get = |k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(str::to_string);
        return get("ssid")
            .map(|s| (format!("ssid:{s}"), s))
            .or_else(|| get("bssid").map(|b| (format!("bssid:{b}"), format!("Wi-Fi {b}"))))
            .or_else(|| get("gateway").map(|g| (format!("gw:{g}"), format!("Network at {g}"))));
    }
    #[cfg(windows)]
    {
        let _ = app;
        let wlan = win_run("netsh", &["wlan", "show", "interfaces"]);
        let ssid = wlan.lines().map(str::trim).find(|l| l.starts_with("SSID")).and_then(|l| l.split_once(':')).map(|(_, v)| v.trim().to_string());
        if let Some(s) = ssid.filter(|s| !s.is_empty()) {
            return Some((format!("ssid:{s}"), s));
        }
        let gw = win_gateway()?;
        return Some((format!("gw:{gw}"), format!("Network at {gw}")));
    }
    #[allow(unreachable_code)]
    {
        let _ = app;
        None
    }
}

#[cfg(windows)]
fn win_run(cmd: &str, args: &[&str]) -> String {
    use std::os::windows::process::CommandExt;
    std::process::Command::new(cmd)
        .args(args)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

#[cfg(windows)]
fn win_gateway() -> Option<String> {
    win_run("route", &["print", "-4", "0.0.0.0"])
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>())
        .find(|f| f.len() >= 3 && f[0] == "0.0.0.0" && f[1] == "0.0.0.0")
        .map(|f| f[2].to_string())
}

fn trust_of(app: &AppHandle, key: &str) -> Option<String> {
    if app.state::<Sync>().once.lock().unwrap().as_deref() == Some(key) {
        return Some("once".into());
    }
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    ensure(&conn).ok()?;
    conn.query_row("SELECT trust FROM sync_networks WHERE key = ?1", [key], |r| r.get(0)).optional().ok()?
}

fn on_trusted(app: &AppHandle) -> bool {
    network(app).and_then(|(k, _)| trust_of(app, &k)).is_some_and(|t| t != "never")
}

/// Desktop: announce over mDNS only while on a trusted network.
fn refresh_announce(app: &AppHandle, trusted: bool) {
    #[cfg(desktop)]
    {
        let st = app.state::<Sync>();
        let mut a = st.announce.lock().unwrap();
        if !trusted {
            if let Some(d) = a.take() {
                let _ = d.shutdown();
            }
        } else if a.is_none() {
            let id = device_id(&app.state::<Db>().0.lock().unwrap());
            *a = announce(&id, &device_name(app));
        }
    }
    let _ = (app, trusted);
}

/// Syncs with every paired device if this network is trusted. Returns how many synced.
fn auto_sync(app: &AppHandle) -> usize {
    let ids: Vec<String> = peers(&app.state::<Db>().0.lock().unwrap()).unwrap_or_default().into_iter().map(|p| p.id).collect();
    if ids.is_empty() || !option(app, "syncAuto") || !on_trusted(app) {
        return 0;
    }
    #[cfg(target_os = "android")]
    let notify = option(app, "syncNotify");
    #[cfg(target_os = "android")]
    if notify {
        let _ = app.state::<SyncPlugin>().0.run_mobile_plugin::<()>("syncing", json!({ "on": true }));
    }
    let n = ids.iter().filter(|id| sync_peer(app, id, true).is_ok()).count();
    #[cfg(target_os = "android")]
    if notify {
        let _ = app.state::<SyncPlugin>().0.run_mobile_plugin::<()>("syncing", json!({ "on": false }));
    }
    n
}

/// Background options, on unless set to "0": syncAuto, syncNotify.
fn option(app: &AppHandle, key: &str) -> bool {
    crate::db::read_setting(&app.state::<Db>().0.lock().unwrap(), key).as_deref() != Some("0")
}

#[tauri::command]
pub fn sync_set_option(db: State<Db>, key: String, on: bool) -> Res<()> {
    if !["syncAuto", "syncNotify", "syncHold"].contains(&key.as_str()) {
        return Err("Unknown option.".into());
    }
    crate::db::write_setting(&db.0.lock().unwrap(), &key, if on { "1" } else { "0" }).map(|_| ()).map_err(|e| e.to_string())
}

/// Files over this many MB wait while on a hotspot (when syncHold is on).
#[tauri::command]
pub fn sync_set_hold_mb(db: State<Db>, mb: u32) -> Res<()> {
    crate::db::write_setting(&db.0.lock().unwrap(), "syncHoldMb", &mb.max(1).to_string()).map(|_| ()).map_err(|e| e.to_string())
}

/// Every 30 s (while the app process runs), check the network. On a change
/// (e.g. Wi-Fi joined), or on wake from sleep (the wall clock jumped),
/// refresh mDNS and sync with paired devices.
pub fn start_watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last: Option<Option<String>> = None;
        let mut wall = std::time::SystemTime::now();
        let mut ticks = 0u32;
        loop {
            let woke = wall.elapsed().is_ok_and(|d| d > Duration::from_secs(90));
            wall = std::time::SystemTime::now();
            let key = network(&app).map(|n| n.0);
            let moved = last.as_ref() != Some(&key);
            if moved {
                *app.state::<Sync>().once.lock().unwrap() = None;
                last = Some(key);
                let _ = app.emit("sync-network", ());
            }
            if moved || woke {
                refresh_announce(&app, on_trusted(&app));
                auto_sync(&app);
            }
            // Every 4th tick (~2 min): sync only when changes are waiting.
            ticks += 1;
            if ticks % 4 == 0 {
                let waiting = {
                    let db = app.state::<Db>();
                    let conn = db.0.lock().unwrap();
                    conn.query_row(
                        "SELECT 1 FROM sync_clock WHERE seq > (SELECT IFNULL(MIN(sent), 0) FROM sync_peers) LIMIT 1",
                        [],
                        |_| Ok(()),
                    ).optional().unwrap_or(None).is_some()
                };
                if waiting {
                    auto_sync(&app);
                    let _ = app.emit("sync-status", ());
                }
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}

/// The current network and its trust: always, never, once, or null (ask).
#[tauri::command]
pub async fn sync_network(app: AppHandle) -> Res<Value> {
    tauri::async_runtime::spawn_blocking(move || match network(&app) {
        Some((key, name)) => json!({ "key": key, "name": name, "trust": trust_of(&app, &key) }),
        None => Value::Null,
    })
    .await
    .map_err(|e| e.to_string())
}

/// Answers the trust prompt: "always", "never" or "once".
#[tauri::command]
pub async fn sync_trust(app: AppHandle, key: String, name: String, trust: String) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        if trust == "once" {
            *app.state::<Sync>().once.lock().unwrap() = Some(key);
        } else {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            ensure(&conn)?;
            conn.execute("INSERT OR REPLACE INTO sync_networks VALUES (?1, ?2, ?3)", params![key, name, trust]).map_err(|e| e.to_string())?;
        }
        refresh_announce(&app, trust != "never");
        auto_sync(&app);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Settings → Sync networks.
#[tauri::command]
pub fn sync_networks(db: State<Db>) -> Res<Vec<Value>> {
    let conn = db.0.lock().unwrap();
    ensure(&conn)?;
    let mut st = conn.prepare("SELECT key, name, trust FROM sync_networks ORDER BY name").map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| Ok(json!({ "key": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "trust": r.get::<_, String>(2)? })))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_forget_network(app: AppHandle, db: State<Db>, key: String) -> Res<()> {
    db.0.lock().unwrap().execute("DELETE FROM sync_networks WHERE key = ?1", [&key]).map_err(|e| e.to_string())?;
    refresh_announce(&app, on_trusted(&app));
    let _ = app.emit("sync-network", ());
    Ok(())
}

/// Phone prompts: hasLocation, askLocation, batteryOk, askBattery (SyncPlugin.kt).
#[tauri::command]
pub fn sync_android(app: AppHandle, cmd: String) -> Res<bool> {
    #[cfg(target_os = "android")]
    {
        if !["hasLocation", "askLocation", "batteryOk", "askBattery"].contains(&cmd.as_str()) {
            return Err("Unknown command.".into());
        }
        let v = app.state::<SyncPlugin>().0.run_mobile_plugin::<Value>(&cmd, json!({})).map_err(|e| e.to_string())?;
        return Ok(v["ok"].as_bool().unwrap_or(true));
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, cmd);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 600 KB file in 256 KB chunks over a real Noise channel, resuming from a
    /// partial `.part` left by an earlier, dropped sync.
    #[test]
    fn file_chunks_resume() {
        let tmp = std::env::temp_dir().join(format!("oc-files-{}", uuid::Uuid::new_v4()));
        let (src, dst) = (tmp.join("a"), tmp.join("b"));
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        let body: Vec<u8> = (0..600_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(src.join("img.png"), &body).unwrap();
        // Earlier sync got 1 chunk plus a bit; the bit is re-fetched.
        std::fs::write(dst.join("img.png.part"), &body[..300_000]).unwrap();
        let key = [7u8; 32];
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let at = l.local_addr().unwrap();
        let s2 = src.clone();
        let server = std::thread::spawn(move || {
            let mut ch = Channel::open(l.accept().unwrap().0, &key, false).unwrap();
            serve_files(&mut ch, &s2, &list_files(&s2)).unwrap();
        });
        let mut ch = Channel::open(TcpStream::connect(at).unwrap(), &key, true).unwrap();
        pull_files(&mut ch, &dst, &list_files(&src)).unwrap();
        server.join().unwrap();
        assert_eq!(std::fs::read(dst.join("img.png")).unwrap(), body);
        assert!(!dst.join("img.png.part").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    fn db(name: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("oceanic-sync-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let c = crate::db::open(&dir).unwrap();
        READY.store(false, std::sync::atomic::Ordering::Relaxed);
        ensure(&c).unwrap();
        READY.store(false, std::sync::atomic::Ordering::Relaxed);
        c.execute("INSERT INTO sync_peers (id, name, key) VALUES ('peer', 'Peer', x'00')", []).unwrap();
        c
    }

    /// One "Sync now" between a and b, as the two sides run it.
    fn swap(a: &Connection, b: &Connection) -> (Stats, Stats) {
        let (ra, sa) = outgoing(a, "peer").unwrap();
        let (rb, sb) = outgoing(b, "peer").unwrap();
        let in_b = apply(b, &ra).unwrap();
        let in_a = apply(a, &rb).unwrap();
        a.execute("UPDATE sync_peers SET sent = ?1", [sa]).unwrap();
        b.execute("UPDATE sync_peers SET sent = ?1", [sb]).unwrap();
        (in_a, in_b)
    }

    fn title(c: &Connection, id: &str) -> Option<String> {
        c.query_row("SELECT title FROM pages WHERE id = ?1", [id], |r| r.get(0)).optional().unwrap()
    }

    #[test]
    fn metadata_sync() {
        let (a, b) = (db("a"), db("b"));
        a.execute("INSERT INTO pages (id, title, content) VALUES ('p1', 'From A', '[]')", []).unwrap();
        b.execute("INSERT INTO pages (id, title) VALUES ('p2', 'From B')", []).unwrap();
        // First sync: union.
        let (in_a, in_b) = swap(&a, &b);
        assert_eq!((in_a.0, in_b.0), (1, 1));
        assert_eq!(title(&b, "p1").as_deref(), Some("From A"));
        assert_eq!(b.query_row("SELECT content FROM pages WHERE id = 'p1'", [], |r| r.get::<_, String>(0)).unwrap(), "[]");
        // Nothing left in the queue.
        assert_eq!(swap(&a, &b), ((0, 0, 0), (0, 0, 0)));
        // Per-field: A renames, B pins; both survive.
        a.execute("UPDATE pages SET title = 'Renamed' WHERE id = 'p2'", []).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        b.execute("UPDATE pages SET is_pinned = 1 WHERE id = 'p2'", []).unwrap();
        swap(&a, &b);
        for c in [&a, &b] {
            let (t, pin): (String, i64) = c.query_row("SELECT title, is_pinned FROM pages WHERE id = 'p2'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            assert_eq!((t.as_str(), pin), ("Renamed", 1));
        }
        // Same field on both: the later write wins.
        a.execute("UPDATE pages SET title = 'Old' WHERE id = 'p1'", []).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        b.execute("UPDATE pages SET title = 'New' WHERE id = 'p1'", []).unwrap();
        swap(&a, &b);
        assert_eq!((title(&a, "p1"), title(&b, "p1")), (Some("New".into()), Some("New".into())));
        // Hard delete beats a later edit on the other side.
        a.execute("DELETE FROM pages WHERE id = 'p1'", []).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        b.execute("UPDATE pages SET title = 'Edit after delete' WHERE id = 'p1'", []).unwrap();
        swap(&a, &b);
        assert_eq!((title(&a, "p1"), title(&b, "p1")), (None, None));
    }

    #[test]
    fn body_merge() {
        use yrs::{GetString, ReadTxn, StateVector, Text, Transact, Update, updates::decoder::Decode};
        fn edit(base: &[u8], at: u32, s: &str) -> Vec<u8> {
            let d = yrs::Doc::new();
            let t = d.get_or_insert_text("t");
            let mut x = d.transact_mut();
            x.apply_update(Update::decode_v1(base).unwrap()).unwrap();
            t.insert(&mut x, at, s);
            x.encode_state_as_update_v1(&StateVector::default())
        }
        fn text(b: &[u8]) -> String {
            let d = yrs::Doc::new();
            let t = d.get_or_insert_text("t");
            d.transact_mut().apply_update(Update::decode_v1(b).unwrap()).unwrap();
            let s = t.get_string(&d.transact());
            s
        }
        let (a, b) = (db("ya"), db("yb"));
        let base = edit(&yrs::Doc::new().transact().encode_state_as_update_v1(&StateVector::default()), 0, "hello world");
        a.execute("INSERT INTO pages (id, title, ydoc) VALUES ('p', 'P', ?1)", [&base]).unwrap();
        swap(&a, &b);
        // Both devices edit the same body; both edits survive.
        a.execute("UPDATE pages SET ydoc = ?1", [edit(&base, 0, "A: ")]).unwrap();
        b.execute("UPDATE pages SET ydoc = ?1", [edit(&base, 11, " (B)")]).unwrap();
        swap(&a, &b);
        for c in [&a, &b] {
            let y: Vec<u8> = c.query_row("SELECT ydoc FROM pages", [], |r| r.get(0)).unwrap();
            assert_eq!(text(&y), "A: hello world (B)");
        }
        // Nothing new: a second sync changes nothing.
        assert_eq!(swap(&a, &b), ((0, 0, 0), (0, 0, 0)));
    }
}
