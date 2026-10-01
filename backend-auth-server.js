import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
app.use(express.json({ limit: "70mb" }));

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/FISHKY";
const port = Number(process.env.PORT || 3552);
const reloadBackendUrl = (process.env.RELOAD_BACKEND_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const mediaDirectory = path.resolve(process.env.NEWS_MEDIA_DIRECTORY || path.join(process.cwd(), "data", "news-media"));
const authDirectory = path.dirname(fileURLToPath(import.meta.url));
function readLocalSetting(name) {
  try {
    const line = readFileSync(path.join(authDirectory, ".env"), "utf8").split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "") : "";
  } catch {
    return "";
  }
}
const discordClientId = process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID || readLocalSetting("VITE_DISCORD_CLIENT_ID");
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET || readLocalSetting("DISCORD_CLIENT_SECRET");
const discordRedirectUri = process.env.DISCORD_REDIRECT_URI || readLocalSetting("DISCORD_REDIRECT_URI") || `http://127.0.0.1:${port}/api/auth/discord/callback`;
const adminEmails = new Set((process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
function loadModeratorDiscordIds() {
  const configuredIds = (process.env.MODERATOR_DISCORD_IDS || "").split(",");
  const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "Config", "config.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (Array.isArray(config.moderators)) configuredIds.push(...config.moderators);
  } catch {
    // Deployments without the Lawin config can provide MODERATOR_DISCORD_IDS instead.
  }
  return new Set(configuredIds.map((id) => String(id).trim()).filter(Boolean));
}
const moderatorDiscordIds = loadModeratorDiscordIds();
const allowedMediaTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
]);
const maxMediaBytes = 50 * 1024 * 1024;

mongoose.connect(mongoUri).catch((err) => {
  console.error("MongoDB connection failed:", err.message);
});

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  username: { type: String, required: true },
  password: { type: mongoose.Schema.Types.Mixed },
  passwordHash: { type: mongoose.Schema.Types.Mixed },
  discordId: { type: String, default: null },
  avatarHash: { type: String, default: null },
  // Lawin accounts are linked by discordId and predate this launcher-only flag.
  // Do not synthesize false for legacy records that already contain a Discord ID.
  discordLinked: { type: Boolean, default: undefined },
  isServer: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  adminRole: { type: String, default: null },
  launcherRole: { type: String, default: "USER" },
  role: { type: String, default: "user" },
  accountId: { type: String, default: null },
  banReason: { type: String, default: null },
  bannedUntil: { type: Date, default: null },
  banExpires: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  banned: { type: Boolean, default: false },
});

const User = mongoose.model("User", userSchema);
const newsCollection = () => mongoose.connection.db.collection("launcherNews");
const banAppealsCollection = () => mongoose.connection.db.collection("launcherBanAppeals");
const communityShopsCollection = () => mongoose.connection.db.collection("launcherCommunityShops");
const discordSessionsCollection = () => mongoose.connection.db.collection("launcherDiscordSessions");
const discordAuthFlows = new Map();

function userIsAdmin(user) {
  return user?.isAdmin === true || user?.admin === true || ["OWNER", "ADMIN"].includes(String(user?.adminRole || "").toUpperCase()) || user?.role === "admin" || adminEmails.has(String(user?.email || "").toLowerCase()) || moderatorDiscordIds.has(String(user?.discordId || ""));
}

