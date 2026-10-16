#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod library;
use library::{err, Folder, Library, Metadata, MoveNote, Note, NoteList, ScanPlan, Status};
use notify::Watcher;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone)]
struct Shared {
    library: Arc<Mutex<Library>>,
    watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
}
fn with_library<T>(
    shared: &Shared,
    f: impl FnOnce(&mut Library) -> Result<T, String>,
) -> Result<T, String> {
    let mut library = shared.library.lock().map_err(err)?;
    f(&mut library)
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}
fn allow_cached_thumbnails(app: &tauri::AppHandle, shared: &Shared) -> Result<(), String> {
    let paths = with_library(shared, |l| {
        Ok(l.entries
            .values()
            .filter_map(|entry| entry.note.thumbnail_url.clone())
            .collect::<Vec<_>>())
    })?;
    for path in paths {
        // Resolve each existing image: Windows can redirect individual AppData files
        // to a packaged host's LocalCache even when the parent directory is unchanged.
        app.asset_protocol_scope().allow_file(path).map_err(err)?;
    }
    Ok(())
}
fn watch(app: &tauri::AppHandle, shared: &Shared) -> Result<(), String> {
    // Release the previous root even if starting the replacement watcher fails.
    shared.watcher.lock().map_err(err)?.take();
    let root = with_library(shared, |l| Ok(l.root.clone()))?;
    let Some(root) = root.filter(|p| p.is_dir()) else {
        return Ok(());
    };
    let events = app.clone();
    let status = shared.library.clone();
    let mut watcher = notify::recommended_watcher(
        move |event: Result<notify::Event, notify::Error>| match event {
            Ok(event)
                if !matches!(event.kind, notify::EventKind::Access(_))
                    && (event.kind.is_remove()
                        || event.paths.iter().any(|p| {
                            p.is_dir()
                                || p.extension().is_some_and(|e| e.eq_ignore_ascii_case("kwz"))
                        })) =>
            {
                let _ = events.emit("library-changed", ());
            }
            Err(_) => {
                if let Ok(mut l) = status.lock() {
                    l.status.message =
                        Some("フォルダ監視に失敗しました。再起動してお試しください。".into());
                }
                let _ = events.emit("library-watch-error", ());
            }
            _ => {}
        },
    )
    .map_err(err)?;
    watcher
        .watch(&root, notify::RecursiveMode::Recursive)
        .map_err(err)?;
    *shared.watcher.lock().map_err(err)? = Some(watcher);
    Ok(())
}

