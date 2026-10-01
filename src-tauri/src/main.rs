#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::env;
use std::fs::{create_dir_all, File};
use tauri::{AppHandle, Manager, State, Window};
use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use sysinfo::{DiskKind, Disks};
mod carter;
mod host;
use dotenvy::dotenv;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
fn close_launcher(app: tauri::AppHandle) {
    host::stop_erbium_host();
    app.exit(0);
}

#[tauri::command]
fn window_minimize(window: Window) {
    window.minimize().unwrap();
}

#[derive(Clone, Serialize)]
struct HardwareInfo {
    cpu_name: String,
    cpu_cores: usize,
    cpu_threads: usize,
    gpu_name: String,
    ram_gb: f64,
    os_drive_type: String,
    estimated_delay_seconds: u32,
}

#[derive(Clone, Default)]
struct HardwareState(Arc<Mutex<Option<HardwareInfo>>>);

#[tauri::command]
fn get_hardware_info(state: State<'_, HardwareState>) -> Option<HardwareInfo> {
    state.0.lock().ok()?.clone()
}

fn scan_hardware_info() -> HardwareInfo {
    let mut system = sysinfo::System::new();
    system.refresh_cpu_all();
    system.refresh_memory();
    let cpu_name = system.cpus().first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Unknown".to_string());
    let cpu_threads = system.cpus().len().max(1);
    let cpu_cores = system.physical_core_count().unwrap_or(cpu_threads).max(1);
    let ram_gb = system.total_memory() as f64 / 1_073_741_824.0;

    let gpu_name = detect_gpu_name();
    let os_drive_type = detect_os_drive_type();
    let estimated_delay_seconds = estimate_hardware_delay(
        &cpu_name, cpu_cores, cpu_threads, &gpu_name, ram_gb, &os_drive_type,
    );

    HardwareInfo {
        cpu_name,
        cpu_cores,
        cpu_threads,
        gpu_name,
        ram_gb,
        os_drive_type,
        estimated_delay_seconds,
    }
}

fn detect_gpu_name() -> String {
    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference='SilentlyContinue'; (Get-CimInstance Win32_VideoController | ForEach-Object Name) -join ' / '"#;
        if let Ok(mut child) = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if status.success() {
                            if let Ok(output) = child.wait_with_output() {
                                let gpu = String::from_utf8_lossy(&output.stdout).trim().to_string();
                                if !gpu.is_empty() {
                                    return gpu;
                                }
                            }
                        }
                        break;
                    }
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        }
    }
    "Unknown".to_string()
}

fn detect_os_drive_type() -> String {
    let system_drive = env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    let expected_mount = format!("{}\\", system_drive.trim_end_matches(['\\', '/']));
    let disks = Disks::new_with_refreshed_list();
    disks.list().iter()
        .find(|disk| disk.mount_point().to_string_lossy().eq_ignore_ascii_case(&expected_mount))
        .map(|disk| match disk.kind() {
            DiskKind::SSD => "SSD".to_string(),
            DiskKind::HDD => "HDD".to_string(),
            DiskKind::Unknown(_) => "Unknown".to_string(),
        })
        .unwrap_or_else(|| "Unknown".to_string())
}

fn estimate_hardware_delay(cpu: &str, cores: usize, threads: usize, gpu: &str, ram_gb: f64, drive: &str) -> u32 {
    let cpu = cpu.to_ascii_lowercase();
    let gpu = gpu.to_ascii_lowercase();
    let drive = drive.to_ascii_lowercase();
    let mut delay = 30i32;

    delay += if threads <= 4 { 12 } else if threads <= 8 { 5 } else if threads >= 24 { -8 } else if threads >= 16 { -6 } else { 0 };
    if ["celeron", "pentium", "athlon", "a-series", "core 2"].iter().any(|part| cpu.contains(part)) {
        delay += 7;
    } else if ["ryzen 7", "ryzen 9", "threadripper", "core i7", "core i9", "i7-", "i9-", "ultra 7", "ultra 9"].iter().any(|part| cpu.contains(part)) {
        delay -= 5;
    }
    delay += if ram_gb < 8.0 { 8 } else if ram_gb < 16.0 { 4 } else if ram_gb >= 32.0 { -5 } else { 0 };
    if drive.contains("hdd") { delay += 8; }
    if drive.contains("ssd") { delay -= 4; }
    if ["rtx 40", "rtx 50", "rx 7", "rx 8", "arc a"].iter().any(|part| gpu.contains(part)) {
        delay -= 5;
    } else if ["intel(r) hd", "intel hd", "intel(r) uhd", "intel uhd", "microsoft basic"].iter().any(|part| gpu.contains(part)) {
        delay += 5;
    }

    // Keep the detected core count in the score so multicore systems with few logical threads aren't misclassified.
    if cores >= 12 && threads >= 12 { delay -= 2; }
    delay.clamp(5, 60) as u32
}

fn phoenix_injector_directory() -> Result<std::path::PathBuf, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .ok_or("Could not locate the local application data folder.")?;
    let install_directory = std::path::PathBuf::from(local_app_data)
        .join("Project Fishk")
        .join("PhoenixInjector");
    create_dir_all(&install_directory)
        .map_err(|error| format!("Could not create Phoenix injector folder: {error}"))?;
    Ok(install_directory)
}

