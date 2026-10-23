//! SSH connection manager: one authenticated connection with exec, streaming exec,
//! interactive shells, file upload and automatic reconnect.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use russh::{
    client::{self, DisconnectReason, Handle},
    keys::{self, PrivateKeyWithHashAlg, PublicKeyOrCertificate},
    ChannelMsg, Disconnect,
};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Notify};

use crate::Emit;

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(10);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
const KEEPALIVE_MAX: usize = 3;
const MAX_RECONNECT_DELAY_MS: u64 = 30_000;
const MAX_RECONNECT_ATTEMPTS: u32 = 10;

#[derive(Clone)]
pub enum Auth {
    Password(String),
    Key {
        pem: String,
        passphrase: Option<String>,
    },
}

#[derive(Clone)]
pub struct Target {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: Auth,
}

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i64>,
}

struct ConnectError {
    message: String,
    is_auth: bool,
}

impl ConnectError {
    fn other(message: impl ToString) -> Self {
        Self {
            message: message.to_string(),
            is_auth: false,
        }
    }
}

/// russh calls `disconnected` when the session ends; the generation lets the manager
/// ignore signals from connections it has already replaced.
struct ClientHandler {
    generation: u64,
    closed: mpsc::UnboundedSender<(u64, Option<String>)>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    // Host keys are accepted as presented; there is no known_hosts check.
    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn disconnected(
        &mut self,
        reason: DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        match reason {
            DisconnectReason::ReceivedDisconnect(_) => {
                let _ = self.closed.send((self.generation, None));
                Ok(())
            }
            DisconnectReason::Error(e) => {
                let _ = self.closed.send((self.generation, Some(e.to_string())));
                Err(e)
            }
        }
    }
}

enum ShellInput {
    Data(Vec<u8>),
    Resize(u32, u32),
}

struct Shell {
    token: u64,
    input: mpsc::UnboundedSender<ShellInput>,
}

#[derive(Default)]
struct State {
    status: &'static str,
    generation: u64,
    handle: Option<Arc<Handle<ClientHandler>>>,
    target: Option<Target>,
    shells: HashMap<String, Shell>,
    next_shell_token: u64,
    tutorial_kill: Option<Arc<Notify>>,
    should_reconnect: bool,
    reconnect_attempts: u32,
    reconnect_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

struct Shared {
    emit: Emit,
    closed_tx: mpsc::UnboundedSender<(u64, Option<String>)>,
    state: Mutex<State>,
}

#[derive(Clone)]
pub struct Ssh(Arc<Shared>);

/// Decodes a byte stream into UTF-8 text, holding back an incomplete trailing
/// character until the rest of it arrives in the next chunk.
#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    return out;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(&String::from_utf8_lossy(&self.pending[..valid]));
                    match e.error_len() {
                        Some(invalid) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + invalid);
                        }
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                    }
                }
            }
        }
    }
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

