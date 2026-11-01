//! Local SQLite persistence for pages, workspaces, settings and tabs.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

/// ISO-8601 UTC with milliseconds, so the frontend can `Date.parse` it directly.
pub(crate) const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

pub struct Db(pub Mutex<Connection>);

pub(crate) type CmdResult<T> = Result<T, String>;

pub(crate) fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/* ------------------------------------------------------------------ setup */

pub fn open(dir: &Path) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(dir).ok();
    let conn = Connection::open(dir.join("oceanic.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    seed(&conn)?;
    Ok(conn)
}

/// Each step runs once, tracked by `PRAGMA user_version`.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version < 1 {
        conn.execute_batch(&format!(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS pages (
               id          TEXT PRIMARY KEY,
               title       TEXT NOT NULL DEFAULT '',
               icon        TEXT NOT NULL DEFAULT '📄',
               content     TEXT,
               parent_id   TEXT,
               is_pinned   INTEGER NOT NULL DEFAULT 0,
               is_archived INTEGER NOT NULL DEFAULT 0,
               archived_at DATETIME,
               sort_order  INTEGER NOT NULL DEFAULT 0,
               created_at  DATETIME NOT NULL DEFAULT ({NOW}),
               updated_at  DATETIME NOT NULL DEFAULT ({NOW})
             );
             CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, sort_order);
             CREATE TABLE IF NOT EXISTS workspace_tabs (
               id            TEXT PRIMARY KEY,
               page_id       TEXT NOT NULL,
               tab_order     INTEGER NOT NULL,
               history       TEXT NOT NULL DEFAULT '[]',
               history_index INTEGER NOT NULL DEFAULT 0,
               is_active     INTEGER NOT NULL DEFAULT 0
             );
             PRAGMA user_version = 1;
             COMMIT;"
        ))?;
    }

    if version < 2 {
        // Backlink index (rebuilt per source page on every save) and the
        // spatial canvas layout.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS page_links (
               source_id TEXT NOT NULL,
               target_id TEXT NOT NULL,
               snippet   TEXT NOT NULL DEFAULT '',
               PRIMARY KEY (source_id, target_id)
             );
             CREATE INDEX IF NOT EXISTS idx_links_target ON page_links(target_id);
             CREATE TABLE IF NOT EXISTS canvas_positions (
               page_id TEXT PRIMARY KEY,
               x       REAL NOT NULL,
               y       REAL NOT NULL
             );
             PRAGMA user_version = 2;
             COMMIT;",
        )?;
    }

    if version < 3 {
        // Canvas connections. `manual = 1` rows were drawn on the canvas and
        // count as links; `manual = 0` rows only style a document link.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS canvas_edges (
               source_id TEXT NOT NULL,
               target_id TEXT NOT NULL,
               label     TEXT NOT NULL DEFAULT '',
               color     TEXT NOT NULL DEFAULT 'default',
               style     TEXT NOT NULL DEFAULT 'solid',
               manual    INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY (source_id, target_id)
             );
             CREATE INDEX IF NOT EXISTS idx_edges_target ON canvas_edges(target_id);
             PRAGMA user_version = 3;
             COMMIT;",
        )?;
    }

    if version < 4 {
        // Subject workspaces, page properties (Date / Status / Tags) and a
        // key-value settings store. Existing pages move into "General".
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS workspaces (
               id         TEXT PRIMARY KEY,
               name       TEXT NOT NULL,
               icon       TEXT NOT NULL DEFAULT '📁',
               color      TEXT NOT NULL DEFAULT 'blue',
               position_x REAL NOT NULL DEFAULT 0,
               position_y REAL NOT NULL DEFAULT 0,
               sort_order INTEGER NOT NULL DEFAULT 0
             );
             INSERT OR IGNORE INTO workspaces (id, name, icon, color) VALUES ('general', 'General', '🌊', 'blue');
             ALTER TABLE pages ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'general';
             ALTER TABLE pages ADD COLUMN due_date TEXT;
             ALTER TABLE pages ADD COLUMN status TEXT;
             ALTER TABLE pages ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
             ALTER TABLE canvas_edges ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'general';
             CREATE INDEX IF NOT EXISTS idx_pages_workspace ON pages(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_pages_due ON pages(workspace_id, due_date);
             CREATE TABLE IF NOT EXISTS settings (
               key   TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             PRAGMA user_version = 4;
             COMMIT;",
        )?;
    }

    if version < 5 {
        // Full-text search over titles and plain document text.
        conn.execute_batch(
            "BEGIN;
             CREATE VIRTUAL TABLE IF NOT EXISTS page_search USING fts5(
               page_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2'
             );
             PRAGMA user_version = 5;
             COMMIT;",
        )?;
        let ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM pages")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for id in ids {
            index_page(conn, &id)?;
        }
    }

    if version < 6 {
        // Study tools: spaced-repetition flashcards (synced from documents),
        // assignment fields for the Kanban board, and imported media files.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS flashcards (
               id               TEXT PRIMARY KEY,
               page_id          TEXT NOT NULL,
               front            TEXT NOT NULL DEFAULT '',
               back             TEXT NOT NULL DEFAULT '',
               interval         INTEGER NOT NULL DEFAULT 0,
               ease_factor      REAL NOT NULL DEFAULT 2.5,
               repetitions      INTEGER NOT NULL DEFAULT 0,
               next_review_date TEXT,
               due_count        INTEGER NOT NULL DEFAULT 0,
               last_reviewed_at TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_flashcards_page ON flashcards(page_id);
             CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(next_review_date);
             CREATE TABLE IF NOT EXISTS assignments (
               page_id        TEXT PRIMARY KEY,
               priority       TEXT,
               weight         REAL NOT NULL DEFAULT 1,
               grade_target   REAL,
               grade_achieved REAL
             );
             CREATE TABLE IF NOT EXISTS assets (
               id          TEXT PRIMARY KEY,
               file_name   TEXT NOT NULL,
               stored_path TEXT NOT NULL,
               mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
               created_at  DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             );
             PRAGMA user_version = 6;
             COMMIT;",
        )?;
    }

    if version < 7 {
        // Oceanic Mindmap: one row per map, one per node (tree via parent_node_id).
        conn.execute_batch(&format!(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS mindmaps (
               id          TEXT PRIMARY KEY,
               title       TEXT NOT NULL DEFAULT 'Untitled mindmap',
               subject_tag TEXT NOT NULL DEFAULT '',
               created_at  DATETIME NOT NULL DEFAULT ({NOW}),
               updated_at  DATETIME NOT NULL DEFAULT ({NOW})
             );
             CREATE TABLE IF NOT EXISTS mindmap_nodes (
               id             TEXT NOT NULL,
               mindmap_id     TEXT NOT NULL,
               label          TEXT NOT NULL DEFAULT '',
               position_x     REAL NOT NULL DEFAULT 0,
               position_y     REAL NOT NULL DEFAULT 0,
               parent_node_id TEXT,
               linked_page_id TEXT,
               style_json     TEXT NOT NULL DEFAULT '{{}}',
               PRIMARY KEY (mindmap_id, id)
             );
             PRAGMA user_version = 7;
             COMMIT;"
        ))?;
    }
    Ok(())
}

