// Every command the frontend may invoke. Production serves the frontend from a loopback
// origin (src/loopback.rs), which Tauri treats as remote, so app commands need ACL
// permissions; tauri-build generates `allow-<command>` for each name listed here.
// Keep in step with `generate_handler!` in main.rs and permissions/app-commands.toml
// (a test in loopback.rs checks all three).
const COMMANDS: &[&str] = &[
    "ssh_select_key_file",
    "ssh_connect",
    "ssh_disconnect",
    "ssh_run_tutorial_script",
    "ssh_kill_process",
    "ssh_gpio_cleanup",
    "sense_start",
    "sense_stop",
    "sense_pause",
    "sense_resume",
    "ssh_scp_buffer",
    "ssh_get_status",
    "ssh_i2c_scan",
    "gpio_connect",
    "gpio_disconnect",
    "terminal_create",
    "terminal_write",
    "terminal_resize",
    "terminal_destroy",
    "agent_deploy",
    "agent_install",
    "agent_start",
    "agent_stop",
    "agent_get_status",
    "settings_get",
    "settings_set",
    "settings_set_password",
    "settings_get_all",
    "settings_set_anthropic_key",
    "settings_has_anthropic_key",
    "settings_clear_anthropic_key",
    "anthropic_request",
    "anthropic_abort",
    "projects_list",
    "projects_read",
    "projects_write",
    "projects_write_transcript",
    "projects_delete",
    "projects_export",
    "projects_import",
    "open_external",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
