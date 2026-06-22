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
    .plugin(tauri_plugin_updater::Builder::new().build())
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
          // Bind an OS-assigned free port so we never collide with a CLI `memoark serve`,
          // a stale instance, or anything else on 3927. The real URL comes back on stdout.
          "--port",
          "0",
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
        let mut ready = false;
        let mut stderr_tail: Vec<String> = Vec::new();
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => {
              let text = String::from_utf8_lossy(&line);
              if let Some(idx) = text.find("MEMOARK_READY") {
                // The sidecar reports its real URL after the marker (the port is
                // OS-assigned), e.g. "MEMOARK_READY http://localhost:54123".
                let url_str = text[idx + "MEMOARK_READY".len()..]
                  .trim()
                  .lines()
                  .next()
                  .unwrap_or("")
                  .trim();
                if let Some(window) = handle.get_webview_window("main") {
                  if let Ok(url) = url_str.parse::<tauri::Url>() {
                    ready = true;
                    let _ = window.navigate(url);
                  }
                }
              }
            }
            CommandEvent::Stderr(line) => {
              let s = String::from_utf8_lossy(&line).trim().to_string();
              if !s.is_empty() {
                stderr_tail.push(s);
                if stderr_tail.len() > 12 {
                  stderr_tail.remove(0);
                }
              }
            }
            CommandEvent::Terminated(_) | CommandEvent::Error(_) => {
              // Sidecar died before it ever served (port/lock/config/crash). Surface the
              // error in the splash instead of spinning forever.
              if !ready {
                let detail = stderr_tail.join(" ");
                let safe: String = detail
                  .replace('\\', " ")
                  .replace('\'', " ")
                  .replace('\n', " ")
                  .chars()
                  .take(400)
                  .collect();
                if let Some(window) = handle.get_webview_window("main") {
                  let js = format!(
                    "var s=document.querySelector('.status');if(s){{s.textContent='后端启动失败 — {}';}}var sp=document.querySelector('.spinner');if(sp){{sp.style.display='none';}}",
                    safe
                  );
                  let _ = window.eval(&js);
                }
              }
              break;
            }
            _ => {}
          }
        }
      });

      // ---- Auto-update check (release only) ----
      // Checks the GitHub Releases latest.json on startup; if a newer signed build
      // exists, downloads + installs it and restarts. No-op in dev (no release feed).
      #[cfg(not(debug_assertions))]
      {
        let update_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          use tauri_plugin_updater::UpdaterExt;
          if let Ok(updater) = update_handle.updater() {
            if let Ok(Some(update)) = updater.check().await {
              if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                update_handle.restart();
              }
            }
          }
        });
      }

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

      // ---- First-run autostart default: enable on the very first launch only ----
      // A marker file under app_config_dir prevents re-enabling on subsequent launches,
      // so users who later disable autostart in the tray won't have it forced back on.
      if let Ok(dir) = app.path().app_config_dir() {
        let marker = dir.join(".autostart-initialized");
        if !marker.exists() {
          let _ = std::fs::create_dir_all(&dir);
          let _ = app.autolaunch().enable();
          let _ = std::fs::write(&marker, "1");
        }
      }

      // ---- Tray: keep MemoArk resident so MCP/serve stay online ----
      let show_i = MenuItem::with_id(app, "show", "显示 MemoArk", true, None::<&str>)?;
      // Read is_enabled() AFTER the first-run block above so the menu item reflects the
      // actual state (enabled on first launch, user-chosen thereafter).
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
