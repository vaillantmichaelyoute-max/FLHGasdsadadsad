use winapi::um::memoryapi::{VirtualAllocEx, VirtualFreeEx, WriteProcessMemory};
use winapi::um::processthreadsapi::{CreateRemoteThread, GetExitCodeThread, OpenProcess};
use winapi::um::synchapi::WaitForSingleObject;
use winapi::um::winnt::{MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE, PROCESS_ALL_ACCESS};
use winapi::um::libloaderapi::{GetModuleHandleA, GetProcAddress};
use std::sync::atomic::{AtomicU32, Ordering};
use std::os::windows::process::CommandExt;
use tauri::{AppHandle};
use winapi::shared::minwindef::FALSE;
use winapi::um::handleapi::CloseHandle;
use winapi::um::processthreadsapi::{OpenThread, SuspendThread};
use winapi::um::tlhelp32::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use winapi::um::debugapi::IsDebuggerPresent;
// use std::env;
use tauri::Manager;
use winapi::um::winnt::HANDLE;
use winapi::um::winnt::THREAD_SUSPEND_RESUME;

use sysinfo::System;

static PLAYER_GAME_PID: AtomicU32 = AtomicU32::new(0);

pub fn is_player_client_running() -> bool {
    let pid = PLAYER_GAME_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return false;
    }

    let mut system = System::new_all();
    system.refresh_all();
    system.processes().keys().any(|process_id| process_id.as_u32() == pid)
}

pub fn close_player_client() -> Result<(), String> {
    let pid = PLAYER_GAME_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return Err("No player game launched by this launcher is running.".to_string());
    }

    let mut system = System::new_all();
    system.refresh_all();
    let process = system.processes().iter().find_map(|(process_id, process)| {
        (process_id.as_u32() == pid).then_some(process)
    });

    match process {
        Some(process) if process.kill() => {
            PLAYER_GAME_PID.store(0, Ordering::SeqCst);
            Ok(())
        }
        _ => {
            PLAYER_GAME_PID.store(0, Ordering::SeqCst);
            Err("The player game process is no longer running.".to_string())
        }
    }
}

fn release_version_from_branch(branch: &str) -> Option<String> {
    let sanitized = branch
        .trim()
        .trim_matches('"')
        .split_once("Release-")
        .map(|(_, suffix)| suffix)
        .unwrap_or(branch.trim());

    let version: String = sanitized
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect();

    if version.is_empty() || version.starts_with('.') || version.ends_with('.') {
        return None;
    }

    let parts: Vec<&str> = version.split('.').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }

    let major = parts[0];
    let minor = parts[1];
    if major.chars().all(|character| character.is_ascii_digit())
        && minor.chars().all(|character| character.is_ascii_digit())
    {
        Some(format!("{major}.{minor}"))
    } else {
        None
    }
}

fn extract_version_from_manifest(manifest: &serde_json::Value) -> Option<String> {
    for field_name in ["BranchName", "BuildVersionString", "BuildVersion", "Version"] {
        if let Some(value) = manifest.get(field_name).and_then(serde_json::Value::as_str) {
            if let Some(version) = release_version_from_branch(value) {
                return Some(version);
            }
        }
    }

    let major = manifest.get("MajorVersion").and_then(serde_json::Value::as_i64)?;
    let minor = manifest.get("MinorVersion").and_then(serde_json::Value::as_i64)?;
    Some(format!("{major}.{minor}"))
}

pub fn detect_fortnite_version(game_root: &str) -> Result<String, String> {
    let root = std::path::Path::new(game_root);
    for relative_path in ["FortniteGame/Build/Build.version", "Engine/Build/Build.version"] {
        let manifest_path = root.join(relative_path);
        let contents = match std::fs::read_to_string(&manifest_path) {
            Ok(contents) => contents,
            Err(_) => continue,
        };
        let manifest: serde_json::Value = serde_json::from_str(&contents)
            .map_err(|_| format!("Could not read build metadata at {}.", manifest_path.display()))?;
        if let Some(version) = extract_version_from_manifest(&manifest) {
            return Ok(version);
        }
    }

    Err("Could not detect the Fortnite version from Build.version metadata.".to_string())
}

#[tauri::command]
pub fn get_fortnite_version(game_root: String) -> Result<String, String> {
    detect_fortnite_version(&game_root)
}

