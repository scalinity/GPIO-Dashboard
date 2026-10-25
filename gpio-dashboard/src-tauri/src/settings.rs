//! Persistent settings: a JSON file for plain values, the OS keychain for secrets.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde_json::{json, Value};

const KEYCHAIN_SERVICE: &str = "com.gpio-dashboard";
pub const PASSWORD_KEY: &str = "connection.password";
/// The Anthropic API key. Only Rust reads it (the proxy); no command returns it.
pub const ANTHROPIC_KEY: &str = "anthropic.apiKey";

pub struct Settings {
    path: PathBuf,
    data: Mutex<Value>,
}

fn defaults() -> Value {
    json!({
        "connection": {
            "host": "",
            "port": 22,
            "username": "pi",
            "authMethod": "key",
            "keyPath": ""
        },
        "ui": {
            "lastTab": "gpio",
            "terminalHeight": 300,
            "completedTutorials": []
        },
        "assistant": {
            "model": "claude-opus-5-5",
            "effort": "high",
            "webTools": true
        },
        "run": {
            // Seconds after which a run on the Pi is stopped; null means no limit (D17).
            "timeLimitSec": null
        }
    })
}

/// Layers `over` on top of `base`, recursing into objects.
fn merge(base: &mut Value, over: Value) {
    match (base, over) {
        (Value::Object(base), Value::Object(over)) => {
            for (key, value) in over {
                match base.get_mut(&key) {
                    Some(existing) => merge(existing, value),
                    None => {
                        base.insert(key, value);
                    }
                }
            }
        }
        (base, over) => *base = over,
    }
}

/// Moves a settings file that cannot be read or parsed aside, so starting from defaults
/// and saving again does not destroy what was in it.
fn keep_unusable_file(path: &Path, why: &str) {
    let backup = path.with_extension("json.bak");
    eprintln!(
        "[settings] {} is unusable ({why}); keeping it as {}",
        path.display(),
        backup.display()
    );
    let _ = fs::rename(path, backup);
}

impl Settings {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("config.json");
        let mut data = defaults();
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Value>(&text) {
                Ok(saved) => merge(&mut data, saved),
                Err(e) => keep_unusable_file(&path, &e.to_string()),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => keep_unusable_file(&path, &e.to_string()),
        }
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    fn data(&self) -> std::sync::MutexGuard<'_, Value> {
        self.data.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads a dotted key such as `connection.host`; unknown keys are `null`.
    pub fn get(&self, key: &str) -> Value {
        key.split('.')
            .try_fold(&*self.data(), |node, part| node.get(part))
            .cloned()
            .unwrap_or(Value::Null)
    }

    pub fn set(&self, key: &str, value: Value) -> Result<(), String> {
        let mut data = self.data();
        // Edit a copy and publish it only once it is on disk, so a failed save leaves
        // memory and file in agreement.
        let mut next = data.clone();
        let mut node = &mut next;
        let mut parts = key.split('.').peekable();
        while let Some(part) = parts.next() {
            if !node.is_object() {
                *node = json!({});
            }
            let map = node.as_object_mut().expect("just made an object");
            if parts.peek().is_none() {
                map.insert(part.to_string(), value);
                break;
            }
            node = map.entry(part.to_string()).or_insert_with(|| json!({}));
        }
        self.save(&next)?;
        *data = next;
        Ok(())
    }

    pub fn all(&self) -> Value {
        self.data().clone()
    }

    /// Writes via a temporary file so a crash never leaves a half-written config.
    fn save(&self, data: &Value) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let temp = self.path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        fs::write(&temp, text).map_err(|e| e.to_string())?;
        fs::rename(&temp, &self.path).map_err(|e| e.to_string())
    }
}

