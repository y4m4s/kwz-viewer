use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_BYTES: u64 = 32 * 1024 * 1024;
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn iso(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn stamp(meta: &fs::Metadata) -> Result<u64, String> {
    meta.modified()
        .map_err(err)?
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_nanos()
        .try_into()
        .map_err(err)
}
pub fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
pub fn display(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", unc)
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
}
fn linked(path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return true;
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}
fn valid_thumbnail(path: &str) -> bool {
    let path = Path::new(path);
    if linked(path) {
        return false;
    }
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    if !file
        .metadata()
        .is_ok_and(|m| m.is_file() && m.len() <= 1024 * 1024)
    {
        return false;
    }
    let mut header = [0; 8];
    if file.read_exact(&mut header).is_err() {
        return false;
    }
    header == [137, 80, 78, 71, 13, 10, 26, 10] || header.starts_with(&[255, 216, 255])
}
pub fn root(path: &Path, data: &Path, cache: &Path) -> Result<PathBuf, String> {
    if linked(path) || !path.is_dir() {
        return Err("フォルダが存在しないか、リンクになっています。".into());
    }
    let root = fs::canonicalize(path).map_err(err)?;
    for internal in [data, cache] {
        let internal = fs::canonicalize(internal).map_err(err)?;
        if internal.starts_with(&root) || root.starts_with(&internal) {
            return Err(
                "アプリの内部データを含むフォルダは選択できません。KWZの保存先を選択してください。"
                    .into(),
            );
        }
    }
    Ok(root)
}
pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid parent")?).map_err(err)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(err)?;
        serde_json::to_writer(&mut file, value).map_err(err)?;
        file.flush().map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        fs::rename(&temp, path).map_err(err)
    })();
    let _ = fs::remove_file(&temp);
    result
}
fn load_json<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T, String> {
    let file = File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > 32 * 1024 * 1024 {
        return Err("保存データが大きすぎます。".into());
    }
    serde_json::from_reader(file).map_err(err)
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub author: Option<String>,
    pub created_at: Option<String>,
    pub edited_at: Option<String>,
    pub frame_count: u32,
    pub duration_seconds: f64,
    pub r#loop: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub file_name: String,
    pub relative_path: String,
    pub status: String,
    pub author: Option<String>,
    pub created_at: Option<String>,
    pub edited_at: Option<String>,
    pub file_modified_at: String,
    pub frame_count: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub r#loop: Option<bool>,
    pub byte_size: u64,
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Entry {
    pub note: Note,
    pub stamp: u64,
}
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub scan_status: String,
    pub total: usize,
    pub indexed: usize,
    pub failed: usize,
    pub last_scanned_at: Option<String>,
    pub directory_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
impl Status {
    fn new(directory: Option<String>) -> Self {
        Self {
            scan_status: "idle".into(),
            total: 0,
            indexed: 0,
            failed: 0,
            last_scanned_at: None,
            directory_configured: directory.is_some(),
            directory,
            message: None,
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Settings {
    directory: String,
}
#[derive(Serialize, Deserialize)]
struct Cache {
    version: u32,
    parser: String,
    entries: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
struct Orders {
    version: u32,
    folders: BTreeMap<String, Vec<String>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    path: String,
    count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteList {
    items: Vec<Note>,
    page: usize,
    page_size: usize,
    total: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveNote {
    folder: String,
    source_id: String,
    target_id: String,
    placement: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPlan {
    pub generation: u64,
    pub pending: Vec<String>,
}

pub struct Library {
    pub data: PathBuf,
    pub cache: PathBuf,
    pub root: Option<PathBuf>,
    pub generation: u64,
    pub status: Status,
    pub entries: BTreeMap<String, Entry>,
    pub pending: HashSet<String>,
    orders: BTreeMap<String, Vec<String>>,
    pub parser: String,
}
impl Library {
    pub fn new(data: PathBuf, cache: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data).map_err(err)?;
        fs::create_dir_all(&cache).map_err(err)?;
        let saved = load_json::<Settings>(&data.join("settings.json"))
            .ok()
            .filter(|s| Path::new(&s.directory).is_absolute());
        let directory = saved.map(|s| s.directory);
        Ok(Self {
            data,
            cache,
            root: directory.as_ref().map(PathBuf::from),
            generation: 0,
            status: Status::new(directory),
            entries: BTreeMap::new(),
            pending: HashSet::new(),
            orders: BTreeMap::new(),
            parser: String::new(),
        })
    }
    fn key(&self) -> String {
        hash(&self.root.as_ref().map(|r| display(r)).unwrap_or_default())
    }
    pub fn cache_dir(&self) -> PathBuf {
        self.cache.join("library").join(self.key())
    }
    fn orders_file(&self) -> PathBuf {
        self.data
            .join("orders")
            .join(format!("{}.json", self.key()))
    }
    pub fn restore(&mut self, parser: String) {
        self.generation += 1;
        self.parser = parser;
        self.entries.clear();
        self.pending.clear();
        let Some(saved) = self.root.clone() else {
            return;
        };
        match root(&saved, &self.data, &self.cache) {
            Ok(directory) => {
                self.root = Some(directory);
            }
            Err(message) => {
                self.status.scan_status = "error".into();
                self.status.message = Some(message);
                return;
            }
        }
        self.orders.clear();
        if let Ok(saved) = load_json::<Orders>(&self.orders_file()) {
            if saved.version == 1
                && saved.folders.iter().all(|(folder, ids)| {
                    folder.len() <= 4096
                        && ids
                            .iter()
                            .all(|id| id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()))
                        && ids.iter().collect::<HashSet<_>>().len() == ids.len()
                })
            {
                self.orders = saved.folders;
            }
        }
        if let Ok(cache) = load_json::<Cache>(&self.cache_dir().join("index.json")) {
            if cache.version == 1 && cache.parser == self.parser {
                self.entries = cache
                    .entries
                    .into_iter()
                    .filter(|e| {
                        e.note.id == hash(&e.note.relative_path)
                            && safe_relative(&e.note.relative_path)
                            && e.note.byte_size <= MAX_BYTES
                            // A missing image must trigger reinspection, not become a permanent "no thumbnail".
                            // A cached path also cannot grant asset access outside this library's cache.
                            && e.note.thumbnail_url.as_ref().is_none_or(|p| {
                                Path::new(p).parent() == Some(self.cache_dir().as_path())
                                    && valid_thumbnail(p)
                            })
                            && (e.note.status != "ready"
                                || (e.note.frame_count.is_some_and(|n| n > 0)
                                    && e.note
                                        .duration_seconds
                                        .is_some_and(|n| n.is_finite() && n >= 0.0)
                                    && e.note.r#loop.is_some()))
                    })
                    .map(|e| (e.note.id.clone(), e))
                    .collect();
            }
        }
        self.status = Status::new(self.root.as_ref().map(|r| display(r)));
        self.status.scan_status = "ready".into();
        self.status.total = self.entries.len();
        self.status.indexed = self.entries.len();
        self.status.failed = self
            .entries
            .values()
            .filter(|e| e.note.status == "error")
            .count();
        self.status.last_scanned_at = Some(now());
    }
    pub fn select(&mut self, directory: PathBuf) -> Result<(), String> {
        let directory = root(&directory, &self.data, &self.cache)?;
        atomic_json(
            &self.data.join("settings.json"),
            &Settings {
                directory: display(&directory),
            },
        )?;
        self.generation += 1;
        self.root = Some(directory);
        self.entries.clear();
        self.pending.clear();
        let parser = self.parser.clone();
        self.restore(parser);
        Ok(())
    }
    pub fn begin_scan(&mut self) -> (u64, Option<PathBuf>, BTreeMap<String, Entry>) {
        self.generation += 1;
        self.status.scan_status = "scanning".into();
        self.status.message = None;
        (self.generation, self.root.clone(), self.entries.clone())
    }
    pub fn publish(
        &mut self,
        generation: u64,
        entries: Result<BTreeMap<String, Entry>, String>,
    ) -> Result<ScanPlan, String> {
        if generation != self.generation {
            return Err("フォルダが変更されました。".into());
        }
        match entries {
            Ok(entries) => {
                self.pending = entries
                    .values()
                    .filter(|e| e.note.status != "ready")
                    .map(|e| e.note.id.clone())
                    .collect();
                self.entries = entries;
                self.status.total = self.entries.len();
                self.status.failed = 0;
                self.status.indexed = self.status.total - self.pending.len();
                let pending = self.pending.iter().cloned().collect();
                self.finish_if_done();
                Ok(ScanPlan {
                    generation,
                    pending,
                })
            }
            Err(message) => {
                self.entries.clear();
                self.pending.clear();
                self.status.total = 0;
                self.status.indexed = 0;
                self.status.failed = 0;
                self.status.scan_status = "error".into();
                self.status.message = Some(message);
                Err("フォルダを読み取れません。".into())
            }
        }
    }
    pub fn complete(
        &mut self,
        generation: u64,
        id: &str,
        metadata: Option<Metadata>,
        error_code: Option<String>,
    ) -> Result<(), String> {
        if generation != self.generation || !self.pending.contains(id) {
            return Err("解析対象が更新されました。".into());
        }
        if let Some(ref m) = metadata {
            if m.frame_count == 0 || !m.duration_seconds.is_finite() || m.duration_seconds < 0.0 {
                return Err("作品情報が不正です。".into());
            }
        }
        let entry = self.entries.get_mut(id).ok_or("作品がありません。")?;
        if let Some(m) = metadata {
            entry.note.status = "ready".into();
            entry.note.author = m.author;
            entry.note.created_at = m.created_at;
            entry.note.edited_at = m.edited_at;
            entry.note.frame_count = Some(m.frame_count);
            entry.note.duration_seconds = Some(m.duration_seconds);
            entry.note.r#loop = Some(m.r#loop);
            entry.note.error_code = None;
        } else {
            entry.note.status = "error".into();
            entry.note.thumbnail_url = None;
            entry.note.error_code = Some(
                match error_code.as_deref() {
                    Some("IO_ERROR") => "IO_ERROR",
                    Some("UNSUPPORTED_VARIANT") => "UNSUPPORTED_VARIANT",
                    _ => "INVALID_KWZ",
                }
                .into(),
            );
            self.status.failed += 1;
        }
        self.pending.remove(id);
        self.status.indexed += 1;
        self.finish_if_done();
        Ok(())
    }
    pub fn fail_scan(&mut self, generation: u64) {
        if generation != self.generation || self.status.scan_status != "scanning" {
            return;
        }
        self.pending.clear();
        self.status.scan_status = "error".into();
        self.status.message =
            Some("作品の読み込みに失敗しました。フォルダを選び直してお試しください。".into());
    }
    fn finish_if_done(&mut self) {
        if !self.pending.is_empty() {
            return;
        }
        self.status.scan_status = "ready".into();
        self.status.last_scanned_at = Some(now());
        let cache = Cache {
            version: 1,
            parser: self.parser.clone(),
            entries: self.entries.values().cloned().collect(),
        };
        if atomic_json(&self.cache_dir().join("index.json"), &cache).is_err() {
            self.status.message =
                Some("キャッシュを保存できませんでした。閲覧は継続できます。".into());
        } else if self.prune_thumbnails().is_err() {
            self.status.message =
                Some("古いキャッシュを削除できませんでした。閲覧は継続できます。".into());
        }
    }
    fn prune_thumbnails(&self) -> Result<(), String> {
        let folder = self.cache_dir();
        let expected = fs::canonicalize(&self.cache)
            .map_err(err)?
            .join("library")
            .join(self.key());
        if linked(&folder) || fs::canonicalize(&folder).map_err(err)? != expected {
            return Err("キャッシュの保存先が変更されました。".into());
        }
        let retained: HashSet<_> = self
            .entries
            .values()
            .filter_map(|entry| entry.note.thumbnail_url.as_deref())
            .filter_map(|path| Path::new(path).file_name())
            .collect();
        for entry in fs::read_dir(&folder).map_err(err)? {
            let entry = entry.map_err(err)?;
            let path = entry.path();
            let name = entry.file_name();
            let text = name.to_string_lossy();
            let parts: Vec<_> = text.split('.').collect();
            // Only delete our generated images, after the new index is safely saved.
            if parts.len() == 3
                && parts[0].len() == 64
                && parts[0].bytes().all(|b| b.is_ascii_hexdigit())
                && parts[1].parse::<u64>().is_ok()
                && ["png", "jpg"].contains(&parts[2])
                && !retained.contains(name.as_os_str())
                && !linked(&path)
                && entry.file_type().map_err(err)?.is_file()
            {
                fs::remove_file(path).map_err(err)?;
            }
        }
        Ok(())
    }
    pub fn ordered(&self, folder: &str) -> Vec<String> {
        let mut entries: Vec<_> = self
            .entries
            .values()
            .filter(|e| {
                folder.is_empty() || e.note.relative_path.starts_with(&format!("{folder}/"))
            })
            .collect();
        entries.sort_by(|a, b| {
            b.note
                .file_modified_at
                .cmp(&a.note.file_modified_at)
                .then(a.note.relative_path.cmp(&b.note.relative_path))
        });
        let known: HashSet<_> = entries.iter().map(|e| e.note.id.as_str()).collect();
        let mut ids: Vec<String> = self
            .orders
            .get(folder)
            .into_iter()
            .flatten()
            .filter(|id| known.contains(id.as_str()))
            .cloned()
            .collect();
        let saved: HashSet<_> = ids.iter().cloned().collect();
        ids.extend(
            entries
                .into_iter()
                .filter(|e| !saved.contains(&e.note.id))
                .map(|e| e.note.id.clone()),
        );
        ids
    }
    pub fn list(&self, folder: String, page: usize, page_size: usize) -> Result<NoteList, String> {
        if page == 0 || page > 1_000_000 || page_size == 0 || page_size > 100 {
            return Err("ページ指定が不正です。".into());
        }
        let ids = self.ordered(&folder);
        let total = ids.len();
        let items = ids
            .into_iter()
            .skip((page - 1) * page_size)
            .take(page_size)
            .filter_map(|id| self.entries.get(&id).map(|e| e.note.clone()))
            .collect();
        Ok(NoteList {
            items,
            page,
            page_size,
            total,
        })
    }
    pub fn folders(&self) -> Vec<Folder> {
        let mut counts = BTreeMap::new();
        for e in self.entries.values() {
            let segments: Vec<_> = e.note.relative_path.split('/').collect();
            for i in 1..segments.len() {
                *counts.entry(segments[..i].join("/")).or_insert(0) += 1;
            }
        }
        counts
            .into_iter()
            .map(|(path, count)| Folder { path, count })
            .collect()
    }
    pub fn move_note(&mut self, command: MoveNote) -> Result<(), String> {
        if self.status.scan_status != "ready" {
            return Err("読み込み完了後に並べ替えてください。".into());
        }
        if !["before", "after"].contains(&command.placement.as_str()) {
            return Err("移動位置が不正です。".into());
        }
        let mut ids = self.ordered(&command.folder);
        if !ids.contains(&command.source_id) || !ids.contains(&command.target_id) {
            return Err("同じフォルダ内の作品を指定してください。".into());
        }
        if command.source_id == command.target_id {
            return Ok(());
        }
        ids.retain(|id| id != &command.source_id);
        let position = ids
            .iter()
            .position(|id| id == &command.target_id)
            .ok_or("移動先がありません。")?
            + usize::from(command.placement == "after");
        ids.insert(position, command.source_id);
        let mut next = self.orders.clone();
        next.insert(command.folder, ids);
        atomic_json(
            &self.orders_file(),
            &Orders {
                version: 1,
                folders: next.clone(),
            },
        )?;
        self.orders = next;
        Ok(())
    }
    pub fn thumbnail(&mut self, generation: u64, id: &str, bytes: &[u8]) -> Result<(), String> {
        if generation != self.generation || !self.pending.contains(id) {
            return Err("解析対象が更新されました。".into());
        }
        let png = bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]);
        let jpeg = bytes.starts_with(&[255, 216, 255]);
        if bytes.len() > 1024 * 1024 || (!png && !jpeg) {
            return Err("サムネイルが不正です。".into());
        }
        let folder = self.cache_dir();
        fs::create_dir_all(&folder).map_err(err)?;
        let entry = self.entries.get_mut(id).ok_or("作品がありません。")?;
        let target = folder.join(format!(
            "{}.{}.{}",
            id,
            entry.stamp,
            if png { "png" } else { "jpg" }
        ));
        let temp = target.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = fs::write(&temp, bytes).and_then(|_| fs::rename(&temp, &target));
        let _ = fs::remove_file(temp);
        result.map_err(err)?;
        entry.note.thumbnail_url = Some(display(&target));
        Ok(())
    }
}
fn safe_relative(value: &str) -> bool {
    !value.is_empty()
        && Path::new(value)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}
pub fn scan(
    directory: &Path,
    previous: BTreeMap<String, Entry>,
) -> Result<BTreeMap<String, Entry>, String> {
    if linked(directory)
        || !directory.is_dir()
        || fs::canonicalize(directory).map_err(err)? != directory
    {
        return Err(
            "対象フォルダを読み取れません。選び直すか、アクセス権を確認してください。".into(),
        );
    }
    let mut entries = BTreeMap::new();
    for file in walkdir::WalkDir::new(directory)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !linked(e.path()))
    {
        let file = file.map_err(err)?;
        if !file.file_type().is_file()
            || !file
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("kwz"))
        {
            continue;
        }
        let meta = file.metadata().map_err(err)?;
        let modified = stamp(&meta)?;
        let relative = file
            .path()
            .strip_prefix(directory)
            .map_err(err)?
            .to_string_lossy()
            .replace('\\', "/");
        let id = hash(&relative);
        if let Some(cached) = previous.get(&id).filter(|e| {
            e.stamp == modified
                && e.note.byte_size == meta.len()
                && e.note.status == "ready"
                && e.note
                    .thumbnail_url
                    .as_ref()
                    .is_none_or(|p| valid_thumbnail(p))
        }) {
            entries.insert(id, cached.clone());
            continue;
        }
        let note = Note {
            id: id.clone(),
            file_name: file.file_name().to_string_lossy().into(),
            relative_path: relative,
            status: "error".into(),
            author: None,
            created_at: None,
            edited_at: None,
            file_modified_at: iso(meta.modified().map_err(err)?),
            frame_count: None,
            duration_seconds: None,
            r#loop: None,
            byte_size: meta.len(),
            thumbnail_url: None,
            error_code: Some(
                if meta.len() > MAX_BYTES {
                    "IO_ERROR"
                } else {
                    "INVALID_KWZ"
                }
                .into(),
            ),
        };
        entries.insert(
            id,
            Entry {
                note,
                stamp: modified,
            },
        );
    }
    Ok(entries)
}

pub fn read_note(directory: &Path, entry: &Entry) -> Result<Vec<u8>, String> {
    if !safe_relative(&entry.note.relative_path)
        || linked(directory)
        || fs::canonicalize(directory).map_err(err)? != directory
    {
        return Err("フォルダが変更されました。".into());
    }
    let mut target = directory.to_path_buf();
    for part in Path::new(&entry.note.relative_path).components() {
        target.push(part);
        if linked(&target) {
            return Err("リンクは読み取れません。".into());
        }
    }
    let identity = same_file::Handle::from_path(&target).map_err(err)?;
    let file = File::open(&target).map_err(err)?;
    if identity != same_file::Handle::from_file(file.try_clone().map_err(err)?).map_err(err)? {
        return Err("作品が変更されました。".into());
    }
    let before = file.metadata().map_err(err)?;
    if !before.is_file() || before.len() > MAX_BYTES || stamp(&before)? != entry.stamp {
        return Err("作品が変更されたか、読み取り上限を超えています。".into());
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    (&file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    let after = file.metadata().map_err(err)?;
    if bytes.len() as u64 != before.len()
        || after.len() != before.len()
        || stamp(&after)? != entry.stamp
        || identity != same_file::Handle::from_path(&target).map_err(err)?
    {
        return Err("読み取り中に作品が変更されました。".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        base: PathBuf,
        notes: PathBuf,
        data: PathBuf,
        cache: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(".app-data/tests")
                .join(format!("native-{}", uuid::Uuid::new_v4()));
            let notes = base.join("notes");
            let data = base.join("state");
            let cache = base.join("cache");
            for folder in [&notes, &data, &cache] {
                fs::create_dir_all(folder).unwrap();
            }
            Self {
                base,
                notes,
                data,
                cache,
            }
        }
        fn library(&self) -> Library {
            let mut library = Library::new(self.data.clone(), self.cache.clone()).unwrap();
            library.restore("6.3.1".into());
            library.select(self.notes.clone()).unwrap();
            library
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }
    fn scan_all(library: &mut Library) -> ScanPlan {
        let (generation, root, previous) = library.begin_scan();
        library
            .publish(generation, scan(&root.unwrap(), previous))
            .unwrap()
    }
    fn metadata() -> Metadata {
        Metadata {
            author: Some("Author".into()),
            created_at: None,
            edited_at: None,
            frame_count: 12,
            duration_seconds: 1.0,
            r#loop: false,
        }
    }
    #[test]
    fn failed_scans_end_loading_and_old_failures_cannot_cancel_a_new_scan() {
        let f = Fixture::new();
        fs::write(f.notes.join("a.kwz"), b"fixture").unwrap();
        let mut l = f.library();
        let old = scan_all(&mut l);
        let current = scan_all(&mut l);
        l.fail_scan(old.generation);
        assert_eq!(l.status.scan_status, "scanning");
        assert_eq!(l.pending.len(), 1);
        l.fail_scan(current.generation);
        assert_eq!(l.status.scan_status, "error");
        assert!(l.pending.is_empty());
        let retry = scan_all(&mut l);
        finish(&mut l, &retry);
        assert_eq!(l.status.scan_status, "ready");
    }
    #[test]
    fn obsolete_thumbnails_are_pruned_without_deleting_current_images_or_other_files() {
        let f = Fixture::new();
        fs::write(f.notes.join("a.kwz"), b"fixture").unwrap();
        let mut l = f.library();
        let first = scan_all(&mut l);
        let png = [137, 80, 78, 71, 13, 10, 26, 10];
        l.thumbnail(first.generation, &first.pending[0], &png)
            .unwrap();
        finish(&mut l, &first);
        assert!(l.status.message.is_none(), "{:?}", l.status.message);
        let image = l
            .entries
            .values()
            .next()
            .unwrap()
            .note
            .thumbnail_url
            .clone()
            .unwrap();
        let unrelated = l.cache_dir().join("keep.txt");
        fs::write(&unrelated, b"keep").unwrap();
        let orphan = l.cache_dir().join(format!("{}.0.png", hash("deleted.kwz")));
        fs::write(&orphan, png).unwrap();
        assert!(scan_all(&mut l).pending.is_empty());
        assert!(!orphan.exists());
        assert!(Path::new(&image).is_file());
        fs::remove_file(f.notes.join("a.kwz")).unwrap();
        assert!(scan_all(&mut l).pending.is_empty());
        assert!(!Path::new(&image).exists());
        assert_eq!(fs::read(unrelated).unwrap(), b"keep");
        let mut restored = Library::new(f.data.clone(), f.cache.clone()).unwrap();
        restored.restore("6.3.1".into());
        assert!(restored.entries.is_empty());
    }
    #[test]
    fn missing_or_corrupt_thumbnails_are_regenerated_after_restart() {
        let f = Fixture::new();
        fs::write(f.notes.join("a.kwz"), b"fixture").unwrap();
        let mut l = f.library();
        let png = [137, 80, 78, 71, 13, 10, 26, 10];
        for corrupt in [false, true] {
            let plan = scan_all(&mut l);
            assert_eq!(plan.pending.len(), 1);
            l.thumbnail(plan.generation, &plan.pending[0], &png)
                .unwrap();
            finish(&mut l, &plan);
            let image = l
                .entries
                .values()
                .next()
                .unwrap()
                .note
                .thumbnail_url
                .clone()
                .unwrap();
            if corrupt {
                fs::write(&image, b"corrupt").unwrap();
            } else {
                fs::remove_file(&image).unwrap();
            }
            l = Library::new(f.data.clone(), f.cache.clone()).unwrap();
            l.restore("6.3.1".into());
            assert!(l.entries.is_empty());
        }
        assert_eq!(scan_all(&mut l).pending.len(), 1);
    }
    #[test]
    fn native_watcher_reports_a_new_kwz_file() {
        use notify::Watcher;
        let f = Fixture::new();
        let (send, receive) = std::sync::mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(move |event: Result<notify::Event, notify::Error>| {
                if let Ok(event) = event {
                    let _ = send.send(event);
                }
            })
            .unwrap();
        watcher
            .watch(&f.notes, notify::RecursiveMode::Recursive)
            .unwrap();
        fs::write(f.notes.join("added.kwz"), b"fixture").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let event = receive
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .unwrap();
            if event.paths.iter().any(|path| path.ends_with("added.kwz")) {
                break;
            }
        }
        let mut library = f.library();
        assert_eq!(scan_all(&mut library).pending.len(), 1);
        drop(watcher);
    }
    fn finish(library: &mut Library, plan: &ScanPlan) {
        for id in &plan.pending {
            library
                .complete(plan.generation, id, Some(metadata()), None)
                .unwrap();
        }
    }
    #[test]
    fn native_index_cache_and_settings_survive_restart() {
        let f = Fixture::new();
        fs::create_dir_all(f.notes.join("000")).unwrap();
        fs::write(f.notes.join("000/作品.KWZ"), b"fixture").unwrap();
        let mut l = f.library();
        let plan = scan_all(&mut l);
        assert_eq!(plan.pending.len(), 1);
        let entry = l.entries.values().next().unwrap();
        assert_eq!(
            read_note(l.root.as_ref().unwrap(), entry).unwrap(),
            b"fixture"
        );
        finish(&mut l, &plan);
        assert_eq!(l.status.scan_status, "ready");
        let mut restored = Library::new(f.data.clone(), f.cache.clone()).unwrap();
        restored.restore("6.3.1".into());
        assert_eq!(restored.status.total, 1);
        assert_eq!(restored.folders()[0].path, "000");
        assert!(scan_all(&mut restored).pending.is_empty());
        restored.restore("new-parser".into()); // Changing the parser must invalidate cache.
        assert_eq!(scan_all(&mut restored).pending.len(), 1);
        assert_eq!(fs::read(f.notes.join("000/作品.KWZ")).unwrap(), b"fixture");
    }
    #[test]
    fn changed_files_and_old_generation_are_rejected() {
        let f = Fixture::new();
        fs::write(f.notes.join("a.kwz"), b"one").unwrap();
        let mut l = f.library();
        let first = scan_all(&mut l);
        let entry = l.entries.values().next().unwrap().clone();
        fs::write(f.notes.join("a.kwz"), b"changed size").unwrap();
        assert!(read_note(l.root.as_ref().unwrap(), &entry).is_err());
        let second = scan_all(&mut l);
        assert!(l
            .complete(first.generation, &first.pending[0], Some(metadata()), None)
            .is_err());
        finish(&mut l, &second);
        assert_eq!(l.status.indexed, 1);
        assert!(l
            .complete(
                second.generation,
                &second.pending[0],
                Some(metadata()),
                None
            )
            .is_err());
    }
    #[test]
    fn order_is_persistent_and_cross_folder_moves_fail() {
        let f = Fixture::new();
        fs::create_dir_all(f.notes.join("other")).unwrap();
        for name in ["a.kwz", "b.kwz", "other/c.kwz"] {
            fs::write(f.notes.join(name), b"fixture").unwrap();
        }
        let mut l = f.library();
        let plan = scan_all(&mut l);
        finish(&mut l, &plan);
        let a = hash("a.kwz");
        let b = hash("b.kwz");
        l.move_note(MoveNote {
            folder: "".into(),
            source_id: a.clone(),
            target_id: b.clone(),
            placement: "after".into(),
        })
        .unwrap();
        let ids = l.ordered("");
        assert_eq!(
            ids.iter().position(|id| id == &a).unwrap(),
            ids.iter().position(|id| id == &b).unwrap() + 1
        );
        let mut restored = Library::new(f.data.clone(), f.cache.clone()).unwrap();
        restored.restore("6.3.1".into());
        assert_eq!(restored.ordered(""), ids);
        assert!(restored
            .move_note(MoveNote {
                folder: "other".into(),
                source_id: a,
                target_id: hash("other/c.kwz"),
                placement: "before".into()
            })
            .is_err());
    }
    #[test]
    fn corrupt_metadata_and_order_documents_are_recoverable() {
        let f = Fixture::new();
        fs::write(f.notes.join("a.kwz"), b"a").unwrap();
        fs::write(f.notes.join("b.kwz"), b"b").unwrap();
        let mut l = f.library();
        let plan = scan_all(&mut l);
        finish(&mut l, &plan);
        fs::write(l.cache_dir().join("index.json"), b"null").unwrap();
        fs::create_dir_all(l.orders_file().parent().unwrap()).unwrap();
        fs::write(l.orders_file(), b"null").unwrap();
        let mut restored = Library::new(f.data.clone(), f.cache.clone()).unwrap();
        restored.restore("6.3.1".into());
        let plan = scan_all(&mut restored);
        assert_eq!(plan.pending.len(), 2);
        finish(&mut restored, &plan);
        restored
            .move_note(MoveNote {
                folder: "".into(),
                source_id: hash("a.kwz"),
                target_id: hash("b.kwz"),
                placement: "after".into(),
            })
            .unwrap();
    }
    #[test]
    fn originals_cannot_overlap_internal_storage_and_failed_writes_leave_no_temp() {
        let f = Fixture::new();
        assert!(root(&f.base, &f.data, &f.cache).is_err());
        let target = f.data.join("blocked.json");
        fs::create_dir(&target).unwrap();
        assert!(atomic_json(&target, &vec![1]).is_err());
        assert_eq!(fs::read_dir(&f.data).unwrap().count(), 1);
    }
    #[test]
    fn oversized_files_fail_reading_without_allocating_or_modifying_originals() {
        let f = Fixture::new();
        let file = File::create(f.notes.join("huge.kwz")).unwrap();
        file.set_len(MAX_BYTES + 1).unwrap();
        drop(file);
        let mut l = f.library();
        let plan = scan_all(&mut l);
        let entry = l.entries.values().next().unwrap();
        assert!(read_note(l.root.as_ref().unwrap(), entry).is_err());
        l.complete(
            plan.generation,
            &plan.pending[0],
            None,
            Some("IO_ERROR".into()),
        )
        .unwrap();
        assert_eq!(l.status.failed, 1);
        assert_eq!(
            fs::metadata(f.notes.join("huge.kwz")).unwrap().len(),
            MAX_BYTES + 1
        );
    }
}
