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
    settings::{self, Settings},
    ssh::{Auth, Ssh, Target},
    ws::{Route, Ws},
};

type CommandResult = Result<Value, String>;

const GPIO_AGENT_PORT: u16 = 8765;
const TUTORIAL_DIR: &str = "/tmp/gpio_dashboard";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

const SETTINGS_ALLOWLIST: [&str; 11] = [
    "ui.completedTutorials",
    "ui.selectedTab",
    "connection.host",
    "connection.port",
    "connection.username",
    "connection.authMethod",
    "connection.keyPath",
    "assistant.model",
    "assistant.effort",
    "assistant.webTools",
    "run.timeLimitSec",
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

/// The remote command that runs an uploaded tutorial script. `filename` must already
/// have passed `is_safe_script_name`.
pub(crate) fn tutorial_run_command(filename: &str) -> String {
    format!("mkdir -p {TUTORIAL_DIR} && cd {TUTORIAL_DIR} && python3 -u {filename}")
}

/// The remote command that stops that script. The `[x]` keeps the pattern from matching
/// the shell that runs this very command, and the interpreter is matched loosely because
/// it shows up as `python3` on a Pi but `Python` on macOS.
pub(crate) fn tutorial_kill_command(filename: &str) -> String {
    let mut chars = filename.chars();
    let first = chars.next().unwrap_or('x');
    let rest = chars.as_str().replace('.', "\\.");
    format!("pkill -f '[pP]ython3? -u [{first}]{rest}' 2>/dev/null; exit 0")
}

fn valid_port(port: i64) -> Option<u16> {
    u16::try_from(port).ok().filter(|p| *p != 0)
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
    // Wider than a port so an out-of-range value reaches `ssh_connect`, which reports it,
    // instead of being rejected while the arguments are deserialized.
    port: i64,
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
    let Some(port) = valid_port(config.port) else {
        return Ok(error_json(format!("Invalid port: {}", config.port)));
    };
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
        port,
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

/// Runs an uploaded script, streaming its output as `tutorial:output` events, until it exits
/// or Stop is pressed. There is no fixed deadline (D17); the optional `run.timeLimitSec`
/// setting, off by default, ends the run after that many seconds.
#[tauri::command]
pub async fn ssh_run_tutorial_script(
    ssh: State<'_, Ssh>,
    settings: State<'_, Settings>,
    filename: String,
) -> CommandResult {
    if !is_safe_script_name(&filename) {
        return Ok(json!({ "error": "Invalid script filename" }));
    }
    let limit = run_time_limit(&settings.get("run.timeLimitSec"));
    Ok(run_script(&ssh, &filename, limit).await)
}

/// A positive number of seconds; anything else means no limit.
fn run_time_limit(setting: &Value) -> Option<Duration> {
    setting
        .as_f64()
        .filter(|secs| *secs > 0.0)
        .and_then(|secs| Duration::try_from_secs_f64(secs).ok())
}

/// Streams a run of `filename` (already checked by `is_safe_script_name`). Closing the
/// channel does not end a remote process that is not writing output, so a run ended by its
/// time limit is also killed on the Pi, as Stop does through `ssh_kill_process`.
pub(crate) async fn run_script(ssh: &Ssh, filename: &str, limit: Option<Duration>) -> Value {
    let result = ssh
        .execute_streaming(&tutorial_run_command(filename), limit)
        .await
        .unwrap_or_else(|e| json!({ "error": e }));
    if result["timedOut"] == true {
        let _ = ssh
            .execute(&tutorial_kill_command(filename), COMMAND_TIMEOUT)
            .await;
    }
    result
}

#[tauri::command]
pub async fn ssh_kill_process(ssh: State<'_, Ssh>, filename: String) -> CommandResult {
    if !is_safe_script_name(&filename) {
        return Ok(json!({ "error": "Invalid script filename" }));
    }
    ssh.kill_tutorial_stream();
    Ok(exec_json(&ssh, &tutorial_kill_command(&filename)).await)
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

/// Connects the telemetry socket to the agent through the SSH session (D18): the agent
/// listens only on the Pi's 127.0.0.1, so the Pi's address is never dialed directly.
#[tauri::command]
pub fn gpio_connect(
    ws: State<'_, Ws>,
    ssh: State<'_, Ssh>,
    auth_token: Option<String>,
) -> CommandResult {
    let route = Route::Tunnel {
        ssh: ssh.inner().clone(),
        port: GPIO_AGENT_PORT,
    };
    ws.connect(route, auth_token.filter(|t| !t.is_empty()));
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

// --- Anthropic key (stored in the Keychain; commands report success or presence only) ---

#[tauri::command]
pub async fn settings_set_anthropic_key(value: String) -> CommandResult {
    Ok(set_anthropic_key(&value, settings::set_secret))
}

#[tauri::command]
pub async fn settings_has_anthropic_key() -> bool {
    has_anthropic_key(settings::get_secret)
}

#[tauri::command]
pub async fn settings_clear_anthropic_key() -> CommandResult {
    Ok(match settings::set_secret(settings::ANTHROPIC_KEY, "") {
        Ok(()) => json!({ "success": true }),
        Err(e) => error_json(e),
    })
}

fn set_anthropic_key(value: &str, store: impl Fn(&str, &str) -> Result<(), String>) -> Value {
    let key = value.trim();
    if key.is_empty() {
        return error_json("Enter an API key".into());
    }
    match store(settings::ANTHROPIC_KEY, key) {
        Ok(()) => json!({ "success": true }),
        Err(e) => error_json(e),
    }
}

fn has_anthropic_key(read: impl Fn(&str) -> Result<String, String>) -> bool {
    read(settings::ANTHROPIC_KEY).is_ok_and(|key| !key.is_empty())
}

// --- System ---

/// Opens an http(s) link in the system browser.
#[tauri::command]
pub fn open_external(url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = open::that_detached(url);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stop_command_does_not_match_its_own_shell() {
        let run = tutorial_run_command("tutorial_1.py");
        let kill = tutorial_kill_command("tutorial_1.py");
        assert!(run.ends_with("python3 -u tutorial_1.py"));
        assert_eq!(
            kill,
            "pkill -f '[pP]ython3? -u [t]utorial_1\\.py' 2>/dev/null; exit 0"
        );
        assert!(
            !kill.contains("tutorial_1.py"),
            "the literal name would match this shell"
        );
    }

    #[test]
    fn a_run_has_no_time_limit_unless_one_is_set() {
        assert_eq!(run_time_limit(&Value::Null), None);
        assert_eq!(run_time_limit(&json!(0)), None);
        assert_eq!(run_time_limit(&json!(-5)), None);
        assert_eq!(run_time_limit(&json!("60")), None);
        assert_eq!(run_time_limit(&json!(1e300)), None);
        assert_eq!(run_time_limit(&json!(90)), Some(Duration::from_secs(90)));
        assert_eq!(
            run_time_limit(&json!(0.5)),
            Some(Duration::from_millis(500))
        );
    }

    #[test]
    fn no_anthropic_key_command_returns_the_key() {
        const KEY: &str = "sk-ant-test-6f1c2a9e-distinctive";
        let stored = std::sync::Mutex::new(String::new());
        let store = |name: &str, value: &str| {
            assert_eq!(name, settings::ANTHROPIC_KEY);
            *stored.lock().unwrap() = value.to_string();
            Ok(())
        };
        let saved = set_anthropic_key(&format!("  {KEY}\n"), store);
        assert_eq!(saved, json!({ "success": true }));
        assert_eq!(*stored.lock().unwrap(), KEY, "stored trimmed");
        assert!(!saved.to_string().contains(KEY));

        let failing = set_anthropic_key(KEY, |_: &str, _: &str| Err("keychain locked".into()));
        assert!(!failing.to_string().contains(KEY));
        assert_eq!(set_anthropic_key("   ", store)["success"], false);

        assert!(has_anthropic_key(|_: &str| Ok(KEY.to_string())));
        assert!(!has_anthropic_key(|_: &str| Ok(String::new())));
        assert!(!has_anthropic_key(|_: &str| Err(KEY.to_string())));

        // settings_get never serves it: it is neither allowlisted nor the password entry.
        assert!(!SETTINGS_ALLOWLIST.contains(&settings::ANTHROPIC_KEY));
        assert_ne!(settings::ANTHROPIC_KEY, settings::PASSWORD_KEY);
    }

    #[test]
    fn ports_must_be_in_range() {
        assert_eq!(valid_port(22), Some(22));
        assert_eq!(valid_port(65535), Some(65535));
        for bad in [0, -1, 65536, i64::MAX, i64::MIN] {
            assert_eq!(valid_port(bad), None, "{bad}");
        }
    }

    #[test]
    fn only_plain_python_filenames_are_allowed() {
        for ok in ["tutorial_1.py", "a-b_c.py", "X9.py"] {
            assert!(is_safe_script_name(ok), "{ok}");
        }
        for bad in [
            "", ".py", "a.sh", "a.py.sh", "../a.py", "a/b.py", "a b.py", "a;rm.py", "a$(x).py",
            "a.py\n",
        ] {
            assert!(!is_safe_script_name(bad), "{bad:?}");
        }
    }
}
