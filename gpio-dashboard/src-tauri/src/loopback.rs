//! Serves the bundled frontend from `http://127.0.0.1:<ephemeral port>` in production builds.
//!
//! WKWebView gives `SharedArrayBuffer` only to documents loaded over http(s) with COOP/COEP.
//! A page on the `tauri://` custom protocol reports `crossOriginIsolated` but its process has
//! no `SharedArrayBuffer`, which the physics worker and Pyodide need (ADR-0008). The server
//! binds the loopback interface only, answers GET/HEAD for embedded assets, and nothing else.

use std::{
    io,
    net::{Ipv4Addr, SocketAddr, TcpListener as StdTcpListener},
};

use tauri::{ipc::CapabilityBuilder, AppHandle, Runtime};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

/// Mirrors `app > security > headers` in tauri.conf.json, which only reaches `tauri://` responses.
const ISOLATION_HEADERS: [(&str, &str); 3] = [
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Embedder-Policy", "require-corp"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
];

/// Granted to the main window from the loopback origin; the same set capabilities/default.json
/// grants from the local origin in dev.
pub const FRONTEND_PERMISSIONS: [&str; 4] = [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-internal-toggle-maximize",
    "app-commands",
];

const MAX_REQUEST_HEAD: usize = 16 * 1024;

/// Binds an ephemeral loopback port and serves the embedded assets on it.
pub fn start<R: Runtime>(app: AppHandle<R>) -> io::Result<SocketAddr> {
    let listener = StdTcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    let addr = listener.local_addr()?;
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::from_std(listener) else {
            return;
        };
        while let Ok((stream, _)) = listener.accept().await {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = serve(&app, stream).await;
            });
        }
    });
    Ok(addr)
}

/// The IPC grant for exactly this origin, so no other local server inherits it.
pub fn capability(addr: SocketAddr) -> CapabilityBuilder {
    FRONTEND_PERMISSIONS.iter().fold(
        CapabilityBuilder::new("loopback-frontend")
            .remote(format!("http://{addr}/*"))
            .window("main"),
        |builder, permission| builder.permission(*permission),
    )
}

async fn serve<R: Runtime>(app: &AppHandle<R>, mut stream: TcpStream) -> io::Result<()> {
    let mut head = Vec::new();
    let mut buf = [0u8; 2048];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut buf).await?;
        if n == 0 || head.len() + n > MAX_REQUEST_HEAD {
            return Ok(());
        }
        head.extend_from_slice(&buf[..n]);
    }
    let response = match request_target(&String::from_utf8_lossy(&head)) {
        Some((method @ ("GET" | "HEAD"), path)) => {
            let asset = asset_path(path).and_then(|p| app.asset_resolver().get(p));
            match asset {
                Some(a) => response(
                    200,
                    &a.mime_type,
                    a.csp_header.as_deref(),
                    &a.bytes,
                    method == "HEAD",
                ),
                None => response(404, "text/plain", None, b"not found", method == "HEAD"),
            }
        }
        Some(_) => response(405, "text/plain", None, b"method not allowed", false),
        None => response(400, "text/plain", None, b"bad request", false),
    };
    stream.write_all(&response).await?;
    stream.shutdown().await
}

/// Method and path from the request line.
fn request_target(head: &str) -> Option<(&str, &str)> {
    let mut parts = head.lines().next()?.split(' ');
    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
    version.starts_with("HTTP/1.").then_some((method, target))
}

/// Maps a request target to an embedded asset path; `None` for anything that is not a plain path.
fn asset_path(target: &str) -> Option<String> {
    let path = target.split(['?', '#']).next()?;
    if !path.starts_with('/') || path.split('/').any(|segment| segment == "..") {
        return None;
    }
    Some(if path == "/" {
        "index.html".into()
    } else {
        path.to_string()
    })
}

