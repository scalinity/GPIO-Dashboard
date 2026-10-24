//! Project files: each project is a JSON document stored as `<dir>/<id>.gpiob`.

use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::Serialize;
use serde_json::Value;

const EXTENSION: &str = "gpiob";
const MAX_ID_LEN: usize = 64;
/// Larger files are refused instead of being read into memory.
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub updated: String,
}

pub struct Projects {
    dir: PathBuf,
}

/// Ids become file names here and on the Pi, so only plain ASCII letters, digits,
/// `_` and `-` are allowed.
fn is_valid_id(id: &str) -> bool {
    (1..=MAX_ID_LEN).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn check_id(id: &str) -> Result<(), String> {
    if is_valid_id(id) {
        Ok(())
    } else {
        Err("Invalid project id".to_string())
    }
}

impl Projects {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn path(&self, id: &str) -> Result<PathBuf, String> {
        check_id(id)?;
        Ok(self.dir.join(format!("{id}.{EXTENSION}")))
    }

    /// Every readable project, newest first. Files that cannot be read or fail
    /// validation are skipped, so one bad file never hides the rest.
    pub fn list(&self) -> Result<Vec<ProjectSummary>, String> {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("Cannot list projects: {e}")),
        };
        let mut projects: Vec<ProjectSummary> = entries
            .flatten()
            .filter_map(|entry| summarize(&entry.path()))
            .collect();
        // ISO-8601 timestamps compare correctly as text.
        projects.sort_by(|a, b| b.updated.cmp(&a.updated).then_with(|| a.id.cmp(&b.id)));
        Ok(projects)
    }

    pub fn read(&self, id: &str) -> Result<Value, String> {
        let path = self.path(id)?;
        match fs::metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err("Project not found".to_string())
            }
            _ => read_doc_file(&path),
        }
    }

    pub fn write(&self, id: &str, doc: &Value) -> Result<(), String> {
        let path = self.path(id)?;
        let text = render(doc)?;
        fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Cannot create the projects folder: {e}"))?;
        write_atomic(&path, &text)
    }

    /// A project that is already gone is the state the caller wants, so it is not an error.
    pub fn delete(&self, id: &str) -> Result<(), String> {
        let path = self.path(id)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Cannot delete project: {e}")),
        }
    }
}

fn summarize(path: &Path) -> Option<ProjectSummary> {
    if path.extension()? != EXTENSION {
        return None;
    }
    let id = path.file_stem()?.to_str()?;
    if !is_valid_id(id) {
        return None;
    }
    let doc = read_doc_file(path).ok()?;
    let meta = doc.get("meta")?;
    Some(ProjectSummary {
        id: id.to_string(),
        name: meta.get("name")?.as_str()?.to_string(),
        updated: meta.get("updated")?.as_str()?.to_string(),
    })
}

/// Checks the shape every project document must have, wherever it came from or goes to.
pub fn validate_doc(doc: &Value) -> Result<(), String> {
    let doc = doc.as_object().ok_or("Project must be a JSON object")?;
    match doc.get("schemaVersion") {
        None => return Err("Missing schemaVersion".to_string()),
        Some(version) if version.as_u64().is_some_and(|v| v >= 1) => {}
        Some(_) => return Err("schemaVersion must be an integer of 1 or more".to_string()),
    }
    let meta = doc
        .get("meta")
        .ok_or("Missing meta")?
        .as_object()
        .ok_or("meta must be an object")?;
    for field in ["name", "updated"] {
        match meta.get(field) {
            None => return Err(format!("Missing meta.{field}")),
            Some(value) if value.is_string() => {}
            Some(_) => return Err(format!("meta.{field} must be a string")),
        }
    }
    Ok(())
}

