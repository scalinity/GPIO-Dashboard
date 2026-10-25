//! Forwards the webview's Anthropic API calls and adds the API key on the Rust side, so the
//! key never reaches the renderer. Only three endpoints are reachable and only four request
//! headers pass through; responses stream back piece by piece.

use std::{
    collections::HashMap,
    error::Error as _,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use reqwest::{
    header::{HeaderValue, SET_COOKIE},
    Method,
};
use serde::Deserialize;
use tokio::sync::Notify;

const API_BASE: &str = "https://api.anthropic.com";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// The header that carries the key and the text placed before the key in its value.
const AUTH_HEADER: (&str, &str) = ("authorization", "Bearer ");
/// The only headers taken from the webview (lowercase; matched case-insensitively). The
/// workspace id is required with a key that is not scoped to a workspace (ADR-0010).
const FORWARDED_HEADERS: [&str; 4] = [
    "anthropic-version",
    "anthropic-beta",
    "content-type",
    "anthropic-workspace-id",
];
const NO_KEY_MESSAGE: &str = "No Anthropic API key is saved. Add it in Settings.";

/// Supplies the API key. The app's provider reads the macOS Keychain; tests inject one.
pub trait KeyProvider: Send + Sync {
    fn key(&self) -> Result<String, String>; // Ok("") means "no key saved"
}

#[derive(Debug, Deserialize)]
pub struct ProxyRequest {
    /// Caller-chosen request id, used by `abort`.
    pub id: String,
    /// "GET" or "POST".
    pub method: String,
    /// E.g. "/v1/messages"; may include "?query" only for GET /v1/models.
    pub path: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// JSON text, forwarded byte-for-byte.
    #[serde(default)]
    pub body: Option<String>,
}

/// What the proxy reports, in order: `Head`, then zero or more `Chunk`, then exactly one of
/// `End` or `Error`. An `Error` may also come first, with no `Head`, when the request never
/// reached the network.
///
/// Error codes: `forbidden`, `duplicate_id`, `key_unavailable`, `no_api_key`, `bad_request`
/// (a header or URL the HTTP layer rejects), `network` and `aborted`.
#[derive(Debug, Clone, PartialEq)]
pub enum ProxyEvent {
    Head {
        status: u16,
        headers: Vec<(String, String)>,
    },
    Chunk(Vec<u8>),
    End,
    Error {
        code: String,
        message: String,
    },
}

pub struct Anthropic {
    client: reqwest::Client,
    base_url: String,
    key: Arc<dyn KeyProvider>,
    // Notified to abort the request with that id.
    in_flight: Mutex<HashMap<String, Arc<Notify>>>,
}

impl Anthropic {
    pub fn new(key: Arc<dyn KeyProvider>) -> Self {
        Self::build(key, API_BASE.to_string())
    }

    #[cfg(test)]
    fn with_base_url(key: Arc<dyn KeyProvider>, base_url: String) -> Self {
        Self::build(key, base_url)
    }

    fn build(key: Arc<dyn KeyProvider>, base_url: String) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            // A redirect would carry the key to a path the allowlist never approved.
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("gpio-dashboard/", env!("CARGO_PKG_VERSION")))
            .build()
            // Only the TLS backend failing to initialize gets here; no request data is involved.
            .expect("the TLS backend initializes");
        Self {
            client,
            base_url,
            key,
            in_flight: Mutex::new(HashMap::new()),
        }
    }

    /// Runs one request to completion, calling `send` for every event in order. `send` returns
    /// false when the receiver is gone; then the body is no longer read and this returns.
    pub async fn request(&self, req: ProxyRequest, send: impl Fn(ProxyEvent) -> bool + Send) {
        let mut send = send;
        // The terminal event goes out only after the id is free again, so a caller that
        // reacts to it by reusing the id never meets its own finished request.
        if let Some(last) = self.run(req, &mut send).await {
            send(last);
        }
    }

    /// Aborts an in-flight request by id; true if one was found. The aborted request ends
    /// with `Error { code: "aborted", .. }` and never sends `End`.
    pub fn abort(&self, id: &str) -> bool {
        let found = lock(&self.in_flight).remove(id);
        match found {
            Some(abort) => {
                abort.notify_one();
                true
            }
            None => false,
        }
    }

    /// Does the work and returns the terminal event still to be sent, or `None` when the
    /// receiver went away. Head and Chunk events are sent along the way.
    async fn run<F>(&self, req: ProxyRequest, send: &mut F) -> Option<ProxyEvent>
    where
        F: Fn(ProxyEvent) -> bool + Send,
    {
        let Some(method) = route(&req.method, &req.path) else {
            return Some(error(
                "forbidden",
                format!("{} {} is not an allowed request", req.method, req.path),
            ));
        };
        let Some(registration) = self.register(&req.id) else {
            return Some(error(
                "duplicate_id",
                format!("A request with id {} is already in flight", req.id),
            ));
        };
        let auth = match self.auth_header() {
            Ok(auth) => auth,
            Err(event) => return Some(event),
        };

        let mut builder = self
            .client
            .request(method.clone(), format!("{}{}", self.base_url, req.path));
        for (name, value) in &req.headers {
            if let Some(allowed) = FORWARDED_HEADERS
                .iter()
                .find(|allowed| allowed.eq_ignore_ascii_case(name))
            {
                builder = builder.header(*allowed, value.as_str());
            }
        }
        builder = builder.header(AUTH_HEADER.0, auth);
        if let Some(body) = req.body.filter(|_| method == Method::POST) {
            builder = builder.body(body);
        }

        let mut response = tokio::select! {
            biased;
            _ = registration.abort.notified() => return Some(aborted()),
            result = builder.send() => match result {
                Ok(response) => response,
                Err(e) => return Some(failure(&e)),
            },
        };

        let head = ProxyEvent::Head {
            status: response.status().as_u16(),
            headers: response
                .headers()
                .iter()
                .filter(|(name, _)| *name != SET_COOKIE)
                .map(|(name, value)| {
                    (
                        name.as_str().to_string(),
                        String::from_utf8_lossy(value.as_bytes()).into_owned(),
                    )
                })
                .collect(),
        };
        if !send(head) {
            return None;
        }

        loop {
            let next = tokio::select! {
                biased;
                _ = registration.abort.notified() => return Some(aborted()),
                next = response.chunk() => next,
            };
            match next {
                Ok(Some(bytes)) if bytes.is_empty() => {}
                Ok(Some(bytes)) => {
                    if !send(ProxyEvent::Chunk(bytes.to_vec())) {
                        return None;
                    }
                }
                Ok(None) => return Some(ProxyEvent::End),
                Err(e) => return Some(failure(&e)),
            }
        }
    }

    /// Reads the key and builds the authorization header value. The key appears nowhere else.
    fn auth_header(&self) -> Result<HeaderValue, ProxyEvent> {
        let key = self.key.key().map_err(|e| error("key_unavailable", e))?;
        if key.is_empty() {
            return Err(error("no_api_key", NO_KEY_MESSAGE));
        }
        let mut value =
            HeaderValue::from_str(&format!("{}{key}", AUTH_HEADER.1)).map_err(|_| {
                error(
                    "key_unavailable",
                    "The saved API key has characters that cannot be sent in a header.",
                )
            })?;
        value.set_sensitive(true);
        Ok(value)
    }

    /// Claims `id`; `None` when a request with that id is already in flight.
    fn register(&self, id: &str) -> Option<Registration<'_>> {
        let mut in_flight = lock(&self.in_flight);
        if in_flight.contains_key(id) {
            return None;
        }
        let abort = Arc::new(Notify::new());
        in_flight.insert(id.to_string(), abort.clone());
        Some(Registration {
            in_flight: &self.in_flight,
            id: id.to_string(),
            abort,
        })
    }
}

