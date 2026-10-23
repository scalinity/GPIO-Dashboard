//! Commands invoked by the renderer through `window.api` (src/renderer/src/api.js).
//!
//! Like the IPC handlers they replace, these report failures in the returned JSON
//! (`{ success: false, error }`) rather than rejecting, which the renderer relies on.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    agent,
    ai::Ai,
    settings::{self, Settings},
    ssh::{Auth, Ssh, Target},
    ws::Ws,
};

type CommandResult = Result<Value, String>;

const GPIO_AGENT_PORT: u16 = 8765;
const TUTORIAL_DIR: &str = "/tmp/gpio_dashboard";
const TUTORIAL_TIMEOUT: Duration = Duration::from_secs(120);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

const SETTINGS_ALLOWLIST: [&str; 9] = [
    "ui.completedTutorials",
    "ui.selectedTab",
    "connection.host",
    "connection.port",
    "connection.username",
    "connection.authMethod",
    "connection.keyPath",
    "ai.model",
    "ai.thinkingLevel",
];

fn error_json(e: String) -> Value {
    json!({ "success": false, "error": e })
}

/// Only plain `name.py` filenames may reach a remote shell command.
fn is_safe_script_name(name: &str) -> bool {
    name.strip_suffix(".py").is_some_and(|stem| {
        !stem.is_empty()
            && stem
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    })
}

// --- SSH ---