pub fn validate_supported_fortnite_version(game_root: &str) -> Result<(), String> {
    let version = detect_fortnite_version(game_root)?;
    if version != "13.40" {
        return Err(format!(
            "This launcher is configured for Fortnite 13.40, but the selected build is {version}. Select the compatible 13.40 install to avoid the login failure loop."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod version_tests {
    use super::{detect_fortnite_version, release_version_from_branch, validate_supported_fortnite_version};
    use std::path::PathBuf;

    fn make_game_root(version: &str) -> (PathBuf, PathBuf) {
        let temp_root = std::env::temp_dir().join(format!("fishky-version-test-{}", uuid::Uuid::new_v4()));
        let game_root = temp_root.join("Game");
        let build_dir = game_root.join("FortniteGame").join("Build");
        std::fs::create_dir_all(&build_dir).unwrap();
        std::fs::write(
            build_dir.join("Build.version"),
            format!(r#"{{"BranchName":"++Fortnite+Release-{version}-CL-123"}}"#),
        ).unwrap();
        (temp_root, game_root)
    }

    #[test]
    fn parses_fortnite_release_branch_version() {
        assert_eq!(release_version_from_branch("++Fortnite+Release-13.40-CL-13715509"), Some("13.40".to_string()));
    }

    #[test]
    fn keeps_distinct_release_versions_distinct() {
        assert_eq!(release_version_from_branch("++Fortnite+Release-13.4-CL-1"), Some("13.4".to_string()));
        assert_eq!(release_version_from_branch("++Fortnite+Release-13.400-CL-1"), Some("13.400".to_string()));
        assert_eq!(release_version_from_branch("++Fortnite+Release-14.00-CL-1"), Some("14.00".to_string()));
    }

    #[test]
    fn rejects_branch_without_release_version() {
        assert_eq!(release_version_from_branch("++Fortnite+Main-CL-1"), None);
    }

    #[test]
    fn detects_installed_release_version_without_restricting_it() {
        let (temp_root, game_root) = make_game_root("13.40");
        assert_eq!(detect_fortnite_version(&game_root.to_string_lossy()).unwrap(), "13.40");
        std::fs::remove_dir_all(temp_root).unwrap();

        let (temp_root, game_root) = make_game_root("13.41");
        assert_eq!(detect_fortnite_version(&game_root.to_string_lossy()).unwrap(), "13.41");
        std::fs::remove_dir_all(temp_root).unwrap();
    }

    #[test]
    fn detects_version_from_build_version_string_when_branch_name_is_missing() {
        let temp_root = std::env::temp_dir().join(format!("fishky-version-string-test-{}", uuid::Uuid::new_v4()));
        let game_root = temp_root.join("Game");
        let build_dir = game_root.join("FortniteGame").join("Build");
        std::fs::create_dir_all(&build_dir).unwrap();
        std::fs::write(
            build_dir.join("Build.version"),
            r#"{"BuildVersionString":"13.40","BuildId":"1234"}"#,
        ).unwrap();

        assert_eq!(detect_fortnite_version(&game_root.to_string_lossy()).unwrap(), "13.40");
        std::fs::remove_dir_all(temp_root).unwrap();
    }

    #[test]
    fn rejects_unsupported_fortnite_versions() {
        let (temp_root, game_root) = make_game_root("13.41");
        let err = validate_supported_fortnite_version(&game_root.to_string_lossy()).unwrap_err();
        assert!(err.contains("Fortnite 13.40"));
        std::fs::remove_dir_all(temp_root).unwrap();

        let (temp_root, game_root) = make_game_root("13.40");
        assert!(validate_supported_fortnite_version(&game_root.to_string_lossy()).is_ok());
        std::fs::remove_dir_all(temp_root).unwrap();
    }
}

pub fn security_check() -> bool {
    unsafe {
        if IsDebuggerPresent() != 0 {
            return false;
        }
    }
    true
}

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

pub fn start_discord_rpc() {
    let app_id = std::env::var("VITE_DISCORD_CLIENT_ID").unwrap_or_default();
    let launcher_name = std::env::var("VITE_LAUNCHER_NAME").unwrap_or_else(|_| "Project Fishk".to_string());
    let discord_link = std::env::var("VITE_DISCORD_LINK").unwrap_or_default();

    tokio::spawn(async move {
        if app_id.is_empty() {
            println!("RPC Error: No Client ID found in environment.");
            return;
        }

        let mut client = DiscordIpcClient::new(&app_id).expect("Failed to create RPC client");
        
        loop {
            if client.connect().is_ok() {
                println!("Discord RPC Connected!");
                loop {
                    let details = format!("Playing {}", launcher_name);
                    let payload = activity::Activity::new()
                        .state("In Launcher")
                        .details(&details)
                        .assets(activity::Assets::new()
                            .large_image("logo")
                            .large_text(&launcher_name))
                        .buttons(vec![activity::Button::new("Join Discord", &discord_link)]);

                    if client.set_activity(payload).is_err() {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(15)).await;
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn kill() {
    let mut system = System::new_all();
    system.refresh_all();

    let processes = vec![
        "EpicGamesLauncher.exe",
        "FortniteLauncher.exe",
        "FortniteClient-Win64-Shipping_EAC.exe",
        "FortniteClient-Win64-Shipping_BE.exe",
        "FortniteClient-Win64-Shipping.exe",
        "EasyAntiCheat_EOS.exe",
        "EpicWebHelper.exe",
    ];

    for process in processes.iter() {
        let cmd = std::process::Command::new("cmd")
            .creation_flags(CREATE_NO_WINDOW)
            .args(&["/C", "taskkill", "/F", "/IM", process])
            .spawn();

        if cmd.is_err() {
            return;
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(10));
}

pub fn kill_epic() {
    let cmd = std::process::Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args(&["/C", "taskkill /F /IM", "EpicGamesLauncher.exe"])
        .spawn();

    if cmd.is_err() {
        return;
    }

    std::thread::sleep(std::time::Duration::from_millis(10));
}

pub async fn download(url: &str, filename: &str, path: &str, window: &tauri::Window) -> Result<(), String> {
    let trimmed_url = url.trim();
    if trimmed_url.is_empty() {
        return Err("Download URL is empty. Configure a valid DLL URL before launching.".to_string());
    }

    let safe_filename = if filename.trim().is_empty() {
        trimmed_url.rsplit('/').next().unwrap_or("download.bin")
    } else {
        filename
    };

    println!("Downloading {} from: {}", safe_filename, trimmed_url);

    let full_url = if trimmed_url.ends_with('/') {
        format!("{}{}", trimmed_url, safe_filename)
    } else {
        trimmed_url.to_string()
    };

    let response = reqwest::get(&full_url)
        .await
        .map_err(|e| format!("Network error while fetching {}: {}", safe_filename, e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed for {}: {}", safe_filename, response.status()));
    }

    let _ = window.emit("update-status", format!("Downloading: {}", safe_filename));

    let parent = std::path::Path::new(path).parent().unwrap_or_else(|| std::path::Path::new("."));
    if !parent.exists() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not create parent directory {}: {}", parent.display(), e))?;
    }

    let content = response.bytes().await.map_err(|e| format!("Failed to read response for {}: {}", safe_filename, e))?;
    std::fs::write(path, content).map_err(|e| format!("File Error while writing {}: {}", path, e))?;
    
    Ok(())
}

fn get_pak_drop_folder() -> Result<std::path::PathBuf, String> {
    let documents = dirs::document_dir().ok_or("Could not locate your Documents folder")?;
    let folder = documents.join("Project Fishk").join("Paks");
    std::fs::create_dir_all(&folder).map_err(|error| format!("Could not create PAK folder: {error}"))?;
    Ok(folder)
}

fn copy_paks_from_folder(game_root: &str, source_folder: &std::path::Path) -> Result<usize, String> {
    if !source_folder.exists() {
        return Ok(0);
    }

    let paks_path = std::path::Path::new(game_root)
        .join("FortniteGame")
        .join("Content")
        .join("Paks");
    std::fs::create_dir_all(&paks_path).map_err(|error| format!("Could not access the game's Paks folder: {error}"))?;

    let entries = std::fs::read_dir(source_folder)
        .map_err(|error| format!("Could not read PAK folder {}: {error}", source_folder.display()))?;
    let mut copied = 0;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read a file in the PAK folder: {error}"))?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_file() {
            continue;
        }

        let source = entry.path();
        let extension = source.extension().and_then(std::ffi::OsStr::to_str).unwrap_or("");
        if !extension.eq_ignore_ascii_case("pak") && !extension.eq_ignore_ascii_case("sig") {
            continue;
        }

        let filename = entry.file_name();
        let target = paks_path.join(filename);
        if target.exists() {
            continue;
        }

        std::fs::copy(&source, &target).map_err(|error| {
            format!("Could not copy {} into the game Paks folder: {error}", source.display())
        })?;
        copied += 1;
    }

    Ok(copied)
}

pub fn sync_paks_from_folder(game_root: &str) -> Result<usize, String> {
    let player_folder = get_pak_drop_folder()?;
    copy_paks_from_folder(game_root, &player_folder)
}

#[tauri::command]
pub fn open_pak_drop_folder_cmd() -> Result<String, String> {
    let folder = get_pak_drop_folder()?;
    std::process::Command::new("explorer.exe")
        .arg(&folder)
        .spawn()
        .map_err(|error| format!("Could not open PAK folder: {error}"))?;
    Ok(folder.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn sync_paks_cmd(game_root: String) -> Result<usize, String> {
    sync_paks_from_folder(&game_root)
}

const BUBBLE_PAK_URL: &str = "https://github.com/vaillantmichaelyoute-max/FLHGasdsadadsad/raw/refs/heads/main/pakchunkBubble-WindowsClient_P.pak";
const BUBBLE_SIG_URL: &str = "https://github.com/vaillantmichaelyoute-max/FLHGasdsadadsad/raw/refs/heads/main/pakchunkBubble-WindowsClient_P.sig";
const MOBILE_PAK_URL: &str = "https://raw.githubusercontent.com/areyoulonleyye-droid/LOW-MESGHES/main/pakchunkLowMesh-WindowsClient_p.pak";
const MOBILE_SIG_URL: &str = "https://raw.githubusercontent.com/areyoulonleyye-droid/LOW-MESGHES/main/pakchunkLowMesh-WindowsClient_p.sig";

fn remove_named_pak_files(game_root: &std::path::Path, filenames: &[&str]) -> Result<(), String> {
    let paks_path = game_root.join("FortniteGame").join("Content").join("Paks");
    for filename in filenames {
        match std::fs::remove_file(paks_path.join(filename)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not remove {}: {}", filename, error)),
        }
    }
    Ok(())
}

fn remove_bubble_build_files(game_root: &std::path::Path) -> Result<(), String> {
    remove_named_pak_files(game_root, &["pakchunkBubble-WindowsClient_P.pak", "pakchunkBubble-WindowsClient_P.sig"])
}

fn remove_mobile_build_files(game_root: &std::path::Path) -> Result<(), String> {
    remove_named_pak_files(game_root, &["pakchunkLowMesh-WindowsClient_p.pak", "pakchunkLowMesh-WindowsClient_p.sig"])
}

#[tauri::command]
pub async fn set_bubble_builds_cmd(game_roots: Vec<String>, enabled: bool, app: AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if game_roots.is_empty() {
        return Err("Add a Fortnite build before changing Bubble Builds.".to_string());
    }

    for game_root in game_roots {
        let root = std::path::PathBuf::from(game_root);
        if !enabled {
            remove_bubble_build_files(&root)?;
            continue;
        }

        let paks_path = root.join("FortniteGame").join("Content").join("Paks");
        std::fs::create_dir_all(&paks_path).map_err(|error| error.to_string())?;
        let window = app.get_window("main").ok_or("Main window not found")?;

        for (url, filename) in [
            (BUBBLE_SIG_URL, "pakchunkBubble-WindowsClient_P.sig"),
            (BUBBLE_PAK_URL, "pakchunkBubble-WindowsClient_P.pak"),
        ] {
            let target_path = paks_path.join(filename);
            if target_path.exists() {
                continue;
            }
            let target = target_path.to_str().ok_or("Invalid Bubble Builds destination path")?;
            download(url, filename, target, &window).await?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn set_mobile_builds_cmd(game_roots: Vec<String>, enabled: bool, app: AppHandle) -> Result<(), String> {
    if game_roots.is_empty() {
        return Err("Add a Fortnite build before changing Mobile Builds.".to_string());
    }

    for game_root in game_roots {
        let root = std::path::PathBuf::from(game_root);
        if !enabled {
            remove_mobile_build_files(&root)?;
            continue;
        }

        let paks_path = root.join("FortniteGame").join("Content").join("Paks");
        std::fs::create_dir_all(&paks_path).map_err(|error| error.to_string())?;
        let window = app.get_window("main").ok_or("Main window not found")?;

        for (url, filename) in [
            (MOBILE_SIG_URL, "pakchunkLowMesh-WindowsClient_p.sig"),
            (MOBILE_PAK_URL, "pakchunkLowMesh-WindowsClient_p.pak"),
        ] {
            let target_path = paks_path.join(filename);
            if target_path.exists() {
                continue;
            }
            let target = target_path.to_str().ok_or("Invalid Mobile Builds destination path")?;
            download(url, filename, target, &window).await?;
        }
    }

    Ok(())
}

fn update_ini_section(contents: &str, section: &str, entries: &[String]) -> String {
    let header = format!("[{section}]");
    let mut lines: Vec<String> = contents.lines().map(str::to_string).collect();
    let start = lines.iter().position(|line| line.trim().eq_ignore_ascii_case(&header));
    let replacement: Vec<String> = std::iter::once(header).chain(entries.iter().cloned()).collect();

    if let Some(start) = start {
        let end = lines[start + 1..]
            .iter()
            .position(|line| line.trim().starts_with('[') && line.trim().ends_with(']'))
            .map(|offset| start + 1 + offset)
            .unwrap_or(lines.len());
        lines.splice(start..end, replacement);
    } else {
        if !lines.is_empty() && !lines.last().is_some_and(String::is_empty) {
            lines.push(String::new());
        }
        lines.extend(replacement);
    }

    let mut output = lines.join("\r\n");
    output.push_str("\r\n");
    output
}

#[tauri::command]
pub fn save_preferred_item_slots_cmd(slots: Vec<String>) -> Result<(), String> {
    const VALID_CATEGORIES: [&str; 8] = ["", "sniper", "assault-rifle", "shotgun", "smg", "pistol", "consumable", "utility"];
    if slots.len() != 5 || slots.iter().any(|slot| !VALID_CATEGORIES.contains(&slot.as_str())) {
        return Err("Preferred item slots must contain five valid categories.".to_string());
    }

    let local_app_data = std::env::var_os("LOCALAPPDATA").ok_or("Could not locate the Fortnite user config folder")?;
    let config_path = std::path::PathBuf::from(local_app_data)
        .join("FortniteGame")
        .join("Saved")
        .join("Config")
        .join("WindowsClient")
        .join("GameUserSettings.ini");
    let contents = std::fs::read_to_string(&config_path).unwrap_or_default();
    let entries = slots.iter().enumerate().map(|(index, category)| {
        format!("PreferredItemSlot{}={}", index + 1, if category.is_empty() { "none" } else { category })
    }).collect::<Vec<_>>();
    let updated = update_ini_section(&contents, "ProjectFishkLauncher", &entries);

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("Could not create Fortnite config folder: {error}"))?;
    }
    std::fs::write(&config_path, updated).map_err(|error| format!("Could not save preferred item slots to Fortnite config: {error}"))
}

#[cfg(test)]
mod bubble_build_tests {
    use super::remove_bubble_build_files;

    #[test]
    fn removes_only_bubble_files_and_ignores_missing_files() {
        let root = std::env::temp_dir().join(format!("fishky-bubble-test-{}", uuid::Uuid::new_v4()));
        let paks = root.join("FortniteGame").join("Content").join("Paks");
        std::fs::create_dir_all(&paks).unwrap();
        let bubble_pak = paks.join("pakchunkBubble-WindowsClient_P.pak");
        let bubble_sig = paks.join("pakchunkBubble-WindowsClient_P.sig");
        let other_pak = paks.join("pakchunkOther-WindowsClient.pak");
        std::fs::write(&bubble_pak, b"pak").unwrap();
        std::fs::write(&bubble_sig, b"sig").unwrap();
        std::fs::write(&other_pak, b"other").unwrap();

        remove_bubble_build_files(&root).unwrap();
        remove_bubble_build_files(&root).unwrap();

        assert!(!bubble_pak.exists());
        assert!(!bubble_sig.exists());
        assert!(other_pak.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod mobile_build_tests {
    use super::remove_mobile_build_files;

    #[test]
    fn removes_only_low_mesh_files_and_ignores_missing_files() {
        let root = std::env::temp_dir().join(format!("fishky-mobile-test-{}", uuid::Uuid::new_v4()));
        let paks = root.join("FortniteGame").join("Content").join("Paks");
        std::fs::create_dir_all(&paks).unwrap();
        let mobile_pak = paks.join("pakchunkLowMesh-WindowsClient_p.pak");
        let mobile_sig = paks.join("pakchunkLowMesh-WindowsClient_p.sig");
        let other_pak = paks.join("pakchunkOther-WindowsClient.pak");
        std::fs::write(&mobile_pak, b"pak").unwrap();
        std::fs::write(&mobile_sig, b"sig").unwrap();
        std::fs::write(&other_pak, b"other").unwrap();

        remove_mobile_build_files(&root).unwrap();
        remove_mobile_build_files(&root).unwrap();

        assert!(!mobile_pak.exists());
        assert!(!mobile_sig.exists());
        assert!(other_pak.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod preferred_item_slot_ini_tests {
    use super::update_ini_section;

    #[test]
    fn updates_only_the_launcher_section_and_is_idempotent() {
        let original = "[/Script/FortniteGame.FortGameUserSettings]\r\nSomeSetting=1\r\n\r\n[ProjectFishkLauncher]\r\nPreferredItemSlot1=sniper\r\n[Other]\r\nKeep=true\r\n";
        let entries = vec![
            "PreferredItemSlot1=pistol".to_string(),
            "PreferredItemSlot2=none".to_string(),
        ];

        let updated = update_ini_section(original, "ProjectFishkLauncher", &entries);
        let updated_again = update_ini_section(&updated, "ProjectFishkLauncher", &entries);

        assert!(updated.contains("SomeSetting=1"));
        assert!(updated.contains("[Other]\r\nKeep=true"));
        assert!(updated.contains("PreferredItemSlot1=pistol\r\nPreferredItemSlot2=none"));
        assert!(!updated.contains("PreferredItemSlot1=sniper"));
        assert_eq!(updated, updated_again);
    }

    #[test]
    fn creates_launcher_section_without_replacing_existing_config() {
        let updated = update_ini_section("[Existing]\r\nValue=true\r\n", "ProjectFishkLauncher", &["PreferredItemSlot1=sniper".to_string()]);
        assert!(updated.starts_with("[Existing]\r\nValue=true"));
        assert!(updated.contains("[ProjectFishkLauncher]\r\nPreferredItemSlot1=sniper"));
    }
}

pub fn suspend_process(pid: u32) -> (u32, bool) {
    unsafe {
        let mut has_err = false;
        let mut count: u32 = 0;

        let te: &mut THREADENTRY32 = &mut std::mem::zeroed();
        (*te).dwSize = std::mem::size_of::<THREADENTRY32>() as u32;

        let snapshot: HANDLE = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);

        if Thread32First(snapshot, te) == 1 {
            loop {
                if pid == (*te).th32OwnerProcessID {
                    let tid = (*te).th32ThreadID;

                    let thread: HANDLE = OpenThread(THREAD_SUSPEND_RESUME, FALSE, tid);
                    has_err |= SuspendThread(thread) as i32 == -1i32;

                    CloseHandle(thread);
                    count += 1;
                }

                if Thread32Next(snapshot, te) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);

        (count, has_err)
    }
}

pub fn is_process_suspended(pid: u32) -> bool {
    unsafe {
        let mut is_suspended = true;

        let te: &mut THREADENTRY32 = &mut std::mem::zeroed();
        (*te).dwSize = std::mem::size_of::<THREADENTRY32>() as u32;

        let snapshot: HANDLE = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);

        if Thread32First(snapshot, te) == 1 {
            loop {
                if pid == (*te).th32OwnerProcessID {
                    let tid = (*te).th32ThreadID;

                    let thread: HANDLE = OpenThread(THREAD_SUSPEND_RESUME, FALSE, tid);
                    let suspend_count = SuspendThread(thread) as i32;

                    if suspend_count == -1i32 {
                        is_suspended = false;
                    } else {
                        is_suspended &= suspend_count > 0;
                    }

                    CloseHandle(thread);
                }

                if Thread32Next(snapshot, te) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);

        is_suspended
    }
}

pub async fn launch_real_launcher(root: &str) -> Result<bool, String> {
    println!("Launching real launcher at path: {}", root);

    let base = std::path::PathBuf::from(root);
    let mut resource_path = base.clone();
    resource_path.push("FortniteGame\\Binaries\\Win64\\FortniteLauncher.exe");

    println!("Launcher path: {:?}", resource_path);

    let mut cwd = std::path::PathBuf::from(root);
    cwd.push("FortniteGame\\Binaries\\Win64");

    println!("Current directory for launcher: {:?}", cwd);

    kill_epic();
    println!("Killed Epic process.");

    let cmd = std::process::Command::new(resource_path.clone())
        .creation_flags(CREATE_NO_WINDOW | 0x00000004)
        .current_dir(cwd)
        .spawn();

    if cmd.is_err() {
        println!("Failed to launch '{}'", resource_path.to_str().unwrap());
        return Err(format!(
            "Failed to launch '{}'",
            resource_path.to_str().unwrap()
        ));
    }

    let pid = cmd.unwrap().id();
    println!("Launched process with PID: {}", pid);

    while !is_process_suspended(pid.clone()) {
        let (_, _) = suspend_process(pid.clone());
        println!("Suspended process with PID: {}", pid);
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    kill_epic();
    Ok(true)
}

pub fn inject_dll(pid: u32, dll_path: &str) -> Result<(), String> {
    unsafe {
        let handle = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
        if handle.is_null() {
            return Err(format!("Could not open process {pid}: {}", std::io::Error::last_os_error()));
        }

        let path_null = format!("{}\0", dll_path);
        let bytes = path_null.as_bytes();
        let mem = VirtualAllocEx(handle, std::ptr::null_mut(), bytes.len(), MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if mem.is_null() {
            let error = std::io::Error::last_os_error();
            CloseHandle(handle);
            return Err(format!("Could not allocate memory in process {pid}: {error}"));
        }

        let k32 = GetModuleHandleA("kernel32.dll\0".as_ptr() as *const i8);
        if k32.is_null() {
            let error = std::io::Error::last_os_error();
            VirtualFreeEx(handle, mem, 0, MEM_RELEASE);
            CloseHandle(handle);
            return Err(format!("Could not find kernel32.dll: {error}"));
        }
        let load_lib = GetProcAddress(k32, "LoadLibraryA\0".as_ptr() as *const i8);
        if load_lib.is_null() {
            let error = std::io::Error::last_os_error();
            VirtualFreeEx(handle, mem, 0, MEM_RELEASE);
            CloseHandle(handle);
            return Err(format!("Could not find LoadLibraryA: {error}"));
        }

        let mut bytes_written = 0;
        if WriteProcessMemory(handle, mem, bytes.as_ptr() as *const _, bytes.len(), &mut bytes_written) == 0 || bytes_written != bytes.len() {
            let error = std::io::Error::last_os_error();
            VirtualFreeEx(handle, mem, 0, MEM_RELEASE);
            CloseHandle(handle);
            return Err(format!("Could not write the DLL path into process {pid}: {error}"));
        }

        let thread = CreateRemoteThread(handle, std::ptr::null_mut(), 0, Some(std::mem::transmute(load_lib)), mem, 0, std::ptr::null_mut());
        if thread.is_null() {
            let error = std::io::Error::last_os_error();
            VirtualFreeEx(handle, mem, 0, MEM_RELEASE);
            CloseHandle(handle);
            return Err(format!("Could not start the DLL load thread in process {pid}: {error}"));
        }

        let wait_result = WaitForSingleObject(thread, 30_000);
        if wait_result != 0 {
            if wait_result == 0x00000102 {
                let error = format!("DLL load did not finish within 30 seconds in process {pid}");
                CloseHandle(thread);
                CloseHandle(handle);
                return Err(error);
            }
            let error = std::io::Error::last_os_error();
            CloseHandle(thread);
            VirtualFreeEx(handle, mem, 0, MEM_RELEASE);
            CloseHandle(handle);
            return Err(format!("Could not wait for the DLL load in process {pid}: {error}"));
        }

        let mut load_result = 0;
        let read_result = GetExitCodeThread(thread, &mut load_result);
        CloseHandle(thread);
        VirtualFreeEx(handle, mem, 0, MEM_RELEASE);
        CloseHandle(handle);
        if read_result == 0 {
            return Err(format!("Could not read the DLL load result for process {pid}: {}", std::io::Error::last_os_error()));
        }
        if load_result == 0 {
            return Err(format!("LoadLibraryA failed to load {dll_path} into process {pid}"));
        }
        Ok(())
    }

}

pub async fn launch_fn(
    path: &str,
    backend_url: String,
    email: String,
    password: String,
    eor: bool,
    ror: bool,
    disable_pre_edits: bool,
    stretch_resolution_enabled: bool,
    resolution_width: u32,
    resolution_height: u32,
) -> Result<bool, String> {
    validate_supported_fortnite_version(path)?;

    let backend_url = backend_url.trim().trim_end_matches('/');
    if !(backend_url.starts_with("http://") || backend_url.starts_with("https://")) {
        return Err("VITE_BACKEND_URL must start with http:// or https://.".to_string());
    }

    let backend_health_url = format!("{backend_url}/fortnite/api/cloudstorage/system");
    let backend_response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|error| format!("Could not create backend connection: {error}"))?
        .get(&backend_health_url)
        .send()
        .await
        .map_err(|error| {
            format!(
                "Could not reach the Project Fishk backend at {backend_url}. Start the backend and make sure Radmin VPN is connected. ({error})"
            )
        })?;
    if !backend_response.status().is_success() {
        return Err(format!(
            "The game backend at {backend_url} returned HTTP {}. Check the configured backend URL and confirm that LawinServer is running.",
            backend_response.status()
        ));
    }

    sync_paks_from_folder(path)?;

    let base = std::path::PathBuf::from(path);

    let mut fort_ac_path = base.clone();
    fort_ac_path.push("FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping_EAC.exe");
    if !fort_ac_path.exists() {
        return Err("FortniteClient-Win64-Shipping_EAC.exe not found".to_string());
    }

    let mut fort_ac_cwd = base.clone();
    fort_ac_cwd.push("FortniteGame\\Binaries\\Win64");
    let _ = std::process::Command::new(fort_ac_path)
        .creation_flags(CREATE_NO_WINDOW | 0x00000004)
        .current_dir(fort_ac_cwd)
        .spawn();

    let _ = launch_real_launcher(base.to_str().unwrap()).await?;

    let mut fort_binary = base.clone();
    fort_binary.push("FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe");
    
    let auth_email = format!("-AUTH_LOGIN={}", email);
    let auth_password = format!("-AUTH_PASSWORD={}", password);

    let mut fort_args = vec![
        "-epicapp=Fortnite".to_string(),
        "-epicenv=Prod".to_string(),
        "-epiclocale=en-us".to_string(),
        "-epicportal".to_string(),
        "-nouac".to_string(),
        "-skippatchcheck".to_string(),
        "-nobe".to_string(),
        "-fromfl=eac".to_string(),
        "-fltoken=3db3ba5dcbd2e16703f3978d".to_string(),
        "-caldera=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50X2lkIjoiYmU5ZGE1YzJmYmVhNDQwN2IyZjQwZWJhYWQ4NTlhZDQiLCJnZW5lcmF0ZWQiOjE2Mzg3MTcyNzgsImNhbGRlcmFHdWlkIjoiMzgxMGI4NjMtMmE2NS00NDU3LTliNTgtNGRhYjNiNDgyYTg2IiwiYWNQcm92aWRlciI6IkVhc3lBbnRpQ2hlYXQiLCJub3RlcyI6IiIsImZhbGxiYWNrIjpmYWxzZX0.VAWQB67RTxhiWOxx7DBjnzDnXyyEnX7OljJm-j2d88G_WgwQ9wrE6lwMEHZHjBd1ISJdUO1UVUqkfLdU5nofBQ".to_string(),
        "-AUTH_TYPE=epic".to_string(),
        format!("-backend={backend_url}"),
    ];

    if eor {
        fort_args.push("-eor".to_string());
    }
    if ror {
        fort_args.push("-ror".to_string());
    }
    if disable_pre_edits {
        fort_args.push("-disablepreedits".to_string());
    }
    if stretch_resolution_enabled {
        if !(640..=7680).contains(&resolution_width) || !(480..=4320).contains(&resolution_height) {
            return Err("Stretch resolution must be between 640x480 and 7680x4320.".to_string());
        }
        fort_args.push(format!("-ResX={resolution_width}"));
        fort_args.push(format!("-ResY={resolution_height}"));
        fort_args.push("-Fullscreen".to_string());
    }
    fort_args.push(auth_email);
    fort_args.push(auth_password);

    let fort_cmd = std::process::Command::new(&fort_binary)
        .creation_flags(CREATE_NO_WINDOW)
        .args(&fort_args) 
        .spawn()
        .map_err(|e| format!("Failed to spawn Fortnite: {}", e))?;

    let pid = fort_cmd.id();
    PLAYER_GAME_PID.store(pid, Ordering::SeqCst);
    Ok(true)

    
}

    #[tauri::command]
    pub async fn download_build_cmd(destination: String, app: tauri::AppHandle) -> Result<String, String> {
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        use std::time::Instant;
        use tauri::Manager;

        let window = app.get_window("main").ok_or("Main window not found")?;
        let url = std::env::var("FORTFORGE_BUILD_DOWNLOAD_URL")
            .map_err(|_| "Build download is not configured. Add FORTFORGE_BUILD_DOWNLOAD_URL to .env.".to_string())?;
        let destination = std::path::PathBuf::from(destination);
        if !destination.is_dir() {
            return Err("Choose an existing destination folder.".to_string());
        }

        let install_dir = destination.join(format!("FortForge Build {}", &uuid::Uuid::new_v4().to_string()[..8]));
        let archive_path = std::env::temp_dir().join(format!("fortforge-build-{}.zip", uuid::Uuid::new_v4()));
        let _ = window.emit("build-download-start", true);
        let _ = window.emit("update-status", "Connecting to build host...");

        let download_result: Result<(), String> = async {
            let response = reqwest::Client::new()
                .get(&url)
                .send()
                .await
                .map_err(|error| format!("Could not connect to the build host: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("Build download failed: HTTP {}", response.status()));
            }

            let total_bytes = response.content_length();
            let mut stream = response.bytes_stream();
            let mut archive = tokio::fs::File::create(&archive_path)
                .await
                .map_err(|error| format!("Could not create temporary archive: {error}"))?;
            let started = Instant::now();
            let mut downloaded_bytes = 0_u64;
            let mut last_event = Instant::now();
            let _ = window.emit("update-status", "Downloading build...");

            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| format!("Download interrupted: {error}"))?;
                archive.write_all(&chunk).await.map_err(|error| format!("Could not write downloaded data: {error}"))?;
                downloaded_bytes += chunk.len() as u64;

                if last_event.elapsed().as_millis() >= 250 {
                    let elapsed = started.elapsed().as_secs_f64().max(0.001);
                    let bytes_per_second = (downloaded_bytes as f64 / elapsed) as u64;
                    let percent = total_bytes
                        .filter(|total| *total > 0)
                        .map(|total| ((downloaded_bytes.saturating_mul(100) / total).min(100)) as u8)
                        .unwrap_or(0);
                    let eta_seconds = total_bytes.and_then(|total| {
                        (bytes_per_second > 0).then_some(total.saturating_sub(downloaded_bytes) / bytes_per_second)
                    });
                    let _ = window.emit("build-download-progress", serde_json::json!({
                        "percent": percent,
                        "downloadedBytes": downloaded_bytes,
                        "totalBytes": total_bytes,
                        "bytesPerSecond": bytes_per_second,
                        "etaSeconds": eta_seconds,
                    }));
                    last_event = Instant::now();
                }
            }

            archive.flush().await.map_err(|error| format!("Could not finish downloaded archive: {error}"))?;
            if downloaded_bytes == 0 {
                return Err("The build host returned an empty file.".to_string());
            }
            Ok(())
        }.await;

        if let Err(error) = download_result {
            let _ = std::fs::remove_file(&archive_path);
            let _ = window.emit("build-download-error", &error);
            return Err(error);
        }

        let _ = window.emit("update-status", "Extracting build archive...");
        let _ = window.emit("build-download-progress", serde_json::json!({
            "percent": 100,
            "downloadedBytes": 0,
            "totalBytes": null,
            "bytesPerSecond": 0,
            "etaSeconds": null,
        }));
        let archive_for_extract = archive_path.clone();
        let install_for_extract = install_dir.clone();
        let extraction_task_result = tokio::task::spawn_blocking(move || -> Result<std::path::PathBuf, String> {
            std::fs::create_dir_all(&install_for_extract).map_err(|error| format!("Could not create build folder: {error}"))?;
            let file = std::fs::File::open(&archive_for_extract).map_err(|error| format!("Could not open downloaded archive: {error}"))?;
            let mut zip = zip::ZipArchive::new(file).map_err(|error| format!("Downloaded file is not a valid ZIP archive: {error}"))?;
            zip.extract(&install_for_extract).map_err(|error| format!("Could not extract build archive: {error}"))?;

            if install_for_extract.join("Engine").is_dir() {
                return Ok(install_for_extract);
            }

            let entries = std::fs::read_dir(&install_for_extract).map_err(|error| error.to_string())?;
            for entry in entries.flatten() {
                if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) && entry.path().join("Engine").is_dir() {
                    return Ok(entry.path());
                }
            }
            Err("The archive extracted, but no Fortnite Engine folder was found.".to_string())
        }).await;
        let _ = std::fs::remove_file(&archive_path);
        let extraction_result = extraction_task_result.map_err(|error| format!("Build extraction task failed: {error}"))?;

        match extraction_result {
            Ok(build_path) => {
                let path = build_path.to_string_lossy().to_string();
                let _ = window.emit("build-download-complete", &path);
                Ok(path)
            }
            Err(error) => {
                let _ = std::fs::remove_dir_all(&install_dir);
                let _ = window.emit("build-download-error", &error);
                Err(error)
            }
        }
    }

    #[cfg(test)]
    mod pak_folder_tests {
        use super::copy_paks_from_folder;

        #[test]
        fn copies_only_pak_and_sig_files_without_overwriting_existing_files() {
            let root = std::env::temp_dir().join(format!("fishky-pak-folder-test-{}", uuid::Uuid::new_v4()));
            let drop_folder = root.join("drop");
            let game_root = root.join("game");
            let target_folder = game_root.join("FortniteGame").join("Content").join("Paks");
            std::fs::create_dir_all(&drop_folder).unwrap();
            std::fs::create_dir_all(&target_folder).unwrap();
            std::fs::write(drop_folder.join("custom.pak"), b"pak-data").unwrap();
            std::fs::write(drop_folder.join("custom.sig"), b"sig-data").unwrap();
            std::fs::write(drop_folder.join("readme.txt"), b"ignore").unwrap();
            std::fs::write(target_folder.join("existing.pak"), b"original").unwrap();
            std::fs::write(drop_folder.join("existing.pak"), b"replacement").unwrap();

            let copied = copy_paks_from_folder(game_root.to_str().unwrap(), &drop_folder).unwrap();

            assert_eq!(copied, 2);
            assert_eq!(std::fs::read(target_folder.join("custom.pak")).unwrap(), b"pak-data");
            assert_eq!(std::fs::read(target_folder.join("custom.sig")).unwrap(), b"sig-data");
            assert_eq!(std::fs::read(target_folder.join("existing.pak")).unwrap(), b"original");
            assert!(!target_folder.join("readme.txt").exists());
            std::fs::remove_dir_all(root).unwrap();
        }
    }