/// A brand-new database gets one starter page. Its content stays NULL so the
/// frontend renders its built-in welcome document until the first edit.
fn seed(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0))?;
    if count == 0 {
        conn.execute(
            "INSERT INTO pages (id, title, icon, is_pinned, sort_order) VALUES ('welcome', 'Welcome', '🌊', 1, 0)",
            [],
        )?;
    }
    Ok(())
}

/* ----------------------------------------------------------------- search */

/// Every `"text"` string in a BlockNote document, block by block.
fn plain_text(content: &str) -> String {
    fn walk(v: &serde_json::Value, out: &mut String) {
        match v {
            serde_json::Value::Object(map) => {
                if let Some(serde_json::Value::String(t)) = map.get("text") {
                    out.push_str(t);
                }
                for (k, child) in map {
                    if k != "text" {
                        walk(child, out);
                    }
                }
                if map.contains_key("type") && map.contains_key("children") {
                    out.push('\n');
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|i| walk(i, out)),
            _ => {}
        }
    }
    let mut out = String::new();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(content) {
        walk(&v, &mut out);
    }
    out
}

/// Refreshes one page's row in the search index from what's stored.
fn index_page(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM page_search WHERE page_id = ?1", [id])?;
    let row: Option<(String, Option<String>)> = conn
        .query_row("SELECT title, content FROM pages WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    if let Some((title, content)) = row {
        let body = content.as_deref().map(plain_text).unwrap_or_default();
        conn.execute(
            "INSERT INTO page_search (page_id, title, body) VALUES (?1, ?2, ?3)",
            params![id, title, body],
        )?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    page_id: String,
    /// Matching text with hits wrapped in \u{1}…\u{2}; empty for title-only hits.
    snippet: String,
    /// bm25 score (lower is better).
    rank: f64,
}

/// Prefix search over titles (and bodies unless `title_only`), best first.
#[tauri::command]
pub fn search_pages(db: State<Db>, query: String, title_only: bool) -> CmdResult<Vec<SearchHit>> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let column = if title_only { "title" } else { "{title body}" };
    let fts = format!("{column} : {}", terms.join(" "));
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT page_id, snippet(page_search, 2, char(1), char(2), '…', 14), bm25(page_search, 8.0, 1.0)
             FROM page_search WHERE page_search MATCH ?1
             ORDER BY bm25(page_search, 8.0, 1.0) LIMIT 100",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([fts], |r| Ok(SearchHit { page_id: r.get(0)?, snippet: r.get(1)?, rank: r.get(2)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/* ------------------------------------------------------------------ types */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    id: String,
    title: String,
    icon: String,
    parent_id: Option<String>,
    is_pinned: bool,
    archived_at: Option<String>,
    created_at: String,
    updated_at: String,
    workspace_id: String,
    /// `YYYY-MM-DD`, or None when the page isn't scheduled.
    due_date: Option<String>,
    status: Option<String>,
    tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    #[serde(flatten)]
    summary: PageSummary,
    /// BlockNote document as JSON; NULL until the page is first saved.
    content: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRecord {
    id: String,
    history: Vec<String>,
    history_index: usize,
    is_active: bool,
}

/// One outgoing `[[page]]` reference, extracted from the document by the
/// frontend. `snippet` is the surrounding block's text.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLink {
    target_id: String,
    snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    source_id: String,
    snippet: String,
    /// "document" for a `[[page]]` chip, "canvas" for a drawn connection.
    via: String,
    /// Canvas connection label (empty for document links).
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    source_id: String,
    target_id: String,
    label: String,
    color: String,
    style: String,
    manual: bool,
}

fn edge_by_key(conn: &Connection, source: &str, target: &str) -> rusqlite::Result<CanvasEdge> {
    conn.query_row(
        "SELECT source_id, target_id, label, color, style, manual FROM canvas_edges
         WHERE source_id = ?1 AND target_id = ?2",
        params![source, target],
        |r| {
            Ok(CanvasEdge {
                source_id: r.get(0)?,
                target_id: r.get(1)?,
                label: r.get(2)?,
                color: r.get(3)?,
                style: r.get(4)?,
                manual: r.get::<_, i64>(5)? != 0,
            })
        },
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEdge {
    source_id: String,
    target_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPosition {
    page_id: String,
    x: f64,
    y: f64,
}

/// Replace the outgoing links recorded for `source_id`.
fn write_links(conn: &Connection, source_id: &str, links: &[PageLink]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM page_links WHERE source_id = ?1", [source_id])?;
    let mut stmt = conn.prepare(
        "INSERT OR REPLACE INTO page_links (source_id, target_id, snippet) VALUES (?1, ?2, ?3)",
    )?;
    for link in links.iter().filter(|l| l.target_id != source_id) {
        stmt.execute(params![source_id, link.target_id, link.snippet])?;
    }
    Ok(())
}

const SUMMARY_COLS: &str =
    "id, title, icon, parent_id, is_pinned, archived_at, created_at, updated_at, workspace_id, due_date, status, tags";

fn summary(r: &Row) -> rusqlite::Result<PageSummary> {
    Ok(PageSummary {
        id: r.get(0)?,
        title: r.get(1)?,
        icon: r.get(2)?,
        parent_id: r.get(3)?,
        is_pinned: r.get::<_, i64>(4)? != 0,
        archived_at: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        workspace_id: r.get(8)?,
        due_date: r.get(9)?,
        status: r.get(10)?,
        tags: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or_default(),
    })
}

fn summary_by_id(conn: &Connection, id: &str) -> rusqlite::Result<PageSummary> {
    conn.query_row(
        &format!("SELECT {SUMMARY_COLS} FROM pages WHERE id = ?1"),
        [id],
        summary,
    )
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/* ------------------------------------------------------------------ pages */

/// Non-archived pages in sidebar order. Children of an archived page are
/// still returned; the frontend hides them because their parent is absent.
#[tauri::command]
pub fn get_pages(db: State<Db>) -> CmdResult<Vec<PageSummary>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM pages WHERE is_archived = 0 ORDER BY sort_order, created_at"
        ))
        .map_err(err)?;
    let rows = stmt.query_map([], summary).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Pages moved to Trash, most recent first.
#[tauri::command]
pub fn get_trashed_pages(db: State<Db>) -> CmdResult<Vec<PageSummary>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM pages WHERE is_archived = 1 ORDER BY archived_at DESC"
        ))
        .map_err(err)?;
    let rows = stmt.query_map([], summary).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn get_page(db: State<Db>, id: String) -> CmdResult<Option<Page>> {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        &format!("SELECT {SUMMARY_COLS}, content FROM pages WHERE id = ?1"),
        [&id],
        |r| Ok(Page { summary: summary(r)?, content: r.get(12)? }),
    )
    .optional()
    .map_err(err)
}

