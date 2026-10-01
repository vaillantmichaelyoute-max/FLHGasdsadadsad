## Credits to https://github.com/kovryn/Pablos-launcher-leak-an-expose , and Pablo, go star his repository
# To start
Open the "tauri_install.bat"
Then rename ".env.example" to ".env"
You can edit name, backend URL, Discord link, logo image, background image, redirect link, and inject DLL URLs. Public launcher builds do not bundle Fortnite PAK/SIG files. Players can place files they are authorized to use in `Documents/Project Fishk/Paks`, and the launcher copies them into their selected build.
Set `VITE_BACKEND_URL` to the Lawin game backend (port 8080) and `VITE_AUTH_API_URL` to the launcher account API (port 3552). For remote hosting, replace `127.0.0.1` with the public host and add the account API origin to the HTTP request scope in `src-tauri/tauri.conf.json` before building. Use HTTPS for public services where available.

Start the Lawin backend from the repository root, then start `backend-auth-server.js` with `start-auth-server.ps1`. The script reads the MongoDB connection string from `Config/config.json` and shares the same user records. Set `ADMIN_EMAILS` in the auth server environment to allow news publishing.
Lastly you can run "tauri_test.bat" to test the launcher
Or you can run "tauri_build.bat" to build the launcher

This launcher has apis for this backend: https://github.com/ghostcubert/Reload-Backend

Once again credits go to Pablo for making the launcher