/// Secrets live in the keychain under the setting's own key, e.g. `connection.password`.
/// A missing entry is `Ok("")`; any other keychain failure is an error, so callers
/// can tell "nothing saved" from "could not read".
pub fn get_secret(name: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn set_secret(name: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())?;
    if value.is_empty() {
        // An entry that is already absent is the state we want.
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gpio-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn defaults_are_available_and_unknown_keys_are_null() {
        let dir = temp_dir("defaults");
        let settings = Settings::load(dir.clone());
        assert_eq!(settings.get("connection.port"), json!(22));
        assert_eq!(settings.get("assistant.model"), json!("claude-opus-5-5"));
        assert_eq!(settings.get("assistant.effort"), json!("high"));
        assert_eq!(settings.get("run.timeLimitSec"), Value::Null);
        assert_eq!(settings.get("nope.nothing"), Value::Null);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn values_persist_and_merge_over_defaults() {
        let dir = temp_dir("persist");
        let settings = Settings::load(dir.clone());
        settings.set("connection.host", json!("pi.local")).unwrap();
        settings
            .set("ui.completedTutorials", json!(["a", "b"]))
            .unwrap();
        settings.set("brand.new.path", json!(1)).unwrap();

        let reloaded = Settings::load(dir.clone());
        assert_eq!(reloaded.get("connection.host"), json!("pi.local"));
        assert_eq!(
            reloaded.get("connection.username"),
            json!("pi"),
            "defaults still merged"
        );
        assert_eq!(reloaded.get("ui.completedTutorials"), json!(["a", "b"]));
        assert_eq!(reloaded.get("brand.new.path"), json!(1));
        assert!(reloaded.all()["connection"].get("password").is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_failed_save_leaves_the_stored_value_unchanged() {
        let dir = temp_dir("failed-save");
        let settings = Settings::load(dir.clone());
        settings.set("connection.host", json!("pi-a")).unwrap();

        // A directory where the temp file should go makes the write fail.
        fs::create_dir(dir.join("config.json.tmp")).unwrap();
        assert!(settings.set("connection.host", json!("pi-b")).is_err());

        assert_eq!(settings.get("connection.host"), json!("pi-a"));
        assert_eq!(
            Settings::load(dir.clone()).get("connection.host"),
            json!("pi-a")
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "touches the macOS keychain"]
    fn keychain_distinguishes_missing_from_stored_and_replaces_and_deletes() {
        let name = format!("test.secret.{}", std::process::id());
        assert_eq!(
            get_secret(&name),
            Ok(String::new()),
            "missing entry is not an error"
        );
        set_secret(&name, "s3cr€t").unwrap();
        assert_eq!(get_secret(&name), Ok("s3cr€t".to_string()));
        set_secret(&name, "replaced").unwrap();
        assert_eq!(get_secret(&name), Ok("replaced".to_string()));
        set_secret(&name, "").unwrap();
        assert_eq!(get_secret(&name), Ok(String::new()));
        set_secret(&name, "").unwrap(); // deleting an absent entry succeeds
    }

    #[test]
    fn a_malformed_file_is_kept_as_a_backup_and_defaults_are_used() {
        let dir = temp_dir("malformed");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config.json"), "{ not json").unwrap();

        let settings = Settings::load(dir.clone());
        assert_eq!(settings.get("connection.port"), json!(22));
        assert_eq!(
            fs::read_to_string(dir.join("config.json.bak")).unwrap(),
            "{ not json"
        );

        // Saving afterwards writes a fresh, valid file and leaves the backup alone.
        settings.set("connection.host", json!("x")).unwrap();
        assert_eq!(
            Settings::load(dir.clone()).get("connection.host"),
            json!("x")
        );
        assert!(dir.join("config.json.bak").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_file_is_not_treated_as_a_problem() {
        let dir = temp_dir("missing");
        let settings = Settings::load(dir.clone());
        assert_eq!(settings.get("connection.username"), json!("pi"));
        assert!(!dir.join("config.json.bak").exists());
        let _ = fs::remove_dir_all(dir);
    }
}