#[tauri::command]
pub fn create_page(
    db: State<Db>,
    parent_id: Option<String>,
    workspace_id: String,
    due_date: Option<String>,
) -> CmdResult<PageSummary> {
    let conn = db.0.lock().unwrap();
    let id = new_id();
    // A sub-page always lives in its parent's workspace.
    conn.execute(
        "INSERT INTO pages (id, title, parent_id, workspace_id, due_date, sort_order)
         VALUES (?1, 'Untitled', ?2,
                 COALESCE((SELECT workspace_id FROM pages WHERE id = ?2), ?3), ?4,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM pages WHERE parent_id IS ?2))",
        params![id, parent_id, workspace_id, due_date],
    )
    .map_err(err)?;
    index_page(&conn, &id).map_err(err)?;
    summary_by_id(&conn, &id).map_err(err)
}

/// Debounced auto-save target: stores the document and refreshes its
/// outgoing links in one transaction. Returns the new `updated_at`.
#[tauri::command]
pub fn save_page(
    db: State<Db>,
    id: String,
    title: String,
    content: String,
    links: Vec<PageLink>,
) -> CmdResult<String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    let updated_at: String = tx
        .query_row(
            &format!(
                "UPDATE pages SET title = ?2, content = ?3, updated_at = {NOW} WHERE id = ?1 RETURNING updated_at"
            ),
            params![id, title, content],
            |r| r.get(0),
        )
        .map_err(err)?;
    write_links(&tx, &id, &links).map_err(err)?;
    index_page(&tx, &id).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(updated_at)
}

