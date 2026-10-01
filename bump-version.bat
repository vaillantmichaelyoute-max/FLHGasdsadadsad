@echo off
setlocal enabledelayedexpansion
pushd "%~dp0"

set "PACKAGE_FILE=%cd%\package.json"
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw '%PACKAGE_FILE%' | ConvertFrom-Json).version"') do set "CURRENT_VERSION=%%i"

if "%CURRENT_VERSION%"=="" (
  echo No version found in package.json.
  exit /b 1
)

for /f "tokens=1,2,3 delims=." %%a in ("%CURRENT_VERSION%") do (
  set "MAJOR=%%a"
  set "MINOR=%%b"
  set "PATCH=%%c"
)

if !PATCH! GEQ 100 (
  set /a MAJOR=MAJOR+1
  set /a MINOR=0
  set /a PATCH=0
) else (
  set /a PATCH=PATCH+1
)

set "NEW_VERSION=!MAJOR!.!MINOR!.!PATCH!"
echo Bumping version from %CURRENT_VERSION% to !NEW_VERSION!

powershell -NoProfile -Command "$p = Get-Content '%PACKAGE_FILE%' -Raw | ConvertFrom-Json; $p.version = '%NEW_VERSION%'; $p | ConvertTo-Json -Depth 100 | Set-Content '%PACKAGE_FILE%' -Encoding utf8;"
powershell -NoProfile -Command "$p = Get-Content '%cd%\src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json; $p.package.version = '%NEW_VERSION%'; $p | ConvertTo-Json -Depth 100 | Set-Content '%cd%\src-tauri\tauri.conf.json' -Encoding utf8;"
powershell -NoProfile -Command "$path = '%cd%\src-tauri\Cargo.toml'; $content = Get-Content $path -Raw; $content = [regex]::Replace($content, '(?m)^version = \"[^\"]+\"', 'version = \"%NEW_VERSION%\"', 1); Set-Content $path $content -Encoding utf8;"
powershell -NoProfile -Command "$path = '%cd%\.env'; if (Test-Path $path) { $content = Get-Content $path; $new = @(); foreach ($line in $content) { if ($line -match '^VITE_LAUNCHER_VERSION=') { $new += 'VITE_LAUNCHER_VERSION=%NEW_VERSION%' } else { $new += $line } }; Set-Content $path $new -Encoding utf8; }"
powershell -NoProfile -Command "$path = '%cd%\.env.example'; if (Test-Path $path) { $content = Get-Content $path; $new = @(); foreach ($line in $content) { if ($line -match '^VITE_LAUNCHER_VERSION=') { $new += 'VITE_LAUNCHER_VERSION=%NEW_VERSION%' } else { $new += $line } }; Set-Content $path $new -Encoding utf8; }"

echo Version bump complete.
endlocal
popd
