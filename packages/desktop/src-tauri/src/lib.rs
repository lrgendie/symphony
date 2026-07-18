use std::path::PathBuf;
use std::time::Duration;

/// Y8 (2026-07-18, canlı bulgu): daemon restart'ta YENİ token üretir (`token.ts`) ama pencere
/// açılışta okuduğu token'ı bir daha hiç yenilemiyordu — restart sonrası REST istekleri (Bearer)
/// sessizce 401 alıyordu, kullanıcı yalnızca pencereyi kapatıp açarak fark ediyordu. Bu aralık
/// GPU/donanım poll'uyla (`daemon.ts` 2sn) aynı kategoride "canlı, kalıcı bağlantı" — çok sık
/// olmasına gerek yok, token yalnız daemon restart'ında değişir.
const TOKEN_WATCH_INTERVAL: Duration = Duration::from_secs(5);

/// ~/.symphony dizini (SYMPHONY_HOME ile taşınabilir — core/config/paths.ts ile aynı sözleşme).
fn symphony_home() -> PathBuf {
  if let Ok(dir) = std::env::var("SYMPHONY_HOME") {
    return PathBuf::from(dir);
  }
  let base = std::env::var("USERPROFILE")
    .or_else(|_| std::env::var("HOME"))
    .unwrap_or_default();
  PathBuf::from(base).join(".symphony")
}

/// Daemon bağlantı bilgisi: token dosyadan (asla koda/pakete gömülmez), port config.json'dan.
/// Daemon henüz çalışmıyorsa token boş döner; UI yeniden bağlanma döngüsüyle bekler.
fn read_daemon_bootstrap() -> (String, u16) {
  let home = symphony_home();
  let token = std::fs::read_to_string(home.join("daemon.token"))
    .map(|s| s.trim().to_string())
    .unwrap_or_default();
  let port = std::fs::read_to_string(home.join("config.json"))
    .ok()
    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    .and_then(|v| {
      v.get("daemon")
        .and_then(|d| d.get("port"))
        .and_then(|p| p.as_u64())
    })
    .unwrap_or(7770) as u16;
  (token, port)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Token + port'u webview'e sayfa JS'inden ÖNCE ver (initialization_script,
      // config.ts'teki getBootstrap() `window.__SYMPHONY__` bunu okur). serde_json
      // token'ı güvenli biçimde JSON string literaline kaçışlar.
      let (token, port) = read_daemon_bootstrap();
      let token_literal = serde_json::to_string(&token).unwrap_or_else(|_| "\"\"".to_string());
      let init_script = format!(
        "window.__SYMPHONY__ = {{ token: {token_literal}, port: {port} }};"
      );

      let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("Symphony")
        .inner_size(1100.0, 720.0)
        .min_inner_size(720.0, 480.0)
        .initialization_script(init_script.as_str())
        .build()?;

      // Y8: arka planda token dosyasını izle, değişince (daemon restart) CANLI pencereye
      // yeniden enjekte et. `eval` webview'in kendi thread'inde çalışmalı — `run_on_main_thread`
      // ile oraya taşınır (yoksa Windows'ta WebView2 panik/no-op riski).
      let app_handle = app.handle().clone();
      let mut last_token = token;
      std::thread::spawn(move || loop {
        std::thread::sleep(TOKEN_WATCH_INTERVAL);
        let (fresh_token, fresh_port) = read_daemon_bootstrap();
        if fresh_token.is_empty() || fresh_token == last_token {
          continue;
        }
        last_token = fresh_token.clone();
        let literal = serde_json::to_string(&fresh_token).unwrap_or_else(|_| "\"\"".to_string());
        let script = format!("window.__SYMPHONY__ = {{ token: {literal}, port: {fresh_port} }};");
        let window = window.clone();
        let _ = app_handle.run_on_main_thread(move || {
          let _ = window.eval(script.as_str());
        });
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
