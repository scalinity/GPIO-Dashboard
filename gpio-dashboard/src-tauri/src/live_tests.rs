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

/// An `Ssh` that remembers host keys in the test directory, as the app does.
fn new_ssh(emit: crate::Emit) -> Ssh {
    Ssh::new(emit, dir().join("known_hosts"))
}

async fn connected(key: &str) -> (Ssh, Events) {
    let (emit, events) = capture();
    let ssh = new_ssh(emit);
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
            let ssh = new_ssh(emit);
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
        let ssh = new_ssh(emit);
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
        let ssh = new_ssh(emit);
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
                Some(Duration::from_secs(10)),
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
            .execute_streaming("sleep 30", Some(Duration::from_secs(60)))
            .await
            .unwrap();
        assert_eq!(killed, json!({"code": null}));
        assert!(started.elapsed() < Duration::from_secs(5));

        // The timeout reports itself and the next stream still works.
        let timed_out = ssh
            .execute_streaming("sleep 30", Some(Duration::from_secs(1)))
            .await
            .unwrap();
        assert_eq!(timed_out, json!({"code": -1, "timedOut": true}));
        let after = ssh
            .execute_streaming("true", Some(Duration::from_secs(5)))
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
        let ssh = new_ssh(emit);
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
            let streamed = ssh
                .execute_streaming("true", Some(Duration::from_secs(2)))
                .await;
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

/// Number of processes on this machine whose command line matches `pattern`.
fn running(pattern: &str) -> usize {
    let out = std::process::Command::new("pgrep")
        .args(["-f", pattern])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).lines().count()
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn stop_ends_a_running_tutorial_script_on_the_remote() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        let file = format!("tutorial_stoptest_{}.py", std::process::id());
        let remote = format!("/tmp/gpio_dashboard/{file}");
        ssh.execute("mkdir -p /tmp/gpio_dashboard", Duration::from_secs(5))
            .await
            .unwrap();
        ssh.put_bytes(b"import time\ntime.sleep(120)\n".to_vec(), &remote)
            .await
            .unwrap();

        let runner = ssh.clone();
        let command = crate::commands::tutorial_run_command(&file, None);
        let run_task =
            tauri::async_runtime::spawn(
                async move { runner.execute_streaming(&command, None).await },
            );
        wait_for("the script to start", || running(&file) > 0).await;

        // What the app does when Stop is pressed.
        ssh.kill_tutorial_stream();
        ssh.execute(
            &crate::commands::tutorial_kill_command(&file),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        let _ = run_task.await;

        tokio::time::sleep(Duration::from_millis(500)).await;
        let leftover = running(&file);
        let _ = std::process::Command::new("pkill")
            .args(["-f", &file])
            .status(); // clean up
        let _ = std::fs::remove_file(&remote);
        assert_eq!(leftover, 0, "the script is still running after Stop");
        ssh.disconnect().await;
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn stopping_the_agent_ends_the_process_that_start_launched() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        let dir = format!("/tmp/gpio_agent_test_{}", std::process::id());
        ssh.execute(&format!("mkdir -p {dir}"), Duration::from_secs(5))
            .await
            .unwrap();
        ssh.put_bytes(
            b"import time\nprint('AUTH_TOKEN=abc', flush=True)\ntime.sleep(120)\n".to_vec(),
            &format!("{dir}/agent.py"),
        )
        .await
        .unwrap();

        ssh.execute(&crate::agent::start_command(&dir), Duration::from_secs(5))
            .await
            .unwrap();
        wait_for("the agent to start", || {
            running(&format!("{dir}/agent.py")) > 0
        })
        .await;

        ssh.execute(
            &crate::agent::stop_command(&dir, ""),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        let leftover = running(&format!("{dir}/agent.py"));
        let _ = std::process::Command::new("pkill")
            .args(["-f", &format!("{dir}/agent.py")])
            .status();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(leftover, 0, "the agent is still running after stop");
        ssh.disconnect().await;
    });
}

fn known_hosts_lines(path: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty()) // a new file starts with a blank line
        .map(String::from)
        .collect()
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn a_host_key_is_recorded_on_first_use_and_accepted_afterwards() {
    run(async {
        let path = dir().join("known_hosts_first_use");
        let _ = std::fs::remove_file(&path);
        for _ in 0..2 {
            let (emit, _) = capture();
            let ssh = Ssh::new(emit, path.clone());
            ssh.connect(key_target("k_ed25519", None, PORT))
                .await
                .unwrap();
            ssh.disconnect().await;
        }
        let lines = known_hosts_lines(&path);
        assert_eq!(lines.len(), 1, "{lines:?}");
        assert!(
            lines[0].starts_with(&format!("[127.0.0.1]:{PORT} ssh-ed25519 ")),
            "{}",
            lines[0]
        );
    });
}

#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn a_changed_host_key_is_refused_and_not_retried() {
    run(async {
        // Pretend this host was first seen with a different key.
        let path = dir().join("known_hosts_changed");
        let other_key = std::fs::read_to_string(dir().join("k_unauthorized.pub")).unwrap();
        std::fs::write(&path, format!("[127.0.0.1]:{PORT} {other_key}")).unwrap();
        let before = known_hosts_lines(&path);

        let (emit, events) = capture();
        let ssh = Ssh::new(emit, path.clone());
        let error = ssh
            .connect(key_target("k_ed25519", None, PORT))
            .await
            .unwrap_err();
        assert!(error.contains("has changed"), "{error}");
        assert!(error.contains(&path.display().to_string()), "{error}");

        // It is not retried on its own, and the saved key was left alone.
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert_eq!(statuses(&events), ["connecting", "error"]);
        assert_eq!(known_hosts_lines(&path), before);
    });
}

