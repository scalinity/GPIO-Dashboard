//! Integration tests for the SSH manager against a real OpenSSH server.
//!
//! They are ignored by default. Run them with `src-tauri/live-tests.sh`, which starts
//! throwaway servers and points `SSHD_TEST_DIR` at their keys.

use std::{path::PathBuf, time::Duration};

use serde_json::json;

use crate::{
    ssh::{Auth, Ssh, Target},
    test_support::{capture, run, wait_for, Events},
};

const PORT: u16 = 2222;
const PORT_NO_TTY: u16 = 2223;

fn dir() -> PathBuf {
    PathBuf::from(
        std::env::var("SSHD_TEST_DIR").expect("run these through src-tauri/live-tests.sh"),
    )
}

fn key_target(key: &str, passphrase: Option<&str>, port: u16) -> Target {
    Target {
        host: "127.0.0.1".into(),
        port,
        username: std::env::var("USER").unwrap(),
        auth: Auth::Key {
            pem: std::fs::read_to_string(dir().join(key)).unwrap(),
            passphrase: passphrase.map(String::from),
        },
    }
}

fn statuses(events: &Events) -> Vec<String> {
    events
        .lock()
        .unwrap()
        .iter()
        .filter(|(event, _)| event == "ssh:status-change")
        .map(|(_, payload)| payload["status"].as_str().unwrap().to_string())
        .collect()
}

fn output_of(events: &Events, stream: &str) -> String {
    events
        .lock()
        .unwrap()
        .iter()
        .filter(|(event, payload)| event == "tutorial:output" && payload["stream"] == stream)
        .map(|(_, payload)| payload["data"].as_str().unwrap().to_string())
        .collect()
}

/// The server-side process(es) of established connections to `port`.
fn server_side_pids(port: u16) -> Vec<String> {
    let me = std::process::id().to_string();
    let lsof = std::process::Command::new("lsof")
        .args([
            "-nP",
            &format!("-iTCP:{port}"),
            "-sTCP:ESTABLISHED",
            "-F",
            "p",
        ])
        .output()
        .unwrap();
    let pids: Vec<String> = String::from_utf8_lossy(&lsof.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix('p'))
        .filter(|pid| *pid != me)
        .map(String::from)
        .collect();
    assert!(!pids.is_empty(), "no server-side process found");
    pids
}

fn signal(signal: &str, pids: &[String]) {
    for pid in pids {
        std::process::Command::new("kill")
            .args([signal, pid])
            .status()
            .unwrap();
    }
}