/// Reads and validates a project document from any path (used for import).
pub fn read_doc_file(path: &Path) -> Result<Value, String> {
    let shown = path.display();
    let meta = fs::metadata(path).map_err(|e| format!("Cannot read {shown}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{shown} is not a file"));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("{shown} is too large: the limit is 16 MiB"));
    }
    let text = fs::read_to_string(path).map_err(|e| format!("Cannot read {shown}: {e}"))?;
    let doc: Value =
        serde_json::from_str(&text).map_err(|e| format!("{shown} is not valid JSON: {e}"))?;
    validate_doc(&doc).map_err(|why| format!("{shown} is not a valid project: {why}"))?;
    Ok(doc)
}

/// Validates and writes a project document to any path (used for export).
pub fn write_doc_file(path: &Path, doc: &Value) -> Result<(), String> {
    write_atomic(path, &render(doc)?)
}

/// Pretty-printed JSON with a trailing newline, after validation.
fn render(doc: &Value) -> Result<String, String> {
    validate_doc(doc)?;
    let mut text = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text)
}

/// Writes through a temporary file in the same folder, so a crash never leaves a
/// half-written project. The temporary name is unique per call, so two saves of the
/// same project cannot interleave their bytes.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let file_name = path.file_name().ok_or("Invalid file path")?;
    let mut temp_name = OsString::from(".");
    temp_name.push(file_name);
    temp_name.push(format!(
        ".{}.{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let temp = path.with_file_name(temp_name);
    fs::write(&temp, text)
        .and_then(|()| fs::rename(&temp, path))
        .map_err(|e| {
            let _ = fs::remove_file(&temp);
            format!("Cannot write {}: {e}", path.display())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gpio-projects-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn doc(name: &str, updated: &str) -> Value {
        json!({
            "schemaVersion": 1,
            "meta": { "name": name, "updated": updated },
            "nodes": [1, 2, 3]
        })
    }

    fn file_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_written_project_reads_back_unchanged() {
        let dir = temp_dir("round-trip");
        let projects = Projects::new(dir.clone());
        let original = doc("Blinky", "2026-10-01T12:00:00Z");
        projects.write("blinky", &original).unwrap();
        assert_eq!(projects.read("blinky").unwrap(), original);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn files_are_pretty_printed_with_a_trailing_newline() {
        let dir = temp_dir("format");
        let projects = Projects::new(dir.clone());
        projects
            .write("p1", &doc("A", "2026-10-01T00:00:00Z"))
            .unwrap();
        let text = fs::read_to_string(dir.join("p1.gpiob")).unwrap();
        assert!(text.ends_with("}\n") && !text.ends_with("\n\n"));
        assert!(text.contains("\n  \"meta\": {"), "indented: {text}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn writing_creates_the_directory_and_replaces_an_existing_project() {
        let dir = temp_dir("create-replace");
        let projects = Projects::new(dir.join("nested").join("projects"));
        projects
            .write("p1", &doc("Old", "2026-10-01T00:00:00Z"))
            .unwrap();
        projects
            .write("p1", &doc("New", "2026-10-02T00:00:00Z"))
            .unwrap();
        assert_eq!(projects.read("p1").unwrap()["meta"]["name"], json!("New"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn list_is_newest_first_with_ties_broken_by_id() {
        let dir = temp_dir("list-order");
        let projects = Projects::new(dir.clone());
        projects
            .write("old", &doc("Old", "2026-01-01T00:00:00Z"))
            .unwrap();
        projects
            .write("b-tie", &doc("Tie B", "2026-06-01T00:00:00Z"))
            .unwrap();
        projects
            .write("new", &doc("New", "2026-09-01T00:00:00Z"))
            .unwrap();
        projects
            .write("a-tie", &doc("Tie A", "2026-06-01T00:00:00Z"))
            .unwrap();

        let ids: Vec<String> = projects.list().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["new", "a-tie", "b-tie", "old"]);

        let first = &projects.list().unwrap()[0];
        assert_eq!(
            first,
            &ProjectSummary {
                id: "new".to_string(),
                name: "New".to_string(),
                updated: "2026-09-01T00:00:00Z".to_string(),
            }
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn list_skips_files_that_are_not_readable_projects() {
        let dir = temp_dir("list-junk");
        let projects = Projects::new(dir.clone());
        projects
            .write("good", &doc("Good", "2026-05-05T00:00:00Z"))
            .unwrap();
        let good = fs::read_to_string(dir.join("good.gpiob")).unwrap();

        fs::write(dir.join("notes.txt"), &good).unwrap(); // wrong extension
        fs::write(dir.join("bad id.gpiob"), &good).unwrap(); // stem is not a valid id
        fs::write(dir.join("dotted.name.gpiob"), &good).unwrap(); // stem has a dot
        fs::write(dir.join("corrupt.gpiob"), "{ not json").unwrap();
        fs::write(
            dir.join("invalid.gpiob"),
            r#"{"schemaVersion": 0, "meta": {"name": "x", "updated": "y"}}"#,
        )
        .unwrap();
        fs::write(dir.join("empty.gpiob"), "").unwrap();
        fs::create_dir(dir.join("folder.gpiob")).unwrap();
        fs::write(dir.join(".good.gpiob.1.2.tmp"), &good).unwrap(); // leftover temp file

        let listed = projects.list().unwrap();
        assert_eq!(listed.len(), 1, "{listed:?}");
        assert_eq!(listed[0].id, "good");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn list_of_a_folder_that_does_not_exist_is_empty() {
        let projects = Projects::new(temp_dir("list-missing").join("nothing-here"));
        assert_eq!(projects.list(), Ok(Vec::new()));
    }

    #[test]
    fn invalid_ids_are_rejected_before_touching_the_filesystem() {
        let long = "a".repeat(65);
        let invalid = [
            "",
            ".",
            "..",
            "../escape",
            "..\\escape",
            "a/b",
            "/abs",
            "a\\b",
            "a b",
            " ",
            "a.b",
            "x.gpiob",
            "~",
            "a:b",
            "a*",
            "a\0b",
            "a\n",
            "abc\n",
            "é",
            "名前",
            "ａｂｃ", // full-width letters
            "a%2fb",
            long.as_str(),
        ];
        let dir = temp_dir("invalid-ids");
        let projects = Projects::new(dir.join("projects"));
        let good = doc("A", "2026-01-01T00:00:00Z");
        for id in invalid {
            assert_eq!(
                projects.read(id),
                Err("Invalid project id".to_string()),
                "read {id:?}"
            );
            assert_eq!(
                projects.write(id, &good),
                Err("Invalid project id".to_string()),
                "write {id:?}"
            );
            assert_eq!(
                projects.delete(id),
                Err("Invalid project id".to_string()),
                "delete {id:?}"
            );
        }
        assert!(!dir.exists(), "nothing was created for an invalid id");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn valid_ids_are_accepted() {
        let longest = "a".repeat(64);
        let dir = temp_dir("valid-ids");
        let projects = Projects::new(dir.clone());
        let good = doc("A", "2026-01-01T00:00:00Z");
        for id in ["a", "Z", "0", "_", "-", "my-project_01", longest.as_str()] {
            projects.write(id, &good).unwrap();
            assert_eq!(projects.read(id).unwrap(), good, "{id}");
        }
        assert_eq!(projects.list().unwrap().len(), 7);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_path_like_id_never_writes_outside_the_folder() {
        let dir = temp_dir("escape");
        let projects = Projects::new(dir.join("projects"));
        let _ = projects.write("../escaped", &doc("A", "2026-01-01T00:00:00Z"));
        assert!(!dir.join("escaped.gpiob").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reading_a_missing_project_says_so() {
        let dir = temp_dir("read-missing");
        let projects = Projects::new(dir.clone());
        assert_eq!(projects.read("nope"), Err("Project not found".to_string()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(projects.read("nope"), Err("Project not found".to_string()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reading_a_broken_project_explains_why() {
        let dir = temp_dir("read-broken");
        fs::create_dir_all(&dir).unwrap();
        let projects = Projects::new(dir.clone());
        fs::write(dir.join("corrupt.gpiob"), "{ not json").unwrap();
        fs::write(dir.join("invalid.gpiob"), r#"{"meta": {}}"#).unwrap();

        let err = projects.read("corrupt").unwrap_err();
        assert!(err.contains("not valid JSON"), "{err}");
        let err = projects.read("invalid").unwrap_err();
        assert!(err.contains("not a valid project"), "{err}");
        assert!(err.contains("Missing schemaVersion"), "{err}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_removes_the_project_and_a_missing_one_is_fine() {
        let dir = temp_dir("delete");
        let projects = Projects::new(dir.clone());
        projects
            .write("gone", &doc("A", "2026-01-01T00:00:00Z"))
            .unwrap();
        assert!(dir.join("gone.gpiob").exists());

        projects.delete("gone").unwrap();
        assert!(!dir.join("gone.gpiob").exists());
        assert_eq!(projects.read("gone"), Err("Project not found".to_string()));

        assert_eq!(projects.delete("gone"), Ok(()), "already deleted");
        assert_eq!(projects.delete("never-existed"), Ok(()));
        let _ = fs::remove_dir_all(dir);
        assert_eq!(
            Projects::new(temp_dir("delete-no-dir")).delete("x"),
            Ok(()),
            "folder does not exist either"
        );
    }

    #[test]
    fn an_atomic_write_leaves_no_temp_file_behind() {
        let dir = temp_dir("atomic");
        let projects = Projects::new(dir.clone());
        projects
            .write("p1", &doc("A", "2026-01-01T00:00:00Z"))
            .unwrap();
        projects
            .write("p1", &doc("B", "2026-01-02T00:00:00Z"))
            .unwrap();
        assert_eq!(file_names(&dir), ["p1.gpiob"]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_failed_write_cleans_up_and_leaves_no_stray_file() {
        let dir = temp_dir("failed-write");
        fs::create_dir_all(dir.join("blocked.gpiob")).unwrap(); // a folder in the project's place
        let projects = Projects::new(dir.clone());
        assert!(projects
            .write("blocked", &doc("A", "2026-01-01T00:00:00Z"))
            .is_err());
        assert_eq!(file_names(&dir), ["blocked.gpiob"]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn an_invalid_document_is_refused_without_creating_anything() {
        let dir = temp_dir("write-invalid");
        let projects = Projects::new(dir.join("projects"));
        let err = projects
            .write("p1", &json!({"schemaVersion": 1}))
            .unwrap_err();
        assert_eq!(err, "Missing meta");
        assert!(!dir.exists());
    }

    #[test]
    fn validate_doc_accepts_and_rejects_the_expected_shapes() {
        let good = |v: Value| assert_eq!(validate_doc(&v), Ok(()), "{v}");
        let bad = |v: Value, reason: &str| {
            let err = validate_doc(&v).expect_err(&format!("should reject {v}"));
            assert!(err.contains(reason), "{v} -> {err}");
        };

        good(json!({"schemaVersion": 1, "meta": {"name": "n", "updated": "u"}}));
        good(json!({"schemaVersion": 7, "meta": {"name": "", "updated": ""}}));
        good(
            json!({"schemaVersion": 1, "meta": {"name": "n", "updated": "u", "extra": 1}, "x": [1]}),
        );

        bad(json!(null), "JSON object");
        bad(json!([]), "JSON object");
        bad(json!("text"), "JSON object");
        bad(json!(5), "JSON object");
        bad(
            json!({"meta": {"name": "n", "updated": "u"}}),
            "Missing schemaVersion",
        );
        for version in [
            json!(0),
            json!(-1),
            json!(1.5),
            json!(1.0),
            json!("1"),
            json!(null),
            json!(true),
        ] {
            bad(
                json!({"schemaVersion": version, "meta": {"name": "n", "updated": "u"}}),
                "schemaVersion must be an integer",
            );
        }
        bad(json!({"schemaVersion": 1}), "Missing meta");
        for meta in [json!(null), json!("m"), json!([]), json!(3)] {
            bad(
                json!({"schemaVersion": 1, "meta": meta}),
                "meta must be an object",
            );
        }
        bad(
            json!({"schemaVersion": 1, "meta": {"updated": "u"}}),
            "Missing meta.name",
        );
        bad(
            json!({"schemaVersion": 1, "meta": {"name": 5, "updated": "u"}}),
            "meta.name must be a string",
        );
        bad(
            json!({"schemaVersion": 1, "meta": {"name": "n"}}),
            "Missing meta.updated",
        );
        bad(
            json!({"schemaVersion": 1, "meta": {"name": "n", "updated": null}}),
            "meta.updated must be a string",
        );
    }

    #[test]
    fn document_files_round_trip_at_any_path() {
        let dir = temp_dir("doc-file");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("export.json");
        let original = doc("Exported", "2026-03-03T00:00:00Z");
        write_doc_file(&path, &original).unwrap();
        assert_eq!(read_doc_file(&path).unwrap(), original);
        assert_eq!(file_names(&dir), ["export.json"], "no temp file left");
        assert!(fs::read_to_string(&path).unwrap().ends_with("}\n"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn document_file_errors_are_specific() {
        let dir = temp_dir("doc-file-errors");
        fs::create_dir_all(&dir).unwrap();

        let err = write_doc_file(&dir.join("x.json"), &json!([])).unwrap_err();
        assert!(err.contains("JSON object"), "{err}");
        assert!(!dir.join("x.json").exists());

        let err =
            write_doc_file(&dir.join("no-such-dir").join("x.json"), &doc("A", "u")).unwrap_err();
        assert!(err.contains("Cannot write"), "{err}");

        let err = read_doc_file(&dir.join("missing.json")).unwrap_err();
        assert!(err.contains("Cannot read"), "{err}");

        fs::write(dir.join("text.json"), "hello").unwrap();
        assert!(read_doc_file(&dir.join("text.json"))
            .unwrap_err()
            .contains("not valid JSON"));

        fs::write(dir.join("array.json"), "[1]").unwrap();
        assert!(read_doc_file(&dir.join("array.json"))
            .unwrap_err()
            .contains("JSON object"));

        fs::write(dir.join("bytes.json"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_doc_file(&dir.join("bytes.json")).is_err());

        let err = read_doc_file(&dir).unwrap_err();
        assert!(err.contains("not a file"), "{err}");
        let _ = fs::remove_dir_all(dir);
    }

    /// A valid project padded with trailing spaces to exactly `size` bytes.
    fn padded_project(path: &Path, size: u64) {
        let mut text = serde_json::to_string(&doc("Big", "2026-01-01T00:00:00Z")).unwrap();
        text.push_str(&" ".repeat(size as usize - text.len()));
        fs::write(path, text).unwrap();
    }

    #[test]
    fn files_over_16_mib_are_refused_and_exactly_16_mib_is_read() {
        let dir = temp_dir("size-guard");
        fs::create_dir_all(&dir).unwrap();
        let projects = Projects::new(dir.clone());

        padded_project(&dir.join("limit.gpiob"), MAX_FILE_BYTES);
        assert!(
            projects.read("limit").is_ok(),
            "exactly the limit is allowed"
        );

        padded_project(&dir.join("big.gpiob"), MAX_FILE_BYTES + 1);
        let err = projects.read("big").unwrap_err();
        assert!(err.contains("too large") && err.contains("16 MiB"), "{err}");
        assert!(read_doc_file(&dir.join("big.gpiob")).is_err());

        let ids: Vec<String> = projects.list().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["limit"], "the oversized file is skipped by list");
        let _ = fs::remove_dir_all(dir);
    }
}