/// Uploads a script that sleeps quietly for two minutes and returns its filename.
async fn upload_quiet_script(ssh: &Ssh, tag: &str) -> (String, String) {
    let file = format!("tutorial_{tag}_{}.py", std::process::id());
    let remote = format!("/tmp/gpio_dashboard/{file}");
    ssh.execute("mkdir -p /tmp/gpio_dashboard", Duration::from_secs(5))
        .await
        .unwrap();
    ssh.put_bytes(b"import time\ntime.sleep(120)\n".to_vec(), &remote)
        .await
        .unwrap();
    (file, remote)
}

fn clean_up(file: &str, remote: &str) {
    let _ = std::process::Command::new("pkill")
        .args(["-f", file])
        .status();
    let _ = std::fs::remove_file(remote);
}

/// D17, observed: ending the stream only closes the SSH channel, and a script that is not
/// writing output keeps running on the remote. This is why a run that ends must also be
/// killed explicitly.
#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn closing_the_channel_alone_leaves_a_quiet_script_running() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        let (file, remote) = upload_quiet_script(&ssh, "orphan").await;
        let command = crate::commands::tutorial_run_command(&file, None);
        let result = ssh
            .execute_streaming(&command, Some(Duration::from_secs(1)))
            .await
            .unwrap();
        assert_eq!(result, json!({"code": -1, "timedOut": true}));
        tokio::time::sleep(Duration::from_millis(500)).await;
        let survivors = running(&file);
        clean_up(&file, &remote);
        assert!(survivors > 0, "expected the script to outlive its channel");
        ssh.disconnect().await;
    });
}

/// D17, fixed: a run ended by the optional time limit is killed on the remote.
#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn a_run_that_hits_its_time_limit_is_killed_on_the_remote() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        let (file, remote) = upload_quiet_script(&ssh, "limit").await;
        let result = crate::commands::run_script(&ssh, &file, Some(Duration::from_secs(1))).await;
        assert_eq!(result, json!({"code": -1, "timedOut": true}));
        tokio::time::sleep(Duration::from_millis(500)).await;
        let survivors = running(&file);
        clean_up(&file, &remote);
        assert_eq!(survivors, 0, "the script outlived its time limit");
        ssh.disconnect().await;
    });
}

/// D18: the agent's WebSocket runs through the SSH session to a server that listens only on
/// the loopback interface, and messages flow both ways.
#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn the_agent_socket_runs_through_the_ssh_tunnel_to_a_loopback_only_server() {
    use crate::ws::{Route, Ws};
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        // Stands in for the Pi agent, bound to 127.0.0.1 exactly as agent.py binds.
        let agent = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = agent.local_addr().unwrap().port();

        let (emit, events) = capture();
        let ws = Ws::new(emit);
        ws.connect(
            Route::Tunnel {
                ssh: ssh.clone(),
                port,
            },
            Some("tok-d18".into()),
        );
        let (stream, _) = tokio::time::timeout(Duration::from_secs(10), agent.accept())
            .await
            .expect("the tunnel reaches the agent")
            .unwrap();

        // The client end of the agent's connection belongs to sshd, not to this process.
        let clients = server_side_pids(port);
        let names: Vec<String> = clients
            .iter()
            .map(|pid| {
                let out = std::process::Command::new("ps")
                    .args(["-o", "comm=", "-p", pid])
                    .output()
                    .unwrap();
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            })
            .collect();
        assert!(
            names.iter().any(|name| name.contains("sshd")),
            "the agent's peer is {names:?}, not sshd"
        );

        let mut conn = accept_async(stream).await.unwrap();
        let auth = conn.next().await.unwrap().unwrap().into_text().unwrap();
        assert!(auth.as_str().contains("tok-d18"));
        conn.send(Message::text(
            r#"{"type": "gpio_state", "pins": {"17": 1}}"#,
        ))
        .await
        .unwrap();
        wait_for("telemetry through the tunnel", || {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|(event, payload)| event == "gpio:state" && payload == &json!({"17": 1}))
        })
        .await;

        ws.send(&json!({"type": "sense_pause"})).unwrap();
        let sent = tokio::time::timeout(Duration::from_secs(5), conn.next())
            .await
            .expect("a command reaches the agent")
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(sent.as_str()).unwrap(),
            json!({"type": "sense_pause"})
        );

        ws.disconnect();
        ssh.disconnect().await;
    });
}

/// The I2C scan runs over SSH and reports why it failed when the host lacks i2c-tools,
/// as this Mac does. (The grid parser is covered by i2c.rs; the real scan by the HIL run.)
#[test]
#[ignore = "needs a local sshd; run src-tauri/live-tests.sh"]
fn an_i2c_scan_without_i2c_tools_reports_why() {
    run(async {
        let (ssh, _) = connected("k_ed25519").await;
        let result = crate::commands::i2c_scan(&ssh, 1).await;
        assert_eq!(result["success"], false);
        let error = result["error"].as_str().unwrap();
        assert!(error.contains("i2cdetect"), "{error}");
        assert_eq!(
            crate::commands::i2c_scan(&ssh, 99).await["error"],
            "Invalid I2C bus 99: use 0 to 31"
        );
        ssh.disconnect().await;
    });
}
