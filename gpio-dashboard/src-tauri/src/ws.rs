//! WebSocket client for the Pi agent's GPIO feed, with automatic reconnect.

use std::{sync::Mutex, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::Emit;

const MAX_RECONNECT_DELAY_MS: u64 = 30_000;
const MAX_RECONNECT_ATTEMPTS: u32 = 10;

pub struct Ws {
    emit: Emit,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Ws {
    pub fn new(emit: Emit) -> Self {
        Self {
            emit,
            task: Mutex::new(None),
        }
    }

    pub fn connect(&self, host: String, port: u16, auth_token: Option<String>) {
        let mut task = self.task.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = task.take() {
            previous.abort();
        }
        *task = Some(tauri::async_runtime::spawn(run(
            self.emit.clone(),
            host,
            port,
            auth_token,
        )));
    }

    pub fn disconnect(&self) {
        if let Some(task) = self.task.lock().unwrap_or_else(|e| e.into_inner()).take() {
            task.abort();
        }
    }
}

async fn run(emit: Emit, host: String, port: u16, auth_token: Option<String>) {
    let url = format!("ws://{host}:{port}");
    let mut attempts: u32 = 0;
    let mut previous_gpio_state: Option<String> = None;

    loop {
        match connect_async(url.as_str()).await {
            Ok((mut stream, _)) => {
                attempts = 0;
                if let Some(token) = &auth_token {
                    let auth = json!({ "type": "auth", "token": token }).to_string();
                    let _ = stream.send(Message::text(auth)).await;
                }
                while let Some(Ok(message)) = stream.next().await {
                    if let Message::Text(raw) = message {
                        forward(&emit, raw.as_str(), &mut previous_gpio_state);
                    }
                }
            }
            Err(e) => eprintln!("[WSClient] WebSocket error: {e}"),
        }

        if attempts >= MAX_RECONNECT_ATTEMPTS {
            return;
        }
        let delay = (1000u64 << attempts).min(MAX_RECONNECT_DELAY_MS);
        attempts += 1;
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
}

/// Relays an agent message to the renderer. Unchanged `gpio_state` frames are dropped
/// before parsing, since the agent resends the full pin state on every poll.
fn forward(emit: &Emit, raw: &str, previous_gpio_state: &mut Option<String>) {
    if raw.starts_with(r#"{"type":"gpio_state""#) {
        if previous_gpio_state.as_deref() == Some(raw) {
            return;
        }
        *previous_gpio_state = Some(raw.to_string());
    }
    let Ok(msg) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    let data = msg.get("data").cloned().unwrap_or(Value::Null);
    match msg.get("type").and_then(Value::as_str) {
        Some("gpio_state") => {
            let pins = msg
                .get("pins")
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or(data);
            emit("gpio:state", pins);
        }
        Some("system_info") => emit("gpio:system-info", data),
        Some("output") => emit("agent:log", data),
        Some("agent_status") => emit("agent:status", data),
        _ => {}
    }
}