async fn prepare_phoenix_dlls(app: &AppHandle, largepakpatch_path: &str) -> Result<Vec<String>, String> {
    let install_directory = phoenix_injector_directory()?;
    let mut dll_paths = vec![largepakpatch_path.to_string()];
    let configured_urls = env::var("VITE_INJECT_DLLS_LINKS").unwrap_or_default();
    if configured_urls.trim().is_empty() {
        return Ok(dll_paths);
    }

    let window = app.get_window("main").ok_or("Main window not found")?;
    for url in configured_urls.split(',').map(str::trim).filter(|url| !url.is_empty()) {
        let url_path = url.split(['?', '#']).next().unwrap_or(url);
        let filename = std::path::Path::new(url_path)
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .filter(|filename| filename.to_ascii_lowercase().ends_with(".dll"))
            .ok_or_else(|| format!("Invalid DLL URL in VITE_INJECT_DLLS_LINKS: {url}"))?;
        let destination = install_directory.join(filename);
        let destination_string = destination.to_string_lossy().into_owned();
        carter::download(url, filename, &destination_string, &window).await?;
        dll_paths.push(destination_string);
    }
    Ok(dll_paths)
}

fn start_phoenix_injector(app: &AppHandle, dll_paths: &[String]) -> Result<(), String> {
    let bundled_executable = app.path_resolver()
        .resolve_resource("resources/Phoenix.exe")
        .filter(|path| path.is_file())
        .ok_or_else(|| "Bundled Phoenix injector is missing. Rebuild the launcher with resources/Phoenix.exe.".to_string())?;
    let install_directory = phoenix_injector_directory()?;

    let executable = install_directory.join("Phoenix.exe");
    std::fs::copy(&bundled_executable, &executable)
        .map_err(|error| format!("Could not stage Phoenix injector: {error}"))?;
    std::fs::write(
        install_directory.join("config.txt"),
        format!("process=FortniteClient-Win64-Shipping.exe\ndlls={}\n", dll_paths.join("|")),
    ).map_err(|error| format!("Could not write Phoenix injector config: {error}"))?;

    let log_file = File::create(install_directory.join("Phoenix-injector.log"))
        .map_err(|error| format!("Could not create Phoenix injector log: {error}"))?;
    let error_log = log_file.try_clone()
        .map_err(|error| format!("Could not open Phoenix injector error log: {error}"))?;
    Command::new(&executable)
        .current_dir(&install_directory)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(error_log))
        .spawn()
        .map_err(|error| format!("Could not start Phoenix injector: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn firstlaunch(
    path: String,
    backend_url: String,
    app: AppHandle,
    email: String,
    password: String,
    eor: bool,
    ror: bool,
    disable_pre_edits: bool,
    stretch_resolution_enabled: bool,
    resolution_width: u32,
    resolution_height: u32,
) -> Result<bool, String> {
    if let Ok(version) = carter::detect_fortnite_version(&path) {
        println!("Detected Fortnite {version} build at {path}");
    }
    if !carter::security_check() {
        return Err("Security violation: Debugger detected. Please close UUU or x64dbg.".to_string());
    }

    carter::kill();
    carter::kill_epic();

    let largepakpatch_dll = host::get_largepakpatch_path(app.clone())?;
    let phoenix_dlls = prepare_phoenix_dlls(&app, &largepakpatch_dll).await?;
    let launched = carter::launch_fn(
        &path,
        backend_url,
        email,
        password,
        eor,
        ror,
        disable_pre_edits,
        stretch_resolution_enabled,
        resolution_width,
        resolution_height,
    ).await?;
    start_phoenix_injector(&app, &phoenix_dlls)?;
    Ok(launched)
}

#[tauri::command]
fn is_fortnite_client_running() -> bool {
    carter::is_player_client_running()
}

#[tauri::command]
fn close_fortnite_client() -> Result<(), String> {
    carter::close_player_client()
}

#[tauri::command]
fn window_close(window: Window) {
    window.close().unwrap();
}

#[tokio::main]
async fn main() {
    let env_content = include_str!("../../.env");
    for line in env_content.lines() {
        if line.starts_with('#') || line.trim().is_empty() { continue; }
        if let Some((key, value)) = line.split_once('=') {
            let clean_value = value.trim().trim_matches('"');
            std::env::set_var(key.trim(), clean_value);
        }
    }
    dotenv().ok();

    carter::start_discord_rpc();
    
    let app_name = env::var("VITE_LAUNCHER_NAME").unwrap_or_else(|_| "Project Fishk".to_string());
    let path = format!("C:\\Program Files\\{}", app_name);

    if let Err(e) = create_dir_all(&path) {
        eprintln!("Error creating directory: {}", e);
    }

    tauri::Builder::default()
        .manage(HardwareState::default())
        .setup(|app| {
            let hardware_state = app.state::<HardwareState>().inner().clone();
            let app_handle = app.handle();
            std::thread::spawn(move || {
                let hardware = scan_hardware_info();
                if let Ok(mut cached) = hardware_state.0.lock() {
                    *cached = Some(hardware.clone());
                }
                let _ = app_handle.emit_all("hardware-info-ready", hardware);
            });

            if let Err(error) = host::get_largepakpatch_path(app.handle()) {
                eprintln!("Could not install LargePakPatch.dll for this user: {error}");
            }
            let window = app.get_window("main").unwrap();
            window.on_window_event(|event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    carter::kill(); 
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_close,
            firstlaunch,
            is_fortnite_client_running,
            close_fortnite_client,
            close_launcher,
            carter::get_fortnite_version,
            carter::sync_paks_cmd,
            carter::open_pak_drop_folder_cmd,
            carter::set_bubble_builds_cmd,
            carter::set_mobile_builds_cmd,
            carter::save_preferred_item_slots_cmd,
            carter::download_build_cmd,
            host::start_erbium_host,
            host::stop_erbium_host,
            host::is_erbium_host_running,
            host::get_largepakpatch_path,
            get_hardware_info,
        ])
        .run(tauri::generate_context!())
        .expect("Error starting the app");
}