function getLauncherRole(user) {
  const knownRoles = ["OWNER", "ADMIN", "CONTENT_CREATOR", "MEMBER", "USER"];
  const grantedRole = String(user?.adminRole || "").toUpperCase();
  if (["OWNER", "ADMIN"].includes(grantedRole)) return grantedRole;

  const storedRole = String(user?.launcherRole || "").toUpperCase();
  if (knownRoles.includes(storedRole) && storedRole !== "USER") return storedRole;
  if (userIsAdmin(user)) return "ADMIN";
  return "USER";
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function getAuthenticatedUser({ email, password, authToken }) {
  if (typeof authToken === "string" && authToken.length >= 32) {
    const session = await discordSessionsCollection().findOne({ tokenHash: hashSessionToken(authToken), expiresAt: { $gt: new Date() } });
    if (!session) return null;
    return User.findOne({ discordId: session.discordId }).lean();
  }
  if (typeof email !== "string" || typeof password !== "string") return null;
  const user = await User.findOne({ email: email.trim().toLowerCase() }).lean();
  const storedHash = user?.password ?? user?.passwordHash;
  if (!user || typeof storedHash !== "string" || !(await bcrypt.compare(password, storedHash))) return null;
  return user;
}

function getPublicUser(user) {
  return {
    accountId: user.accountId || null,
    email: user.email,
    username: user.username,
    discordId: user.discordId,
    avatarHash: user.avatarHash || null,
    role: getLauncherRole(user),
    isAdmin: userIsAdmin(user),
  };
}

function getBanExpiry(user) {
  const value = user.bannedUntil || user.banExpires;
  if (!value) return null;
  const expiresAt = new Date(value);
  return Number.isNaN(expiresAt.getTime()) ? null : expiresAt;
}

async function getAccountBan(user) {
  if (!user.banned) return null;

  const expiresAt = getBanExpiry(user);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    user.banned = false;
    user.bannedUntil = null;
    user.banExpires = null;
    user.banReason = null;
    await user.save();
    return null;
  }

  const identity = user.accountId ? { accountId: user.accountId } : { email: user.email };
  const pendingAppeal = await banAppealsCollection().findOne({ ...identity, status: "pending" });
  return {
    reason: user.banReason || "No reason was provided.",
    expiresAt: expiresAt?.toISOString() || null,
    permanent: !expiresAt,
    canAppeal: !pendingAppeal,
    appealPending: Boolean(pendingAppeal),
  };
}

async function notifyBanAppeal(appeal) {
  const channelId = process.env.BAN_APPEALS_CHANNEL_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!channelId || !botToken) return;

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [{
          title: "New Launcher Ban Appeal",
          color: 0xf59e0b,
          fields: [
            { name: "Username", value: String(appeal.username || appeal.email).slice(0, 256), inline: true },
            { name: "Discord ID", value: String(appeal.discordId || "Not linked").slice(0, 256), inline: true },
            { name: "Ban reason", value: String(appeal.banReason || "No reason provided").slice(0, 1024) },
            { name: "Appeal reason", value: appeal.reason.slice(0, 1024) },
          ],
          timestamp: appeal.createdAt.toISOString(),
        }],
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error(`Appeal saved, but Discord notification returned HTTP ${response.status}.`);
  } catch (err) {
    console.error("Appeal saved, but Discord notification failed:", err.message);
  }
}