#[tauri::command]
async fn desktop_initialize(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    parser_version: String,
) -> Result<Status, String> {
    let shared = state.inner().clone();
    blocking(move || {
        with_library(&shared, |l| {
            l.restore(parser_version);
            Ok(())
        })?;
        allow_cached_thumbnails(&app, &shared)?;
        if watch(&app, &shared).is_err() {
            with_library(&shared, |l| {
                l.status.message =
                    Some("フォルダ監視を開始できませんでした。再起動してお試しください。".into());
                Ok(())
            })?;
        }
        with_library(&shared, |l| Ok(l.status.clone()))
    })
    .await
}
#[tauri::command]
async fn library_status(state: tauri::State<'_, Shared>) -> Result<Status, String> {
    with_library(&state, |l| Ok(l.status.clone()))
}
#[tauri::command]
async fn library_folders(state: tauri::State<'_, Shared>) -> Result<Vec<Folder>, String> {
    with_library(&state, |l| Ok(l.folders()))
}
#[tauri::command]
async fn library_list(
    state: tauri::State<'_, Shared>,
    folder: String,
    page: usize,
    page_size: usize,
) -> Result<NoteList, String> {
    with_library(&state, |l| l.list(folder, page, page_size))
}
#[tauri::command]
async fn library_note(state: tauri::State<'_, Shared>, id: String) -> Result<Option<Note>, String> {
    with_library(&state, |l| Ok(l.entries.get(&id).map(|e| e.note.clone())))
}
#[tauri::command]
async fn library_move(state: tauri::State<'_, Shared>, command: MoveNote) -> Result<(), String> {
    let shared = state.inner().clone();
    blocking(move || with_library(&shared, |l| l.move_note(command))).await
}
#[tauri::command]
async fn library_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
) -> Result<Option<Status>, String> {
    let shared = state.inner().clone();
    blocking(move || {
        let root = with_library(&shared, |l| Ok(l.root.clone()))?;
        let mut dialog = app
            .dialog()
            .file()
            .set_title("KWZフォルダを選択してください");
        if let Some(root) = root.filter(|p| p.is_dir()) {
            dialog = dialog.set_directory(root);
        }
        let Some(selected) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let directory = selected
            .into_path()
            .map_err(|_| "フォルダを読み取れません。".to_string())?;
        with_library(&shared, |l| l.select(directory))?;
        allow_cached_thumbnails(&app, &shared)?;
        if watch(&app, &shared).is_err() {
            with_library(&shared, |l| {
                l.status.message = Some("フォルダ監視を開始できませんでした。".into());
                Ok(())
            })?;
        }
        let status = with_library(&shared, |l| Ok(l.status.clone()))?;
        Ok(Some(status))
    })
    .await
}
#[tauri::command]
async fn library_scan(state: tauri::State<'_, Shared>) -> Result<ScanPlan, String> {
    let shared = state.inner().clone();
    blocking(move || {
        let (generation, root, previous) = with_library(&shared, |l| Ok(l.begin_scan()))?;
        let entries = root
            .map(|p| library::scan(&p, previous))
            .unwrap_or_else(|| Err("フォルダが選択されていません。".into()));
        with_library(&shared, |l| l.publish(generation, entries))
    })
    .await
}
#[tauri::command]
async fn library_scan_failed(
    state: tauri::State<'_, Shared>,
    generation: u64,
) -> Result<(), String> {
    with_library(&state, |l| {
        l.fail_scan(generation);
        Ok(())
    })
}
#[tauri::command]
async fn library_read(
    state: tauri::State<'_, Shared>,
    id: String,
    generation: Option<u64>,
) -> Result<tauri::ipc::Response, String> {
    let shared = state.inner().clone();
    blocking(move || {
        let (root, entry) = with_library(&shared, |l| {
            if generation.is_some_and(|g| g != l.generation) {
                return Err("フォルダが変更されました。".into());
            }
            Ok((
                l.root.clone().ok_or("フォルダが未選択です。")?,
                l.entries.get(&id).cloned().ok_or("作品がありません。")?,
            ))
        })?;
        Ok(tauri::ipc::Response::new(library::read_note(
            &root, &entry,
        )?))
    })
    .await
}
#[tauri::command]
async fn library_complete(
    state: tauri::State<'_, Shared>,
    generation: u64,
    id: String,
    metadata: Option<Metadata>,
    error_code: Option<String>,
) -> Result<(), String> {
    let shared = state.inner().clone();
    blocking(move || {
        with_library(&shared, |l| {
            l.complete(generation, &id, metadata, error_code)
        })
    })
    .await
}
#[tauri::command]
async fn library_thumbnail(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-note-id")
        .and_then(|h| h.to_str().ok())
        .ok_or("Missing note id")?
        .to_string();
    let generation: u64 = request
        .headers()
        .get("x-library-generation")
        .and_then(|h| h.to_str().ok())
        .ok_or("Missing generation")?
        .parse()
        .map_err(err)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("Binary data required".into()),
    };
    let shared = state.inner().clone();
    blocking(move || {
        let path = with_library(&shared, |l| {
            l.thumbnail(generation, &id, &bytes)?;
            l.entries
                .get(&id)
                .and_then(|entry| entry.note.thumbnail_url.clone())
                .ok_or("サムネイルがありません。".into())
        })?;
        app.asset_protocol_scope().allow_file(path).map_err(err)
    })
    .await
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let library = Library::new(app.path().app_data_dir()?, app.path().app_cache_dir()?)
                .map_err(std::io::Error::other)?;
            app.manage(Shared {
                library: Arc::new(Mutex::new(library)),
                watcher: Arc::new(Mutex::new(None)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_initialize,
            library_status,
            library_folders,
            library_list,
            library_note,
            library_move,
            library_select,
            library_scan,
            library_scan_failed,
            library_read,
            library_complete,
            library_thumbnail
        ])
        .run(tauri::generate_context!())
        .expect("デスクトップアプリを起動できませんでした。");
}