/// Title-only save (sidebar rename) for pages whose content isn't loaded.
#[tauri::command]
pub fn rename_page(db: State<Db>, id: String, title: String) -> CmdResult<String> {
    let conn = db.0.lock().unwrap();
    let updated_at = conn
        .query_row(
            &format!("UPDATE pages SET title = ?2, updated_at = {NOW} WHERE id = ?1 RETURNING updated_at"),
            params![id, title],
            |r| r.get(0),
        )
        .map_err(err)?;
    index_page(&conn, &id).map_err(err)?;
    Ok(updated_at)
}

#[tauri::command]
pub fn set_page_icon(db: State<Db>, id: String, icon: String) -> CmdResult<String> {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        &format!("UPDATE pages SET icon = ?2, updated_at = {NOW} WHERE id = ?1 RETURNING updated_at"),
        params![id, icon],
        |r| r.get(0),
    )
    .map_err(err)
}

#[tauri::command]
pub fn toggle_pin_page(db: State<Db>, id: String) -> CmdResult<bool> {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "UPDATE pages SET is_pinned = 1 - is_pinned WHERE id = ?1 RETURNING is_pinned",
        [&id],
        |r| r.get::<_, i64>(0).map(|v| v != 0),
    )
    .map_err(err)
}

/// Soft delete: moves the page (and, implicitly, its sub-pages) to Trash.
#[tauri::command]
pub fn delete_page(db: State<Db>, id: String) -> CmdResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        &format!("UPDATE pages SET is_archived = 1, archived_at = {NOW} WHERE id = ?1"),
        [&id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn restore_page(db: State<Db>, id: String) -> CmdResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE pages SET is_archived = 0, archived_at = NULL WHERE id = ?1",
        [&id],
    )
    .map_err(err)?;
    Ok(())
}

/// Permanently removes the page and every page nested under it.
#[tauri::command]
pub fn delete_page_forever(db: State<Db>, id: String) -> CmdResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "WITH RECURSIVE sub(id) AS (
           SELECT ?1
           UNION ALL
           SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id
         )
         DELETE FROM pages WHERE id IN (SELECT id FROM sub)",
        [&id],
    )
    .map_err(err)?;
    // Links and canvas cards pointing at pages that no longer exist.
    conn.execute_batch(
        "DELETE FROM page_links WHERE source_id NOT IN (SELECT id FROM pages)
                                   OR target_id NOT IN (SELECT id FROM pages);
         DELETE FROM canvas_positions WHERE page_id NOT IN (SELECT id FROM pages);
         DELETE FROM page_search WHERE page_id NOT IN (SELECT id FROM pages);
         DELETE FROM flashcards WHERE page_id NOT IN (SELECT id FROM pages);
         DELETE FROM assignments WHERE page_id NOT IN (SELECT id FROM pages);
         DELETE FROM canvas_edges WHERE source_id NOT IN (SELECT id FROM pages)
                                     OR target_id NOT IN (SELECT id FROM pages);",
    )
    .map_err(err)?;
    Ok(())
}