/// An id held in the in-flight map; released when the request ends, however it ends.
struct Registration<'a> {
    in_flight: &'a Mutex<HashMap<String, Arc<Notify>>>,
    id: String,
    abort: Arc<Notify>,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        let mut in_flight = lock(self.in_flight);
        // `abort` may already have removed this entry, and the id may belong to a newer request.
        if in_flight
            .get(&self.id)
            .is_some_and(|current| Arc::ptr_eq(current, &self.abort))
        {
            in_flight.remove(&self.id);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// The only requests that may leave the app: the method to use, or `None` to refuse.
fn route(method: &str, path: &str) -> Option<Method> {
    match (method, path) {
        ("POST", "/v1/messages" | "/v1/messages/count_tokens") => Some(Method::POST),
        ("GET", "/v1/models") => Some(Method::GET),
        ("GET", path) if path.strip_prefix("/v1/models?").is_some_and(is_plain_query) => {
            Some(Method::GET)
        }
        _ => None,
    }
}

/// A non-empty query of printable ASCII, with no fragment marker.
fn is_plain_query(query: &str) -> bool {
    !query.is_empty() && query.bytes().all(|b| b.is_ascii_graphic() && b != b'#')
}

fn error(code: &str, message: impl Into<String>) -> ProxyEvent {
    ProxyEvent::Error {
        code: code.to_string(),
        message: message.into(),
    }
}

fn aborted() -> ProxyEvent {
    error("aborted", "Request aborted")
}

/// A transport failure, with the whole cause chain so "connection refused" or a TLS reason
/// is not lost. The request's headers, and so the key, are not part of any reqwest message.
fn failure(e: &reqwest::Error) -> ProxyEvent {
    let mut message = e.to_string();
    let mut cause = e.source();
    while let Some(inner) = cause {
        message.push_str(": ");
        message.push_str(&inner.to_string());
        cause = inner.source();
    }
    let code = if e.is_builder() {
        "bad_request"
    } else {
        "network"
    };
    error(code, message)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use serde_json::Value;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
    };

    use super::*;
    use crate::test_support::{run, wait_for};

    const TEST_KEY: &str = "sk-ant-api03-DISTINCTIVE-0123456789";

    // ---- a key provider that records how often it is asked ----

    struct TestKey {
        result: Result<String, String>,
        calls: AtomicUsize,
    }

    impl TestKey {
        fn new(result: Result<&str, &str>) -> Arc<Self> {
            Arc::new(Self {
                result: result.map(String::from).map_err(String::from),
                calls: AtomicUsize::new(0),
            })
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl KeyProvider for TestKey {
        fn key(&self) -> Result<String, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.result.clone()
        }
    }

    // ---- a raw-TCP mock of the Anthropic API ----

    #[derive(Clone)]
    enum Step {
        /// Writes these bytes.
        Send(Vec<u8>),
        /// Pauses before the next step.
        Wait(Duration),
        /// Pauses until the test calls `notify_one` on the gate.
        Hold(Arc<Notify>),
        /// Reads until the client closes the connection, then stops.
        UntilClosed,
    }

    /// Runs the same script for every connection and records what it saw.
    struct Mock {
        port: u16,
        connections: Arc<AtomicUsize>,
        requests: Arc<Mutex<Vec<String>>>,
        client_gone: Arc<AtomicBool>,
        accepting: tauri::async_runtime::JoinHandle<()>,
    }

    impl Mock {
        fn url(&self) -> String {
            format!("http://127.0.0.1:{}", self.port)
        }

        /// Connections accepted so far, after a pause long enough for a stray one to show up.
        async fn connections_after_a_pause(&self) -> usize {
            tokio::time::sleep(Duration::from_millis(100)).await;
            self.connections.load(Ordering::SeqCst)
        }

        fn requests(&self) -> Vec<Captured> {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .map(|raw| Captured::parse(raw))
                .collect()
        }

        /// True once a write failed or a read saw the client close: the proxy let go.
        fn client_gone(&self) -> bool {
            self.client_gone.load(Ordering::SeqCst)
        }
    }

    impl Drop for Mock {
        fn drop(&mut self) {
            self.accepting.abort();
        }
    }

    async fn serve(script: Vec<Step>) -> Mock {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let connections = Arc::new(AtomicUsize::new(0));
        let requests: Arc<Mutex<Vec<String>>> = Default::default();
        let client_gone = Arc::new(AtomicBool::new(false));
        let accepting = tauri::async_runtime::spawn({
            let (connections, requests, client_gone) =
                (connections.clone(), requests.clone(), client_gone.clone());
            async move {
                while let Ok((socket, _)) = listener.accept().await {
                    connections.fetch_add(1, Ordering::SeqCst);
                    tauri::async_runtime::spawn(respond(
                        socket,
                        script.clone(),
                        requests.clone(),
                        client_gone.clone(),
                    ));
                }
            }
        });
        Mock {
            port,
            connections,
            requests,
            client_gone,
            accepting,
        }
    }

    async fn respond(
        mut socket: TcpStream,
        script: Vec<Step>,
        requests: Arc<Mutex<Vec<String>>>,
        client_gone: Arc<AtomicBool>,
    ) {
        let Some(raw) = read_request(&mut socket).await else {
            return;
        };
        requests.lock().unwrap().push(raw);
        for step in script {
            match step {
                Step::Send(bytes) => {
                    if socket.write_all(&bytes).await.is_err() {
                        client_gone.store(true, Ordering::SeqCst);
                        return;
                    }
                }
                Step::Wait(pause) => tokio::time::sleep(pause).await,
                Step::Hold(gate) => gate.notified().await,
                Step::UntilClosed => {
                    let mut buf = [0u8; 1024];
                    while matches!(socket.read(&mut buf).await, Ok(n) if n > 0) {}
                    client_gone.store(true, Ordering::SeqCst);
                    return;
                }
            }
        }
    }

    /// Reads one whole request (head plus `content-length` bytes of body).
    async fn read_request(socket: &mut TcpStream) -> Option<String> {
        let mut raw = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = socket.read(&mut buf).await.ok().filter(|&n| n > 0)?;
            raw.extend_from_slice(&buf[..n]);
            let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
                continue;
            };
            let head = String::from_utf8_lossy(&raw[..end]).to_ascii_lowercase();
            let wanted = head
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if raw.len() >= end + 4 + wanted {
                return Some(String::from_utf8_lossy(&raw).into_owned());
            }
        }
    }

    /// A request as the mock received it.
    struct Captured {
        request_line: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    impl Captured {
        fn parse(raw: &str) -> Self {
            let (head, body) = raw.split_once("\r\n\r\n").unwrap();
            let mut lines = head.split("\r\n");
            let request_line = lines.next().unwrap().to_string();
            let headers = lines
                .map(|line| {
                    let (name, value) = line.split_once(':').unwrap();
                    (name.trim().to_ascii_lowercase(), value.trim().to_string())
                })
                .collect();
            Self {
                request_line,
                headers,
                body: body.to_string(),
            }
        }

        fn values(&self, name: &str) -> Vec<&str> {
            self.headers
                .iter()
                .filter(|(n, _)| n == name)
                .map(|(_, v)| v.as_str())
                .collect()
        }
    }

    // ---- canned responses ----

    const STREAM_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
    const CHUNKED_END: &[u8] = b"0\r\n\r\n";

    fn chunk(data: &[u8]) -> Vec<u8> {
        let mut out = format!("{:x}\r\n", data.len()).into_bytes();
        out.extend_from_slice(data);
        out.extend_from_slice(b"\r\n");
        out
    }

    /// A complete response in one write. `Connection: close` keeps the client from reusing
    /// the socket for a later request.
    fn full_response(status_line: &str, extra_headers: &str, body: &[u8]) -> Step {
        let mut out = format!(
            "HTTP/1.1 {status_line}\r\n{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        Step::Send(out)
    }

    fn ok_json(body: &[u8]) -> Step {
        full_response("200 OK", "Content-Type: application/json\r\n", body)
    }

    // ---- driving the proxy the way the app will: spawned, with events collected ----

    fn proxy_for(key: &Arc<TestKey>, mock: &Mock) -> Arc<Anthropic> {
        Arc::new(Anthropic::with_base_url(key.clone(), mock.url()))
    }

    fn request(id: &str, method: &str, path: &str) -> ProxyRequest {
        ProxyRequest {
            id: id.into(),
            method: method.into(),
            path: path.into(),
            headers: vec![],
            body: None,
        }
    }

    fn messages(id: &str) -> ProxyRequest {
        ProxyRequest {
            headers: vec![("content-type".into(), "application/json".into())],
            body: Some("{}".into()),
            ..request(id, "POST", "/v1/messages")
        }
    }

    /// A request in progress; `events` shows what has been reported so far.
    struct Running {
        seen: Arc<Mutex<Vec<ProxyEvent>>>,
        done: tauri::async_runtime::JoinHandle<()>,
    }

    impl Running {
        fn events(&self) -> Vec<ProxyEvent> {
            self.seen.lock().unwrap().clone()
        }

        async fn finish(self) -> Vec<ProxyEvent> {
            let Running { seen, done } = self;
            tokio::time::timeout(Duration::from_secs(10), done)
                .await
                .expect("the request did not finish within 10 s")
                .unwrap();
            let events = seen.lock().unwrap().clone();
            events
        }
    }

    /// Spawns the request (so its future must be `Send`, as the app needs). The receiver
    /// "goes away" by returning false once `accept` events have been recorded.
    fn start_until_gone(proxy: &Arc<Anthropic>, req: ProxyRequest, accept: usize) -> Running {
        let seen: Arc<Mutex<Vec<ProxyEvent>>> = Default::default();
        let sink = seen.clone();
        let proxy = proxy.clone();
        let done = tauri::async_runtime::spawn(async move {
            proxy
                .request(req, move |event| {
                    let mut seen = sink.lock().unwrap();
                    seen.push(event);
                    seen.len() < accept
                })
                .await;
        });
        Running { seen, done }
    }

    fn start(proxy: &Arc<Anthropic>, req: ProxyRequest) -> Running {
        start_until_gone(proxy, req, usize::MAX)
    }

    async fn collect(proxy: &Arc<Anthropic>, req: ProxyRequest) -> Vec<ProxyEvent> {
        start(proxy, req).finish().await
    }

    fn kinds(events: &[ProxyEvent]) -> Vec<&'static str> {
        events
            .iter()
            .map(|event| match event {
                ProxyEvent::Head { .. } => "head",
                ProxyEvent::Chunk(_) => "chunk",
                ProxyEvent::End => "end",
                ProxyEvent::Error { .. } => "error",
            })
            .collect()
    }

    fn body(events: &[ProxyEvent]) -> Vec<u8> {
        events
            .iter()
            .filter_map(|event| match event {
                ProxyEvent::Chunk(bytes) => Some(bytes.as_slice()),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    }

    /// The (code, message) of the final event, which must be an Error.
    fn final_error(events: &[ProxyEvent]) -> (&str, &str) {
        match events.last() {
            Some(ProxyEvent::Error { code, message }) => (code, message),
            other => panic!("expected the last event to be an Error, got {other:?}"),
        }
    }

    /// The (code, message) of a sequence that is exactly one Error.
    fn only_error(events: &[ProxyEvent]) -> (&str, &str) {
        assert_eq!(kinds(events), ["error"], "events: {events:?}");
        final_error(events)
    }

    /// Everything the events say, as text, for searching.
    fn text(events: &[ProxyEvent]) -> String {
        events
            .iter()
            .map(|event| match event {
                ProxyEvent::Head { status, headers } => format!("{status} {headers:?}"),
                ProxyEvent::Chunk(bytes) => String::from_utf8_lossy(bytes).into_owned(),
                ProxyEvent::End => String::new(),
                ProxyEvent::Error { code, message } => format!("{code} {message}"),
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    // ---- the headers and body that reach the server ----

    #[test]
    fn injects_the_key_and_forwards_only_the_allowed_headers() {
        run(async {
            let mock = serve(vec![ok_json(b"{}")]).await;
            let key = TestKey::new(Ok(TEST_KEY));
            let proxy = proxy_for(&key, &mock);
            let mut req = messages("headers");
            req.headers = [
                ("Authorization", "Bearer webview-secret"),
                ("X-API-Key", "webview-secret"),
                ("Anthropic-Version", "2026-10-21"),
                ("ANTHROPIC-BETA", "tools-2026-01-01, other-beta"),
                ("Content-Type", "application/json; charset=utf-8"),
                ("Anthropic-Workspace-Id", "wrkspc_01TEST"),
                ("x-stainless-foo", "bar"),
                ("Cookie", "session=1"),
                ("Host", "evil.example"),
                ("User-Agent", "evil-agent"),
                ("Accept-Encoding", "br"),
            ]
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .to_vec();

            let events = collect(&proxy, req).await;
            assert_eq!(kinds(&events), ["head", "chunk", "end"]);

            let requests = mock.requests();
            let seen = &requests[0];
            assert_eq!(
                seen.values("authorization"),
                [format!("Bearer {TEST_KEY}")],
                "exactly the injected key, once"
            );
            assert_eq!(seen.values("anthropic-version"), ["2026-10-21"]);
            assert_eq!(
                seen.values("anthropic-beta"),
                ["tools-2026-01-01, other-beta"]
            );
            assert_eq!(
                seen.values("content-type"),
                ["application/json; charset=utf-8"]
            );
            assert_eq!(seen.values("anthropic-workspace-id"), ["wrkspc_01TEST"]);
            assert_eq!(seen.values("host"), [format!("127.0.0.1:{}", mock.port)]);
            for header in ["x-api-key", "x-stainless-foo", "cookie", "accept-encoding"] {
                assert!(
                    seen.values(header).is_empty(),
                    "{header} reached the server"
                );
            }
            assert!(!seen.values("user-agent").contains(&"evil-agent"));
            let known = [
                "authorization",
                "anthropic-version",
                "anthropic-beta",
                "content-type",
                "anthropic-workspace-id",
                "content-length",
                "host",
                "user-agent",
                "accept",
            ];
            for (name, _) in &seen.headers {
                assert!(known.contains(&name.as_str()), "unexpected header {name}");
            }
            let raw = mock.requests.lock().unwrap()[0].clone();
            assert!(!raw.contains("webview-secret"));
        });
    }

    #[test]
    fn sends_the_method_path_query_and_body_exactly_as_given() {
        run(async {
            let mock = serve(vec![ok_json(b"{}")]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);

            let odd_body = "{ \"model\" :\"m\",\n  \"text\":\"é✓ \\u00e9\" }";
            let mut count = request("a", "POST", "/v1/messages/count_tokens");
            count.body = Some(odd_body.into());
            collect(&proxy, count).await;

            let mut models = request("b", "GET", "/v1/models?limit=2&after_id=m%20x");
            models.body = Some("ignored".into());
            collect(&proxy, models).await;

            let requests = mock.requests();
            assert_eq!(
                requests[0].request_line,
                "POST /v1/messages/count_tokens HTTP/1.1"
            );
            assert_eq!(requests[0].body, odd_body);
            assert_eq!(
                requests[1].request_line,
                "GET /v1/models?limit=2&after_id=m%20x HTTP/1.1"
            );
            assert_eq!(requests[1].body, "", "a GET carries no body");
        });
    }

    // ---- the allowlist ----

    #[test]
    fn requests_outside_the_allowlist_are_forbidden_without_a_key_lookup_or_connection() {
        run(async {
            let mock = serve(vec![ok_json(b"{}")]).await;
            let key = TestKey::new(Ok(TEST_KEY));
            let proxy = proxy_for(&key, &mock);

            let refused = [
                ("POST", "/v1/messages/../v1/models"),
                ("GET", "/v1/messages/../v1/models"),
                ("POST", "https://evil.example/v1/messages"),
                ("POST", "//evil.example/v1/messages"),
                ("POST", "evil.example/v1/messages"),
                ("GET", "https://api.anthropic.com/v1/models"),
                ("GET", "/v1/messages"),
                ("POST", "/v1/models"),
                ("POST", "/v1/messages?x=1"),
                ("POST", "/v1/messages/count_tokens?x=1"),
                ("POST", "/v1/messages/"),
                ("POST", "/v1/messages/count_tokens/"),
                ("GET", "/v1/messages/count_tokens"),
                ("POST", "/v1/messages/batches"),
                ("POST", "/V1/messages"),
                ("POST", "/v1/messages#frag"),
                ("POST", "/v1/messages "),
                ("POST", "/v1/messages\r\nx-evil: 1"),
                ("POST", "/v1/messages%2f..%2fmodels"),
                ("POST", ""),
                ("POST", "/"),
                ("GET", "/v1/models/"),
                ("GET", "/v1/models/claude-haiku-5-5"),
                ("GET", "//v1/models"),
                ("GET", "v1/models"),
                ("GET", "/v1/models?"),
                ("GET", "/v1/models#frag"),
                ("GET", "/v1/models?a#b"),
                ("GET", "/v1/models?a b"),
                ("GET", "/v1/models?a=1\r\nHost: evil.example"),
                ("GET", "/v1/modelsx"),
                ("GET", "/v1/models/../messages"),
                ("PUT", "/v1/messages"),
                ("DELETE", "/v1/messages"),
                ("PATCH", "/v1/models"),
                ("HEAD", "/v1/models"),
                ("OPTIONS", "/v1/messages"),
                ("CONNECT", "/v1/messages"),
                ("post", "/v1/messages"),
                ("get", "/v1/models"),
                ("", "/v1/messages"),
                ("POST ", "/v1/messages"),
            ];
            for (method, path) in refused {
                let events = collect(&proxy, request("x", method, path)).await;
                let (code, _) = only_error(&events);
                assert_eq!(code, "forbidden", "{method} {path:?}");
            }

            assert_eq!(key.calls(), 0, "the key was read for a forbidden request");
            assert_eq!(mock.connections_after_a_pause().await, 0);

            // The allowed forms still pass.
            for (method, path) in [
                ("POST", "/v1/messages"),
                ("POST", "/v1/messages/count_tokens"),
                ("GET", "/v1/models"),
                ("GET", "/v1/models?limit=20&before_id=abc"),
            ] {
                let events = collect(&proxy, request("ok", method, path)).await;
                assert_eq!(kinds(&events), ["head", "chunk", "end"], "{method} {path}");
            }
        });
    }

    // ---- the response ----

    #[test]
    fn streams_each_piece_as_it_arrives_without_buffering_the_body() {
        run(async {
            let (first, second) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
            let mock = serve(vec![
                Step::Send(STREAM_HEAD.to_vec()),
                Step::Send(chunk(b"alpha ")),
                Step::Hold(first.clone()),
                Step::Send(chunk(b"beta ")),
                Step::Hold(second.clone()),
                Step::Send(chunk(b"gamma")),
                Step::Send(CHUNKED_END.to_vec()),
            ])
            .await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            let running = start(&proxy, messages("stream"));

            // The mock is parked before it writes "beta ", so this piece cannot have come
            // from a buffered whole body.
            wait_for("the first piece", || {
                kinds(&running.events()) == ["head", "chunk"]
            })
            .await;
            first.notify_one();
            wait_for("the second piece", || running.events().len() == 3).await;
            second.notify_one();

            let events = running.finish().await;
            let kinds = kinds(&events);
            assert_eq!(kinds[0], "head");
            assert_eq!(kinds[kinds.len() - 1], "end");
            assert!(kinds[1..kinds.len() - 1].iter().all(|k| *k == "chunk"));
            assert!(kinds.len() >= 5, "expected several chunks, got {kinds:?}");
            assert_eq!(body(&events), b"alpha beta gamma");
        });
    }

    #[test]
    fn a_client_error_response_is_forwarded_whole_not_reported_as_an_error() {
        run(async {
            let error_body =
                br#"{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}"#;
            let mock = serve(vec![full_response(
                "400 Bad Request",
                "Content-Type: application/json\r\n",
                error_body,
            )])
            .await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);

            let events = collect(&proxy, messages("bad")).await;
            let kinds = kinds(&events);
            assert_eq!(kinds[0], "head");
            assert_eq!(kinds[kinds.len() - 1], "end");
            assert!(kinds.len() >= 3 && kinds[1..kinds.len() - 1].iter().all(|k| *k == "chunk"));
            assert!(matches!(&events[0], ProxyEvent::Head { status: 400, .. }));
            assert_eq!(body(&events), error_body);
        });
    }

    #[test]
    fn response_headers_are_lowercased_and_set_cookie_is_dropped() {
        run(async {
            let mock = serve(vec![full_response(
                "200 OK",
                "Request-Id: req_123\r\nX-Mixed-CASE: Value\r\nSet-Cookie: a=1; HttpOnly\r\nSet-Cookie: b=2\r\n",
                b"{}",
            )])
            .await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);

            let events = collect(&proxy, messages("headers")).await;
            let ProxyEvent::Head { status, headers } = &events[0] else {
                panic!("expected Head first, got {events:?}");
            };
            assert_eq!(*status, 200);
            let has =
                |name: &str, value: &str| headers.iter().any(|(n, v)| n == name && v == value);
            assert!(has("request-id", "req_123"));
            assert!(has("x-mixed-case", "Value"));
            assert!(has("content-length", "2"));
            assert!(headers.iter().all(|(n, _)| *n == n.to_ascii_lowercase()));
            assert!(headers.iter().all(|(n, _)| n != "set-cookie"));
        });
    }

    #[test]
    fn a_redirect_is_forwarded_not_followed() {
        run(async {
            let mock = serve(vec![full_response(
                "302 Found",
                "Location: /v1/elsewhere\r\n",
                b"",
            )])
            .await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);

            let events = collect(&proxy, messages("redirect")).await;
            let ProxyEvent::Head { status, headers } = &events[0] else {
                panic!("expected Head first, got {events:?}");
            };
            assert_eq!(*status, 302);
            assert!(headers.contains(&("location".into(), "/v1/elsewhere".into())));
            assert_eq!(events.last(), Some(&ProxyEvent::End));
            assert_eq!(mock.connections_after_a_pause().await, 1);
        });
    }

    // ---- failures ----

    #[test]
    fn a_refused_connection_is_a_network_error() {
        run(async {
            let port = {
                let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                listener.local_addr().unwrap().port()
            };
            let proxy = Arc::new(Anthropic::with_base_url(
                TestKey::new(Ok(TEST_KEY)),
                format!("http://127.0.0.1:{port}"),
            ));

            let events = collect(&proxy, messages("refused")).await;
            let (code, message) = only_error(&events);
            assert_eq!(code, "network");
            assert!(!message.is_empty());
        });
    }

    #[test]
    fn a_body_cut_off_mid_stream_is_a_network_error_without_end() {
        run(async {
            let mock = serve(vec![Step::Send(
                b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\npartial"
                    .to_vec(),
            )])
            .await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);

            let events = collect(&proxy, messages("cut")).await;
            let kinds = kinds(&events);
            assert_eq!(kinds[0], "head");
            assert!(!kinds.contains(&"end"), "events: {events:?}");
            assert_eq!(final_error(&events).0, "network");
            assert_eq!(body(&events), b"partial");
        });
    }

    #[test]
    fn a_header_value_the_http_layer_rejects_is_a_bad_request_without_a_connection() {
        run(async {
            let mock = serve(vec![ok_json(b"{}")]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            let mut req = messages("injection");
            req.headers = vec![(
                "anthropic-version".into(),
                "2026-10-21\r\nx-api-key: stolen".into(),
            )];

            let events = collect(&proxy, req).await;
            assert_eq!(only_error(&events).0, "bad_request");
            assert_eq!(mock.connections_after_a_pause().await, 0);
        });
    }

    #[test]
    fn a_missing_key_is_reported_without_a_connection() {
        run(async {
            let mock = serve(vec![ok_json(b"{}")]).await;
            let key = TestKey::new(Ok(""));
            let proxy = proxy_for(&key, &mock);

            let events = collect(&proxy, messages("nokey")).await;
            assert_eq!(
                only_error(&events),
                (
                    "no_api_key",
                    "No Anthropic API key is saved. Add it in Settings."
                )
            );
            assert_eq!(key.calls(), 1);
            assert_eq!(mock.connections_after_a_pause().await, 0);
        });
    }

    #[test]
    fn a_failing_key_provider_is_reported_without_a_connection() {
        run(async {
            let mock = serve(vec![ok_json(b"{}")]).await;
            let proxy = proxy_for(&TestKey::new(Err("keychain is locked")), &mock);

            let events = collect(&proxy, messages("locked")).await;
            assert_eq!(
                only_error(&events),
                ("key_unavailable", "keychain is locked")
            );
            assert_eq!(mock.connections_after_a_pause().await, 0);
        });
    }

    #[test]
    fn the_key_never_appears_in_any_event() {
        run(async {
            let mut all: Vec<ProxyEvent> = Vec::new();

            // Success, a server error, and a connection cut mid-body.
            let mock = serve(vec![ok_json(b"{\"ok\":true}")]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            all.extend(collect(&proxy, messages("ok")).await);

            let mock = serve(vec![full_response(
                "401 Unauthorized",
                "",
                b"{\"error\":1}",
            )])
            .await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            all.extend(collect(&proxy, messages("401")).await);

            let mock = serve(vec![Step::Send(
                b"HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\nx".to_vec(),
            )])
            .await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            all.extend(collect(&proxy, messages("cut")).await);

            // Refused connection.
            let port = {
                let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                listener.local_addr().unwrap().port()
            };
            let refused = Arc::new(Anthropic::with_base_url(
                TestKey::new(Ok(TEST_KEY)),
                format!("http://127.0.0.1:{port}"),
            ));
            all.extend(collect(&refused, messages("refused")).await);

            // Forbidden, and a header the HTTP layer rejects.
            all.extend(collect(&proxy, request("f", "GET", "/v1/messages")).await);
            let mut bad = messages("bad");
            bad.headers = vec![("anthropic-beta".into(), "a\r\nb".into())];
            all.extend(collect(&proxy, bad).await);

            // Aborted.
            let mock = serve(vec![Step::Send(STREAM_HEAD.to_vec()), Step::UntilClosed]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            let running = start(&proxy, messages("abort"));
            wait_for("the head", || !running.events().is_empty()).await;
            assert!(proxy.abort("abort"));
            all.extend(running.finish().await);

            // A key that cannot be sent in a header (trailing newline from a paste).
            let bad_key = format!("{TEST_KEY}\n");
            let proxy = proxy_for(&TestKey::new(Ok(&bad_key)), &mock);
            let events = collect(&proxy, messages("newline")).await;
            assert_eq!(only_error(&events).0, "key_unavailable");
            all.extend(events);

            // The provider's own failure and an absent key.
            let proxy = proxy_for(&TestKey::new(Err("keychain is locked")), &mock);
            all.extend(collect(&proxy, messages("locked")).await);
            let proxy = proxy_for(&TestKey::new(Ok("")), &mock);
            all.extend(collect(&proxy, messages("none")).await);

            assert!(all.len() > 15, "scenarios produced too few events: {all:?}");
            assert!(
                !text(&all).contains("DISTINCTIVE"),
                "the key leaked into an event"
            );
        });
    }

    // ---- abort, ids and the receiver going away ----

    #[test]
    fn abort_ends_a_stalled_stream_with_aborted_and_no_end() {
        run(async {
            let mock = serve(vec![Step::Send(STREAM_HEAD.to_vec()), Step::UntilClosed]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            let running = start(&proxy, messages("stalled"));
            wait_for("the response head", || kinds(&running.events()) == ["head"]).await;

            assert!(proxy.abort("stalled"));
            assert!(!proxy.abort("stalled"), "an id can be aborted only once");
            assert!(!proxy.abort("never-started"));

            let events = running.finish().await;
            assert_eq!(kinds(&events), ["head", "error"]);
            assert_eq!(final_error(&events), ("aborted", "Request aborted"));
            wait_for("the proxy to drop the connection", || mock.client_gone()).await;
        });
    }

    #[test]
    fn abort_works_while_still_waiting_for_the_response_head() {
        run(async {
            let mock = serve(vec![Step::UntilClosed]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            let running = start(&proxy, messages("silent"));
            wait_for("the request to reach the server", || {
                !mock.requests.lock().unwrap().is_empty()
            })
            .await;

            assert!(proxy.abort("silent"));

            let events = running.finish().await;
            assert_eq!(only_error(&events), ("aborted", "Request aborted"));
            wait_for("the proxy to drop the connection", || mock.client_gone()).await;
        });
    }

    #[test]
    fn a_duplicate_in_flight_id_is_rejected_and_the_first_request_is_untouched() {
        run(async {
            let mock = serve(vec![Step::Send(STREAM_HEAD.to_vec()), Step::UntilClosed]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            let first = start(&proxy, messages("same"));
            wait_for("the first head", || kinds(&first.events()) == ["head"]).await;

            let second = collect(&proxy, messages("same")).await;
            assert_eq!(only_error(&second).0, "duplicate_id");
            assert_eq!(mock.connections_after_a_pause().await, 1);

            assert!(proxy.abort("same"), "the first request is still registered");
            let events = first.finish().await;
            assert_eq!(final_error(&events).0, "aborted");
        });
    }

    #[test]
    fn an_id_is_free_again_before_the_final_event_is_delivered() {
        run(async {
            // Whatever the caller does on seeing End or Error, the id is already released.
            let ids_still_held: Arc<Mutex<Vec<bool>>> = Default::default();
            let watch = |proxy: &Arc<Anthropic>| {
                let (probe, held) = (proxy.clone(), ids_still_held.clone());
                move |event: ProxyEvent| {
                    if matches!(event, ProxyEvent::End | ProxyEvent::Error { .. }) {
                        let registered = lock(&probe.in_flight).contains_key("reused");
                        held.lock().unwrap().push(registered);
                    }
                    true
                }
            };

            let mock = serve(vec![ok_json(b"{}")]).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);
            proxy.request(messages("reused"), watch(&proxy)).await;

            let port = {
                let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                listener.local_addr().unwrap().port()
            };
            let refused = Arc::new(Anthropic::with_base_url(
                TestKey::new(Ok(TEST_KEY)),
                format!("http://127.0.0.1:{port}"),
            ));
            refused.request(messages("reused"), watch(&refused)).await;

            assert_eq!(*ids_still_held.lock().unwrap(), [false, false]);

            // And the same id then works again.
            let events = collect(&proxy, messages("reused")).await;
            assert_eq!(kinds(&events), ["head", "chunk", "end"]);
        });
    }

    #[test]
    fn a_receiver_that_goes_away_stops_the_request_and_the_reading() {
        run(async {
            let mut script = vec![Step::Send(STREAM_HEAD.to_vec())];
            for _ in 0..200 {
                script.push(Step::Send(chunk(b"x")));
                script.push(Step::Wait(Duration::from_millis(20)));
            }
            let mock = serve(script).await;
            let proxy = proxy_for(&TestKey::new(Ok(TEST_KEY)), &mock);

            // The receiver is gone after the head and one chunk.
            let events = start_until_gone(&proxy, messages("gone"), 2).finish().await;

            assert_eq!(
                kinds(&events),
                ["head", "chunk"],
                "nothing is sent after false"
            );
            wait_for("the proxy to drop the connection", || mock.client_gone()).await;
            assert!(!proxy.abort("gone"), "the id was released");
        });
    }

    // ---- the request shape ----

    #[test]
    fn a_request_parses_with_headers_and_body_optional() {
        let bare: ProxyRequest =
            serde_json::from_str(r#"{"id":"a","method":"GET","path":"/v1/models"}"#).unwrap();
        assert!(bare.headers.is_empty() && bare.body.is_none());

        let full: ProxyRequest = serde_json::from_str(
            r#"{"id":"b","method":"POST","path":"/v1/messages",
                "headers":[["content-type","application/json"]],"body":"{}"}"#,
        )
        .unwrap();
        assert_eq!(
            full.headers,
            [("content-type".to_string(), "application/json".to_string())]
        );
        assert_eq!(full.body.as_deref(), Some("{}"));
    }

    // ---- live ----

    /// Reads the key from the environment so this test never touches the Keychain.
    struct EnvKey;

    impl KeyProvider for EnvKey {
        fn key(&self) -> Result<String, String> {
            std::env::var("ANTHROPIC_API_KEY")
                .map_err(|_| "ANTHROPIC_API_KEY is not set in this process's environment".into())
        }
    }

    #[test]
    #[ignore = "live: needs ANTHROPIC_API_KEY in this process's environment"]
    fn live_count_tokens_through_the_real_proxy_path() {
        run(async {
            let proxy = Arc::new(Anthropic::new(Arc::new(EnvKey)));
            let mut req = request("live", "POST", "/v1/messages/count_tokens");
            req.headers = vec![
                ("content-type".into(), "application/json".into()),
                ("anthropic-version".into(), "2026-10-21".into()),
            ];
            req.body = Some(
                r#"{"model":"claude-haiku-5-5","messages":[{"role":"user","content":"Hello"}]}"#
                    .into(),
            );

            let events = collect(&proxy, req).await;
            let Some(ProxyEvent::Head { status, .. }) = events.first() else {
                panic!("no Head arrived; events: {events:?}");
            };
            let response_body = String::from_utf8_lossy(&body(&events)).into_owned();
            assert_eq!(*status, 200, "status {status}, body: {response_body}");
            assert_eq!(events.last(), Some(&ProxyEvent::End));
            let json: Value = serde_json::from_str(&response_body)
                .unwrap_or_else(|e| panic!("body is not JSON ({e}): {response_body}"));
            assert!(
                json["input_tokens"].is_number(),
                "no numeric input_tokens in: {response_body}"
            );
        });
    }
}
