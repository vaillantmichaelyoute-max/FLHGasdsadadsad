# Project Fishk auth setup

## 1) Update launcher env

Open `.env` and set the two service URLs:

```env
VITE_BACKEND_URL=http://127.0.0.1:8080
VITE_AUTH_API_URL=http://127.0.0.1:3552
VITE_ENABLE_API=true
```

`VITE_BACKEND_URL` is the Lawin game backend from this repository (port 8080). `VITE_AUTH_API_URL` is the launcher's account/news API (port 3552). For other computers, replace both loopback hosts with the backend's reachable address, use HTTPS where available, and add the account API origin to the HTTP request scope in `src-tauri/tauri.conf.json` before building. Loopback addresses only reach services on the same computer.

## 2) Start the auth server

Run `start-auth-server.ps1` from the launcher folder. It reads the MongoDB URI from this repository's `Config/config.json` and points the storefront proxy at the Lawin server on port 8080. Discord IDs in `Config/config.json`'s `moderators` list are granted the launcher's admin permissions when linked to a launcher account. You can also set `ADMIN_EMAILS` or `MODERATOR_DISCORD_IDS` in the auth server environment, or mark a MongoDB user with `isAdmin: true` or `role: "admin"`. Never put admin credentials in the launcher configuration.

## 3) Create a launcher account

Use the existing Discord bot's `/create` command. It saves the Discord user's ID in Lawin's `discordId` field, along with the email and password the launcher uses. The launcher accepts this existing link; old Lawin records do not need a `discordLinked` field.

## 4) Configure Discord sign-in

In the Discord Developer Portal, add `http://127.0.0.1:3552/api/auth/discord/callback` as an OAuth2 redirect URI. Put the application's client ID in `VITE_DISCORD_CLIENT_ID` and its client secret in `DISCORD_CLIENT_SECRET` in the local `.env`; the secret must never use a `VITE_` name or be included in a launcher build. For a remotely hosted auth API, use its HTTPS callback URL and set the same value in `DISCORD_REDIRECT_URI`. Restart the auth server after changing these values. Users still need an existing `/create` account linked to the same Discord ID.

## 5) Login contract

POST to http://127.0.0.1:3552/api/auth/login

Body:

```json
{
  "email": "player@example.com",
  "password": "yourPassword123"
}
```

Success:

```json
{
  "success": true,
  "user": {
    "email": "player@example.com",
    "username": "Fishky",
    "discordId": "123456789012345678",
    "avatarHash": "abc123",
    "isAdmin": false
  }
}
```

Failure:

```json
{
  "success": false,
  "message": "Wrong credentials or Discord account not linked."
}
```

## 6) Important

Discord sign-in creates a short-lived launcher session for the account linked to that Discord ID. Fortnite itself still requires the game account password; Discord-only users are prompted for it when launching. The email/password sign-in remains available.

## 7) Account checks and ban appeals

The launcher calls `POST /api/auth/validate` at startup and again immediately before launching Fortnite. Deleted accounts and invalid saved credentials are signed out; network failures keep the saved session and offer retry. Active bans return the stored reason and `bannedUntil` date.

`POST /api/auth/appeal` stores one pending appeal per account in the `launcherBanAppeals` MongoDB collection. To notify a Discord channel from this auth service, set `DISCORD_BOT_TOKEN` and `BAN_APPEALS_CHANNEL_ID` in its server environment. Without a notification channel, appeals are still persisted in MongoDB for administrator review.

## 8) Admin news and media

Admin accounts can publish announcements from the Home page. The API checks the account against the server-side `ADMIN_EMAILS` allowlist or the account's MongoDB `isAdmin`/`role` fields; a client-side flag alone cannot publish.

The feed is public at `GET /api/news`. Admin publishing uses `POST /api/news`. Uploaded JPG, PNG, WebP, GIF, MP4, and WebM media is limited to 50 MB and stored under `data/news-media` by default; set `NEWS_MEDIA_DIRECTORY` to a persistent folder on the backend host if needed. News metadata is stored in the `launcherNews` MongoDB collection.

The Discord bot syncs linked accounts' highest configured guild rank to MongoDB at startup and whenever a member's Discord roles change. The launcher validates the account on focus and every 30 seconds, so rank labels and admin access update without signing out. Keep the bot online and connected to the Discord server containing the configured role IDs. For shared announcements, deploy this API and its media directory on a host reachable by every launcher user, and configure the launcher to use that HTTPS backend URL.

## 9) Community shops

The launcher community tab lets signed-in users search cosmetics and publish up to five public lineups, with up to twelve cosmetics per lineup. Shops are stored in MongoDB's `launcherCommunityShops` collection. Owners can delete their own shops; public listings do not expose account IDs or email addresses. The auth API must be reachable by launcher clients for shop creation and browsing.
