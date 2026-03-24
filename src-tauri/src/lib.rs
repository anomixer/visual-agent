use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;
use std::sync::Mutex;

struct SidecarState(Mutex<Option<CommandChild>>);
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      app.manage(SidecarState(Mutex::new(None)));

      let app_handle = app.handle().clone();
      std::thread::spawn(move || {
        let sidecar_command = match app_handle.shell().sidecar("server") {
          Ok(command) => command,
          Err(err) => {
            eprintln!("Failed to prepare sidecar: {err}");
            return;
          }
        };

        let (_receiver, child) = match sidecar_command.spawn() {
          Ok(result) => result,
          Err(err) => {
            eprintln!("Failed to spawn sidecar: {err}");
            return;
          }
        };

        if let Some(state) = app_handle.try_state::<SidecarState>() {
          if let Ok(mut child_lock) = state.0.lock() {
            *child_lock = Some(child);
          }
        }
      });

      Ok(())
    })
    .on_window_event(|window, event| match event {
      tauri::WindowEvent::Destroyed => {
        if let Some(state) = window.try_state::<SidecarState>() {
          if let Ok(mut child_lock) = state.0.lock() {
            if let Some(child) = child_lock.take() {
              let _ = child.kill();
            }
          }
        }
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