#[tauri::command]
pub async fn ssh_select_key_file(app: AppHandle) -> CommandResult {
    let mut dialog = app.dialog().file().set_title("Select SSH Private Key");
    if let Ok(home) = app.path().home_dir() {
        dialog = dialog.set_directory(home.join(".ssh"));
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let path = rx
        .await
        .ok()
        .flatten()
        .and_then(|picked| picked.into_path().ok());
    Ok(match path {
        Some(path) => json!({ "canceled": false, "path": path.display().to_string() }),
        None => json!({ "canceled": true }),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfig {
    host: String,
    port: u16,
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    auth_method: String,
    #[serde(default)]
    key_path: String,
}

#[tauri::command]
pub async fn ssh_connect(ssh: State<'_, Ssh>, config: ConnectConfig) -> CommandResult {
    let auth = if config.auth_method == "key" && !config.key_path.is_empty() {
        // Selecting the .pub file means its private key next to it, as OpenSSH does.
        let key_path = config
            .key_path
            .strip_suffix(".pub")
            .unwrap_or(&config.key_path);
        match std::fs::read_to_string(key_path) {
            Ok(pem) => Auth::Key {
                pem,
                // The password field doubles as the key's passphrase.
                passphrase: Some(config.password).filter(|p| !p.is_empty()),
            },
            Err(e) => return Ok(error_json(format!("Cannot read key file: {e}"))),
        }
    } else {
        Auth::Password(config.password)
    };

    let target = Target {
        host: config.host,
        port: config.port,
        username: config.username,
        auth,
    };
    Ok(match ssh.connect(target).await {
        Ok(()) => json!({ "success": true }),
        Err(e) => error_json(e),
    })
}

#[tauri::command]
pub async fn ssh_disconnect(ssh: State<'_, Ssh>) -> CommandResult {
    ssh.disconnect().await;
    Ok(json!({ "success": true }))
}

/// Runs an uploaded tutorial script, streaming its output as `tutorial:output` events.
#[tauri::command]
pub async fn ssh_run_tutorial_script(ssh: State<'_, Ssh>, filename: String) -> CommandResult {
    if !is_safe_script_name(&filename) {
        return Ok(json!({ "error": "Invalid script filename" }));
    }
    let cmd = format!("mkdir -p {TUTORIAL_DIR} && cd {TUTORIAL_DIR} && python3 -u {filename}");
    Ok(ssh
        .execute_streaming(&cmd, TUTORIAL_TIMEOUT)
        .await
        .unwrap_or_else(|e| json!({ "error": e })))
}

#[tauri::command]
pub async fn ssh_kill_process(ssh: State<'_, Ssh>, filename: String) -> CommandResult {
    if !is_safe_script_name(&filename) {
        return Ok(json!({ "error": "Invalid script filename" }));
    }
    ssh.kill_tutorial_stream();
    let cmd = format!("pkill -f \"python3 {filename}\" 2>/dev/null; exit 0");
    Ok(exec_json(&ssh, &cmd).await)
}

#[tauri::command]
pub async fn ssh_gpio_cleanup(ssh: State<'_, Ssh>) -> CommandResult {
    let cmd = "python3 -c \"import RPi.GPIO as GPIO; GPIO.setmode(GPIO.BCM); GPIO.cleanup()\" 2>/dev/null; exit 0";
    Ok(exec_json(&ssh, cmd).await)
}

async fn exec_json(ssh: &Ssh, cmd: &str) -> Value {
    match ssh.execute(cmd, COMMAND_TIMEOUT).await {
        Ok(out) => json!({ "stdout": out.stdout, "stderr": out.stderr, "code": out.code }),
        Err(e) => json!({ "error": e }),
    }
}

#[tauri::command]
pub async fn ssh_scp_buffer(
    ssh: State<'_, Ssh>,
    content: String,
    remote_path: String,
) -> CommandResult {
    if !remote_path.starts_with(&format!("{TUTORIAL_DIR}/")) || remote_path.contains("..") {
        return Ok(error_json("Invalid remote path".into()));
    }
    let mkdir = match ssh
        .execute(&format!("mkdir -p {TUTORIAL_DIR}"), COMMAND_TIMEOUT)
        .await
    {
        Ok(out) => out,
        Err(e) => return Ok(error_json(e)),
    };
    if mkdir.code != Some(0) {
        return Ok(error_json(format!(
            "Failed to create directory: {}",
            mkdir.stderr
        )));
    }
    Ok(
        match ssh.put_bytes(content.into_bytes(), &remote_path).await {
            Ok(()) => json!({ "success": true }),
            Err(e) => error_json(e),
        },
    )
}

#[tauri::command]
pub fn ssh_get_status(ssh: State<'_, Ssh>) -> CommandResult {
    Ok(json!({ "status": ssh.status() }))
}

// --- GPIO WebSocket ---

#[tauri::command]
pub fn gpio_connect(ws: State<'_, Ws>, host: String, auth_token: Option<String>) -> CommandResult {
    ws.connect(host, GPIO_AGENT_PORT, auth_token.filter(|t| !t.is_empty()));
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn gpio_disconnect(ws: State<'_, Ws>) -> CommandResult {
    ws.disconnect();
    Ok(json!({ "success": true }))
}

// --- Terminal ---

#[tauri::command]
pub async fn terminal_create(ssh: State<'_, Ssh>, session_id: String) -> CommandResult {
    Ok(match ssh.create_shell(&session_id).await {
        Ok(()) => json!({ "success": true }),
        Err(e) => error_json(e),
    })
}

#[tauri::command]
pub fn terminal_write(ssh: State<'_, Ssh>, session_id: String, data: String) {
    ssh.write_to_shell(&session_id, data);
}

#[tauri::command]
pub fn terminal_resize(
    ssh: State<'_, Ssh>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> CommandResult {
    ssh.resize_shell(&session_id, cols, rows);
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn terminal_destroy(ssh: State<'_, Ssh>, session_id: String) -> CommandResult {
    ssh.destroy_shell(&session_id);
    Ok(json!({ "success": true }))
}

// --- Pi agent ---

#[tauri::command]
pub async fn agent_deploy(ssh: State<'_, Ssh>) -> CommandResult {
    Ok(agent::deploy(&ssh).await.unwrap_or_else(error_json))
}

#[tauri::command]
pub async fn agent_install(ssh: State<'_, Ssh>) -> CommandResult {
    Ok(agent::install(&ssh).await.unwrap_or_else(error_json))
}

#[tauri::command]
pub async fn agent_start(ssh: State<'_, Ssh>) -> CommandResult {
    Ok(agent::start(&ssh).await.unwrap_or_else(error_json))
}

#[tauri::command]
pub async fn agent_stop(ssh: State<'_, Ssh>) -> CommandResult {
    Ok(agent::stop(&ssh).await.unwrap_or_else(error_json))
}

#[tauri::command]
pub async fn agent_get_status(ssh: State<'_, Ssh>) -> CommandResult {
    Ok(agent::get_status(&ssh)
        .await
        .unwrap_or_else(|e| json!({ "running": false, "error": e })))
}

// --- Settings ---

#[tauri::command]
pub async fn settings_get(settings: State<'_, Settings>, key: String) -> CommandResult {
    if key == settings::PASSWORD_KEY {
        // A failed keychain read is not the same as "no password"; report it as null
        // and log why, so the form still loads.
        return Ok(match settings::get_secret(&key) {
            Ok(password) => Value::String(password),
            Err(e) => {
                eprintln!("[settings] could not read {key} from the keychain: {e}");
                Value::Null
            }
        });
    }
    if !SETTINGS_ALLOWLIST.contains(&key.as_str()) {
        return Ok(Value::Null);
    }
    Ok(settings.get(&key))
}

#[tauri::command]
pub async fn settings_set(
    settings: State<'_, Settings>,
    key: String,
    value: Value,
) -> CommandResult {
    if !SETTINGS_ALLOWLIST.contains(&key.as_str()) {
        return Ok(error_json("Setting not allowed".into()));
    }
    Ok(match settings.set(&key, value) {
        Ok(()) => json!({ "success": true }),
        Err(e) => error_json(e),
    })
}

#[tauri::command]
pub async fn settings_set_password(value: Option<String>) -> CommandResult {
    Ok(
        match settings::set_secret(settings::PASSWORD_KEY, &value.unwrap_or_default()) {
            Ok(()) => json!({ "success": true }),
            Err(e) => error_json(e),
        },
    )
}

#[tauri::command]
pub async fn settings_get_all(settings: State<'_, Settings>) -> CommandResult {
    Ok(settings.all())
}

#[tauri::command]
pub async fn settings_set_api_key(value: String) -> CommandResult {
    let key = value.trim();
    if key.is_empty() {
        return Ok(error_json("Invalid API key".into()));
    }
    Ok(match settings::set_secret(settings::API_KEY, key) {
        Ok(()) => json!({ "success": true }),
        Err(e) => error_json(e),
    })
}

#[tauri::command]
pub async fn settings_has_api_key() -> CommandResult {
    Ok(match settings::get_secret(settings::API_KEY) {
        Ok(key) => json!({ "hasKey": !key.is_empty() }),
        Err(e) => json!({ "hasKey": false, "error": e }),
    })
}

// --- AI ---

#[tauri::command]
pub async fn ai_generate(ai: State<'_, Ai>, params: Value) -> CommandResult {
    ai.generate(params, || settings::get_secret(settings::API_KEY));
    Ok(Value::Null)
}

#[tauri::command]
pub fn ai_abort(ai: State<'_, Ai>) -> CommandResult {
    ai.abort();
    Ok(json!({ "success": true }))
}

// --- System ---

/// Opens an http(s) link in the system browser.
#[tauri::command]
pub fn open_external(url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = open::that_detached(url);
    }
}
