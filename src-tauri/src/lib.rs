use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned `memoark serve` sidecar so we can kill it on app exit
/// (releasing the data-dir lock cleanly).
struct Sidecar(Mutex<Option<CommandChild>>);

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

      // Bundled PGLite assets live under <resource_dir>/assets (see tauri.conf.json
      // `resources`). The sidecar's exec dir is Contents/MacOS, NOT Contents/Resources,
      // so we MUST pass the resource dir explicitly — dirname(execPath)/assets is wrong.
      let resource_dir = app.path().resource_dir()?;
      let assets = resource_dir.join("assets");
      let web_dist = resource_dir.join("web-dist");
      let (mut rx, child) = app
        .shell()
        .sidecar("memoark")?
        .args([
          "serve",
          "--no-open",
          "--pglite-assets",
          assets.to_str().unwrap(),
          "--web-dist",
          web_dist.to_str().unwrap(),
        ])
        .spawn()?;
      app.manage(Sidecar(Mutex::new(Some(child))));

      // Wait for the serve READY marker on stdout, then point the webview at the API.
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          if let CommandEvent::Stdout(line) = event {
            let text = String::from_utf8_lossy(&line);
            if text.contains("MEMOARK_READY") {
              if let Some(window) = handle.get_webview_window("main") {
                if let Ok(url) = "http://localhost:3927".parse::<tauri::Url>() {
                  let _ = window.navigate(url);
                }
              }
            }
          }
        }
      });

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        if let Some(state) = app.try_state::<Sidecar>() {
          if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
          }
        }
      }
    });
}