fn error_text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl Ssh {
    pub fn new(emit: Emit) -> Self {
        let (closed_tx, mut closed_rx) = mpsc::unbounded_channel::<(u64, Option<String>)>();
        let ssh = Ssh(Arc::new(Shared {
            emit,
            closed_tx,
            state: Mutex::new(State {
                status: "disconnected",
                ..State::default()
            }),
        }));
        let this = ssh.clone();
        tauri::async_runtime::spawn(async move {
            while let Some((generation, error)) = closed_rx.recv().await {
                this.on_closed(generation, error);
            }
        });
        ssh
    }

    fn st(&self) -> MutexGuard<'_, State> {
        self.0.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set_status(&self, status: &'static str, error: Option<String>) {
        self.st().status = status;
        (self.0.emit)(
            "ssh:status-change",
            json!({ "status": status, "error": error }),
        );
    }

    pub fn status(&self) -> &'static str {
        self.st().status
    }

    pub fn username(&self) -> Option<String> {
        self.st().target.as_ref().map(|t| t.username.clone())
    }

    pub async fn connect(&self, target: Target) -> Result<(), String> {
        let old = self.teardown();
        drop(old);
        self.st().target = Some(target);
        self.set_status("connecting", None);
        self.attempt().await
    }

    /// Closes the current connection, if any, and invalidates its generation.
    fn teardown(&self) -> Option<Arc<Handle<ClientHandler>>> {
        let mut s = self.st();
        s.generation += 1;
        if let Some(task) = s.reconnect_task.take() {
            task.abort();
        }
        s.tutorial_kill = None;
        s.shells.clear();
        s.handle.take()
    }

    async fn attempt(&self) -> Result<(), String> {
        let (target, generation) = {
            let mut s = self.st();
            s.generation += 1;
            match s.target.clone() {
                Some(t) => (t, s.generation),
                None => return Err("No connection target".into()),
            }
        };

        let dialed =
            match tokio::time::timeout(CONNECTION_TIMEOUT, self.dial(&target, generation)).await {
                Ok(result) => result,
                Err(_) => Err(ConnectError::other("Connection timeout")),
            };

        match dialed {
            Ok(handle) => {
                let handle = Arc::new(handle);
                {
                    let mut s = self.st();
                    if s.generation != generation {
                        return Err("Connection superseded".into());
                    }
                    s.handle = Some(handle.clone());
                    s.reconnect_attempts = 0;
                    s.should_reconnect = true;
                }
                self.set_status("connected", None);
                if handle.is_closed() {
                    self.on_closed(generation, Some("Connection closed".into()));
                }
                Ok(())
            }
            Err(e) => {
                let reconnect = {
                    let mut s = self.st();
                    if s.generation != generation {
                        return Err(e.message);
                    }
                    if e.is_auth {
                        s.should_reconnect = false;
                    }
                    !e.is_auth && s.should_reconnect
                };
                self.set_status("error", Some(e.message.clone()));
                if reconnect {
                    self.schedule_reconnect();
                }
                Err(e.message)
            }
        }
    }

    async fn dial(
        &self,
        target: &Target,
        generation: u64,
    ) -> Result<Handle<ClientHandler>, ConnectError> {
        let key = match &target.auth {
            Auth::Key { pem, passphrase } => Some(Arc::new(
                keys::decode_secret_key(pem, passphrase.as_deref())
                    .map_err(|e| ConnectError::other(format!("Cannot parse private key: {e}")))?,
            )),
            Auth::Password(_) => None,
        };

        let config = Arc::new(client::Config {
            keepalive_interval: Some(KEEPALIVE_INTERVAL),
            keepalive_max: KEEPALIVE_MAX,
            ..Default::default()
        });
        let handler = ClientHandler {
            generation,
            closed: self.0.closed_tx.clone(),
        };
        let mut handle = client::connect(config, (target.host.as_str(), target.port), handler)
            .await
            .map_err(ConnectError::other)?;

        let authenticated = match (key, &target.auth) {
            (Some(key), _) => {
                let hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(ConnectError::other)?
                    .flatten();
                handle
                    .authenticate_publickey(
                        target.username.as_str(),
                        PrivateKeyWithHashAlg::new(key, hash),
                    )
                    .await
                    .map_err(ConnectError::other)?
                    .success()
            }
            (None, Auth::Password(password)) => handle
                .authenticate_password(target.username.as_str(), password.as_str())
                .await
                .map_err(ConnectError::other)?
                .success(),
            (None, Auth::Key { .. }) => unreachable!("key auth always decodes a key"),
        };

        if authenticated {
            Ok(handle)
        } else {
            Err(ConnectError {
                message: "All configured authentication methods failed".into(),
                is_auth: true,
            })
        }
    }

    fn on_closed(&self, generation: u64, error: Option<String>) {
        let reconnect = {
            let mut s = self.st();
            if s.generation != generation || s.handle.is_none() {
                return;
            }
            s.handle = None;
            s.shells.clear();
            s.tutorial_kill = None;
            s.should_reconnect
        };
        match error {
            Some(message) => self.set_status("error", Some(message)),
            None => self.set_status("disconnected", None),
        }
        if reconnect {
            self.schedule_reconnect();
        }
    }

    fn schedule_reconnect(&self) {
        let delay_ms = {
            let mut s = self.st();
            if let Some(task) = s.reconnect_task.take() {
                task.abort();
            }
            if s.reconnect_attempts >= MAX_RECONNECT_ATTEMPTS {
                s.should_reconnect = false;
                drop(s);
                self.set_status("error", Some("Max reconnect attempts exceeded".into()));
                return;
            }
            let delay = (1000u64 << s.reconnect_attempts).min(MAX_RECONNECT_DELAY_MS);
            s.reconnect_attempts += 1;
            delay
        };
        self.set_status("connecting", None);

        let this = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            let proceed = {
                let s = this.st();
                s.should_reconnect && s.target.is_some()
            };
            if proceed {
                let _ = this.attempt().await;
            }
        });
        self.st().reconnect_task = Some(task);
    }

    pub async fn disconnect(&self) {
        self.st().should_reconnect = false;
        let handle = self.teardown();
        if let Some(handle) = handle {
            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
        self.set_status("disconnected", None);
    }

    fn connected_handle(&self) -> Result<Arc<Handle<ClientHandler>>, String> {
        let s = self.st();
        match (&s.handle, s.status) {
            (Some(handle), "connected") => Ok(handle.clone()),
            _ => Err("Not connected".into()),
        }
    }

    pub async fn execute(&self, cmd: &str, timeout: Duration) -> Result<ExecOutput, String> {
        let handle = self.connected_handle()?;
        let run = async {
            let mut channel = handle.channel_open_session().await.map_err(error_text)?;
            channel.exec(true, cmd).await.map_err(error_text)?;
            let (mut stdout, mut stderr, mut code) = (Vec::new(), Vec::new(), None);
            while let Some(msg) = channel.wait().await {
                match msg {
                    ChannelMsg::Data { data } => stdout.extend_from_slice(&data[..]),
                    ChannelMsg::ExtendedData { data, ext: 1 } => {
                        stderr.extend_from_slice(&data[..])
                    }
                    ChannelMsg::ExitStatus { exit_status } => code = Some(i64::from(exit_status)),
                    _ => {}
                }
            }
            Ok(ExecOutput {
                stdout: String::from_utf8_lossy(&stdout).into_owned(),
                stderr: String::from_utf8_lossy(&stderr).into_owned(),
                code,
            })
        };
        tokio::time::timeout(timeout, run)
            .await
            .map_err(|_| format!("Command timed out after {}ms", timeout.as_millis()))?
    }

    /// Runs `cmd`, forwarding its output to the renderer as it arrives.
    /// Resolves to `{ code }`, or `{ code: -1, timedOut: true }` on timeout.
    pub async fn execute_streaming(&self, cmd: &str, timeout: Duration) -> Result<Value, String> {
        let handle = self.connected_handle()?;
        let mut channel = handle.channel_open_session().await.map_err(error_text)?;
        channel.exec(true, cmd).await.map_err(error_text)?;

        let kill = Arc::new(Notify::new());
        self.st().tutorial_kill = Some(kill.clone());

        let killed = kill.notified();
        let deadline = tokio::time::sleep(timeout);
        tokio::pin!(killed, deadline);

        let (mut out_text, mut err_text) = (Utf8Stream::default(), Utf8Stream::default());
        let mut code = None;
        let mut timed_out = false;
        loop {
            tokio::select! {
                msg = channel.wait() => match msg {
                    None => break,
                    Some(ChannelMsg::Data { data }) => {
                        self.emit_tutorial_output("stdout", out_text.push(&data[..]));
                    }
                    Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                        self.emit_tutorial_output("stderr", err_text.push(&data[..]));
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(i64::from(exit_status)),
                    Some(_) => {}
                },
                _ = &mut killed => {
                    let _ = channel.close().await;
                    break;
                }
                _ = &mut deadline => {
                    let _ = channel.close().await;
                    timed_out = true;
                    break;
                }
            }
        }

        {
            let mut s = self.st();
            if s.tutorial_kill
                .as_ref()
                .is_some_and(|k| Arc::ptr_eq(k, &kill))
            {
                s.tutorial_kill = None;
            }
        }

        Ok(if timed_out {
            json!({ "code": -1, "timedOut": true })
        } else {
            json!({ "code": code })
        })
    }

    fn emit_tutorial_output(&self, stream: &str, data: String) {
        if !data.is_empty() {
            (self.0.emit)("tutorial:output", json!({ "stream": stream, "data": data }));
        }
    }

    pub fn kill_tutorial_stream(&self) {
        if let Some(kill) = self.st().tutorial_kill.take() {
            kill.notify_one();
        }
    }

    /// Writes `data` to `remote_path` by piping it into `cat` on the remote side.
    pub async fn put_bytes(&self, data: Vec<u8>, remote_path: &str) -> Result<(), String> {
        let handle = self.connected_handle()?;
        let upload = async {
            let mut channel = handle.channel_open_session().await.map_err(error_text)?;
            channel
                .exec(true, format!("cat > {}", shell_quote(remote_path)))
                .await
                .map_err(error_text)?;
            channel.data_bytes(data).await.map_err(error_text)?;
            channel.eof().await.map_err(error_text)?;
            let (mut stderr, mut code) = (Vec::new(), None);
            while let Some(msg) = channel.wait().await {
                match msg {
                    ChannelMsg::ExtendedData { data, ext: 1 } => {
                        stderr.extend_from_slice(&data[..])
                    }
                    ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                    _ => {}
                }
            }
            match code {
                Some(0) => Ok(()),
                _ => Err(format!(
                    "Upload failed: {}",
                    String::from_utf8_lossy(&stderr).trim()
                )),
            }
        };
        tokio::time::timeout(Duration::from_secs(30), upload)
            .await
            .map_err(|_| "Upload timed out".to_string())?
    }

    pub async fn create_shell(&self, session_id: &str) -> Result<(), String> {
        let handle = self.connected_handle()?;
        let channel = handle.channel_open_session().await.map_err(error_text)?;
        channel
            .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
            .await
            .map_err(error_text)?;
        channel.request_shell(true).await.map_err(error_text)?;
        let (mut reader, writer) = channel.split();

        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<ShellInput>();
        let token = {
            let mut s = self.st();
            s.next_shell_token += 1;
            let token = s.next_shell_token;
            s.shells.insert(
                session_id.to_string(),
                Shell {
                    token,
                    input: input_tx,
                },
            );
            token
        };

        // Dropping the shell's sender (destroy, disconnect or replacement) ends the
        // writer task, which then closes the channel.
        tauri::async_runtime::spawn(async move {
            while let Some(input) = input_rx.recv().await {
                let sent = match input {
                    ShellInput::Data(bytes) => writer.data_bytes(bytes).await,
                    ShellInput::Resize(cols, rows) => writer.window_change(cols, rows, 0, 0).await,
                };
                if sent.is_err() {
                    break;
                }
            }
            let _ = writer.eof().await;
            let _ = writer.close().await;
        });

        let this = self.clone();
        let event = format!("terminal:data:{session_id}");
        let session_id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            let mut text = Utf8Stream::default();
            while let Some(msg) = reader.wait().await {
                if let ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } = msg {
                    let chunk = text.push(&data[..]);
                    if !chunk.is_empty() {
                        (this.0.emit)(&event, Value::String(chunk));
                    }
                }
            }
            let mut s = this.st();
            if s.shells
                .get(&session_id)
                .is_some_and(|shell| shell.token == token)
            {
                s.shells.remove(&session_id);
            }
        });
        Ok(())
    }

    pub fn write_to_shell(&self, session_id: &str, data: String) {
        if let Some(shell) = self.st().shells.get(session_id) {
            let _ = shell.input.send(ShellInput::Data(data.into_bytes()));
        }
    }

    pub fn resize_shell(&self, session_id: &str, cols: u32, rows: u32) {
        if let Some(shell) = self.st().shells.get(session_id) {
            let _ = shell.input.send(ShellInput::Resize(cols, rows));
        }
    }

    pub fn destroy_shell(&self, session_id: &str) {
        self.st().shells.remove(session_id);
    }
}
