// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod commands;
#[cfg(test)]
mod live_tests;
mod loopback;
mod settings;
mod ssh;
#[cfg(test)]
mod test_support;
mod ws;

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

use crate::{settings::Settings, ssh::Ssh, ws::Ws};

/// Creates the main window. Production loads the frontend from the loopback server, which
/// WKWebView needs for SharedArrayBuffer (ADR-0008); dev loads `devUrl`. Either way the window
/// may only navigate within the frontend's own origin.
fn create_main_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or("no window configured")?;
    let origin: Url = if tauri::is_dev() {
        app.config()
            .build
            .dev_url
            .clone()
            .ok_or("devUrl is not configured")?
    } else {
        let addr = loopback::start(app.handle().clone())?;
        app.add_capability(loopback::capability(addr))?;
        format!("http://{addr}/").parse()?
    };
    if !tauri::is_dev() {
        config.url = WebviewUrl::External(origin.clone());
    }
    WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_navigation(move |url| url.origin() == origin.origin())
        .build()?;
    Ok(())
}

/// Sends an event to the renderer. Shared by the managers so they stay independent of Tauri.
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Stops the Pi agent and closes the connections, then exits. Quitting waits for the
/// remote stop so the agent is not left running on the Pi.
fn shutdown(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        app.state::<Ws>().disconnect();
        let ssh = app.state::<Ssh>().inner().clone();
        let _ = tokio::time::timeout(SHUTDOWN_TIMEOUT, async {
            let _ = agent::stop(&ssh).await;
            ssh.disconnect().await;
        })
        .await;
        app.exit(0);
    });
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let emit: Emit = Arc::new(move |event, payload| {
                let _ = handle.emit(event, payload);
            });
            let config_dir = app.path().app_config_dir()?;
            app.manage(Ssh::new(emit.clone(), config_dir.join("known_hosts")));
            app.manage(Ws::new(emit));
            app.manage(Settings::load(config_dir));
            create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ssh_select_key_file,
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_run_tutorial_script,
            commands::ssh_kill_process,
            commands::ssh_gpio_cleanup,
            commands::ssh_scp_buffer,
            commands::ssh_get_status,
            commands::gpio_connect,
            commands::gpio_disconnect,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_destroy,
            commands::agent_deploy,
            commands::agent_install,
            commands::agent_start,
            commands::agent_stop,
            commands::agent_get_status,
            commands::settings_get,
            commands::settings_set,
            commands::settings_set_password,
            commands::settings_get_all,
            commands::settings_set_anthropic_key,
            commands::settings_has_anthropic_key,
            commands::settings_clear_anthropic_key,
            commands::open_external,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the application");

    let shutting_down = AtomicBool::new(false);
    app.run(move |app, event| {
        // `code` is None when the user quits (last window closed, Cmd+Q); the later
        // `app.exit(0)` carries a code and passes through.
        if let RunEvent::ExitRequested {
            api, code: None, ..
        } = event
        {
            api.prevent_exit();
            if !shutting_down.swap(true, Ordering::SeqCst) {
                shutdown(app.clone());
            }
        }
    });
}
