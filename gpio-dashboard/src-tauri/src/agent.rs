//! Deploys and controls the GPIO agent that runs on the Raspberry Pi.

use std::time::Duration;

use serde_json::{json, Value};

use crate::ssh::{shell_quote, Ssh};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(300);
const TOKEN_ATTEMPTS: u32 = 5;

// Compiled in, so the app needs no resource directory at runtime.
const AGENT_FILES: [(&str, &[u8]); 7] = [
    ("agent.py", include_bytes!("../../pi-agent/agent.py")),
    (
        "code_executor.py",
        include_bytes!("../../pi-agent/code_executor.py"),
    ),
    (
        "gpio_monitor.py",
        include_bytes!("../../pi-agent/gpio_monitor.py"),
    ),
    ("install.sh", include_bytes!("../../pi-agent/install.sh")),
    (
        "requirements.txt",
        include_bytes!("../../pi-agent/requirements.txt"),
    ),
    ("sense.py", include_bytes!("../../pi-agent/sense.py")),
    (
        "system_info.py",
        include_bytes!("../../pi-agent/system_info.py"),
    ),
];

pub(crate) fn remote_dir(ssh: &Ssh) -> Result<String, String> {
    let user = ssh
        .username()
        .ok_or("SSH manager has no configured username")?;
    let valid = !user.is_empty()
        && user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return Err("Invalid SSH username".into());
    }
    Ok(format!("/home/{user}/gpio-dashboard-agent"))
}

pub async fn deploy(ssh: &Ssh) -> Result<Value, String> {
    let dir = remote_dir(ssh)?;
    ssh.execute(&format!("mkdir -p {}", shell_quote(&dir)), DEFAULT_TIMEOUT)
        .await?;
    for (name, bytes) in AGENT_FILES {
        ssh.put_bytes(bytes.to_vec(), &format!("{dir}/{name}"))
            .await?;
    }
    Ok(json!({ "success": true, "files": AGENT_FILES.len() }))
}

pub async fn install(ssh: &Ssh) -> Result<Value, String> {
    let dir = shell_quote(&remote_dir(ssh)?);
    let out = ssh
        .execute(
            &format!("cd {dir} && chmod +x install.sh && bash install.sh"),
            INSTALL_TIMEOUT,
        )
        .await?;
    Ok(json!({ "stdout": out.stdout, "stderr": out.stderr, "code": out.code }))
}

pub async fn start(ssh: &Ssh) -> Result<Value, String> {
    let dir = remote_dir(ssh)?;
    let log = shell_quote(&format!("{dir}/agent.log"));

    // Kill any existing agent, then start fresh with nohup so it survives the SSH channel closing.
    ssh.execute(&stop_command(&dir, "sleep 0.5; "), DEFAULT_TIMEOUT)
        .await?;
    ssh.execute(&start_command(&dir), DEFAULT_TIMEOUT).await?;

    // The agent may take a moment to print its auth token.
    let mut auth_token = None;
    for _ in 0..TOKEN_ATTEMPTS {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let out = ssh
            .execute(
                &format!("head -5 {log} 2>/dev/null; exit 0"),
                DEFAULT_TIMEOUT,
            )
            .await?;
        if let Some(token) = find_auth_token(&out.stdout) {
            auth_token = Some(token.to_string());
            // Scrub the token from the log file.
            ssh.execute(
                &format!("sed -i '/AUTH_TOKEN=/d' {log} 2>/dev/null; exit 0"),
                DEFAULT_TIMEOUT,
            )
            .await?;
            break;
        }
    }
    Ok(json!({ "success": true, "authToken": auth_token }))
}

pub async fn stop(ssh: &Ssh) -> Result<Value, String> {
    if ssh.status() != "connected" {
        return Ok(json!({ "success": true }));
    }
    ssh.execute(&stop_command(&remote_dir(ssh)?, ""), DEFAULT_TIMEOUT)
        .await?;
    Ok(json!({ "success": true }))
}

pub async fn get_status(ssh: &Ssh) -> Result<Value, String> {
    if ssh.status() != "connected" {
        return Ok(json!({ "running": false }));
    }
    let out = ssh
        .execute("ps aux | grep agent.py | grep -v grep", DEFAULT_TIMEOUT)
        .await?;
    Ok(json!({ "running": !out.stdout.trim().is_empty() }))
}

/// What `check`'s `echo installed` prints before the deployed files when `agent.py` is on the Pi.
const INSTALLED_MARKER: &str = "installed\n";

/// Whether the agent is on the Pi and whether it is this app's: every file `deploy` puts there,
/// byte for byte. Launch starts it only when it is (ADR-0141); a first deploy or an update runs
/// `install.sh`, and with it apt, so it stays a click.
pub async fn check(ssh: &Ssh) -> Result<Value, String> {
    let dir = shell_quote(&remote_dir(ssh)?);
    let names = AGENT_FILES.map(|(name, _)| name).join(" ");
    let out = ssh
        .execute(
            &format!(
                "cd {dir} 2>/dev/null && test -f agent.py && echo installed && cat -- {names} 2>/dev/null; exit 0"
            ),
            DEFAULT_TIMEOUT,
        )
        .await?;
    Ok(deployed(&out.stdout))
}

/// What `check` makes of the Pi's reply: the marker, then the deployed files in `AGENT_FILES` order.
fn deployed(stdout: &str) -> Value {
    let Some(files) = stdout.strip_prefix(INSTALLED_MARKER) else {
        return json!({ "installed": false, "current": false });
    };
    let ours: Vec<u8> = AGENT_FILES
        .iter()
        .flat_map(|(_, bytes)| bytes.iter().copied())
        .collect();
    json!({ "installed": true, "current": files.as_bytes() == ours.as_slice() })
}