/// Copies a page (not its sub-pages) to just after the original. `content`
/// is the frontend's current document, which may be newer than the stored one.
#[tauri::command]
pub fn duplicate_page(
    db: State<Db>,
    id: String,
    content: Option<String>,
    links: Option<Vec<PageLink>>,
) -> CmdResult<PageSummary> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    let (parent_id, order): (Option<String>, i64) = tx
        .query_row("SELECT parent_id, sort_order FROM pages WHERE id = ?1", [&id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(err)?;
    tx.execute(
        "UPDATE pages SET sort_order = sort_order + 1 WHERE parent_id IS ?1 AND sort_order > ?2",
        params![parent_id, order],
    )
    .map_err(err)?;
    let copy_id = new_id();
    tx.execute(
        "INSERT INTO pages (id, title, icon, content, parent_id, sort_order, workspace_id, due_date, status, tags)
         SELECT ?2, title || ' (copy)', icon, COALESCE(?3, content), parent_id, sort_order + 1,
                workspace_id, due_date, status, tags
         FROM pages WHERE id = ?1",
        params![id, copy_id, content],
    )
    .map_err(err)?;
    match links {
        Some(links) => write_links(&tx, &copy_id, &links).map_err(err)?,
        None => {
            tx.execute(
                "INSERT INTO page_links (source_id, target_id, snippet)
                 SELECT ?2, target_id, snippet FROM page_links WHERE source_id = ?1",
                params![id, copy_id],
            )
            .map_err(err)?;
        }
    }
    let page = summary_by_id(&tx, &copy_id).map_err(err)?;
    index_page(&tx, &copy_id).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(page)
}

/// Moves a page under `new_parent_id` (None = top level). `position` is its
/// index among the new parent's live children; omitted means "last".
#[tauri::command]
pub fn update_page_parent(
    db: State<Db>,
    id: String,
    new_parent_id: Option<String>,
    position: Option<usize>,
) -> CmdResult<String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;

    // Refuse to nest a page inside itself or one of its own sub-pages.
    if let Some(parent) = &new_parent_id {
        let cycle: bool = tx
            .query_row(
                "WITH RECURSIVE up(id, parent_id) AS (
                   SELECT id, parent_id FROM pages WHERE id = ?1
                   UNION ALL
                   SELECT p.id, p.parent_id FROM pages p JOIN up ON p.id = up.parent_id
                 )
                 SELECT EXISTS(SELECT 1 FROM up WHERE id = ?2)",
                params![parent, id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if cycle {
            return Err("A page can't be moved inside itself".into());
        }
    }

    // New sibling order: live siblings with this page spliced in, then the
    // trashed ones (they keep their relative order behind the live pages).
    let siblings = |archived: i64| -> rusqlite::Result<Vec<String>> {
        let mut stmt = tx.prepare(
            "SELECT id FROM pages WHERE parent_id IS ?1 AND id != ?2 AND is_archived = ?3
             ORDER BY sort_order, created_at",
        )?;
        let rows = stmt.query_map(params![new_parent_id, id, archived], |r| r.get(0))?;
        rows.collect()
    };
    let mut order = siblings(0).map_err(err)?;
    order.insert(position.unwrap_or(order.len()).min(order.len()), id.clone());
    order.extend(siblings(1).map_err(err)?);

    for (i, sibling) in order.iter().enumerate() {
        tx.execute("UPDATE pages SET sort_order = ?2 WHERE id = ?1", params![sibling, i as i64])
            .map_err(err)?;
    }
    let updated_at: String = tx
        .query_row(
            &format!(
                "UPDATE pages SET parent_id = ?2, updated_at = {NOW} WHERE id = ?1 RETURNING updated_at"
            ),
            params![id, new_parent_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(updated_at)
}

/* ------------------------------------------------------------- backlinks */

/// Live pages that reference `id`: document links pointing here, plus canvas
/// connections in either direction (they count as bi-directional).
#[tauri::command]
pub fn get_backlinks(db: State<Db>, id: String) -> CmdResult<Vec<Backlink>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT other, snippet, via, label FROM (
               SELECT l.source_id AS other, l.snippet, 'document' AS via, '' AS label
               FROM page_links l WHERE l.target_id = ?1
               UNION ALL
               SELECT CASE WHEN e.source_id = ?1 THEN e.target_id ELSE e.source_id END,
                      '', 'canvas', e.label
               FROM canvas_edges e
               WHERE e.manual = 1 AND (e.source_id = ?1 OR e.target_id = ?1)
             ) b
             JOIN pages p ON p.id = b.other
             WHERE p.is_archived = 0 AND b.other != ?1
             ORDER BY p.updated_at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([&id], |r| {
            Ok(Backlink {
                source_id: r.get(0)?,
                snippet: r.get(1)?,
                via: r.get(2)?,
                label: r.get(3)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/* ---------------------------------------------------------- canvas edges */

/// Every styled or drawn connection.
#[tauri::command]
pub fn get_canvas_edges(db: State<Db>) -> CmdResult<Vec<CanvasEdge>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT source_id, target_id FROM canvas_edges")
        .map_err(err)?;
    let keys = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    keys.iter().map(|(s, t)| edge_by_key(&conn, s, t).map_err(err)).collect()
}

/// Drop-to-connect: records a drawn connection from `source_id` to `target_id`.
#[tauri::command]
pub fn connect_pages(db: State<Db>, source_id: String, target_id: String) -> CmdResult<CanvasEdge> {
    if source_id == target_id {
        return Err("A page can't connect to itself".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO canvas_edges (source_id, target_id, manual, workspace_id)
         VALUES (?1, ?2, 1, (SELECT workspace_id FROM pages WHERE id = ?1))
         ON CONFLICT(source_id, target_id) DO UPDATE SET manual = 1",
        params![source_id, target_id],
    )
    .map_err(err)?;
    edge_by_key(&conn, &source_id, &target_id).map_err(err)
}

/// Label / color / line style for a connection (drawn or from a document).
#[tauri::command]
pub fn update_canvas_edge(
    db: State<Db>,
    source_id: String,
    target_id: String,
    label: String,
    color: String,
    style: String,
) -> CmdResult<CanvasEdge> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO canvas_edges (source_id, target_id, label, color, style, workspace_id)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT workspace_id FROM pages WHERE id = ?1))
         ON CONFLICT(source_id, target_id) DO UPDATE SET label = ?3, color = ?4, style = ?5",
        params![source_id, target_id, label, color, style],
    )
    .map_err(err)?;
    edge_by_key(&conn, &source_id, &target_id).map_err(err)
}

/// Removes a drawn connection (and its styling). Document links can only be
/// removed by editing the document.
#[tauri::command]
pub fn delete_canvas_edge(db: State<Db>, source_id: String, target_id: String) -> CmdResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "DELETE FROM canvas_edges WHERE source_id = ?1 AND target_id = ?2",
        params![source_id, target_id],
    )
    .map_err(err)?;
    Ok(())
}

/// Every link in the workspace, for the spatial canvas.
#[tauri::command]
pub fn get_links(db: State<Db>) -> CmdResult<Vec<LinkEdge>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT source_id, target_id FROM page_links").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(LinkEdge { source_id: r.get(0)?, target_id: r.get(1)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/* ---------------------------------------------------------------- canvas */

#[tauri::command]
pub fn get_canvas_positions(db: State<Db>) -> CmdResult<Vec<CanvasPosition>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT page_id, x, y FROM canvas_positions").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(CanvasPosition { page_id: r.get(0)?, x: r.get(1)?, y: r.get(2)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Upserts card positions (after auto-layout or a drag).
#[tauri::command]
pub fn save_canvas_positions(db: State<Db>, positions: Vec<CanvasPosition>) -> CmdResult<()> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    {
        let mut stmt = tx
            .prepare("INSERT OR REPLACE INTO canvas_positions (page_id, x, y) VALUES (?1, ?2, ?3)")
            .map_err(err)?;
        for p in &positions {
            stmt.execute(params![p.page_id, p.x, p.y]).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

/* ---------------------------------------------------------------- export */

/// Writes an export to the path the user picked in the native Save dialog.
#[tauri::command]
pub fn write_export_file(path: String, data: Vec<u8>) -> CmdResult<()> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

/* ------------------------------------------------------------------ tabs */

#[tauri::command]
pub fn get_tabs(db: State<Db>) -> CmdResult<Vec<TabRecord>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, history, history_index, is_active FROM workspace_tabs ORDER BY tab_order")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let history: String = r.get(1)?;
            Ok(TabRecord {
                id: r.get(0)?,
                history: serde_json::from_str(&history).unwrap_or_default(),
                history_index: r.get::<_, i64>(2)? as usize,
                is_active: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Replaces the stored tab strip with `tabs`, in order.
#[tauri::command]
pub fn save_tabs(db: State<Db>, tabs: Vec<TabRecord>) -> CmdResult<()> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM workspace_tabs", []).map_err(err)?;
    for (order, tab) in tabs.iter().enumerate() {
        let page_id = tab.history.get(tab.history_index).cloned().unwrap_or_default();
        tx.execute(
            "INSERT INTO workspace_tabs (id, page_id, tab_order, history, history_index, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                tab.id,
                page_id,
                order as i64,
                serde_json::to_string(&tab.history).unwrap_or_else(|_| "[]".into()),
                tab.history_index as i64,
                tab.is_active as i64,
            ],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

/* -------------------------------------------------------- page properties */

/// Date / Status / Tags shown under the title and on calendar cards.
#[tauri::command]
pub fn set_page_properties(
    db: State<Db>,
    id: String,
    due_date: Option<String>,
    status: Option<String>,
    tags: Vec<String>,
) -> CmdResult<String> {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        &format!(
            "UPDATE pages SET due_date = ?2, status = ?3, tags = ?4, updated_at = {NOW}
             WHERE id = ?1 RETURNING updated_at"
        ),
        params![id, due_date, status, serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into())],
        |r| r.get(0),
    )
    .map_err(err)
}

/// Live pages of a workspace scheduled between `start` and `end` (inclusive,
/// `YYYY-MM-DD`), for the calendar's visible range.
#[tauri::command]
pub fn get_pages_in_range(
    db: State<Db>,
    workspace_id: String,
    start: String,
    end: String,
) -> CmdResult<Vec<PageSummary>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM pages
             WHERE workspace_id = ?1 AND is_archived = 0 AND due_date BETWEEN ?2 AND ?3
             ORDER BY due_date, sort_order"
        ))
        .map_err(err)?;
    let rows = stmt.query_map(params![workspace_id, start, end], summary).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/* ------------------------------------------------------------- workspaces */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    id: String,
    name: String,
    icon: String,
    color: String,
    position_x: f64,
    position_y: f64,
}

fn workspace_row(r: &Row) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: r.get(0)?,
        name: r.get(1)?,
        icon: r.get(2)?,
        color: r.get(3)?,
        position_x: r.get(4)?,
        position_y: r.get(5)?,
    })
}