async fn connected(key: &str) -> (Ssh, Events) {
    let (emit, events) = capture();
    let ssh = Ssh::new(emit);
    ssh.connect(key_target(key, None, PORT)).await.unwrap();
    (ssh, events)
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn all_key_types_authenticate() {
    run(async {
        for (key, passphrase) in [
            ("k_ed25519", None),
            ("k_ed25519_pass", Some("s3cret-pass")),
            ("k_rsa", None),
            ("k_ecdsa", None),
        ] {
            let (emit, events) = capture();
            let ssh = Ssh::new(emit);
            ssh.connect(key_target(key, passphrase, PORT))
                .await
                .unwrap_or_else(|e| panic!("{key}: {e}"));
            assert_eq!(statuses(&events), ["connecting", "connected"], "{key}");
            ssh.disconnect().await;
        }
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn authentication_failures_are_reported_and_never_retried() {
    run(async {
        let (emit, events) = capture();
        let ssh = Ssh::new(emit);
        let error = ssh
            .connect(key_target("k_unauthorized", None, PORT))
            .await
            .unwrap_err();
        assert_eq!(error, "All configured authentication methods failed");
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert_eq!(statuses(&events), ["connecting", "error"]);

        let wrong = ssh
            .connect(key_target("k_ed25519_pass", Some("wrong"), PORT))
            .await
            .unwrap_err();
        assert!(wrong.starts_with("Cannot parse private key"), "{wrong}");
        let missing = ssh
            .connect(key_target("k_ed25519_pass", None, PORT))
            .await
            .unwrap_err();
        assert!(missing.starts_with("Cannot parse private key"), "{missing}");
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn a_refused_connection_is_an_error_and_commands_fail_cleanly() {
    run(async {
        let (emit, events) = capture();
        let ssh = Ssh::new(emit);
        assert!(ssh.connect(key_target("k_ed25519", None, 1)).await.is_err());
        assert_eq!(statuses(&events), ["connecting", "error"]);
        let error = ssh
            .execute("true", Duration::from_secs(1))
            .await
            .err()
            .unwrap();
        assert_eq!(error, "Not connected");
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn exec_returns_output_exit_code_and_honors_the_timeout() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        let out = ssh
            .execute("echo hello; echo oops 1>&2; exit 3", Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(
            (out.stdout.as_str(), out.stderr.as_str(), out.code),
            ("hello\n", "oops\n", Some(3))
        );
        let error = ssh
            .execute("sleep 5", Duration::from_millis(500))
            .await
            .err()
            .unwrap();
        assert_eq!(error, "Command timed out after 500ms");
        ssh.disconnect().await;
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn streaming_keeps_split_characters_and_supports_kill_and_timeout() {
    run(async {
        let (ssh, events) = connected("k_ed25519").await;

        // A multi-byte character split across two writes arrives whole, on the right stream.
        let result = ssh
            .execute_streaming(
                "printf 'h\\xc3\\xa9llo \\xe2\\x9c'; sleep 0.6; printf '\\x93 done\\n'; echo err 1>&2",
                Duration::from_secs(10),
            )
            .await
            .unwrap();
        assert_eq!(result, json!({"code": 0}));
        assert_eq!(output_of(&events, "stdout"), "héllo ✓ done\n");
        assert_eq!(output_of(&events, "stderr"), "err\n");

        // Stop ends a long-running stream promptly.
        let killer = ssh.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(600)).await;
            killer.kill_tutorial_stream();
        });
        let started = std::time::Instant::now();
        let killed = ssh
            .execute_streaming("sleep 30", Duration::from_secs(60))
            .await
            .unwrap();
        assert_eq!(killed, json!({"code": null}));
        assert!(started.elapsed() < Duration::from_secs(5));

        // The timeout reports itself and the next stream still works.
        let timed_out = ssh
            .execute_streaming("sleep 30", Duration::from_secs(1))
            .await
            .unwrap();
        assert_eq!(timed_out, json!({"code": -1, "timedOut": true}));
        let after = ssh
            .execute_streaming("true", Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(after, json!({"code": 0}));
        ssh.disconnect().await;
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn upload_round_trips_awkward_names_and_reports_failures() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        let remote_dir = format!("/tmp/gpio_dashboard_test_{}", std::process::id());
        ssh.execute(&format!("mkdir -p {remote_dir}"), Duration::from_secs(5))
            .await
            .unwrap();

        let payload: String = (0..40_000)
            .map(|i| format!("line {i} — ünïcödé ✓ 'q' \"d\" $x `y`\n"))
            .collect();
        let path = format!("{remote_dir}/it's a file.py");
        ssh.put_bytes(payload.clone().into_bytes(), &path)
            .await
            .unwrap();
        let read_back = ssh
            .execute(
                &format!("cat '{remote_dir}/it'\\''s a file.py'"),
                Duration::from_secs(10),
            )
            .await
            .unwrap();
        assert_eq!(read_back.stdout, payload);

        // Overwriting with less data truncates.
        ssh.put_bytes(b"x".to_vec(), &path).await.unwrap();
        let size = ssh
            .execute(
                &format!("wc -c < '{remote_dir}/it'\\''s a file.py'"),
                Duration::from_secs(5),
            )
            .await
            .unwrap();
        assert_eq!(size.stdout.trim(), "1");

        let error = ssh
            .put_bytes(b"x".to_vec(), "/nonexistent-dir-xyz/f.py")
            .await
            .unwrap_err();
        assert!(error.starts_with("Upload failed:"), "{error}");
        ssh.execute(&format!("rm -rf {remote_dir}"), Duration::from_secs(5))
            .await
            .unwrap();
        ssh.disconnect().await;
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn an_interactive_shell_passes_input_output_and_resizes() {
    run(async {
        let (ssh, events) = connected("k_ed25519").await;
        ssh.create_shell("t1").await.unwrap();
        ssh.resize_shell("t1", 120, 40);
        ssh.write_to_shell("t1", "echo SHELL_$((6*7)); stty size\n".into());
        wait_for("shell output", || {
            let text: String = events
                .lock()
                .unwrap()
                .iter()
                .filter(|(event, _)| event == "terminal:data:t1")
                .map(|(_, payload)| payload.as_str().unwrap().to_string())
                .collect();
            text.contains("SHELL_42") && text.contains("40 120")
        })
        .await;
        ssh.destroy_shell("t1");
        ssh.disconnect().await;
        assert_eq!(ssh.status(), "disconnected");
        assert!(ssh.execute("true", Duration::from_secs(1)).await.is_err());
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn a_dropped_connection_is_reestablished_automatically() {
    run(async {
        let (ssh, events) = connected("k_ed25519").await;

        // Kill the server-side process of this connection.
        for pid in server_side_pids(PORT) {
            std::process::Command::new("kill")
                .args(["-9", &pid])
                .status()
                .unwrap();
        }

        wait_for("reconnect", || {
            let seen = statuses(&events);
            seen.len() >= 4 && seen.last().unwrap() == "connected"
        })
        .await;
        let out = ssh
            .execute("echo back", Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(out.stdout, "back\n");
        ssh.disconnect().await;
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn shell_creation_fails_when_the_server_refuses_a_pty() {
    run(async {
        let (emit, _) = capture();
        let ssh = Ssh::new(emit);
        ssh.connect(key_target("k_ed25519", None, PORT_NO_TTY))
            .await
            .unwrap();

        let error = ssh
            .create_shell("t1")
            .await
            .expect_err("a refused PTY must be an error");
        assert!(error.contains("PTY"), "{error}");

        // Nothing was registered for the session, and the connection still works.
        ssh.write_to_shell("t1", "ignored\n".into());
        let out = ssh
            .execute("echo ok", Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(out.stdout, "ok\n");
        ssh.disconnect().await;
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn a_stalled_server_cannot_hang_streaming_or_shell_creation() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;

        // Freeze the server-side process: the connection stays open but nothing answers.
        let pids = server_side_pids(PORT);
        signal("-STOP", &pids);
        let outcome = tokio::time::timeout(Duration::from_secs(25), async {
            let started = std::time::Instant::now();
            let streamed = ssh.execute_streaming("true", Duration::from_secs(2)).await;
            let streaming_took = started.elapsed();
            let started = std::time::Instant::now();
            let shell = ssh.create_shell("stalled").await;
            (streamed, streaming_took, shell, started.elapsed())
        })
        .await;
        signal("-CONT", &pids);

        let (streamed, streaming_took, shell, shell_took) =
            outcome.expect("a stalled server hung the call past the safety timeout");
        assert_eq!(streamed.unwrap(), json!({"code": -1, "timedOut": true}));
        assert!(
            streaming_took < Duration::from_secs(5),
            "{streaming_took:?}"
        );
        assert!(shell.is_err());
        assert!(shell_took < Duration::from_secs(15), "{shell_took:?}");
        ssh.disconnect().await;
    });
}
