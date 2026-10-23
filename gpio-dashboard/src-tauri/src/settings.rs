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
        let mut node = &mut *data;
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
        self.save(&data)
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