const WORKSPACE_COLS: &str = "id, name, icon, color, position_x, position_y";

#[tauri::command]
pub fn get_workspaces(db: State<Db>) -> CmdResult<Vec<Workspace>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!("SELECT {WORKSPACE_COLS} FROM workspaces ORDER BY sort_order, rowid"))
        .map_err(err)?;
    let rows = stmt.query_map([], workspace_row).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn create_workspace(db: State<Db>, name: String, icon: String, color: String) -> CmdResult<Workspace> {
    let conn = db.0.lock().unwrap();
    let id = new_id();
    conn.execute(
        "INSERT INTO workspaces (id, name, icon, color, sort_order)
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM workspaces))",
        params![id, name, icon, color],
    )
    .map_err(err)?;
    conn.query_row(
        &format!("SELECT {WORKSPACE_COLS} FROM workspaces WHERE id = ?1"),
        [&id],
        workspace_row,
    )
    .map_err(err)
}

#[tauri::command]
pub fn update_workspace(db: State<Db>, id: String, name: String, icon: String, color: String) -> CmdResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE workspaces SET name = ?2, icon = ?3, color = ?4 WHERE id = ?1",
        params![id, name, icon, color],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn reorder_workspaces(db: State<Db>, ids: Vec<String>) -> CmdResult<()> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE workspaces SET sort_order = ?2 WHERE id = ?1", params![id, i as i64])
            .map_err(err)?;
    }
    tx.commit().map_err(err)
}

