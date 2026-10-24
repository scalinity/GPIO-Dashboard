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

fn remote_dir(ssh: &Ssh) -> Result<String, String> {
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

/// The remote command that launches the agent from `dir`. The script is given by its
/// full path so `stop_command` can find the process by that path.
pub(crate) fn start_command(dir: &str) -> String {
    let quoted_dir = shell_quote(dir);
    let script = shell_quote(&format!("{dir}/agent.py"));
    format!("cd {quoted_dir} && nohup python3 {script} > agent.log 2>&1 &")
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

    #[test]
    fn the_stop_pattern_matches_the_launched_script_but_not_its_own_command() {
        let start = start_command("/home/pi/gpio-dashboard-agent");
        let stop = stop_command("/home/pi/gpio-dashboard-agent", "");
        assert!(start.contains("python3 '/home/pi/gpio-dashboard-agent/agent.py'"));
        assert!(stop.contains("'/home/pi/gpio-dashboard-agent/[a]gent\\.py'"));
        assert!(
            !stop.contains("/agent.py"),
            "the stop command must not contain the literal path"
        );
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
