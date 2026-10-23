//! Persistent settings: a JSON file for plain values, the OS keychain for secrets.

use std::{fs, path::PathBuf, sync::Mutex};

use serde_json::{json, Value};

const KEYCHAIN_SERVICE: &str = "com.gpio-dashboard";
pub const PASSWORD_KEY: &str = "connection.password";
pub const API_KEY: &str = "ai.apiKey";

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
        "ai": {
            "model": "anthropic/claude-opus-4.6",
            "thinkingLevel": "medium"
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

impl Settings {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("config.json");
        let mut data = defaults();
        if let Some(saved) = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        {
            merge(&mut data, saved);
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

/// Secrets live in the keychain under the setting's own key, e.g. `ai.apiKey`.
pub fn get_secret(name: &str) -> String {
    keyring::Entry::new(KEYCHAIN_SERVICE, name)
        .and_then(|entry| entry.get_password())
        .unwrap_or_default()
}

pub fn set_secret(name: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())?;
    if value.is_empty() {
        // Nothing to store; a missing entry is already the desired state.
        let _ = entry.delete_credential();
        return Ok(());
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
        assert_eq!(settings.get("ai.model"), json!("anthropic/claude-opus-4.6"));
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
}
