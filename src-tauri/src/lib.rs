use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned `memoark serve` sidecar so we can kill it on app exit
/// (releasing the data-dir lock cleanly).
struct Sidecar(Mutex<Option<CommandChild>>);

/// Show + focus the main window (used by the tray "show" item and left-click).
fn show_main(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    // LaunchAgent = per-user login item on macOS; the Windows/Linux equivalents are
    // handled by the plugin. Toggled from the tray, not forced on.
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ---- Sidecar: spawn `memoark serve` with explicit resource paths ----
      // Bundled PGLite assets live under <resource_dir>/assets (see tauri.conf.json
      // `resources`). The sidecar's exec dir is Contents/MacOS, NOT Contents/Resources,
      // so we MUST pass the resource dir explicitly — dirname(execPath)/assets is wrong.
      let resource_dir = app.path().resource_dir()?;
      let assets = resource_dir.join("assets");
      let web_dist = resource_dir.join("web-dist");

      // A Finder-launched app has cwd=/, so serve's default cwd/memoark.yaml lookup
      // can't find anything. Point it at the user-global config home (sibling of the
      // CLI's ~/.memoark/data data_dir).
      let config = app.path().home_dir()?.join(".memoark").join("memoark.yaml");
      let (mut rx, child) = app
        .shell()
        .sidecar("memoark")?
        .args([
          "serve",
          "--no-open",
          "--config",
          config.to_str().unwrap(),
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

      // ---- Native menu bar (Cmd+Q / clipboard shortcuts) ----
      let app_menu = Submenu::with_items(
        app,
        "MemoArk",
        true,
        &[
          &PredefinedMenuItem::about(app, Some("MemoArk"), None)?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::hide(app, None)?,
          &PredefinedMenuItem::quit(app, None)?,
        ],
      )?;
      let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
          &PredefinedMenuItem::undo(app, None)?,
          &PredefinedMenuItem::redo(app, None)?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::cut(app, None)?,
          &PredefinedMenuItem::copy(app, None)?,
          &PredefinedMenuItem::paste(app, None)?,
          &PredefinedMenuItem::select_all(app, None)?,
        ],
      )?;
      let menu = Menu::with_items(app, &[&app_menu, &edit_menu])?;
      app.set_menu(menu)?;

      // ---- Tray: keep MemoArk resident so MCP/serve stay online ----
      let show_i = MenuItem::with_id(app, "show", "显示 MemoArk", true, None::<&str>)?;
      let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
      let autostart_i =
        CheckMenuItem::with_id(app, "autostart", "开机自启", true, autostart_enabled, None::<&str>)?;
      let quit_i = MenuItem::with_id(app, "quit", "退出 MemoArk", true, None::<&str>)?;
      let tray_menu = Menu::with_items(
        app,
        &[&show_i, &autostart_i, &PredefinedMenuItem::separator(app)?, &quit_i],
      )?;

      let autostart_cb = autostart_i.clone();
      TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("MemoArk")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
          "show" => show_main(app),
          "quit" => app.exit(0),
          "autostart" => {
            let mgr = app.autolaunch();
            let now = mgr.is_enabled().unwrap_or(false);
            let _ = if now { mgr.disable() } else { mgr.enable() };
            let _ = autostart_cb.set_checked(!now);
          }
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main(tray.app_handle());
          }
        })
        .build(app)?;

      // ---- Close button hides to tray instead of quitting (MCP stays online) ----
      if let Some(main_window) = app.get_webview_window("main") {
        let hide_target = main_window.clone();
        main_window.on_window_event(move |event| {
          if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hide_target.hide();
          }
        });
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      // Quitting (tray "quit" / Cmd+Q) fires Exit → kill the sidecar so the data-dir
      // lock is released. Hiding the window does NOT exit (tray keeps the app alive).
      if let tauri::RunEvent::Exit = event {
        if let Some(state) = app.try_state::<Sidecar>() {
          if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
          }
        }
      }
    });
}