fn response(status: u16, mime: &str, csp: Option<&str>, body: &[u8], head_only: bool) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Method Not Allowed",
    };
    let mut out = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in ISOLATION_HEADERS {
        out.push_str(&format!("{name}: {value}\r\n"));
    }
    if let Some(csp) = csp {
        out.push_str(&format!("Content-Security-Policy: {csp}\r\n"));
    }
    out.push_str("\r\n");
    let mut bytes = out.into_bytes();
    if !head_only {
        bytes.extend_from_slice(body);
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::collections::BTreeSet;

    #[test]
    fn request_lines_are_parsed_and_malformed_ones_rejected() {
        assert_eq!(
            request_target("GET /assets/a.js HTTP/1.1\r\nHost: x\r\n\r\n"),
            Some(("GET", "/assets/a.js"))
        );
        assert_eq!(
            request_target("HEAD / HTTP/1.0\r\n\r\n"),
            Some(("HEAD", "/"))
        );
        assert_eq!(request_target("GET /\r\n\r\n"), None);
        assert_eq!(request_target("GET / SPDY/3\r\n\r\n"), None);
    }

    #[test]
    fn only_plain_absolute_paths_map_to_assets() {
        assert_eq!(asset_path("/").as_deref(), Some("index.html"));
        assert_eq!(
            asset_path("/assets/index-abc.js?v=1#x").as_deref(),
            Some("/assets/index-abc.js")
        );
        assert_eq!(asset_path("/../etc/passwd"), None);
        assert_eq!(asset_path("/a/../../b"), None);
        assert_eq!(asset_path("http://evil/"), None);
        assert_eq!(asset_path("*"), None);
    }

    #[test]
    fn responses_carry_isolation_headers_and_no_caching() {
        let r = String::from_utf8(response(
            200,
            "text/html",
            Some("default-src 'self'"),
            b"<p>",
            false,
        ))
        .unwrap();
        assert!(r.starts_with("HTTP/1.1 200 OK\r\n"));
        for (name, value) in ISOLATION_HEADERS {
            assert!(r.contains(&format!("{name}: {value}\r\n")), "{name}");
        }
        assert!(r.contains("Cache-Control: no-store\r\n"));
        assert!(r.contains("Content-Security-Policy: default-src 'self'\r\n"));
        assert!(r.ends_with("\r\n\r\n<p>"));
        let head =
            String::from_utf8(response(404, "text/plain", None, b"not found", true)).unwrap();
        assert!(head.contains("Content-Length: 9\r\n") && head.ends_with("\r\n\r\n"));
    }

    #[test]
    fn isolation_headers_match_the_tauri_config() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let headers = &config["app"]["security"]["headers"];
        for (name, value) in &ISOLATION_HEADERS[..2] {
            assert_eq!(headers[name], *value, "{name}");
        }
    }

    #[test]
    fn the_loopback_grant_matches_the_local_grant() {
        let config: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let local: Vec<&str> = config["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap())
            .collect();
        assert_eq!(local, FRONTEND_PERMISSIONS);
    }

    #[test]
    fn command_lists_agree() {
        let main_rs = include_str!("main.rs");
        let start = main_rs.find("generate_handler![").unwrap();
        let handler_block = &main_rs[start..start + main_rs[start..].find(']').unwrap()];
        let handler: BTreeSet<String> = handler_block
            .split("commands::")
            .skip(1)
            .map(|s| {
                s.split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .next()
                    .unwrap()
                    .to_string()
            })
            .collect();
        let build_rs = include_str!("../build.rs");
        let manifest_block =
            &build_rs[build_rs.find("const COMMANDS").unwrap()..build_rs.find("];").unwrap()];
        let manifest: BTreeSet<String> = manifest_block
            .split('"')
            .skip(1)
            .step_by(2)
            .map(String::from)
            .collect();
        let granted: BTreeSet<String> = include_str!("../permissions/app-commands.toml")
            .split("\"allow-")
            .skip(1)
            .map(|s| s.split('"').next().unwrap().replace('-', "_"))
            .collect();
        assert_eq!(handler, manifest, "generate_handler! vs build.rs");
        assert_eq!(
            manifest, granted,
            "build.rs vs permissions/app-commands.toml"
        );
    }
}
