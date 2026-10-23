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

/// Whether a raw frame is a `gpio_state` message, without parsing it. The agent uses
/// Python's default JSON separators, so there is a space after the colon; the compact
/// form is accepted too.
fn is_gpio_state(raw: &str) -> bool {
    raw.starts_with(r#"{"type": "gpio_state""#) || raw.starts_with(r#"{"type":"gpio_state""#)
}

/// Relays an agent message to the renderer. Unchanged `gpio_state` frames are dropped
/// before parsing, since the agent resends the full pin state on every poll.
fn forward(emit: &Emit, raw: &str, previous_gpio_state: &mut Option<String>) {
    if is_gpio_state(raw) {
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use futures_util::{SinkExt, StreamExt};
    use serde_json::json;
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    use super::*;
    use crate::test_support::{capture, run, wait_for};

    #[test]
    fn forwards_each_message_type_and_ignores_the_rest() {
        let (emit, events) = capture();
        let mut previous = None;
        for raw in [
            r#"{"type":"gpio_state","pins":{"17":1}}"#,
            r#"{"type":"gpio_state","data":{"fallback":true}}"#,
            r#"{"type":"system_info","data":{"cpu":12}}"#,
            r#"{"type":"output","data":"hello"}"#,
            r#"{"type":"agent_status","data":{"status":"running"}}"#,
            r#"{"type":"unknown","data":1}"#,
            "not json",
        ] {
            forward(&emit, raw, &mut previous);
        }
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                ("gpio:state".to_string(), json!({"17": 1})),
                ("gpio:state".to_string(), json!({"fallback": true})),
                ("gpio:system-info".to_string(), json!({"cpu": 12})),
                ("agent:log".to_string(), json!("hello")),
                ("agent:status".to_string(), json!({"status": "running"})),
            ]
        );
    }

    #[test]
    fn identical_consecutive_gpio_frames_are_dropped() {
        let (emit, events) = capture();
        let mut previous = None;
        // The agent serializes with Python's default separators (a space after the
        // colon); the compact form is accepted as well.
        for (a, b) in [
            (
                r#"{"type": "gpio_state", "pins": {"17": 1}}"#,
                r#"{"type": "gpio_state", "pins": {"17": 0}}"#,
            ),
            (
                r#"{"type":"gpio_state","pins":{"17":1}}"#,
                r#"{"type":"gpio_state","pins":{"17":0}}"#,
            ),
        ] {
            events.lock().unwrap().clear();
            previous = None;
            for raw in [a, a, b, b, a] {
                forward(&emit, raw, &mut previous);
            }
            assert_eq!(events.lock().unwrap().len(), 3, "{a}");
        }
    }

    #[test]
    fn authenticates_reconnects_and_stops_after_disconnect() {
        run(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let (emit, events) = capture();
            let ws = Ws::new(emit);
            ws.connect("127.0.0.1".into(), port, Some("tok123".into()));

            let (stream, _) = listener.accept().await.unwrap();
            let mut conn = accept_async(stream).await.unwrap();
            let auth = conn.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(auth.as_str()).unwrap(),
                json!({"type": "auth", "token": "tok123"})
            );
            conn.send(Message::text(r#"{"type":"output","data":"hi"}"#))
                .await
                .unwrap();
            wait_for("a forwarded event", || !events.lock().unwrap().is_empty()).await;

            // The server drops the connection; the client reconnects and re-authenticates.
            drop(conn);
            let (stream, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
                .await
                .expect("client reconnects")
                .unwrap();
            let mut conn = accept_async(stream).await.unwrap();
            let again = conn.next().await.unwrap().unwrap().into_text().unwrap();
            assert!(again.as_str().contains("tok123"));

            // After disconnect() it must stay away.
            ws.disconnect();
            drop(conn);
            assert!(
                tokio::time::timeout(Duration::from_secs(3), listener.accept())
                    .await
                    .is_err(),
                "client reconnected after disconnect()"
            );
        });
    }
}