/// Deletes a workspace: its live top-level pages go to Trash, and everything
/// it held is handed to `fallback_id` so restoring from Trash has a home.
#[tauri::command]
pub fn delete_workspace(db: State<Db>, id: String, fallback_id: String) -> CmdResult<()> {
    if id == fallback_id {
        return Err("Pick another workspace to keep".into());
    }
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        &format!(
            "UPDATE pages SET is_archived = 1, archived_at = {NOW}
             WHERE workspace_id = ?1 AND is_archived = 0
               AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM pages WHERE workspace_id = ?1))"
        ),
        [&id],
    )
    .map_err(err)?;
    tx.execute("UPDATE pages SET workspace_id = ?2 WHERE workspace_id = ?1", params![id, fallback_id])
        .map_err(err)?;
    tx.execute("UPDATE canvas_edges SET workspace_id = ?2 WHERE workspace_id = ?1", params![id, fallback_id])
        .map_err(err)?;
    tx.execute("DELETE FROM workspaces WHERE id = ?1", [&id]).map_err(err)?;
    tx.commit().map_err(err)
}

/// Moves a page and all of its sub-pages into another workspace, at the end
/// of that workspace's top level.
#[tauri::command]
pub fn move_page_to_workspace(db: State<Db>, id: String, workspace_id: String) -> CmdResult<String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "WITH RECURSIVE sub(id) AS (
           SELECT ?1
           UNION ALL
           SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id
         )
         UPDATE pages SET workspace_id = ?2 WHERE id IN (SELECT id FROM sub)",
        params![id, workspace_id],
    )
    .map_err(err)?;
    let updated_at: String = tx
        .query_row(
            &format!(
                "UPDATE pages SET parent_id = NULL, updated_at = {NOW},
                   sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM pages
                                 WHERE parent_id IS NULL AND workspace_id = ?2)
                 WHERE id = ?1 RETURNING updated_at"
            ),
            params![id, workspace_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(updated_at)
}

/* --------------------------------------------------------------- settings */

pub fn read_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

pub fn write_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(db: State<Db>) -> CmdResult<std::collections::HashMap<String, String>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> CmdResult<()> {
    let conn = db.0.lock().unwrap();
    write_setting(&conn, &key, &value).map_err(err)
}

/* ---------------------------------------------------------------- storage */

