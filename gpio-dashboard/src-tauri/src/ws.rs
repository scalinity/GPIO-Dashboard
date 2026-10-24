//! WebSocket client for the Pi agent: GPIO telemetry in, agent commands out, with
//! automatic reconnect. The agent listens only on the Pi's 127.0.0.1, so the socket runs
//! through an SSH direct-tcpip tunnel rather than over the network (D18).

use std::{sync::Mutex, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    sync::mpsc,
};
use tokio_tungstenite::{client_async, tungstenite::Message, WebSocketStream};

use crate::{ssh::Ssh, Emit};

const MAX_RECONNECT_DELAY_MS: u64 = 30_000;
const MAX_RECONNECT_ATTEMPTS: u32 = 10;

/// How the socket reaches the agent.
pub enum Route {
    /// Through the SSH session to the agent on the Pi's loopback interface.
    Tunnel { ssh: Ssh, port: u16 },
    /// A plain TCP connection, for tests against a local server.
    #[cfg(test)]
    Direct { host: String, port: u16 },
}

trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

impl Route {
    async fn open(&self) -> Result<WebSocketStream<Box<dyn Io>>, String> {
        let (io, url): (Box<dyn Io>, String) = match self {
            Route::Tunnel { ssh, port } => (
                Box::new(ssh.open_tunnel("127.0.0.1", *port).await?),
                format!("ws://127.0.0.1:{port}"),
            ),
            #[cfg(test)]
            Route::Direct { host, port } => (
                Box::new(
                    tokio::net::TcpStream::connect((host.as_str(), *port))
                        .await
                        .map_err(|e| e.to_string())?,
                ),
                format!("ws://{host}:{port}"),
            ),
        };
        let (stream, _) = client_async(url, io).await.map_err(|e| e.to_string())?;
        Ok(stream)
    }
}

struct Connection {
    task: tauri::async_runtime::JoinHandle<()>,
    outbox: mpsc::UnboundedSender<String>,
}

pub struct Ws {
    emit: Emit,
    connection: Mutex<Option<Connection>>,
}

impl Ws {
    pub fn new(emit: Emit) -> Self {
        Self {
            emit,
            connection: Mutex::new(None),
        }
    }

    pub fn connect(&self, route: Route, auth_token: Option<String>) {
        let (outbox, queued) = mpsc::unbounded_channel();
        let task = tauri::async_runtime::spawn(run(self.emit.clone(), route, auth_token, queued));
        let previous = self.lock().replace(Connection { task, outbox });
        if let Some(previous) = previous {
            previous.task.abort();
        }
    }

    pub fn disconnect(&self) {
        if let Some(connection) = self.lock().take() {
            connection.task.abort();
        }
    }

    /// Queues a message for the agent. Messages are delivered in order, once the socket is
    /// (re)connected and authenticated.
    pub fn send(&self, message: &Value) -> Result<(), String> {
        self.lock()
            .as_ref()
            .ok_or("Not connected to the Pi agent")?
            .outbox
            .send(message.to_string())
            .map_err(|_| "The connection to the Pi agent has ended".to_string())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Connection>> {
        self.connection.lock().unwrap_or_else(|e| e.into_inner())
    }
}

async fn run(
    emit: Emit,
    route: Route,
    auth_token: Option<String>,
    mut queued: mpsc::UnboundedReceiver<String>,
) {
    let mut attempts: u32 = 0;
    let mut previous_gpio_state: Option<String> = None;

    loop {
        match route.open().await {
            Ok(mut stream) => {
                attempts = 0;
                if let Some(token) = &auth_token {
                    let auth = json!({ "type": "auth", "token": token }).to_string();
                    let _ = stream.send(Message::text(auth)).await;
                }
                loop {
                    tokio::select! {
                        incoming = stream.next() => match incoming {
                            Some(Ok(Message::Text(raw))) => {
                                forward(&emit, raw.as_str(), &mut previous_gpio_state)
                            }
                            Some(Ok(_)) => {}
                            _ => break,
                        },
                        Some(outgoing) = queued.recv() => {
                            if stream.send(Message::text(outgoing)).await.is_err() {
                                break;
                            }
                        }
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
            let mut previous = None;
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
            ws.connect(
                Route::Direct {
                    host: "127.0.0.1".into(),
                    port,
                },
                Some("tok123".into()),
            );

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

    #[test]
    fn sent_messages_reach_the_agent_in_order_after_auth() {
        run(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let (emit, _) = capture();
            let ws = Ws::new(emit);
            assert!(
                ws.send(&json!({"type": "ping"})).is_err(),
                "no connection yet"
            );

            ws.connect(
                Route::Direct {
                    host: "127.0.0.1".into(),
                    port,
                },
                Some("tok".into()),
            );
            // Queued before the socket is up; delivered after the auth frame.
            ws.send(&json!({"type": "sense_pause"})).unwrap();
            let (stream, _) = listener.accept().await.unwrap();
            let mut conn = accept_async(stream).await.unwrap();
            ws.send(&json!({"type": "sense_resume"})).unwrap();
            let mut frames = Vec::new();
            for _ in 0..3 {
                let text = conn.next().await.unwrap().unwrap().into_text().unwrap();
                frames.push(serde_json::from_str::<Value>(text.as_str()).unwrap()["type"].clone());
            }
            assert_eq!(
                frames,
                vec![json!("auth"), json!("sense_pause"), json!("sense_resume")]
            );

            ws.disconnect();
            assert!(ws.send(&json!({"type": "ping"})).is_err(), "disconnected");
        });
    }
}