app.use("/news-media", express.static(mediaDirectory, { dotfiles: "deny", maxAge: "1h", setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff") }));

app.get("/health", (req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1, port });
});

app.post("/api/auth/discord/start", (_req, res) => {
  if (!discordClientId || !discordClientSecret) {
    return res.status(503).json({ message: "Discord sign-in is not configured. Set DISCORD_CLIENT_SECRET in the auth server environment." });
  }
  const state = randomBytes(24).toString("hex");
  discordAuthFlows.set(state, { createdAt: Date.now(), result: null });
  const params = new URLSearchParams({
    client_id: discordClientId,
    redirect_uri: discordRedirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  return res.json({ state, authorizationUrl: `https://discord.com/oauth2/authorize?${params.toString()}` });
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const flow = discordAuthFlows.get(state);
  const safeFinish = (message) => {
    const safeMessage = String(message).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    return res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Discord sign-in</title></head><body style="margin:0;background:#111820;color:#eef4f8;font:16px Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:420px;padding:32px;text-align:center"><h1>Discord sign-in</h1><p>${safeMessage}</p><p>You can close this window and return to Project Fishk.</p></main></body></html>`);
  };
  if (!flow || Date.now() - flow.createdAt > 5 * 60_000) return safeFinish("This sign-in request expired. Start again from the launcher.");
  if (typeof req.query.error === "string") {
    flow.result = { error: "Discord sign-in was cancelled." };
    return safeFinish("Sign-in was cancelled.");
  }
  if (typeof req.query.code !== "string") {
    flow.result = { error: "Discord did not return an authorization code." };
    return safeFinish("Discord did not complete sign-in.");
  }

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: discordRedirectUri,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || typeof tokenData.access_token !== "string") throw new Error("Discord authorization could not be verified.");

    const profileResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || typeof profile.id !== "string") throw new Error("Could not read your Discord account.");

    const user = await User.findOne({ discordId: profile.id });
    if (!user) throw new Error("No launcher account is linked to this Discord. Create one with /create first.");
    if (await getAccountBan(user)) throw new Error("This account is currently banned.");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    await discordSessionsCollection().deleteMany({ expiresAt: { $lte: new Date() } });
    await discordSessionsCollection().insertOne({
      tokenHash: hashSessionToken(token),
      discordId: profile.id,
      expiresAt,
      createdAt: new Date(),
    });
    flow.result = { authToken: token, user: getPublicUser(user) };
    return safeFinish("Discord verified. Return to the launcher to continue.");
  } catch (err) {
    flow.result = { error: err.message || "Discord sign-in failed." };
    return safeFinish("Sign-in could not be completed. Return to the launcher for details.");
  }
});

app.get("/api/auth/discord/poll", (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const flow = discordAuthFlows.get(state);
  if (!flow || Date.now() - flow.createdAt > 5 * 60_000) {
    discordAuthFlows.delete(state);
    return res.status(404).json({ message: "Discord sign-in expired." });
  }
  if (!flow.result) return res.status(202).json({ pending: true });
  discordAuthFlows.delete(state);
  if (flow.result.error) return res.status(401).json({ message: flow.result.error });
  return res.json({ success: true, authToken: flow.result.authToken, user: flow.result.user });
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const { authToken } = req.body || {};
    if (typeof authToken === "string") {
      await discordSessionsCollection().deleteOne({ tokenHash: hashSessionToken(authToken) });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Discord session revocation failed:", err.message);
    return res.status(500).json({ success: false });
  }
});

app.get("/api/launcher/shop", async (_req, res) => {
  try {
    const response = await fetch(`${reloadBackendUrl}/fortnite/api/storefront/v2/catalog`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FishkyLauncher/1.0",
      },
    });
    if (!response.ok) {
      return res.status(502).json({ message: `Reload Backend returned HTTP ${response.status} for its storefront.` });
    }

    const payload = await response.json();
    const storefronts = payload?.storefronts;
    if (!Array.isArray(storefronts)) {
      return res.status(502).json({ message: "Reload Backend returned an invalid storefront catalog." });
    }

    const getOffers = (storefrontName) => {
      const storefront = storefronts.find((entry) => entry.name === storefrontName);
      if (!Array.isArray(storefront?.catalogEntries)) return [];
      return storefront.catalogEntries
        .filter((entry) => Array.isArray(entry.itemGrants) && entry.itemGrants.length > 0)
        .map((entry) => ({
          id: entry.offerId || entry.devName,
          itemGrants: entry.itemGrants.map((grant) => grant.templateId),
          price: entry.prices?.[0]?.finalPrice ?? null,
        }));
    };

    return res.json({
      featured: getOffers("BRWeeklyStorefront"),
      daily: getOffers("BRDailyStorefront"),
    });
  } catch (err) {
    console.error("Reload storefront proxy failed:", err.message);
    return res.status(502).json({ message: "Could not fetch the Reload Backend item shop." });
  }
});

app.get("/api/community-shops", async (_req, res) => {
  try {
    const shops = await communityShopsCollection()
      .find({}, { projection: { _id: 0, creatorAccountId: 0, creatorEmail: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return res.json({ shops });
  } catch (err) {
    console.error("Community shop feed failed:", err.message);
    return res.status(500).json({ message: "Could not load community shops." });
  }
});

app.post("/api/community-shops/mine", async (req, res) => {
  try {
    const { email, password, authToken } = req.body || {};
    if (typeof authToken !== "string" && (typeof email !== "string" || typeof password !== "string")) {
      return res.status(400).json({ message: "Sign in again to view your shops." });
    }
    const user = await getAuthenticatedUser({ email, password, authToken });
    if (!user) {
      return res.status(401).json({ message: "Your sign-in could not be verified." });
    }
    const identityQuery = user.accountId
      ? { creatorAccountId: user.accountId }
      : { creatorEmail: user.email };
    const shops = await communityShopsCollection()
      .find(identityQuery, { projection: { _id: 0, creatorAccountId: 0, creatorEmail: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ shops });
  } catch (err) {
    console.error("Account community shops failed:", err.message);
    return res.status(500).json({ message: "Could not load your community shops." });
  }
});

app.post("/api/community-shops", async (req, res) => {
  try {
    const { email, password, authToken, title, description, items } = req.body || {};
    if (typeof authToken !== "string" && (typeof email !== "string" || typeof password !== "string")) {
      return res.status(400).json({ message: "Sign in again before publishing a shop." });
    }

    const user = await getAuthenticatedUser({ email, password, authToken });
    if (!user) {
      return res.status(401).json({ message: "Your sign-in could not be verified." });
    }
    if (user.banned) return res.status(403).json({ message: "Banned accounts cannot publish shops." });

    const cleanTitle = typeof title === "string" ? title.trim() : "";
    const cleanDescription = typeof description === "string" ? description.trim() : "";
    if (!cleanTitle || cleanTitle.length > 48 || cleanDescription.length > 240) {
      return res.status(400).json({ message: "Add a title (up to 48 characters) and description (up to 240 characters)." });
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 12) {
      return res.status(400).json({ message: "A community shop must contain between 1 and 12 cosmetics." });
    }

    const cleanItems = [];
    for (const item of items) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const image = typeof item?.image === "string" ? item.image.trim() : "";
      const rarity = typeof item?.rarity === "string" ? item.rarity.trim() : "";
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !name || name.length > 100 || !image.startsWith("https://") || image.length > 1000) {
        return res.status(400).json({ message: "One of the submitted cosmetics is invalid." });
      }
      cleanItems.push({ id, name, image, rarity: rarity.slice(0, 32) });
    }

    const creatorAccountId = user.accountId || null;
    const identityQuery = creatorAccountId ? { creatorAccountId } : { creatorEmail: user.email };
    const existingCount = await communityShopsCollection().countDocuments(identityQuery);
    if (existingCount >= 5) {
      return res.status(409).json({ message: "You can publish up to 5 community shops." });
    }

    const shop = {
      id: randomUUID(),
      title: cleanTitle,
      description: cleanDescription,
      items: cleanItems,
      creatorAccountId,
      creatorEmail: user.email,
      author: String(user.username || user.email).slice(0, 40),
      createdAt: new Date(),
    };
    await communityShopsCollection().insertOne(shop);
    const { creatorAccountId: _accountId, creatorEmail: _email, ...publicShop } = shop;
    return res.status(201).json({ success: true, shop: publicShop });
  } catch (err) {
    console.error("Community shop publish failed:", err.message);
    return res.status(500).json({ message: "Could not publish this community shop." });
  }
});

app.delete("/api/community-shops/:shopId", async (req, res) => {
  try {
    const { email, password, authToken } = req.body || {};
    if (typeof authToken !== "string" && (typeof email !== "string" || typeof password !== "string")) {
      return res.status(400).json({ message: "Sign in again before deleting a shop." });
    }

    const user = await getAuthenticatedUser({ email, password, authToken });
    if (!user) {
      return res.status(401).json({ message: "Your sign-in could not be verified." });
    }

    const creatorMatch = user.accountId
      ? { creatorAccountId: user.accountId }
      : { creatorEmail: user.email };
    const result = await communityShopsCollection().deleteOne({ id: req.params.shopId, ...creatorMatch });
    if (result.deletedCount === 0) return res.status(404).json({ message: "That shop was not found on your account." });
    return res.json({ success: true });
  } catch (err) {
    console.error("Community shop deletion failed:", err.message);
    return res.status(500).json({ message: "Could not delete this community shop." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() }).lean();

    if (!user) {
      return res.status(401).json({ success: false, message: "Wrong credentials or Discord account not linked." });
    }

    const storedHash = user.password ?? user.passwordHash;
    if (typeof storedHash !== "string") {
      console.error("Login rejected: user record has no string password hash.");
      return res.status(500).json({ success: false, message: "Account credentials need to be repaired by the server administrator." });
    }

    const valid = await bcrypt.compare(String(password), storedHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "Wrong credentials or Discord account not linked." });
    }

    const ban = await getAccountBan(user);
    if (ban) {
      return res.status(403).json({ success: false, code: "account_banned", message: "This account is banned.", ban });
    }

    if (!user.isServer && !user.discordId) {
      return res.status(403).json({ success: false, message: "This account is not linked to Discord." });
    }

    return res.json({
      success: true,
      user: {
        accountId: user.accountId || null,
        email: user.email,
        username: user.username,
        discordId: user.discordId,
        avatarHash: user.avatarHash || null,
        role: getLauncherRole(user),
        isAdmin: userIsAdmin(user),
      },
    });
  } catch (err) {
    console.error("Login failed:", err);
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
});

app.post("/api/auth/validate", async (req, res) => {
  try {
    const { email, password, authToken } = req.body || {};
    if (typeof authToken !== "string" && (typeof email !== "string" || typeof password !== "string")) {
      return res.status(400).json({ success: false, code: "missing_credentials", message: "Saved sign-in details are incomplete." });
    }

    const user = await getAuthenticatedUser({ email, password, authToken });
    if (!user) {
      return res.status(401).json({ success: false, code: authToken ? "credentials_changed" : "account_deleted", message: authToken ? "Your Discord launcher session expired. Sign in again." : "This account no longer exists or the saved sign-in details changed." });
    }

    const ban = await getAccountBan(user);
    if (ban) {
      return res.status(403).json({ success: false, code: "account_banned", message: "This account is banned.", ban });
    }

    if (!user.isServer && !user.discordId) {
      return res.status(403).json({ success: false, code: "account_unlinked", message: "This account is no longer linked to Discord." });
    }

    return res.json({ success: true, user: {
      accountId: user.accountId || null,
      email: user.email,
      username: user.username,
      discordId: user.discordId,
      avatarHash: user.avatarHash || null,
      role: getLauncherRole(user),
      isAdmin: userIsAdmin(user),
    } });
  } catch (err) {
    console.error("Account validation failed:", err.message);
    return res.status(500).json({ success: false, code: "validation_unavailable", message: "Could not verify this account right now." });
  }
});

app.post("/api/auth/appeal", async (req, res) => {
  try {
    const { email, password, reason } = req.body || {};
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (typeof email !== "string" || typeof password !== "string" || cleanReason.length < 10 || cleanReason.length > 2000) {
      return res.status(400).json({ success: false, message: "Enter an appeal reason between 10 and 2000 characters." });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    const storedHash = user?.password ?? user?.passwordHash;
    if (!user || typeof storedHash !== "string" || !(await bcrypt.compare(password, storedHash))) {
      return res.status(401).json({ success: false, message: "Your sign-in could not be verified." });
    }

    const ban = await getAccountBan(user);
    if (!ban) {
      return res.status(409).json({ success: false, code: "not_banned", message: "This account is not currently banned." });
    }
    if (!ban.canAppeal) {
      return res.status(409).json({ success: false, code: "appeal_pending", message: "An appeal is already pending for this account." });
    }

    const appeal = {
      appealId: randomUUID(),
      accountId: user.accountId || null,
      email: user.email,
      username: user.username,
      discordId: user.discordId || null,
      banReason: ban.reason,
      banExpiresAt: ban.expiresAt,
      reason: cleanReason,
      status: "pending",
      createdAt: new Date(),
    };
    await banAppealsCollection().insertOne(appeal);
    await notifyBanAppeal(appeal);
    console.info(`Ban appeal submitted for ${user.email}`);
    return res.status(201).json({ success: true, status: "pending", message: "Your appeal was submitted for administrator review." });
  } catch (err) {
    console.error("Ban appeal submission failed:", err.message);
    return res.status(500).json({ success: false, message: "Could not submit your appeal right now." });
  }
});

app.get("/api/news", async (_req, res) => {
  try {
    const items = await newsCollection().find({}, { projection: { _id: 0 } }).sort({ publishedAt: -1 }).limit(50).toArray();
    return res.json({ items });
  } catch (err) {
    console.error("News feed failed:", err);
    return res.status(500).json({ message: "Could not load announcements." });
  }
});

app.post("/api/news", async (req, res) => {
  let savedMediaPath;
  try {
    const { email, password, authToken, title, body, mediaData } = req.body || {};
    if (!authToken && (!email || !password)) {
      return res.status(400).json({ success: false, message: "Sign in again to publish." });
    }

    const user = await getAuthenticatedUser({ email, password, authToken });
    if (!user) {
      return res.status(401).json({ success: false, message: "Your sign-in could not be verified." });
    }
    if (user.banned) {
      return res.status(403).json({ success: false, message: "This account is banned." });
    }
    if (!userIsAdmin(user)) {
      return res.status(403).json({ success: false, message: "Admin permission is required to publish news." });
    }

    const cleanTitle = String(title || "").trim();
    const cleanBody = String(body || "").trim();
    if (!cleanTitle || cleanTitle.length > 120 || !cleanBody || cleanBody.length > 5000) {
      return res.status(400).json({ success: false, message: "Add a title (up to 120 characters) and message (up to 5000 characters)." });
    }

    let mediaPath = null;
    let mediaType = null;
    if (mediaData) {
      const match = String(mediaData).match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
      const extension = match && allowedMediaTypes.get(match[1].toLowerCase());
      if (!match || !extension) {
        return res.status(400).json({ success: false, message: "Choose a JPG, PNG, WebP, GIF, MP4, or WebM file." });
      }

      const mediaBuffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
      if (!mediaBuffer.length || mediaBuffer.length > maxMediaBytes) {
        return res.status(413).json({ success: false, message: "Media must be smaller than 50 MB." });
      }

      const filename = `${randomUUID()}.${extension}`;
      await mkdir(mediaDirectory, { recursive: true });
      savedMediaPath = path.join(mediaDirectory, filename);
      await writeFile(savedMediaPath, mediaBuffer, { flag: "wx" });
      mediaPath = `/news-media/${filename}`;
      mediaType = match[1].toLowerCase();
    }

    const item = {
      id: randomUUID(),
      title: cleanTitle,
      body: cleanBody,
      mediaPath,
      mediaType,
      author: String(user.username || user.email),
      publishedAt: new Date(),
    };
    await newsCollection().insertOne(item);
    return res.status(201).json({ success: true, item });
  } catch (err) {
    if (savedMediaPath) await unlink(savedMediaPath).catch(() => {});
    console.error("News publish failed:", err);
    return res.status(500).json({ success: false, message: "Could not publish this announcement." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, username, password, discordId } = req.body || {};

    if (!email || !username || !password) {
      return res.status(400).json({ success: false, message: "Email, username, and password are required." });
    }

    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) {
      return res.status(409).json({ success: false, message: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const newUser = await User.create({
      email: String(email).toLowerCase(),
      username: String(username),
      passwordHash,
      discordId: discordId ? String(discordId) : null,
      discordLinked: Boolean(discordId),
      avatarHash: null,
      banned: false,
    });

    return res.status(201).json({
      success: true,
      user: {
        email: newUser.email,
        username: newUser.username,
        discordId: newUser.discordId,
        avatarHash: newUser.avatarHash || null,
      },
    });
  } catch (err) {
    console.error("Register failed:", err);
    return res.status(500).json({ success: false, message: "Server error during registration." });
  }
});

app.post("/api/auth/link-discord", async (req, res) => {
  try {
    const { email, password, discordId, avatarHash } = req.body || {};

    if (!email || !password || !discordId) {
      return res.status(400).json({ success: false, message: "Email, password, and Discord ID are required." });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "Wrong credentials." });
    }

    user.discordId = String(discordId);
    user.avatarHash = avatarHash ? String(avatarHash) : user.avatarHash;
    user.discordLinked = true;
    await user.save();

    return res.json({ success: true, message: "Discord linked successfully." });
  } catch (err) {
    console.error("Discord link failed:", err);
    return res.status(500).json({ success: false, message: "Server error while linking Discord." });
  }
});

app.listen(port, () => {
  console.log(`Auth server running on http://127.0.0.1:${port}`);
  console.log(`MongoDB URI: ${mongoUri}`);
});