/// Copies the live database into `dir` (VACUUM INTO gives a consistent copy
/// even with WAL). The caller records the new folder and restarts the app.
pub fn copy_database_to(conn: &Connection, dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = dir.join("oceanic.db");
    if target.exists() {
        return Err(format!("{} already contains an oceanic.db", dir.display()));
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy()]).map_err(err)?;
    Ok(())
}

/* --------------------------------------------------------------- mindmaps */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mindmap {
    id: String,
    title: String,
    subject_tag: String,
    created_at: String,
    updated_at: String,
    node_count: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapNode {
    id: String,
    label: String,
    position_x: f64,
    position_y: f64,
    parent_node_id: Option<String>,
    linked_page_id: Option<String>,
    style_json: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapWithNodes {
    #[serde(flatten)]
    mindmap: Mindmap,
    nodes: Vec<MindmapNode>,
}

const MINDMAP_COLS: &str = "m.id, m.title, m.subject_tag, m.created_at, m.updated_at,
     (SELECT COUNT(*) FROM mindmap_nodes n WHERE n.mindmap_id = m.id)";

fn mindmap_row(r: &Row) -> rusqlite::Result<Mindmap> {
    Ok(Mindmap {
        id: r.get(0)?,
        title: r.get(1)?,
        subject_tag: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
        node_count: r.get(5)?,
    })
}

fn mindmap_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<MindmapWithNodes>> {
    let Some(mindmap) = conn
        .query_row(&format!("SELECT {MINDMAP_COLS} FROM mindmaps m WHERE m.id = ?1"), [id], mindmap_row)
        .optional()?
    else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT id, label, position_x, position_y, parent_node_id, linked_page_id, style_json
         FROM mindmap_nodes WHERE mindmap_id = ?1",
    )?;
    let nodes = stmt
        .query_map([id], |r| {
            Ok(MindmapNode {
                id: r.get(0)?,
                label: r.get(1)?,
                position_x: r.get(2)?,
                position_y: r.get(3)?,
                parent_node_id: r.get(4)?,
                linked_page_id: r.get(5)?,
                style_json: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(Some(MindmapWithNodes { mindmap, nodes }))
}

#[tauri::command]
pub fn get_all_mindmaps(db: State<Db>) -> CmdResult<Vec<Mindmap>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!("SELECT {MINDMAP_COLS} FROM mindmaps m ORDER BY m.updated_at DESC"))
        .map_err(err)?;
    let rows = stmt.query_map([], mindmap_row).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn get_mindmap_by_id(db: State<Db>, id: String) -> CmdResult<Option<MindmapWithNodes>> {
    let conn = db.0.lock().unwrap();
    mindmap_by_id(&conn, &id).map_err(err)
}

/// New map with its central topic (named after the map).
#[tauri::command]
pub fn create_mindmap(db: State<Db>, title: String, subject_tag: String) -> CmdResult<MindmapWithNodes> {
    let conn = db.0.lock().unwrap();
    let id = new_id();
    conn.execute(
        "INSERT INTO mindmaps (id, title, subject_tag) VALUES (?1, ?2, ?3)",
        params![id, title, subject_tag],
    )
    .map_err(err)?;
    conn.execute(
        "INSERT INTO mindmap_nodes (id, mindmap_id, label, style_json) VALUES ('root', ?1, ?2, '{\"shape\":\"pill\"}')",
        params![id, title],
    )
    .map_err(err)?;
    mindmap_by_id(&conn, &id).map_err(err)?.ok_or_else(|| "mindmap vanished".into())
}

/// Replaces the map's title and every node in one transaction (debounced autosave).
#[tauri::command]
pub fn save_mindmap(
    db: State<Db>,
    id: String,
    title: String,
    subject_tag: String,
    nodes: Vec<MindmapNode>,
) -> CmdResult<String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    let updated_at: String = tx
        .query_row(
            &format!(
                "UPDATE mindmaps SET title = ?2, subject_tag = ?3, updated_at = {NOW} WHERE id = ?1 RETURNING updated_at"
            ),
            params![id, title, subject_tag],
            |r| r.get(0),
        )
        .map_err(err)?;
    tx.execute("DELETE FROM mindmap_nodes WHERE mindmap_id = ?1", [&id]).map_err(err)?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO mindmap_nodes (id, mindmap_id, label, position_x, position_y, parent_node_id, linked_page_id, style_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(err)?;
        for n in &nodes {
            stmt.execute(params![n.id, id, n.label, n.position_x, n.position_y, n.parent_node_id, n.linked_page_id, n.style_json])
                .map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(updated_at)
}

#[tauri::command]
pub fn delete_mindmap(db: State<Db>, id: String) -> CmdResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM mindmap_nodes WHERE mindmap_id = ?1", [&id]).map_err(err)?;
    conn.execute("DELETE FROM mindmaps WHERE id = ?1", [&id]).map_err(err)?;
    Ok(())
}