/// The remote command that launches the agent from `dir`, with the venv install.sh makes
/// when apt's gpiod binding is 1.x. The script is given by its full path so
/// `stop_command` can find the process by that path. Only `nohup` goes to the background, with
/// every stream redirected: backgrounding the whole `cd … && nohup …` list runs it in a subshell
/// that holds the channel's output open, and on a Pi's OpenSSH the command then lasts as long as
/// the agent does.
pub(crate) fn start_command(dir: &str) -> String {
    let quoted_dir = shell_quote(dir);
    let script = shell_quote(&format!("{dir}/agent.py"));
    format!(
        "cd {quoted_dir} && {{ nohup $([ -x venv/bin/python3 ] && echo venv/bin/python3 || echo python3) {script} > agent.log 2>&1 < /dev/null & }}"
    )
}

/// The Python a program runs with: the venv install.sh makes in the agent's directory `dir`
/// when it is there (it holds gpiod 2 where apt's is 1.x, and rpi-lgpio where apt has no Pi 5
/// backend for RPi.GPIO and gpiozero), else the system's.
pub(crate) fn python_in(dir: &str) -> String {
    let venv = shell_quote(&format!("{dir}/venv/bin/python3"));
    format!("$([ -x {venv} ] && echo {venv} || echo python3)")
}

/// The remote command that stops the agent in `dir`; `then` runs after the kill. The
/// `[a]` keeps the pattern from matching the shell that runs this very command.
pub(crate) fn stop_command(dir: &str, then: &str) -> String {
    let pattern = shell_quote(&format!("{dir}/[a]gent\\.py"));
    format!("pkill -f {pattern} 2>/dev/null; {then}exit 0")
}

fn find_auth_token(log: &str) -> Option<&str> {
    let rest = log.split("AUTH_TOKEN=").nth(1)?;
    rest.split_whitespace()
        .next()
        .filter(|_| !rest.starts_with(char::is_whitespace))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ours() -> String {
        AGENT_FILES
            .iter()
            .map(|(_, bytes)| std::str::from_utf8(bytes).unwrap())
            .collect()
    }

    #[test]
    fn the_agent_is_current_only_when_every_deployed_file_is_this_apps() {
        assert_eq!(
            deployed(""),
            json!({ "installed": false, "current": false })
        );
        assert_eq!(
            deployed(&format!("{INSTALLED_MARKER}{}", ours())),
            json!({ "installed": true, "current": true })
        );
        // An older agent.py, or a file missing from the end.
        let older = ours().replacen("def ", "def  ", 1);
        assert_eq!(
            deployed(&format!("{INSTALLED_MARKER}{older}")),
            json!({ "installed": true, "current": false })
        );
        let short = &ours()[..ours().len() - 1];
        assert_eq!(
            deployed(&format!("{INSTALLED_MARKER}{short}")),
            json!({ "installed": true, "current": false })
        );
    }

    #[test]
    fn the_stop_pattern_matches_the_launched_script_but_not_its_own_command() {
        let start = start_command("/home/pi/gpio-dashboard-agent");
        let stop = stop_command("/home/pi/gpio-dashboard-agent", "");
        assert!(start.contains("echo python3) '/home/pi/gpio-dashboard-agent/agent.py'"));
        assert!(stop.contains("'/home/pi/gpio-dashboard-agent/[a]gent\\.py'"));
        assert!(
            !stop.contains("/agent.py"),
            "the stop command must not contain the literal path"
        );
    }

    #[test]
    fn only_the_agent_goes_to_the_background_with_its_streams_redirected() {
        let start = start_command("/home/pi/gpio-dashboard-agent");
        assert!(
            start.starts_with("cd '/home/pi/gpio-dashboard-agent' && { nohup "),
            "{start}"
        );
        assert!(
            start.ends_with("> agent.log 2>&1 < /dev/null & }"),
            "{start}"
        );
    }

    #[test]
    fn programs_run_with_the_agents_venv_python_when_there_is_one() {
        let dir = std::env::temp_dir().join(format!("gpio-agent-python-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dir_str = dir.to_str().unwrap();
        let python = || {
            let out = std::process::Command::new("sh")
                .args(["-c", &format!("echo {}", python_in(dir_str))])
                .output()
                .unwrap();
            String::from_utf8(out.stdout).unwrap().trim().to_string()
        };
        assert_eq!(python(), "python3");

        let venv = dir.join("venv/bin");
        std::fs::create_dir_all(&venv).unwrap();
        std::fs::write(venv.join("python3"), "#!/bin/sh\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(venv.join("python3"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        assert_eq!(python(), format!("{dir_str}/venv/bin/python3"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn every_agent_source_file_is_deployed() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../pi-agent");
        for entry in std::fs::read_dir(dir).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            if name.ends_with(".py") && !name.starts_with("test_") {
                assert!(
                    AGENT_FILES.iter().any(|(deployed, _)| *deployed == name),
                    "{name} is not in AGENT_FILES"
                );
            }
        }
    }

    #[test]
    fn finds_the_auth_token_in_the_agent_log() {
        assert_eq!(
            find_auth_token("starting\nAUTH_TOKEN=abc-123_X\nready"),
            Some("abc-123_X")
        );
        assert_eq!(find_auth_token("no token here"), None);
        assert_eq!(find_auth_token("AUTH_TOKEN= spaced"), None);
        assert_eq!(find_auth_token("AUTH_TOKEN="), None);
    }
}
