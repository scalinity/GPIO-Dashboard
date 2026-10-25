//! Commands invoked by the renderer through `window.api` (src/renderer/src/api.js).
//!
//! Like the IPC handlers they replace, these report failures in the returned JSON
//! (`{ success: false, error }`) rather than rejecting, which the renderer relies on.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager, State,
};
use tauri_plugin_dialog::DialogExt;

use crate::{
    agent,
    anthropic::{Anthropic, KeyProvider, ProxyEvent, ProxyRequest},
    i2c,
    projects::{self, Projects},
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
/// have passed `is_safe_script_name`. With the agent's directory, the script runs with its venv's
/// Python when there is one (`agent::python_in`), which is where install.sh puts rpi-lgpio on a
/// system whose apt has no Pi 5 backend for RPi.GPIO and gpiozero.
pub(crate) fn tutorial_run_command(filename: &str, agent_dir: Option<&str>) -> String {
    let python = agent_dir.map_or_else(|| "python3".to_string(), agent::python_in);
    format!("mkdir -p {TUTORIAL_DIR} && cd {TUTORIAL_DIR} && {python} -u {filename}")
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
        .execute_streaming(
            &tutorial_run_command(filename, agent::remote_dir(ssh).ok().as_deref()),
            limit,
        )
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

/// Returns the given GPIOs to inputs with no pull, after Stop: a killed script never reaches its
/// own cleanup, so an output it left driven (a motor driver's input, a relay) would stay on.
/// Only user GPIOs 2-27 are accepted; 0 and 1 are the HAT ID EEPROM.
/// Board Sense settings from the Board tab: user GPIOs 2-27 only (0 and 1 are the HAT ID
/// EEPROM), with the settle time and sweep period kept to sensible bounds.
fn sense_config(pins: &[u8], settle_us: u32, period_ms: u32) -> Option<Value> {
    if pins.is_empty() || pins.iter().any(|p| !(2..=27).contains(p)) {
        return None;
    }
    Some(json!({
        "pins": pins,
        "settleUs": settle_us.clamp(10, 10_000),
        "periodMs": period_ms.clamp(50, 60_000),
    }))
}

fn sent(result: Result<(), String>) -> Value {
    match result {
        Ok(()) => json!({ "success": true }),
        Err(e) => error_json(e),
    }
}

/// Starts Board Sense (SPEC 14.5). Only the Board tab's sensing toggle calls this; the agent
/// changes nothing but the bias of input lines.
#[tauri::command]
pub async fn sense_start(
    ws: State<'_, Ws>,
    pins: Vec<u8>,
    settle_us: u32,
    period_ms: u32,
) -> CommandResult {
    Ok(match sense_config(&pins, settle_us, period_ms) {
        Some(config) => sent(ws.send(&json!({ "type": "sense_start", "config": config }))),
        None => json!({ "error": "Invalid GPIO list" }),
    })
}

#[tauri::command]
pub async fn sense_stop(ws: State<'_, Ws>) -> CommandResult {
    Ok(sent(ws.send(&json!({ "type": "sense_stop" }))))
}

/// Pauses Board Sense before a run and reports whether the agent confirmed, within a second,
/// that every line is released. A run must not start without that confirmation.
#[tauri::command]
pub async fn sense_pause(ws: State<'_, Ws>) -> CommandResult {
    Ok(match ws.pause_sensing().await {
        Ok(paused) => json!({ "paused": paused }),
        Err(e) => error_json(e),
    })
}

#[tauri::command]
pub async fn sense_resume(ws: State<'_, Ws>) -> CommandResult {
    Ok(sent(ws.send(&json!({ "type": "sense_resume" }))))
}

#[tauri::command]
pub async fn ssh_gpio_cleanup(ssh: State<'_, Ssh>, pins: Vec<u8>) -> CommandResult {
    match gpio_cleanup_command(&pins) {
        Some(cmd) => Ok(exec_json(&ssh, &cmd).await),
        None => Ok(json!({ "error": "Invalid GPIO list" })),
    }
}

/// `pinctrl set <pins> ip pn`: input, no pull. None for an empty list or a pin outside 2-27.
fn gpio_cleanup_command(pins: &[u8]) -> Option<String> {
    if pins.is_empty() || pins.iter().any(|p| !(2..=27).contains(p)) {
        return None;
    }
    let list: Vec<String> = pins.iter().map(u8::to_string).collect();
    Some(format!("pinctrl set {} ip pn", list.join(",")))
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

/// Lists the devices that answer on an I2C bus (`i2cdetect -y <bus>` on the Pi).
#[tauri::command]
pub async fn ssh_i2c_scan(ssh: State<'_, Ssh>, bus: i64) -> CommandResult {
    Ok(i2c_scan(&ssh, bus).await)
}

pub(crate) async fn i2c_scan(ssh: &Ssh, bus: i64) -> Value {
    let command = u8::try_from(bus)
        .map_err(|_| format!("Invalid I2C bus {bus}"))
        .and_then(i2c::i2cdetect_command);
    let command = match command {
        Ok(command) => command,
        Err(e) => return error_json(e),
    };
    let out = match ssh.execute(&command, COMMAND_TIMEOUT).await {
        Ok(out) => out,
        Err(e) => return error_json(e),
    };
    let text = if out.code == Some(0) {
        out.stdout
    } else {
        format!("{}{}", out.stdout, out.stderr)
    };
    match i2c::parse_i2cdetect(&text) {
        Ok(devices) => json!({ "success": true, "devices": devices }),
        Err(e) => error_json(e),
    }
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

/// The app's key provider for the proxy: the Keychain entry, read per request.
pub struct KeychainKey;

impl KeyProvider for KeychainKey {
    fn key(&self) -> Result<String, String> {
        settings::get_secret(settings::ANTHROPIC_KEY)
    }
}

// --- Anthropic API proxy (the key is added in Rust; SPEC 4.2, 12.1) ---

/// Streams one API request. The channel receives, in order: `{ status, headers }`, the body
/// as raw byte chunks (ArrayBuffers in JavaScript), then `{ end: true }` or
/// `{ error: { code, message } }`.
#[tauri::command]
pub async fn anthropic_request(
    anthropic: State<'_, Anthropic>,
    req: ProxyRequest,
    channel: Channel<InvokeResponseBody>,
) -> CommandResult {
    anthropic
        .request(req, |event| channel.send(proxy_message(event)).is_ok())
        .await;
    Ok(Value::Null)
}

#[tauri::command]
pub fn anthropic_abort(anthropic: State<'_, Anthropic>, id: String) -> bool {
    anthropic.abort(&id)
}

fn proxy_message(event: ProxyEvent) -> InvokeResponseBody {
    let json = match event {
        ProxyEvent::Chunk(bytes) => return InvokeResponseBody::Raw(bytes),
        ProxyEvent::Head { status, headers } => json!({ "status": status, "headers": headers }),
        ProxyEvent::End => json!({ "end": true }),
        ProxyEvent::Error { code, message } => {
            json!({ "error": { "code": code, "message": message } })
        }
    };
    InvokeResponseBody::Json(json.to_string())
}

// --- Projects ---

fn result_json(result: Result<Value, String>) -> Value {
    result.unwrap_or_else(error_json)
}

#[tauri::command]
pub fn projects_list(projects: State<'_, Projects>) -> CommandResult {
    Ok(result_json(
        projects
            .list()
            .map(|list| json!({ "success": true, "projects": list })),
    ))
}

#[tauri::command]
pub fn projects_read(projects: State<'_, Projects>, id: String) -> CommandResult {
    Ok(result_json(
        projects
            .read(&id)
            .map(|doc| json!({ "success": true, "doc": doc })),
    ))
}

#[tauri::command]
pub fn projects_write(projects: State<'_, Projects>, id: String, doc: Value) -> CommandResult {
    Ok(result_json(
        projects
            .write(&id, &doc)
            .map(|()| json!({ "success": true })),
    ))
}

/// Saves the Claude panel's transcript beside project `id` (SPEC 11.9).
#[tauri::command]
pub fn projects_write_transcript(
    projects: State<'_, Projects>,
    id: String,
    transcript: Value,
) -> CommandResult {
    Ok(result_json(
        projects
            .write_transcript(&id, &transcript)
            .map(|()| json!({ "success": true })),
    ))
}

#[tauri::command]
pub fn projects_delete(projects: State<'_, Projects>, id: String) -> CommandResult {
    Ok(result_json(
        projects.delete(&id).map(|()| json!({ "success": true })),
    ))
}

/// Saves a project anywhere the user picks, through the native save dialog.
#[tauri::command]
pub async fn projects_export(app: AppHandle, doc: Value) -> CommandResult {
    if let Err(e) = projects::validate_doc(&doc) {
        return Ok(error_json(e));
    }
    let name = export_file_name(doc["meta"]["name"].as_str().unwrap_or(""));
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Export Project")
        .add_filter("Breadboard project", &["gpiob"])
        .set_file_name(name)
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let path = rx
        .await
        .ok()
        .flatten()
        .and_then(|picked| picked.into_path().ok());
    Ok(match path {
        None => json!({ "canceled": true }),
        Some(path) => result_json(
            projects::write_doc_file(&path, &doc)
                .map(|()| json!({ "success": true, "path": path.display().to_string() })),
        ),
    })
}

/// Reads a project file the user picks, through the native open dialog.
#[tauri::command]
pub async fn projects_import(app: AppHandle) -> CommandResult {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Import Project")
        .add_filter("Breadboard project", &["gpiob"])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let path = rx
        .await
        .ok()
        .flatten()
        .and_then(|picked| picked.into_path().ok());
    Ok(match path {
        None => json!({ "canceled": true }),
        Some(path) => result_json(
            projects::read_doc_file(&path).map(|doc| json!({ "success": true, "doc": doc })),
        ),
    })
}

/// A file name for an exported project: the project name, kept to safe characters.
fn export_file_name(name: &str) -> String {
    let stem: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(80)
        .collect();
    format!("{}.gpiob", if stem.is_empty() { "project" } else { &stem })
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
    fn sense_config_accepts_only_user_gpios_and_bounds_its_timing() {
        assert_eq!(
            sense_config(&[17, 27], 1, 1_000_000),
            Some(json!({ "pins": [17, 27], "settleUs": 10, "periodMs": 60_000 }))
        );
        assert_eq!(sense_config(&[], 100, 250), None);
        assert_eq!(sense_config(&[0, 17], 100, 250), None);
        assert_eq!(sense_config(&[28], 100, 250), None);
    }

    #[test]
    fn gpio_cleanup_sets_only_user_gpios_to_unpulled_inputs() {
        assert_eq!(
            gpio_cleanup_command(&[17, 27]).as_deref(),
            Some("pinctrl set 17,27 ip pn")
        );
        assert_eq!(gpio_cleanup_command(&[]), None);
        assert_eq!(gpio_cleanup_command(&[1, 17]), None);
        assert_eq!(gpio_cleanup_command(&[28]), None);
    }

    #[test]
    fn the_stop_command_does_not_match_its_own_shell() {
        let run = tutorial_run_command("tutorial_1.py", None);
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
    fn proxy_events_become_json_messages_and_raw_chunks() {
        let json = |event| match proxy_message(event) {
            InvokeResponseBody::Json(text) => serde_json::from_str::<Value>(&text).unwrap(),
            InvokeResponseBody::Raw(_) => panic!("expected JSON"),
        };
        assert_eq!(
            json(ProxyEvent::Head {
                status: 200,
                headers: vec![("request-id".into(), "req_1".into())]
            }),
            json!({ "status": 200, "headers": [["request-id", "req_1"]] })
        );
        assert_eq!(json(ProxyEvent::End), json!({ "end": true }));
        assert_eq!(
            json(ProxyEvent::Error {
                code: "aborted".into(),
                message: "Request aborted".into()
            }),
            json!({ "error": { "code": "aborted", "message": "Request aborted" } })
        );
        match proxy_message(ProxyEvent::Chunk(b"data: x\n".to_vec())) {
            InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, b"data: x\n"),
            InvokeResponseBody::Json(_) => panic!("chunks travel as raw bytes"),
        }
    }

    #[test]
    fn export_names_keep_safe_characters_only() {
        assert_eq!(export_file_name("Blinking LED"), "Blinking LED.gpiob");
        assert_eq!(export_file_name("a/b:c"), "a_b_c.gpiob");
        assert_eq!(export_file_name("  "), "project.gpiob");
        assert_eq!(export_file_name(""), "project.gpiob");
        assert_eq!(
            export_file_name(&"x".repeat(200)).len(),
            80 + ".gpiob".len()
        );
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
