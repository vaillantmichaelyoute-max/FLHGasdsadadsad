// src/onboard.tsx
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { checkUpdate, installUpdate, type UpdateManifest } from "@tauri-apps/api/updater";
import { open } from "@tauri-apps/api/dialog";
import { open as openExternal } from "@tauri-apps/api/shell";
import { readBinaryFile, exists } from "@tauri-apps/api/fs";
import { join } from "@tauri-apps/api/path";
import { useNavigate } from "react-router-dom";
import { Body, fetch, ResponseType } from "@tauri-apps/api/http";
import { Defaults } from "./defaults";
import NewsPanel from "./NewsPanel";
import { appWindow } from "@tauri-apps/api/window";
import { listen } from '@tauri-apps/api/event';
import "./launcher.css";
import {
  Home,
  Grid,
  Settings,
  LogOut,
  Play,
  Plus,
  Trash2,
  Trophy,
  ShoppingCart,
  ArrowUpRight,
  CloudDownload,
  Download,
  FolderOpen,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Minus,
  Maximize2,
  X,
  ShieldPlus,
  PanelTop,
  PanelBottom,
  PanelLeft,
  ImagePlus,
  Star,
  UsersRound,
  Info,
  Palette,
  Shield,
  PanelsTopLeft,
  UserRound,
  AlertTriangle,
  Newspaper,
  RefreshCw
} from "lucide-react";
import { GiCrossedAxes, GiMachineGun, GiPistolGun, GiRifle, GiShotgun } from "react-icons/gi";
import "./App.css";

interface UserData {
  email: string;
  password?: string;
  authToken?: string;
  accountId?: string | null;
  username?: string;
  discordId?: string;
  avatarHash?: string | null;
  role?: string;
  isAdmin?: boolean;
}

interface ArenaLeaderboardEntry {
  rank?: number;
  accountId?: string;
  username: string;
  hype: number;
  division: number;
  discordId?: string;
  avatarHash?: string;
}

interface CosmeticInfo {
  id: string;
  name: string;
  description: string;
  image: string;
  rarity: string;
}

/* -------------------- Helpers -------------------- */
function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null as any, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(binary);
}
function getFolderName(p: string) {
  const parts = p.split(/\\|\//).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && typeof (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === "function";
}

/* -------------------- Types -------------------- */
type TabKey = "home" | "library" | "shop" | "settings" | "leaderboard" | "admin";
type BuildItem = { id: string; path: string; name: string; version?: string; versionError?: string; coverDataUrl?: string };
type BuildDownloadProgress = {
  percent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  etaSeconds: number | null;
};
type UpdateTrackerStatus = "browser" | "setup" | "checking" | "current" | "available" | "installing" | "error";
type LauncherTheme = "midnight" | "ember" | "grove" | "rose";
type NavigationPosition = "left" | "bottom" | "top";
type PreferencesView = "information" | "appearance" | "security" | "overlay" | "account";
type PreferredItemCategoryId = "sniper" | "assault-rifle" | "shotgun" | "smg" | "pistol" | "consumable" | "utility";

const preferredItemCategories = [
  { id: "assault-rifle", label: "Assault Rifle", icon: GiRifle },
  { id: "shotgun", label: "Shotgun", icon: GiShotgun },
  { id: "smg", label: "SMG", icon: GiMachineGun },
  { id: "pistol", label: "Pistol", icon: GiPistolGun },
  { id: "sniper", label: "Sniper", icon: GiRifle },
  { id: "consumable", label: "Consumable", icon: ShieldPlus },
  { id: "utility", label: "Utility", icon: GiCrossedAxes },
] as const;

const defaultPreferredItemSlots: (PreferredItemCategoryId | null)[] = [
  "sniper",
  "assault-rifle",
  "shotgun",
  "smg",
  "consumable",
];

function readPreferredItemSlots(): (PreferredItemCategoryId | null)[] {
  const saved = localStorage.getItem("gameSetting.preferredItemSlots");
  if (!saved) return [...defaultPreferredItemSlots];

  try {
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [...defaultPreferredItemSlots];

    return Array.from({ length: 5 }, (_, index) => {
      const item = preferredItemCategories.find((category) => category.id === parsed[index]);
      return item?.id ?? null;
    });
  } catch {
    return [...defaultPreferredItemSlots];
  }
}

const PreferredItemSlots: React.FC = () => {
  const [slots, setSlots] = useState<(PreferredItemCategoryId | null)[]>(readPreferredItemSlots);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveSlots = (next: (PreferredItemCategoryId | null)[]) => {
    setSlots(next);
    localStorage.setItem("gameSetting.preferredItemSlots", JSON.stringify(next));
    if (hasTauriRuntime()) {
      void invoke("save_preferred_item_slots_cmd", { slots: next.map((category) => category ?? "") })
        .then(() => setSaveError(null))
        .catch((error) => setSaveError(`Could not save Fortnite config: ${String(error)}`));
    }
  };

  const clearSlot = (slotIndex: number) => {
    saveSlots(slots.map((category, index) => index === slotIndex ? null : category));
  };

  const selectCategory = (category: PreferredItemCategoryId) => {
    if (editingSlot === null) return;
    saveSlots(slots.map((item, index) => index === editingSlot ? category : item));
    setEditingSlot(null);
  };

  return (
    <section className="launcher-surface rounded-md p-6" data-settings-group="security">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-white">Preferred Item Slots</h3>
        <p className="mt-1 text-xs text-slate-400">Choose which item category belongs in each inventory slot.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {slots.map((categoryId, index) => {
          const category = preferredItemCategories.find((item) => item.id === categoryId);
          const Icon = category?.icon;

          return (
            <div key={index} className={`relative min-w-0 overflow-hidden rounded-md border transition-colors ${editingSlot === index ? "border-white/35 bg-white/[0.07]" : "border-white/10 bg-black/20 hover:border-white/25"}`}>
              <button
                type="button"
                onClick={() => setEditingSlot(index)}
                aria-label={`Select item category for slot ${index + 1}${category ? `, currently ${category.label}` : ", empty"}`}
                className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-3 px-3 pt-5 text-center"
              >
                <span className="absolute left-2 top-2 grid h-5 w-5 place-items-center rounded border border-white/15 bg-white/[0.04] text-[10px] font-semibold text-slate-400">{index + 1}</span>
                {Icon ? <Icon size={30} className="shrink-0 text-slate-100" /> : <span className="text-2xl leading-none text-slate-500">+</span>}
                <span className="max-w-full truncate text-xs font-semibold text-slate-200">{category?.label ?? "Choose item"}</span>
              </button>
              {category && (
                <button
                  type="button"
                  onClick={() => clearSlot(index)}
                  aria-label={`Clear slot ${index + 1}`}
                  title="Clear slot"
                  className="absolute right-2 top-2 grid h-5 w-5 cursor-pointer place-items-center rounded text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {saveError && <p role="alert" className="mt-3 text-xs text-red-300">{saveError}</p>}

      {editingSlot !== null && (
        <div className="mt-4 max-w-sm overflow-hidden rounded-md border border-white/10 bg-[#111820]" role="dialog" aria-label={`Select item category for slot ${editingSlot + 1}`}>
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <button type="button" onClick={() => setEditingSlot(null)} aria-label="Close item category picker" className="grid h-8 w-8 cursor-pointer place-items-center rounded border border-white/10 text-slate-300 transition-colors hover:bg-white/5">
              <ChevronLeft size={16} />
            </button>
            <div>
              <p className="text-sm font-semibold text-white">Select Item</p>
              <p className="text-xs text-slate-400">Choose a category for slot {editingSlot + 1}</p>
            </div>
          </div>
          <div className="divide-y divide-white/10">
            {preferredItemCategories.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectCategory(id)}
                aria-pressed={slots[editingSlot] === id}
                className={`flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-white/5 ${slots[editingSlot] === id ? "text-white" : "text-slate-300"}`}
              >
                <Icon size={20} className="shrink-0" />
                <span>{label}</span>
              </button>
            ))}
            <button type="button" onClick={() => { clearSlot(editingSlot); setEditingSlot(null); }} className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left text-sm text-red-300 transition-colors hover:bg-red-400/10">
              <X size={20} className="shrink-0" />
              <span>Clear Slot</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const launcherThemes: { id: LauncherTheme; name: string; accent: string; colors: string[] }[] = [
  { id: "midnight", name: "Lava", accent: "#f04444", colors: ["#180d0b", "#301713", "#f04444"] },
  { id: "ember", name: "Ember", accent: "#ff986a", colors: ["#251612", "#43241c", "#ff986a"] },
  { id: "grove", name: "Grove", accent: "#91d69a", colors: ["#102019", "#1c3427", "#91d69a"] },
  { id: "rose", name: "Rose", accent: "#f0789a", colors: ["#24131d", "#421e31", "#f0789a"] },
];

const tutorialSteps: { tab: TabKey; title: string; description: string }[] = [
  { tab: "home", title: "Welcome to your launcher", description: "Your home page brings together your selected build, recent updates, and the controls for starting a session." },
  { tab: "library", title: "Your game library", description: "Import a Fortnite installation you already have or add a build from the launcher. Select a build here to make it your active version." },
  { tab: "home", title: "Ready when you are", description: "Choose a build in your library, then use Play on Home to start it. You can return here whenever you are ready." },
  { tab: "settings", title: "Set things your way", description: "Appearance, game options, and launcher updates live in Settings. Your preferences are saved on this device." },
];

function formatEta(seconds: number | null) {
  if (seconds === null) return "Calculating time remaining";
  if (seconds < 60) return `${seconds}s remaining`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s remaining`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}

function formatShopCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function parseShopCountdown(value: string) {
  const match = value.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
}

function formatTransferRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSecond} B/s`;
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return "Unknown";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

const TabTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full">
    {children}
  </div>
);

const NavItem = ({ icon, label, id, active, setActive }: {
  icon: React.ReactNode;
  label: string;
  id: TabKey;
  active: TabKey;
  setActive: (value: TabKey) => void;
}) => (
  <button
    onClick={() => setActive(id)}
    data-active={active === id}
    data-tour={id === "library" ? "library" : id === "settings" ? "settings" : undefined}
    aria-label={label}
    title={label}
    className="launcher-nav-item cursor-pointer relative w-full flex items-center gap-3 px-4 py-3 rounded-md transition-all duration-200 group z-10"
  >
    <span className="launcher-nav-icon transition-colors">{icon}</span>
    <span className="text-sm font-medium">{label}</span>
  </button>
);

/* -------------------- Component -------------------- */
export default function Onboard() {
  const navigate = useNavigate();
  const [active, setActive] = useState<TabKey>("home");
  const [preferencesView, setPreferencesView] = useState<PreferencesView>("information");
  const [navigationPosition, setNavigationPosition] = useState<NavigationPosition>(() => {
    const saved = localStorage.getItem("launcherNavigationPosition");
    return saved === "left" || saved === "top" || saved === "bottom" ? saved : "bottom";
  });
  const [customBackground, setCustomBackground] = useState(() => localStorage.getItem("launcherCustomBackground") ?? "");
  const [backgroundMessage, setBackgroundMessage] = useState("");
  const [tutorialStep, setTutorialStep] = useState(() => localStorage.getItem("dust.tutorial.completed.v1") === "true" ? -1 : 0);
  const [path, setPath] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [isHostRunning, setIsHostRunning] = useState(false);
  const [isHostStarting, setIsHostStarting] = useState(false);
  const [hostStatus, setHostStatus] = useState("Host stopped");
  const [erbiumDllPath, setErbiumDllPath] = useState("");
  const [isClosingGame, setIsClosingGame] = useState(false);
  const [user, setUser] = useState<UserData | null>(null);
  const [showGamePasswordPrompt, setShowGamePasswordPrompt] = useState(false);
  const [gamePasswordDraft, setGamePasswordDraft] = useState("");
  const [pendingGameLaunchPath, setPendingGameLaunchPath] = useState<string | null>(null);
  const [builds, setBuilds] = useState<BuildItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [eor, setEor] = useState(() => localStorage.getItem("gameSetting.eor") === "true");
  const [ror, setRor] = useState(() => localStorage.getItem("gameSetting.ror") === "true");
  const [disablePreedits, setDisablePreedits] = useState(() => localStorage.getItem("gameSetting.disablePreedits") === "true");
  const [bubbleBuilds, setBubbleBuilds] = useState(() =>
    localStorage.getItem("gameSetting.bubbleBuilds") === "true" && localStorage.getItem("gameSetting.mobileBuilds") !== "true"
  );
  const [isApplyingBubbleBuilds, setIsApplyingBubbleBuilds] = useState(false);
  const [stretchResolutionEnabled, setStretchResolutionEnabled] = useState(() => localStorage.getItem("gameSetting.stretchResolution") === "true");
  const [resolutionWidth, setResolutionWidth] = useState(() => Number(localStorage.getItem("gameSetting.resolutionWidth")) || 1600);
  const [resolutionHeight, setResolutionHeight] = useState(() => Number(localStorage.getItem("gameSetting.resolutionHeight")) || 1080);
  const [mobileBuilds, setMobileBuilds] = useState(() => localStorage.getItem("gameSetting.mobileBuilds") === "true");
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStatus, setCurrentStatus] = useState("");
  const [warningMsg, setWarningMsg] = useState("");
  const [isBuildDownload, setIsBuildDownload] = useState(false);
  const [downloadEta, setDownloadEta] = useState<number | null>(null);
  const [downloadRate, setDownloadRate] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadTotalBytes, setDownloadTotalBytes] = useState<number | null>(null);
  const [showDownloadDetails, setShowDownloadDetails] = useState(false);
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem("launcherAccentColor") ?? "#f04444");
  const [theme, setTheme] = useState<LauncherTheme>(() => {
    const savedTheme = localStorage.getItem("launcherTheme");
    return launcherThemes.some((item) => item.id === savedTheme) ? savedTheme as LauncherTheme : "midnight";
  });
  const [updateTrackerStatus, setUpdateTrackerStatus] = useState<UpdateTrackerStatus>("browser");
  const [updateManifest, setUpdateManifest] = useState<UpdateManifest | null>(null);
  const [updateTrackerMessage, setUpdateTrackerMessage] = useState("Open the installed desktop launcher to check for updates.");
  const hasAutoCheckedUpdates = useRef(false);

  const checkForUpdates = async () => {
    if (!hasTauriRuntime()) {
      setUpdateTrackerStatus("browser");
      setUpdateTrackerMessage("Update checks are only available in the installed desktop launcher.");
      return;
    }
    if (!Defaults.UPDATER_CONFIGURED) {
      setUpdateTrackerStatus("setup");
      setUpdateTrackerMessage("Automatic updates are disabled for this launcher build.");
      return;
    }

    setUpdateTrackerStatus("checking");
    setUpdateTrackerMessage("Checking the signed GitHub release feed...");
    setUpdateManifest(null);
    let timeoutId: number | undefined;
    try {
      const result = await Promise.race([
        checkUpdate(),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error("Update check timed out after 15 seconds.")),
            15_000,
          );
        }),
      ]);
      if (result.shouldUpdate && result.manifest) {
        setUpdateManifest(result.manifest);
        setUpdateTrackerStatus("available");
        setUpdateTrackerMessage(`Version ${result.manifest.version} is ready to install.`);
      } else {
        setUpdateTrackerStatus("current");
        setUpdateTrackerMessage(`You are on version ${Defaults.LAUNCHER_VERSION}.`);
      }
    } catch (updateError) {
      setUpdateTrackerStatus("error");
      setUpdateTrackerMessage(`Could not check updates. Check your internet connection and the GitHub release feed. ${String(updateError)}`);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  };

  const installAvailableUpdate = async () => {
    if (!hasTauriRuntime() || !updateManifest) return;
    setUpdateTrackerStatus("installing");
    setUpdateTrackerMessage(`Downloading version ${updateManifest.version}...`);
    try {
      await installUpdate();
      setUpdateTrackerMessage("Update installed. The launcher will restart.");
    } catch (updateError) {
      setUpdateTrackerStatus("error");
      setUpdateTrackerMessage(`Update installation failed: ${String(updateError)}`);
    }
  };

  useEffect(() => {
    if (!hasTauriRuntime() || hasAutoCheckedUpdates.current) return;
    hasAutoCheckedUpdates.current = true;
    if (Defaults.UPDATER_CONFIGURED) {
      void checkForUpdates();
    } else {
      setUpdateTrackerStatus("setup");
      setUpdateTrackerMessage("Automatic updates are disabled for this launcher build.");
    }
  }, []);

useEffect(() => {
  const unlistenStart = listen('download-start', () => {
        setIsDownloading(true);
        setIsBuildDownload(false);
        setWarningMsg("");
        setShowDownloadDetails(false);
    });
  const unlistenProgress = listen<number>('download-progress', (e) => setProgress(e.payload));
  const unlistenStatus = listen<string>('update-status', (e) => setCurrentStatus(e.payload));
  const unlistenWarn = listen<string>('download-warning', (e) => {
        setWarningMsg(e.payload);
    });
  const unlistenDone = listen('download-complete', () => {
        setIsDownloading(false);
        setWarningMsg("");
    });
  const unlistenBuildStart = listen('build-download-start', () => {
    setIsDownloading(true);
    setIsBuildDownload(true);
    setProgress(0);
    setDownloadEta(null);
    setDownloadRate(0);
    setDownloadedBytes(0);
    setDownloadTotalBytes(null);
    setShowDownloadDetails(false);
    setCurrentStatus("Connecting to build host...");
    setWarningMsg("");
  });
  const unlistenBuildProgress = listen<BuildDownloadProgress>('build-download-progress', (event) => {
    setProgress(event.payload.percent);
    setDownloadEta(event.payload.etaSeconds);
    setDownloadRate(event.payload.bytesPerSecond);
    setDownloadedBytes(event.payload.downloadedBytes);
    setDownloadTotalBytes(event.payload.totalBytes);
  });
  const unlistenBuildComplete = listen<string>('build-download-complete', () => {
    setProgress(100);
    setCurrentStatus("Build installed");
    setIsDownloading(false);
  });
  const unlistenBuildError = listen<string>('build-download-error', (event) => {
    setWarningMsg(event.payload);
    setIsDownloading(false);
  });

  return () => {
    unlistenWarn.then(f => f());
    unlistenStart.then(f => f());
    unlistenProgress.then(f => f());
    unlistenStatus.then(f => f());
    unlistenDone.then(f => f());
    unlistenBuildStart.then(f => f());
    unlistenBuildProgress.then(f => f());
    unlistenBuildComplete.then(f => f());
    unlistenBuildError.then(f => f());
  };
}, []);

/* -------------------- Panels -------------------- */
const LeaderboardPanel: React.FC = () => {
  const [entries, setEntries] = useState<ArenaLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalEntries, setTotalEntries] = useState(0);
  const pageSize = 100;

  const fetchLeaderboard = async () => {
  setLoading(true);
  if (!hasTauriRuntime()) {
    setEntries([]);
    setTotalEntries(0);
    setLeaderboardError(null);
    setLoading(false);
    return;
  }
  if (!Defaults.ENABLE_API) {
    console.log("Leaderboard API is disabled via Defaults.");
    setEntries([]);
    setTotalEntries(0);
    setLeaderboardError("Leaderboard service is disabled.");
    setLoading(false);
    return;
  }

  try {
    const response = await fetch(`${Defaults.AUTH_API_URL}/api/launcher/leaderboard?page=${page}&limit=${pageSize}`, {
      method: 'GET',
      responseType: ResponseType.JSON,
    });

    if (response.ok) {
      const payload = response.data as { entries?: unknown; total?: unknown } | unknown;
      const responseEntries = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as { entries?: unknown }).entries)
          ? (payload as { entries: unknown[] }).entries
          : null;

      if (!responseEntries) {
        throw new Error("The leaderboard returned an invalid response.");
      }

      const normalizedEntries = responseEntries.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Partial<ArenaLeaderboardEntry>;
        const username = typeof item.username === "string" && item.username.trim()
          ? item.username.trim()
          : "Unknown player";
        return [{
          rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : undefined,
          accountId: typeof item.accountId === "string" ? item.accountId : undefined,
          username,
          hype: Number.isFinite(Number(item.hype)) ? Number(item.hype) : 0,
          division: Number.isFinite(Number(item.division)) ? Number(item.division) : 0,
          discordId: typeof item.discordId === "string" ? item.discordId : undefined,
          avatarHash: typeof item.avatarHash === "string" ? item.avatarHash : undefined,
        }];
      });
      setEntries(normalizedEntries);
      const payloadTotal = payload && typeof payload === "object" ? Number((payload as { total?: unknown }).total) : NaN;
      setTotalEntries(Number.isFinite(payloadTotal) && payloadTotal >= 0 ? payloadTotal : normalizedEntries.length);
      setLeaderboardError(null);
    } else {
      throw new Error(`Leaderboard request failed with HTTP ${response.status}.`);
    }
  } catch (err) {
    console.error("Leaderboard Error:", err);
    setLeaderboardError("Could not load the leaderboard. Check the backend connection and try again.");
  } finally {
    setLoading(false);
  }
};

  useEffect(() => {
    fetchLeaderboard();

    const interval = setInterval(fetchLeaderboard, 600000);

    return () => clearInterval(interval);
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const firstVisibleRank = totalEntries === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisibleRank = Math.min(page * pageSize, totalEntries);

  const getRankStyle = (index: number) => {
    if (index === 0) return { icon: "🥇", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/20" };
    if (index === 1) return { icon: "🥈", color: "text-slate-300", bg: "bg-slate-300/10", border: "border-slate-300/20" };
    if (index === 2) return { icon: "🥉", color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" };
    return { icon: `#${index + 1}`, color: "text-slate-500", bg: "bg-transparent", border: "border-transparent" };
  };

  return (
    <div className="mx-auto flex min-h-full w-full flex-col">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">Competitive</div>
          <h1 className="mt-1 text-2xl font-black uppercase italic text-white">Arena leaderboard</h1>
          <p className="mt-1 text-xs text-slate-400">Players ranked by Arena hype</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold tabular-nums text-white">{totalEntries.toLocaleString()}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Players ranked</div>
        </div>
      </header>

      <div className="leaderboard-table-shell min-w-0">
        <table className="leaderboard-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#101b2a]">
            <tr className="border-b border-white/10 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              <th className="w-24 px-5 py-3">Rank</th>
              <th className="px-5 py-3">Player</th>
              <th className="w-36 px-5 py-3">Division</th>
              <th className="w-36 px-5 py-3 text-right">Hype</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.06]">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-5 py-20 text-center text-sm text-slate-400">
                  Loading rankings...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-20 text-center">
                  <div className="mx-auto flex max-w-md flex-col items-center">
                    <Trophy size={25} className="mb-3 text-slate-500" />
                    <p className="text-sm font-semibold text-slate-200">
                      {leaderboardError ? "Leaderboard Unavailable" : "No rankings yet"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {leaderboardError || "Arena rankings will appear once player scores are recorded."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              entries.map((player, index) => {
                const rankNumber = player.rank ?? ((page - 1) * pageSize + index + 1);
                const rank = getRankStyle(rankNumber - 1);
                return (
                  <tr key={player.accountId || `${rankNumber}-${player.username}`} className="group h-[62px] transition-colors hover:bg-white/[0.035]">
                    <td className="px-5 py-3">
                      <div className={`inline-flex h-8 min-w-9 items-center justify-center border px-2 text-xs font-bold tabular-nums ${rank.bg} ${rank.color} ${rank.border}`}>
                        {rankNumber <= 3 ? rank.icon : `#${rankNumber}`}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden border border-white/10 bg-[#091522]">
                          {player.discordId && player.avatarHash ? (
                            <img 
                              src={`https://cdn.discordapp.com/avatars/${player.discordId}/${player.avatarHash}.png?size=64`} 
                              alt={player.username}
                              className="w-full h-full object-cover"
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <span className="text-xs font-bold text-cyan-300">{player.username.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <span className="truncate text-sm font-semibold text-slate-200 transition-colors group-hover:text-white">
                          {player.username}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Div</span>
                        <span className="text-sm font-bold tabular-nums text-slate-200">{player.division}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-base font-bold tabular-nums text-cyan-300">
                        {player.hype.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-3">
        <p className="text-xs tabular-nums text-slate-400">
          {totalEntries === 0 ? "No players" : `Showing ${firstVisibleRank.toLocaleString()}-${lastVisibleRank.toLocaleString()} of ${totalEntries.toLocaleString()}`}
          <span className="ml-2 text-slate-600">100 per page</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="inline-flex h-9 items-center gap-1 border border-white/10 px-3 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={15} /> Previous
          </button>
          <span className="min-w-20 text-center text-xs font-semibold tabular-nums text-slate-400">Page {page} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            className="inline-flex h-9 items-center gap-1 border border-white/10 px-3 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </div>
  );
};

const ShopPanel: React.FC = () => {
  type CommunityShop = { id: string; title: string; description: string; author: string; createdAt: string; items: CosmeticInfo[] };
  const accountForShops = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null") as UserData | null;
    } catch {
      return null;
    }
  })();
  const [shopData, setShopData] = useState<{ featured: any[]; daily: any[] }>({ featured: [], daily: [] });
  const [cosmetics, setCosmetics] = useState<Record<string, CosmeticInfo>>({});
  const [loading, setLoading] = useState(true);
  const [shopView, setShopView] = useState<"shop" | "community" | "my-shops">("shop");
  const [communityShops, setCommunityShops] = useState<CommunityShop[]>([]);
  const [myCommunityShopIds, setMyCommunityShopIds] = useState<string[]>([]);
  const [communityTitle, setCommunityTitle] = useState("");
  const [communityDescription, setCommunityDescription] = useState("");
  const [cosmeticQuery, setCosmeticQuery] = useState("");
  const [cosmeticResults, setCosmeticResults] = useState<CosmeticInfo[]>([]);
  const [selectedShopItems, setSelectedShopItems] = useState<CosmeticInfo[]>([]);
  const [communityBusy, setCommunityBusy] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [favoriteOfferIds, setFavoriteOfferIds] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("launcherShopFavorites") || "[]");
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const [timeUntilRotation, setTimeUntilRotation] = useState<string>("--:--:--");
  const [rotationDeadline, setRotationDeadline] = useState<number | null>(null);
  const [rotationRefresh, setRotationRefresh] = useState(0);

  const loadCommunityShops = async () => {
    if (!Defaults.ENABLE_API) return;
    try {
      const [feedResponse, ownResponse] = await Promise.all([
        fetch(`${Defaults.AUTH_API_URL}/api/community-shops`, { method: "GET", responseType: ResponseType.JSON }),
        accountForShops?.email && accountForShops.password
          ? fetch(`${Defaults.AUTH_API_URL}/api/community-shops/mine`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: Body.json(accountForShops.authToken ? { authToken: accountForShops.authToken } : { email: accountForShops.email, password: accountForShops.password }),
              responseType: ResponseType.JSON,
            })
          : Promise.resolve(null),
      ]);
      const feedData = (feedResponse.data ?? {}) as { shops?: CommunityShop[] };
      if (feedResponse.ok) setCommunityShops(Array.isArray(feedData.shops) ? feedData.shops : []);
      if (ownResponse?.ok) {
        const ownData = (ownResponse.data ?? {}) as { shops?: CommunityShop[] };
        setMyCommunityShopIds(Array.isArray(ownData.shops) ? ownData.shops.map((shop) => shop.id) : []);
      }
    } catch {
      setCommunityError("Could not load community shops. Check your connection and retry.");
    }
  };

  useEffect(() => {
    void loadCommunityShops();
  }, []);

  const searchCosmetics = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = cosmeticQuery.trim();
    if (!query) return;
    setCommunityBusy(true);
    setCommunityError("");
    try {
      const response = await fetch(`https://fortnite-api.com/v2/cosmetics/br/search?name=${encodeURIComponent(query)}&matchMethod=contains&language=en`, {
        method: "GET",
        responseType: ResponseType.JSON,
      });
      const payload = response.data as { status?: number; data?: any[] };
      const results = Array.isArray(payload?.data) ? payload.data.slice(0, 12).flatMap((item) => {
        const image = item.images?.featured || item.images?.icon || item.images?.smallIcon;
        if (!item.id || !item.name || !image) return [];
        return [{ id: item.id, name: item.name, description: item.description || "", image, rarity: item.rarity?.value || "" }];
      }) : [];
      setCosmeticResults(results);
      if (!results.length) setCommunityError("No matching cosmetics found.");
    } catch {
      setCommunityError("Cosmetic search failed. Try another name.");
    } finally {
      setCommunityBusy(false);
    }
  };

  const publishCommunityShop = async () => {
    if (!accountForShops?.email || (!accountForShops.password && !accountForShops.authToken)) {
      setCommunityError("Sign in again before publishing a community shop.");
      return;
    }
    if (selectedShopItems.length === 0) {
      setCommunityError("Add at least one cosmetic to your shop.");
      return;
    }
    setCommunityBusy(true);
    setCommunityError("");
    try {
      const response = await fetch(`${Defaults.AUTH_API_URL}/api/community-shops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: Body.json({
          email: accountForShops.email,
          password: accountForShops.password,
          authToken: accountForShops.authToken,
          title: communityTitle,
          description: communityDescription,
          items: selectedShopItems,
        }),
        responseType: ResponseType.JSON,
      });
      const payload = (response.data ?? {}) as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Could not publish your shop.");
      setCommunityTitle("");
      setCommunityDescription("");
      setSelectedShopItems([]);
      setCosmeticResults([]);
      setCosmeticQuery("");
      await loadCommunityShops();
    } catch (error) {
      setCommunityError(String(error).replace(/^Error: /, ""));
    } finally {
      setCommunityBusy(false);
    }
  };

  const deleteCommunityShop = async (shopId: string) => {
    if (!accountForShops?.email || !accountForShops.password) return;
    setCommunityBusy(true);
    setCommunityError("");
    try {
      const response = await fetch(`${Defaults.AUTH_API_URL}/api/community-shops/${encodeURIComponent(shopId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: Body.json(accountForShops.authToken ? { authToken: accountForShops.authToken } : { email: accountForShops.email, password: accountForShops.password }),
        responseType: ResponseType.JSON,
      });
      const payload = (response.data ?? {}) as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Could not delete that shop.");
      await loadCommunityShops();
    } catch (error) {
      setCommunityError(String(error).replace(/^Error: /, ""));
    } finally {
      setCommunityBusy(false);
    }
  };

  useEffect(() => {
  const fetchShop = async () => {
    if (!hasTauriRuntime()) {
      setLoading(false);
      return;
    }
    if (!Defaults.ENABLE_API) {
      console.log("Shop API is disabled.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${Defaults.AUTH_API_URL}/api/launcher/shop`, {
        method: 'GET',
        responseType: ResponseType.JSON,
      });
      if (!res.ok) throw new Error("Shop fetch failed");

      const data = res.data as { featured?: any[]; daily?: any[]; timeUntilRotationMs?: number; timeUntilRotationText?: string };
      const featured = Array.isArray(data.featured) ? data.featured : [];
      const daily = Array.isArray(data.daily) ? data.daily : [];
      setShopData({ featured, daily });

      const countdownMs = typeof data.timeUntilRotationMs === "number" && Number.isFinite(data.timeUntilRotationMs)
        ? Math.max(0, data.timeUntilRotationMs)
        : typeof data.timeUntilRotationText === "string"
          ? parseShopCountdown(data.timeUntilRotationText)
          : null;
      if (countdownMs !== null && countdownMs > 0) {
        setRotationDeadline(Date.now() + countdownMs);
        setTimeUntilRotation(formatShopCountdown(countdownMs));
      } else {
        setRotationDeadline(null);
        setTimeUntilRotation(countdownMs === 0 ? "00:00:00" : "--:--:--");
      }

      const offers = [...featured, ...daily];
      const cosmeticMap: Record<string, CosmeticInfo> = {};
      const cosmeticIds: string[] = [...new Set(offers.map((offer) => {
        const grant = Array.isArray(offer.itemGrants) ? offer.itemGrants[0] : offer.itemGrants;
        const templateId = typeof grant === "string" ? grant.split(":")[1] : undefined;
        return templateId ?? "";
      }).filter((id) => Boolean(id)))];

      await Promise.all(cosmeticIds.map(async (rawId) => {
        try {
          const apiRes = await fetch(`https://fortnite-api.com/v2/cosmetics/br/${rawId}`, {
            method: "GET",
            responseType: ResponseType.JSON,
          });
          const apiData = apiRes.data as any;

          if (apiRes.ok && apiData.status === 200) {
            cosmeticMap[rawId] = {
              id: apiData.data.id,
              name: apiData.data.name,
              description: apiData.data.description,
              image: apiData.data.images.featured || apiData.data.images.icon || apiData.data.images.smallIcon,
              rarity: apiData.data.rarity.value,
            };
          }
        } catch (error) {
          console.warn("Failed to fetch cosmetic details for", rawId, error);
        }
      }));

      setCosmetics(cosmeticMap);
    } catch (err) {
      console.error("Shop Error:", err);
    } finally {
      setLoading(false);
    }
  };

  fetchShop();
}, [rotationRefresh]);

  useEffect(() => {
    if (rotationDeadline === null) return;

    const updateCountdown = () => {
      const remainingMs = Math.max(0, rotationDeadline - Date.now());
      setTimeUntilRotation(formatShopCountdown(remainingMs));
      if (remainingMs === 0) {
        setRotationDeadline(null);
        setRotationRefresh((refresh) => refresh + 1);
      }
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [rotationDeadline]);

  useEffect(() => {
    localStorage.setItem("launcherShopFavorites", JSON.stringify(favoriteOfferIds));
  }, [favoriteOfferIds]);

  const getRarityStyle = (rarity: string) => {
    switch (rarity?.toLowerCase()) {
      case "legendary": return { border: "border-orange-500/40", text: "text-orange-400", bg: "from-orange-500/20" };
      case "epic": return { border: "border-purple-500/40", text: "text-purple-400", bg: "from-purple-500/20" };
      case "rare": return { border: "border-blue-500/40", text: "text-blue-400", bg: "from-blue-500/20" };
      case "uncommon": return { border: "border-green-500/40", text: "text-green-400", bg: "from-green-500/20" };
      default: return { border: "border-white/10", text: "text-slate-400", bg: "from-slate-500/10" };
    }
  };

  const RenderSection = (title: string, items: any[], section: "featured" | "daily" | "favorites") => (
    <section className={`shop-offer-section shop-offer-section-${section}`}>
      <header className="shop-offer-heading">
        <div>
          <span>{section === "featured" ? "LIMITED ROTATION" : section === "daily" ? "REFRESHES DAILY" : "SAVED FOR LATER"}</span>
          <h2>{title}</h2>
        </div>
        {section === "featured" && <div className="shop-countdown"><span>Refresh in</span><strong>{timeUntilRotation}</strong></div>}
      </header>
      <div className={`shop-offer-grid ${section === "featured" ? "is-featured" : "is-daily"}`}>
        {items.map((entry) => {
          const rawId = entry.itemGrants?.[0]?.split(":")[1];
          const info = rawId ? cosmetics[rawId] : undefined;
          const style = getRarityStyle(info?.rarity || "");
          const offerId = String(entry.id);
          const isFavorite = favoriteOfferIds.includes(offerId);

          return (
            <article key={offerId} className={`shop-offer-card ${style.border}`}>
              <div className={`shop-offer-art bg-gradient-to-b ${style.bg} to-[#10121b]`}>
                {info?.image ? (
                  <img src={info.image} alt={info.name} onLoad={(event) => event.currentTarget.classList.add("is-loaded")} />
                ) : (
                  <span className="shop-offer-placeholder">{info?.name || rawId || "Loading item"}</span>
                )}
                <button
                  type="button"
                  aria-label={isFavorite ? `Remove ${info?.name || "item"} from My Shops` : `Save ${info?.name || "item"} to My Shops`}
                  aria-pressed={isFavorite}
                  onClick={() => setFavoriteOfferIds((current) => current.includes(offerId) ? current.filter((id) => id !== offerId) : [...current, offerId])}
                  className="shop-offer-favorite"
                >
                  <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
                </button>
                <div className="shop-offer-footer">
                  <div>
                    <span className={style.text}>{info?.rarity || "FORTNITE ITEM"}</span>
                    <h3>{info?.name || rawId || "Cosmetic"}</h3>
                  </div>
                  {entry.price !== null && entry.price !== undefined && (
                    <strong className="shop-offer-price"><img src="https://i.imgur.com/pfmvUEu.png" alt="V-Bucks" />{entry.price}</strong>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const allOffers = [...shopData.featured, ...shopData.daily];
  const favoriteOffers = allOffers.filter((offer) => favoriteOfferIds.includes(String(offer.id)));
  const isShopEmpty = shopData.featured.length === 0 && shopData.daily.length === 0;

  const savedAccount = (() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<UserData> & { email?: string; username?: string; discordId?: string };
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-40 w-full bg-transparent">
        <p className="text-sm text-slate-400">Loading shop...</p>
      </div>
    );
  }

  return (
    <div className="shop-page">
      <section className="shop-account-card mb-6 rounded-2xl border border-white/10 bg-gradient-to-br from-[#0a1a2a] via-[#0b1320] to-[#111827] p-5 shadow-[0_0_30px_rgba(15,118,110,0.14)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-200">
              <UserRound size={22} />
            </div>
            <div>
              <span className="home-panel-kicker">MY ACCOUNT</span>
              <h2 className="mt-1 text-xl font-bold text-white">{savedAccount?.username || "Player"}</h2>
              <p className="text-sm text-slate-400">{savedAccount?.email || "Signed in with launcher account"}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setActive("home")} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
              <Shield size={14} /> Profile
            </button>
            <button type="button" onClick={() => void openExternal(Defaults.DISCORD_LINK)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-400">
              Discord <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </section>

      <header className="shop-page-header">
        <div><span className="home-panel-kicker">FORTNITE / ITEM ROTATION</span><h1>Shop</h1></div>
        <div className="shop-view-tabs" role="tablist" aria-label="Shop views">
          {([{ id: "shop", label: "Shop" }, { id: "community", label: "Community" }, { id: "my-shops", label: "My Shops" }] as const).map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={shopView === id} onClick={() => setShopView(id)}>{label}</button>
          ))}
        </div>
      </header>

      {shopView === "shop" && !isShopEmpty && (
        <div className="shop-page-content">
          {shopData.featured.length > 0 && RenderSection("Featured", shopData.featured, "featured")}
          {shopData.daily.length > 0 && RenderSection("Daily", shopData.daily, "daily")}
        </div>
      )}

      {shopView === "my-shops" && (favoriteOffers.length > 0
        ? RenderSection("My Shops", favoriteOffers, "favorites")
        : <div className="shop-empty-state"><Star size={24} /><h2>No saved items yet</h2><p>Use the star on any cosmetic to keep it here.</p></div>)}

      {shopView === "community" && (
        <div className="community-shops-page">
          <section className="community-shop-builder">
            <header>
              <div><span className="home-panel-kicker">CREATE AND SHARE</span><h2>Build a community shop</h2><p>Put together a cosmetic lineup and publish it for everyone.</p></div>
              <span className="community-shop-limit">{selectedShopItems.length}/12 items</span>
            </header>
            <div className="community-shop-form">
              <label>Shop name<input maxLength={48} value={communityTitle} onChange={(event) => setCommunityTitle(event.target.value)} placeholder="e.g. Neon legends" /></label>
              <label>Description<input maxLength={240} value={communityDescription} onChange={(event) => setCommunityDescription(event.target.value)} placeholder="What's the theme?" /></label>
              <form className="community-cosmetic-search" onSubmit={(event) => void searchCosmetics(event)}>
                <label htmlFor="community-cosmetic-query">Find cosmetics</label>
                <div><input id="community-cosmetic-query" value={cosmeticQuery} onChange={(event) => setCosmeticQuery(event.target.value)} placeholder="Search by cosmetic name" /><button type="submit" disabled={communityBusy || !cosmeticQuery.trim()}><RefreshCw size={15} /> Search</button></div>
              </form>
            </div>

            {cosmeticResults.length > 0 && (
              <div className="community-cosmetic-results">
                {cosmeticResults.map((cosmetic) => {
                  const selected = selectedShopItems.some((item) => item.id === cosmetic.id);
                  return <button type="button" key={cosmetic.id} disabled={selected || selectedShopItems.length >= 12} onClick={() => setSelectedShopItems((items) => [...items, cosmetic])}>
                    <img src={cosmetic.image} alt="" /><span><strong>{cosmetic.name}</strong><small>{cosmetic.rarity || "Cosmetic"}</small></span><Plus size={16} />
                  </button>;
                })}
              </div>
            )}

            {selectedShopItems.length > 0 && <div className="community-shop-selected" aria-label="Selected shop items">
              {selectedShopItems.map((item) => <button type="button" key={item.id} title={`Remove ${item.name}`} onClick={() => setSelectedShopItems((items) => items.filter((entry) => entry.id !== item.id))}><img src={item.image} alt="" /><span>{item.name}</span><X size={13} /></button>)}
            </div>}

            <footer>
              <span>{myCommunityShopIds.length}/5 published shops</span>
              <button type="button" className="launcher-play-button" disabled={communityBusy || myCommunityShopIds.length >= 5 || !communityTitle.trim() || selectedShopItems.length === 0} onClick={() => void publishCommunityShop()}>
                <Plus size={16} /> {communityBusy ? "Working..." : "Publish shop"}
              </button>
            </footer>
            {communityError && <p className="community-shop-message" role="status">{communityError}</p>}
          </section>

          <section className="community-shop-feed">
            <header><div><span className="home-panel-kicker">PLAYER LINEUPS</span><h2>Community shops</h2></div><button type="button" onClick={() => void loadCommunityShops()} title="Refresh community shops" aria-label="Refresh community shops"><RefreshCw size={16} /></button></header>
            {communityShops.length > 0 ? <div className="community-shop-grid">
              {communityShops.map((shop) => <article className="community-shop-card" key={shop.id}>
                <header><div><h3>{shop.title}</h3><p>by {shop.author}</p></div>{myCommunityShopIds.includes(shop.id) && <button type="button" title="Delete your shop" aria-label={`Delete ${shop.title}`} disabled={communityBusy} onClick={() => void deleteCommunityShop(shop.id)}><Trash2 size={15} /></button>}</header>
                {shop.description && <p className="community-shop-description">{shop.description}</p>}
                <div className="community-shop-items">{shop.items.map((item) => <div key={item.id} title={item.name}><img src={item.image} alt={item.name} /><span>{item.name}</span></div>)}</div>
                <footer><span>{shop.items.length} cosmetics</span><time>{new Date(shop.createdAt).toLocaleDateString()}</time></footer>
              </article>)}
            </div> : <div className="community-shop-empty"><UsersRound size={25} /><h3>No shops published yet</h3><p>Build the first lineup and share it with the community.</p></div>}
          </section>
        </div>
      )}

      {shopView === "shop" && isShopEmpty && (
        <div className="shop-empty-state"><ShoppingCart size={24} /><h2>Shop unavailable</h2><p>Connection to the item store was lost. Check back later.</p></div>
      )}
    </div>
  );
};

  /* -------------------- lifecycle / persistence -------------------- */
  useEffect(() => {
    let cancelled = false;
    const savedPath = localStorage.getItem("buildPath");
    if (savedPath) setPath(savedPath);

    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try { setUser(JSON.parse(savedUser)); } catch { /* ignore */ }
    }
    setErbiumDllPath(localStorage.getItem("erbiumDllPath") || "");

    const savedBuilds = localStorage.getItem("SettingsMP.builds");
    if (savedBuilds) {
      try {
        const parsed = JSON.parse(savedBuilds) as BuildItem[];
        setBuilds(parsed);
        if (!savedPath && parsed.length > 0) setPath(parsed[0].path);
        if (hasTauriRuntime()) {
          void Promise.all(parsed.map(async (build) => {
            try {
              const version = await invoke<string>("get_fortnite_version", { gameRoot: build.path });
              return { ...build, version, versionError: undefined };
            } catch (versionError) {
              return { ...build, version: undefined, versionError: String(versionError) };
            }
          })).then((checkedBuilds) => {
            if (cancelled) return;
            setBuilds(checkedBuilds);
            localStorage.setItem("SettingsMP.builds", JSON.stringify(checkedBuilds));
          });
        }
      } catch { /* ignore */ }
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user?.email || (!user.password && !user.authToken) || !Defaults.ENABLE_API) return;

    let cancelled = false;
    let requestInFlight = false;
    const refreshAccountRole = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch(`${Defaults.AUTH_API_URL}/api/auth/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: Body.json(user.authToken ? { authToken: user.authToken } : { email: user.email, password: user.password }),
          responseType: ResponseType.JSON,
        });
        const data = (response.data ?? {}) as { success?: boolean; user?: Partial<UserData> };
        if (!cancelled && response.ok && data.success && data.user) {
          setUser((currentUser) => {
            if (!currentUser) return currentUser;
            const refreshedUser = { ...currentUser, ...data.user, password: currentUser.password };
            localStorage.setItem("user", JSON.stringify(refreshedUser));
            return refreshedUser;
          });
        }
      } catch {
        // Keep the current session visible while the account service is unavailable.
      } finally {
        requestInFlight = false;
      }
    };

    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void refreshAccountRole();
    };
    const timer = window.setInterval(() => void refreshAccountRole(), 30_000);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    void refreshAccountRole();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [user?.email, user?.password]);

  useEffect(() => {
    if (active === "admin" && user?.isAdmin !== true) setActive("home");
  }, [active, user?.isAdmin]);

  useEffect(() => {
    localStorage.setItem("gameSetting.eor", String(eor));
  }, [eor]);

  useEffect(() => {
    localStorage.setItem("gameSetting.ror", String(ror));
  }, [ror]);

  useEffect(() => {
    localStorage.setItem("gameSetting.disablePreedits", String(disablePreedits));
  }, [disablePreedits]);

  useEffect(() => {
    localStorage.setItem("gameSetting.bubbleBuilds", String(bubbleBuilds));
  }, [bubbleBuilds]);

  useEffect(() => {
    localStorage.setItem("gameSetting.mobileBuilds", String(mobileBuilds));
  }, [mobileBuilds]);

  useEffect(() => {
    localStorage.setItem("gameSetting.stretchResolution", String(stretchResolutionEnabled));
    localStorage.setItem("gameSetting.resolutionWidth", String(resolutionWidth));
    localStorage.setItem("gameSetting.resolutionHeight", String(resolutionHeight));
  }, [stretchResolutionEnabled, resolutionWidth, resolutionHeight]);

  useEffect(() => {
    localStorage.setItem("SettingsMP.builds", JSON.stringify(builds));
  }, [builds]);

  useEffect(() => {
    if (path) localStorage.setItem("buildPath", path); else localStorage.removeItem("buildPath");
  }, [path]);

  /* -------------------- Fortnite process polling -------------------- */
  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    const run = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const running = await invoke<boolean>("is_fortnite_client_running");
        const hostRunning = await invoke<boolean>("is_erbium_host_running");
        if (!cancelled) {
          setIsGameRunning(running);
          setIsHostRunning(hostRunning);
          if (running) setIsLaunching(false);
        }
      } catch {
        if (!cancelled && !hasTauriRuntime()) setIsGameRunning(false);
      } finally {
        requestInFlight = false;
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlistenStatus: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    void listen<string>("host-status", (event) => setHostStatus(event.payload)).then((unlisten) => {
      if (active) unlistenStatus = unlisten;
      else unlisten();
    });
    void listen<string>("host-error", (event) => {
      setHostStatus("Host stopped");
      setError(event.payload);
      setTimeout(() => setError(null), 8000);
    }).then((unlisten) => {
      if (active) unlistenError = unlisten;
      else unlisten();
    });

    return () => {
      active = false;
      unlistenStatus?.();
      unlistenError?.();
    };
  }, []);

  /* -------------------- actions -------------------- */
  const requireDesktopRuntime = () => {
    if (hasTauriRuntime()) return true;
    setError("Use the installed desktop launcher for folder access, downloads, and game launch. The browser preview cannot access native features.");
    setTimeout(() => setError(null), 7000);
    return false;
  };

  const handleBuildModeToggle = async (mode: "bubble" | "mobile", enabled: boolean) => {
    if (!requireDesktopRuntime()) return;
    const gameRoots = [...new Set([...builds.map((build) => build.path), ...(path ? [path] : [])])];
    if (gameRoots.length === 0) {
      setError(`Add or select a Fortnite build before changing ${mode === "bubble" ? "Bubble" : "Mobile"} Builds.`);
      setTimeout(() => setError(null), 5000);
      return;
    }

    setIsApplyingBubbleBuilds(true);
    try {
      if (mode === "mobile") {
        if (enabled && bubbleBuilds) {
          await invoke("set_bubble_builds_cmd", { gameRoots, enabled: false });
          setBubbleBuilds(false);
        }
        await invoke("set_mobile_builds_cmd", { gameRoots, enabled });
        setMobileBuilds(enabled);
      } else {
        if (enabled && mobileBuilds) {
          await invoke("set_mobile_builds_cmd", { gameRoots, enabled: false });
          setMobileBuilds(false);
        }
        await invoke("set_bubble_builds_cmd", { gameRoots, enabled });
        setBubbleBuilds(enabled);
      }
    } catch (toggleError) {
      setError(`Could not ${enabled ? "enable" : "disable"} ${mode === "bubble" ? "Bubble" : "Mobile"} Builds: ${String(toggleError)}`);
      setTimeout(() => setError(null), 7000);
    } finally {
      setIsApplyingBubbleBuilds(false);
    }
  };

  const handleLaunch = async (requestedPath?: string, suppliedPassword?: string) => {
    if (!requireDesktopRuntime()) return;
    if (isHostRunning) {
      setError("Stop the Erbium host before launching a player session.");
      setTimeout(() => setError(null), 5000);
      return;
    }
    setIsLaunching(true);
    const launchPath = requestedPath || path || builds[0]?.path;
    if (!launchPath) {
      setError("Please first select a game folder or build in the library.");
      setTimeout(() => setError(null), 5000);
      setIsLaunching(false);
      return;
    }
    if (!user?.email) {
      setError("No verified account details found. Sign in again.");
      setTimeout(() => setError(null), 5000);
      setIsLaunching(false);
      return;
    }
    const gamePassword = suppliedPassword || user.password;
    if (!gamePassword) {
      setPendingGameLaunchPath(requestedPath || null);
      setShowGamePasswordPrompt(true);
      setIsLaunching(false);
      return;
    }

    try {
    if (!Defaults.ENABLE_API) {
      throw new Error("Account verification is disabled. Enable the launcher auth API before launching.");
    }

    const validation = await fetch(`${Defaults.AUTH_API_URL}/api/auth/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Body.json({ email: user.email, password: gamePassword }),
      responseType: ResponseType.JSON,
    });
    const validationData = (validation.data ?? {}) as {
      success?: boolean;
      code?: string;
      message?: string;
      user?: Partial<UserData>;
      ban?: {
        reason: string;
        expiresAt: string | null;
        permanent: boolean;
        canAppeal: boolean;
        appealPending: boolean;
      };
    };
    if (!validation.ok || !validationData.success) {
      setIsLaunching(false);
      if (validation.status === 429) {
        setError("The backend is receiving too many requests. Wait a minute, then try launching again.");
        setTimeout(() => setError(null), 10000);
        return;
      }
      if (validationData.code === "account_banned" && validationData.ban) {
        navigate("/account-status", { state: { user, ban: validationData.ban } });
      } else if (["account_deleted", "credentials_changed", "account_unlinked", "missing_credentials"].includes(validationData.code || "")) {
        localStorage.removeItem("user");
        setUser(null);
        navigate("/login", { state: { authNotice: validationData.message || "Your account is no longer available. Please sign in again." } });
      } else {
        setError(validationData.message || "Could not verify your account. Fortnite was not launched.");
        setTimeout(() => setError(null), 8000);
      }
      return;
    }

    const verifiedUser = { ...user, ...validationData.user, password: gamePassword };
    setUser(verifiedUser);
    localStorage.setItem("user", JSON.stringify(verifiedUser));
    await invoke("set_bubble_builds_cmd", { gameRoots: [launchPath], enabled: bubbleBuilds && !mobileBuilds });
    await invoke("set_mobile_builds_cmd", { gameRoots: [launchPath], enabled: mobileBuilds });
    await invoke("firstlaunch", {
      path: launchPath,
      backendUrl: Defaults.BACKEND_URL,
      email: verifiedUser.email,
      password: verifiedUser.password,
      eor: eor,
      ror: ror,
      disablePreEdits: disablePreedits,
      stretchResolutionEnabled,
      resolutionWidth,
      resolutionHeight,
    });
  } catch (err) {
    setError("Could not verify your account or start Fortnite: " + String(err));
    setIsLaunching(false);
  } finally {
    if (!isGameRunning) setIsLaunching(false);
  }
  };

  const confirmGamePassword = () => {
    const password = gamePasswordDraft;
    if (!password) return;
    const updatedUser = user ? { ...user, password } : null;
    if (updatedUser) {
      setUser(updatedUser);
      localStorage.setItem("user", JSON.stringify(updatedUser));
    }
    setShowGamePasswordPrompt(false);
    setGamePasswordDraft("");
    void handleLaunch(pendingGameLaunchPath || undefined, password);
  };

  const selectErbiumDll = async () => {
    if (!requireDesktopRuntime()) return null;
    const selected = await open({
      multiple: false,
      title: "Select the built Erbium.dll",
      filters: [{ name: "Erbium DLL", extensions: ["dll"] }],
    });
    if (typeof selected !== "string") return null;
    setErbiumDllPath(selected);
    localStorage.setItem("erbiumDllPath", selected);
    return selected;
  };

  const handleErbiumHost = async () => {
    if (!requireDesktopRuntime()) return;
    if (user?.isAdmin !== true) {
      setError("Only launcher admins can start the Erbium host.");
      setTimeout(() => setError(null), 5000);
      return;
    }
    if (isHostRunning) {
      try {
        await invoke("stop_erbium_host");
        setHostStatus("Stopping host...");
      } catch (stopError) {
        setError("Could not stop Erbium host: " + String(stopError));
        setTimeout(() => setError(null), 6000);
      }
      return;
    }
    if (!user?.email || !user.password) {
      setError("Sign in with a game account before starting the host.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    const gameRoot = path || builds[0]?.path;
    if (!gameRoot) {
      setError("Add or select the Fortnite 13.40 build first.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    let dllPath = erbiumDllPath;
    if (!dllPath) {
      const selected = await selectErbiumDll();
      if (!selected) return;
      dllPath = selected;
    }

    setIsHostStarting(true);
    setHostStatus("Preparing Erbium host...");
    try {
      const largepakpatchDllPath = await invoke<string>("get_largepakpatch_path");
      await invoke("start_erbium_host", {
        gameRoot,
        email: user.email,
        password: user.password,
        erbiumDllPath: dllPath,
        largepakpatchDllPath,
      });
      setIsHostRunning(true);
    } catch (hostError) {
      setHostStatus("Host stopped");
      setError("Could not start Erbium host: " + String(hostError));
      setTimeout(() => setError(null), 8000);
    } finally {
      setIsHostStarting(false);
    }
  };

  const handleCloseGame = async () => {
    if (!requireDesktopRuntime()) return;
    setIsClosingGame(true);
    try {
      await invoke("close_fortnite_client");
    } catch (closeError) {
      setError(`Could not close Fortnite: ${String(closeError)}`);
      setTimeout(() => setError(null), 7000);
    } finally {
      setIsClosingGame(false);
    }
  };

  const handleLogout = () => {
    if (user?.authToken && Defaults.ENABLE_API) {
      void fetch(`${Defaults.AUTH_API_URL}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: Body.json({ authToken: user.authToken }),
        responseType: ResponseType.JSON,
      }).catch(() => {});
    }
    localStorage.removeItem("user");
    setUser(null);
    navigate("/login");
  };

  /* -------------------- builds -------------------- */
  const addBuild = async () => {
    if (!requireDesktopRuntime()) return;
    const selected = await open({ 
      directory: true,
      multiple: false,
      title: "Select Fortnite Folder",
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const hasEngine = await exists(await join(selected, "Engine"));
      if (!hasEngine) {
        setError("Invalid build: The folder must contain an 'Engine' folder.");
        setTimeout(() => setError(null), 5000);
        return;
      }
      let gameVersion: string | undefined;
      try { gameVersion = await invoke<string>("get_fortnite_version", { gameRoot: selected }); } catch { /* Version display is optional. */ }
      if (builds.length >= 2) {
        setError("Maximum builds in library reached (2). Remove one first.");
        setTimeout(() => setError(null), 5000);
        return;
      }

      const splashPath = await join(selected, "FortniteGame", "Content", "Splash", "Splash.bmp");
      const hasSplash = await exists(splashPath);

      let coverDataUrl: string | undefined;
      if (hasSplash) {
        const bytes = await readBinaryFile(splashPath);
        const b64 = bytesToBase64(bytes);
        coverDataUrl = "data:image/bmp;base64," + b64;
      }

      const item: BuildItem = {
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
        path: selected,
        name: getFolderName(selected),
        version: gameVersion,
        coverDataUrl,
      };
      const updatedBuilds = [item, ...builds];
      setBuilds(updatedBuilds);
      setPath(selected);
      localStorage.setItem("SettingsMP.builds", JSON.stringify(updatedBuilds));
    } catch (e) {
      setError("Could not add build: " + String(e));
      setTimeout(() => setError(null), 5000);
      return;
    }
    try {
      await invoke("sync_paks_cmd", { gameRoot: selected });
    } catch (err) {
      console.error("Could not sync local PAK files:", err);
      setError("Could not copy PAK/SIG files from Documents\\Project Fishk\\Paks: " + String(err));
      setTimeout(() => setError(null), 6000);
    }
  };

  const downloadBuild = async () => {
    if (!requireDesktopRuntime()) return;
    if (builds.length >= 2) {
      setError("The library is full. Remove a build before downloading another.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    try {
      const previousDestination = localStorage.getItem("buildDownloadDirectory") ?? undefined;
      const destination = await open({
        directory: true,
        multiple: false,
        title: "Choose where to install the build",
        defaultPath: previousDestination,
      });
      if (!destination || typeof destination !== "string") return;

      localStorage.setItem("buildDownloadDirectory", destination);
      setIsDownloading(true);
      setIsBuildDownload(true);
      setProgress(0);
      setDownloadEta(null);
      setDownloadRate(0);
      setCurrentStatus("Connecting to build host...");
      setWarningMsg("");

      const installedPath = await invoke<string>("download_build_cmd", { destination });
      let gameVersion: string | undefined;
      try { gameVersion = await invoke<string>("get_fortnite_version", { gameRoot: installedPath }); } catch { /* Version display is optional. */ }
      const splashPath = await join(installedPath, "FortniteGame", "Content", "Splash", "Splash.bmp");
      let coverDataUrl: string | undefined;
      if (await exists(splashPath)) {
        coverDataUrl = `data:image/bmp;base64,${bytesToBase64(await readBinaryFile(splashPath))}`;
      }

      const item: BuildItem = {
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
        path: installedPath,
        name: getFolderName(installedPath),
        version: gameVersion,
        coverDataUrl,
      };
      const updatedBuilds = [item, ...builds];
      setBuilds(updatedBuilds);
      setPath(installedPath);
      localStorage.setItem("SettingsMP.builds", JSON.stringify(updatedBuilds));
      setActive("home");
    } catch (downloadError) {
      const message = `Could not download build: ${String(downloadError)}`;
      setError(message);
      setTimeout(() => setError(null), 7000);
    } finally {
      setIsDownloading(false);
    }
  };
  

  const removeBuild = (id: string) => {
    setBuilds((prev) => {
      const next = prev.filter((b) => b.id !== id);
      const removed = prev.find((b) => b.id === id);
      localStorage.setItem("SettingsMP.builds", JSON.stringify(next));
      if (removed && removed.path === path) {
        if (next[0]) setPath(next[0].path); else setPath(null);
      }
      return next;
    });
  };


const CustomTitleBar = () => (
  <div 
    data-tauri-drag-region 
    className="launcher-titlebar h-8 w-full bg-[#071422]/90 border-b border-white/10 flex justify-between items-center fixed top-0 left-0 z-[999] backdrop-blur-md select-none rounded-t-xl"
  >
    <div data-tauri-drag-region className="launcher-titlebar-brand pl-4">{Defaults.LAUNCHER_NAME}</div>

    <div className="flex h-full">
      <button 
        onClick={() => appWindow.minimize()}
        type="button"
        title="Minimize"
        aria-label="Minimize"
        className="px-4 h-full hover:bg-white/10 text-slate-400 transition-colors cursor-pointer"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={async () => {
          const fullscreen = await appWindow.isFullscreen();
          await appWindow.setFullscreen(!fullscreen);
        }}
        title="Toggle fullscreen"
        aria-label="Toggle fullscreen"
        className="px-4 h-full hover:bg-white/10 text-slate-400 transition-colors cursor-pointer"
      >
        <Maximize2 size={14} />
      </button>
      <button 
        onClick={() => appWindow.close()}
        type="button"
        title="Close"
        aria-label="Close"
        className="px-4 h-full hover:bg-red-600 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-tr-xl"
      >
        <X size={14} />
      </button>
    </div>
  </div>
);
type HardwareInfo = {
  cpu_name: string;
  cpu_cores: number;
  cpu_threads: number;
  gpu_name: string;
  ram_gb: number;
  os_drive_type: string;
};

const HardwareDelayCard: React.FC = () => {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!hasTauriRuntime()) {
      setLoadError("Hardware detection is available in the installed launcher.");
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<HardwareInfo>("hardware-info-ready", (event) => {
        if (!cancelled) {
          setHardware(event.payload);
          setLoadError("");
        }
      });
      const info = await invoke<HardwareInfo | null>("get_hardware_info");
      if (!cancelled && info) setHardware(info);
    })().catch((error) => {
      if (!cancelled) setLoadError(`Hardware scan failed: ${String(error)}`);
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const driveLabel = hardware?.os_drive_type.toLowerCase().includes("ssd")
    ? "SSD"
    : hardware?.os_drive_type.toLowerCase().includes("hdd")
      ? "HDD"
      : hardware?.os_drive_type ?? "Detecting";

  return (
    <section className="launcher-surface rounded-md p-6" data-settings-group="security">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Hardware information</h3>
          <p className="mt-1 text-xs text-slate-400">Detected system specifications.</p>
        </div>
      </div>

      {loadError ? (
        <p role="status" className="text-xs text-slate-400">{loadError}</p>
      ) : hardware ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Processor</dt>
            <dd className="mt-1 break-words text-sm font-medium text-slate-100">{hardware.cpu_name}</dd>
            <dd className="mt-0.5 text-xs text-slate-400">{hardware.cpu_cores} cores / {hardware.cpu_threads} threads</dd>
          </div>
          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Graphics</dt>
            <dd className="mt-1 break-words text-sm font-medium text-slate-100">{hardware.gpu_name}</dd>
          </div>
          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Memory</dt>
            <dd className="mt-1 text-sm font-medium text-slate-100">{hardware.ram_gb.toFixed(1)} GB RAM</dd>
          </div>
          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">System drive</dt>
            <dd className="mt-1 text-sm font-medium text-slate-100">{driveLabel}</dd>
          </div>
        </dl>
      ) : (
        <p role="status" className="text-xs text-slate-400">Scanning system hardware...</p>
      )}
    </section>
  );
};

/* -------------------- UI pieces (Epic-like) -------------------- */

// left nav (compact Epic style)
interface LeftNavProps {
  active: TabKey;
  setActive: (val: TabKey) => void;
  user: UserData | null;
  handleLogout: () => void;
}

const LeftNav: React.FC<LeftNavProps> = ({ active, setActive, user, handleLogout }) => (
<div className="launcher-sidebar border-r flex flex-col relative z-20">
  {/* Logo Section */}
  <div className="h-12 mb-4 flex items-center justify-start gap-3 px-2">
    <div className="launcher-brand-mark h-9 w-9 rounded-full bg-[#07080a] border border-white/10 flex items-center justify-center overflow-hidden relative">
      <img 
        src={Defaults.LOGO_URL} 
        alt="Logo" 
        className="w-full h-full object-cover transition-transform duration-500 hover:scale-110" 
      />
      <div className="absolute inset-0 border border-blue-500/10 rounded-xl pointer-events-none" />
    </div>
    <span className="launcher-brand-name truncate">{Defaults.LAUNCHER_NAME}</span>
  </div>

    {/* Navigation */}
    <nav className="px-2 space-y-1 flex-1">
      <NavItem icon={<Home size={18} />} label="Home" id="home" active={active} setActive={setActive} />
      <NavItem icon={<Grid size={18} />} label="Library" id="library" active={active} setActive={setActive} />
      <NavItem icon={<ShoppingCart size={18} />} label="Shop" id="shop" active={active} setActive={setActive} />
      <NavItem icon={<Trophy size={18} />} label="Compete" id="leaderboard" active={active} setActive={setActive} />
      {user?.isAdmin === true && (
        <NavItem icon={<Shield size={18} />} label="Admin" id="admin" active={active} setActive={setActive} />
      )}
      <div className="my-4 mx-4 h-px bg-white/5" />
      
      <NavItem icon={<Settings size={18} />} label="Settings" id="settings" active={active} setActive={setActive} />
    </nav>

    {/* Bottom Profile */}
    <div className="launcher-profile p-2 mt-auto border-t border-white/5 bg-black/20">
      <div className="flex items-center gap-2">
        <div className="h-10 w-10 rounded-xl border border-white/15 overflow-hidden bg-[#292b47]">
           <img 
             src={user?.discordId && user?.avatarHash 
               ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatarHash}.png?size=64`
               : `https://ui-avatars.com/api/?name=${user?.username || 'G'}&background=0ea5e9&color=fff`
             } 
             className="w-full h-full object-cover" 
           />
        </div>
        <div className="launcher-profile-copy min-w-0 flex-1">
          <p className="text-[10px] text-slate-500">Signed in</p>
          <p className="truncate text-xs font-semibold text-slate-200">{user?.username ?? user?.email?.split("@")[0] ?? "Player"}</p>
          <p className="text-[9px] font-bold uppercase tracking-wider text-cyan-300">{user?.role ?? "USER"}</p>
        </div>
      <button 
        onClick={handleLogout} 
        aria-label="Sign out"
        title="Sign out"
        className="cursor-pointer p-1.5 text-slate-500 hover:text-red-400 transition-colors"
      >
        <LogOut size={16} />
      </button>
      </div>
    </div>
  </div>
);

  const AdminPanelView: React.FC<{ user: UserData | null; onOpenDiscord: () => void; onRefreshSession: () => void; onOpenHost: () => void; onOpenSettings: () => void; }> = ({ user, onOpenDiscord, onRefreshSession, onOpenHost, onOpenSettings }) => {
  const adminCommands = [
    "/lookup <user>",
    "/ban <user>",
    "/kick <user>",
    "/unban <user>",
    "/add-item <user> <template>",
    "/set-level <user> <level>",
    "/give-vbucks <user> <amount>",
    "/full-locker <user>",
    "/set-banner <user> <icon> <color>",
    "/wipe-account <user>",
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Staff tools</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Admin</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRefreshSession} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/5">Refresh session</button>
          <button type="button" onClick={onOpenHost} className="launcher-play-button inline-flex h-10 cursor-pointer items-center gap-2 px-4 text-sm font-semibold">Start Erbium host</button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-white/10 bg-[#0b1724]/70 p-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-200">
              <Shield size={20} />
            </div>
            <div>
              <span className="home-panel-kicker">MODERATOR PANEL</span>
              <h2 className="mt-1 text-xl font-bold text-white">{user?.username ?? user?.email?.split("@")[0] ?? "Staff"}</h2>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Account</p>
              <p className="mt-2 text-sm font-semibold text-white">{user?.email ?? "No email"}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Discord</p>
              <p className="mt-2 text-sm font-semibold text-white">{user?.discordId ? `Linked (${user.discordId})` : "Not linked"}</p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Admin notes</p>
            <p className="mt-2 text-sm leading-6 text-slate-200">
              Use the Discord staff bot for live backend moderation. This launcher panel is for quick access, session refresh, and launcher-side staff checks.
            </p>
          </div>
        </section>

        <aside className="rounded-2xl border border-white/10 bg-[#0d1a22]/80 p-5 shadow-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Staff actions</p>
          <div className="mt-4 space-y-3">
            <button type="button" onClick={onOpenDiscord} className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm font-medium text-white transition hover:bg-white/10">
              <span>Open Discord staff server</span>
              <ArrowUpRight size={15} />
            </button>
            <button type="button" onClick={() => void openExternal(Defaults.DISCORD_LINK)} className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm font-medium text-white transition hover:bg-white/10">
              <span>Open Discord commands</span>
              <ArrowUpRight size={15} />
            </button>
            <button type="button" onClick={onOpenSettings} className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm font-medium text-white transition hover:bg-white/10">
              <span>Open launcher settings</span>
              <ChevronRight size={15} />
            </button>
          </div>
        </aside>
      </div>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#0b1724]/70 p-5 shadow-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Command reference</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {adminCommands.map((command) => (
            <div key={command} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-medium text-slate-200">{command}</div>
          ))}
        </div>
      </section>
    </div>
  );
};

const LibraryPanel: React.FC = () => (
    <div className="mx-auto w-full">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Game installations</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Library</h1>
          <p className="mt-1 text-sm text-slate-400">{builds.length} of 2 builds installed</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadBuild} disabled={builds.length >= 2} className="launcher-play-button inline-flex h-10 cursor-pointer items-center gap-2 px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45">
            <CloudDownload size={16} /> Download build
          </button>
          <button type="button" onClick={addBuild} disabled={builds.length >= 2} className="inline-flex h-10 cursor-pointer items-center gap-2 border border-white/15 px-4 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45">
            <Plus size={16} /> Add existing
          </button>
        </div>
      </header>

      {builds.length === 0 ? (
        <div className="mt-5 grid min-h-[260px] grid-cols-1 overflow-hidden border border-white/10 bg-black/20 md:grid-cols-[minmax(240px,0.8fr)_1.2fr]">
          <div className="relative min-h-44 overflow-hidden bg-[#071823]">
            <img src={Defaults.PLACEHOLDER_IMAGE} alt="Fortnite build artwork" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#101619]/80" />
          </div>
          <div className="flex flex-col justify-center p-6 md:p-9">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Nothing installed</span>
            <h2 className="mt-2 text-2xl font-bold text-white">Add your first build</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">Download a ready-to-play installation or add a Fortnite build already on this device.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={downloadBuild} className="launcher-play-button inline-flex h-10 cursor-pointer items-center gap-2 px-4 text-sm font-semibold">
                <CloudDownload size={16} /> Download build
              </button>
              <button type="button" onClick={addBuild} className="inline-flex h-10 cursor-pointer items-center gap-2 border border-white/15 px-4 text-sm font-semibold text-slate-200 hover:bg-white/5">
                <Plus size={16} /> Add existing
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="library-build-grid mt-5">
          {builds.map((build) => {
            const selected = build.path === path;
            return (
              <article key={build.id} className={`library-build-card ${selected ? "is-selected" : ""}`}>
                <button type="button" className="library-build-poster" aria-pressed={selected} onClick={() => setPath(build.path)}>
                  <div className="library-build-art">
                  {build.coverDataUrl ? (
                    <img src={build.coverDataUrl} alt={`${build.name} cover`} />
                  ) : (
                    <img src={Defaults.PLACEHOLDER_IMAGE} alt="Fortnite build artwork" />
                  )}
                  <span className="library-build-poster-shade" />
                  <span className="library-build-poster-copy">
                    <span>{selected ? "SELECTED BUILD" : "FORTNITE BUILD"}</span>
                    <strong>{build.name}</strong>
                    <small>{getFolderName(build.path)}</small>
                  </span>
                  </div>
                </button>

                <div className="library-build-card-footer">
                  <span>{build.version ? `v${build.version}` : build.versionError ? "Version unknown" : "Detecting version"}</span>
                  <div>
                    <button type="button" onClick={() => setPath(build.path)} disabled={selected} className="library-build-select">
                      {selected ? "Selected" : "Select"}
                    </button>
                    <button type="button" onClick={() => void handleLaunch(build.path)} disabled={isLaunching} className="library-build-launch">
                      <Play size={13} fill="currentColor" /> Launch
                    </button>
                    <button type="button" onClick={() => removeBuild(build.id)} title={`Remove ${build.name}`} aria-label={`Remove ${build.name}`} className="library-build-remove">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );

  /* News / patch notes full list */
const SettingsPanel: React.FC<{
  eor: boolean; setEor: (v: boolean) => void;
  ror: boolean; setRor: (v: boolean) => void;
  disablePreedits: boolean;
  setDisablePreedits: (v: boolean) => void;
  bubbleBuilds: boolean; setBubbleBuilds: (v: boolean) => void;
  isApplyingBubbleBuilds: boolean;
  stretchResolutionEnabled: boolean; setStretchResolutionEnabled: (v: boolean) => void;
  resolutionWidth: number; setResolutionWidth: (v: number) => void;
  resolutionHeight: number; setResolutionHeight: (v: number) => void;
  mobileBuilds: boolean; setMobileBuilds: (v: boolean) => void;
  accentColor: string; setAccentColor: (color: string) => void;
  theme: LauncherTheme; onSelectTheme: (theme: LauncherTheme) => void;
  navigationPosition: NavigationPosition; onSelectNavigationPosition: (position: NavigationPosition) => void;
  customBackground: string; backgroundMessage: string;
  onSelectBackground: (file?: File) => void; onResetBackground: () => void;
  updateTrackerStatus: UpdateTrackerStatus;
  updateTrackerMessage: string;
  updateManifest: UpdateManifest | null;
  onOpenPakFolder: () => void;
  onCheckForUpdates: () => void;
  onInstallAvailableUpdate: () => void;
  preferencesView: PreferencesView; onSelectPreferencesView: (view: PreferencesView) => void;
  user: UserData | null; onSignOut: () => void;
}> = ({ eor, setEor, ror, setRor, bubbleBuilds, setBubbleBuilds, isApplyingBubbleBuilds, stretchResolutionEnabled, setStretchResolutionEnabled, resolutionWidth, setResolutionWidth, resolutionHeight, setResolutionHeight, mobileBuilds, setMobileBuilds, accentColor, setAccentColor, theme, onSelectTheme, navigationPosition, onSelectNavigationPosition, customBackground, backgroundMessage, onSelectBackground, onResetBackground, preferencesView, onSelectPreferencesView, user, onSignOut, updateTrackerStatus, updateTrackerMessage, updateManifest, onOpenPakFolder, onCheckForUpdates, onInstallAvailableUpdate }) => {

  return (
    <div className="settings-page mx-auto max-w-6xl" data-settings-view={preferencesView}>
      <div className="settings-layout">
        <aside className="settings-rail" aria-label="Settings categories">
          <div className="settings-rail-label">Launcher</div>
          <button type="button" role="tab" aria-selected={preferencesView === "information"} onClick={() => onSelectPreferencesView("information")}>
            <Info size={16} /><span>Information</span><ChevronRight size={14} />
          </button>
          <button type="button" role="tab" aria-selected={preferencesView === "appearance"} onClick={() => onSelectPreferencesView("appearance")}>
            <Palette size={16} /><span>Appearance</span><ChevronRight size={14} />
          </button>
          <button type="button" role="tab" aria-selected={preferencesView === "security"} onClick={() => onSelectPreferencesView("security")}>
            <Shield size={16} /><span>Security</span><ChevronRight size={14} />
          </button>
          <button type="button" role="tab" aria-selected={preferencesView === "overlay"} onClick={() => onSelectPreferencesView("overlay")}>
            <PanelsTopLeft size={16} /><span>Overlay</span><small>Soon</small>
          </button>
          <div className="settings-rail-label settings-rail-profile-label">Profile</div>
          <button type="button" role="tab" aria-selected={preferencesView === "account"} onClick={() => onSelectPreferencesView("account")}>
            <UserRound size={16} /><span>Account</span><ChevronRight size={14} />
          </button>
        </aside>

        <main className="settings-main">
          <header className="preferences-header">
            <div>
              <span className="home-panel-kicker">SETTINGS</span>
              <h1>{preferencesView === "information" ? "Settings" : preferencesView === "account" ? "Account" : preferencesView === "overlay" ? "Overlay" : preferencesView === "appearance" ? "Appearance" : "Security"}</h1>
              <p>{preferencesView === "information" ? "Configure launcher & build options" : preferencesView === "account" ? "Your launcher account" : preferencesView === "overlay" ? "In-game tools" : preferencesView === "appearance" ? "Personalize the launcher" : "Game and system options"}</p>
            </div>
          </header>

          {preferencesView === "information" && (
            <section className="settings-info-content">
              <article className="settings-product-card">
                <div className="settings-product-logo"><img src={Defaults.LOGO_URL} alt="" /><span><Newspaper size={22} /></span></div>
                <div><h2>{Defaults.LAUNCHER_NAME}</h2><p>{Defaults.LAUNCHER_NAME} v{Defaults.LAUNCHER_VERSION}</p><small>Launcher made for the community.</small></div>
              </article>
              <section className="settings-support">
                <h2>Support</h2>
                <div className="settings-support-actions">
                  <button type="button" onClick={() => void openExternal(Defaults.DISCORD_LINK)}>Discord Server <UsersRound size={16} /></button>
                  <button type="button" onClick={onCheckForUpdates} disabled={updateTrackerStatus === "browser" || updateTrackerStatus === "setup" || updateTrackerStatus === "checking"}>Check for updates <RefreshCw size={16} /></button>
                  <button type="button" onClick={() => void openExternal(Defaults.DISCORD_LINK)}>Report a Problem <AlertTriangle size={16} /></button>
                </div>
                <p>{updateTrackerMessage}</p>
              </section>
            </section>
          )}

          {preferencesView === "account" && (
            <section className="settings-account-card launcher-surface">
              <div className="settings-account-avatar"><UserRound size={22} /></div>
              <div className="min-w-0"><span className="home-panel-kicker">SIGNED IN</span><h2>{user?.username ?? user?.email?.split("@")[0] ?? "Player"}</h2><p>{user?.email ?? "No account email"}</p></div>
              <button type="button" onClick={onSignOut} className="settings-signout-button">Sign out</button>
            </section>
          )}

          {preferencesView === "overlay" && (
            <section className="settings-overlay-soon launcher-surface"><PanelsTopLeft size={25} /><span className="home-panel-kicker">COMING SOON</span><h2>In-game overlay</h2><p>Quick access to launcher tools while you play.</p></section>
          )}

          <div className="settings-grid grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">

        <HardwareDelayCard />

        <PreferredItemSlots />
        
        {/* GAMEPLAY MECHANICS CARD */}
        <div data-settings-group="security" className="p-10 rounded-2xl border-2 border-white/10 bg-[#0b1724]/60 backdrop-blur-xl shadow-2xl transition-all hover:bg-[#0b1724]/80 flex flex-col justify-between">
          <h3 className="mb-5 text-xs font-black uppercase tracking-[0.18em] text-blue-300">Gameplay</h3>
          <div className="flex items-center justify-between group">
            <div>
              <p className="text-sm font-black text-slate-200 group-hover:text-white transition-colors uppercase italic tracking-tighter">Edit on Release</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Instant Edit</p>
            </div>
            <button
              type="button"
              onClick={() => setEor(!eor)} 
              className={`cursor-pointer relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 ${eor ? "bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)]" : "bg-white/10"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${eor ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="h-px bg-white/5" />

          {/* Reset on Release */}
          <div className="flex items-center justify-between group">
            <div>
              <p className="text-sm font-black text-slate-200 group-hover:text-white transition-colors uppercase italic tracking-tighter">Reset on Release</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Confirms a reset when released</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={ror}
              aria-label="Reset on Release"
              onClick={() => setRor(!ror)}
              className={`relative inline-flex h-7 w-12 cursor-pointer items-center rounded-full transition-all duration-300 ${ror ? "bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)]" : "bg-white/10"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${ror ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="h-px bg-white/5" />

          {/* Disable Pre-edits */}
          <div className="flex items-center justify-between group">
            <div>
              <p className="text-sm font-black text-slate-200 group-hover:text-white transition-colors uppercase italic tracking-tighter">Disable Pre-edits</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Removes Pre-edit delay</p>
            </div>
            <button
              type="button"
              onClick={() => setDisablePreedits(!disablePreedits)} 
              className={`cursor-pointer relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 ${disablePreedits ? "bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)]" : "bg-white/10"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${disablePreedits ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="pt-6" /> 
        </div>
        <div data-settings-group="security" className="settings-display-card p-8 rounded-2xl border-2 border-white/10 bg-[#0b1724]/60 backdrop-blur-xl shadow-2xl transition-all hover:bg-[#0b1724]/80">
          <div className="mb-6">
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Display</h3>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Resolution</p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase italic tracking-tighter text-slate-200">Stretch resolution</p>
              <p className="mt-0.5 text-xs text-slate-500">Applies when Fortnite launches</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Stretch resolution"
              aria-checked={stretchResolutionEnabled}
              onClick={() => setStretchResolutionEnabled(!stretchResolutionEnabled)}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-all ${stretchResolutionEnabled ? "bg-cyan-500" : "bg-white/10"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${stretchResolutionEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className={`mt-6 grid grid-cols-2 gap-3 ${stretchResolutionEnabled ? "" : "opacity-45"}`}>
            <label className="text-xs font-semibold text-slate-400">
              Width
              <input
                type="number"
                min={640}
                max={7680}
                step={10}
                value={resolutionWidth}
                disabled={!stretchResolutionEnabled}
                onChange={(event) => setResolutionWidth(Math.max(640, Math.min(7680, Number(event.target.value) || 1600)))}
                className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60 disabled:cursor-not-allowed"
              />
            </label>
            <label className="text-xs font-semibold text-slate-400">
              Height
              <input
                type="number"
                min={480}
                max={4320}
                step={10}
                value={resolutionHeight}
                disabled={!stretchResolutionEnabled}
                onChange={(event) => setResolutionHeight(Math.max(480, Math.min(4320, Number(event.target.value) || 1080)))}
                className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60 disabled:cursor-not-allowed"
              />
            </label>
          </div>
          <div className="settings-resolution-preview mt-5 flex min-h-28 items-center justify-center rounded-md border border-white/10 bg-black/25 p-3">
            <div
              className="settings-resolution-screen flex max-h-24 max-w-full items-center justify-center border border-cyan-300/50 bg-cyan-300/10 px-3 text-center text-xs font-semibold text-cyan-100"
              style={{ aspectRatio: `${resolutionWidth} / ${resolutionHeight}`, width: `${Math.min(100, (resolutionWidth / resolutionHeight) * 56)}%` }}
            >
              {resolutionWidth} x {resolutionHeight}
            </div>
          </div>
        </div>
        {/* RIGHT COLUMN */}
        <div data-settings-group="security" className="flex flex-col gap-6">
          <div className="p-8 rounded-2xl border-2 border-white/10 bg-[#0b1724]/60 backdrop-blur-xl shadow-2xl transition-all hover:bg-[#0b1724]/80">
            <div className="flex items-center gap-4 mb-10">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.1)]">
                <Grid size={24} />
              </div>
              <div>
                <h4 className="text-sm font-black text-white uppercase tracking-tight italic">Performance</h4>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Visual</p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="flex items-center justify-between group">
                <div>
                  <p className="text-sm font-black text-slate-200 group-hover:text-white transition-colors uppercase italic tracking-tighter">Bubble Builds</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Installs or removes the Bubble pack</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bubbleBuilds}
                  disabled={isApplyingBubbleBuilds}
                  onClick={() => void setBubbleBuilds(!bubbleBuilds)}
                  className={`cursor-pointer relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 disabled:cursor-wait disabled:opacity-60 ${bubbleBuilds ? "bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)]" : "bg-white/10"}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${bubbleBuilds ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>

              <div className="h-px bg-white/5" />

              <div className="flex items-center justify-between group">
                <div>
                  <p className="text-sm font-black text-slate-200 group-hover:text-white transition-colors uppercase italic tracking-tighter">Mobile Builds</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Installs Low Mesh PAKs; disables Bubble Builds</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={mobileBuilds}
                  aria-label="Mobile Builds"
                  disabled={isApplyingBubbleBuilds}
                  onClick={() => setMobileBuilds(!mobileBuilds)}
                  className={`cursor-pointer relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 disabled:cursor-wait disabled:opacity-60 ${mobileBuilds ? "bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)]" : "bg-white/10"}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${mobileBuilds ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            </div>
          </div>
          
          <div className="p-5 rounded-2xl border-2 border-white/10 bg-[#0b1724]/60 backdrop-blur-xl shadow-2xl flex items-center justify-between transition-all hover:bg-[#0b1724]/80 group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
                <Play size={18} fill="currentColor" className="ml-0.5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Launcher Build</p>
                <p className="text-sm text-white font-black uppercase italic tracking-tighter">{Defaults.LAUNCHER_VERSION}</p>
              </div>
            </div>
          </div>
        </div>

        <div data-settings-group="appearance" className="launcher-surface md:col-span-2 rounded-md p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white">Launcher theme</h3>
            <p className="mt-1 text-xs text-slate-400">Choose a saved color atmosphere for this device.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Launcher theme">
            {launcherThemes.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectTheme(preset.id)}
                aria-pressed={theme === preset.id}
                className={`flex min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors ${theme === preset.id ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-slate-300 hover:bg-white/5"}`}
              >
                <span className="flex h-6 w-8 shrink-0 overflow-hidden rounded-sm border border-white/20" aria-hidden="true">
                  {preset.colors.map((color) => <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />)}
                </span>
                <span className="truncate">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div data-settings-group="appearance" className="launcher-surface md:col-span-2 rounded-md p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white">Move tabs</h3>
            <p className="mt-1 text-xs text-slate-400">Choose where the launcher navigation sits.</p>
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Navigation position">
            {([
              { id: "top", label: "Top", Icon: PanelTop },
              { id: "bottom", label: "Bottom", Icon: PanelBottom },
              { id: "left", label: "Left", Icon: PanelLeft },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelectNavigationPosition(id)}
                aria-pressed={navigationPosition === id}
                className={`launcher-position-option flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors ${navigationPosition === id ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-slate-300 hover:bg-white/5"}`}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div data-settings-group="appearance" className="launcher-surface md:col-span-2 flex flex-wrap items-center justify-between gap-5 rounded-md p-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="launcher-background-preview h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-white/20" style={{ backgroundImage: `url("${customBackground || Defaults.BACKGROUND_URL}")` }} aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">Custom background</h3>
              <p className="mt-1 text-xs text-slate-400">Use your own image behind the launcher.</p>
              {backgroundMessage && <p role="alert" className="mt-1 text-xs text-red-300">{backgroundMessage}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="launcher-play-button inline-flex h-10 cursor-pointer items-center gap-2 px-4 text-xs font-bold">
              <ImagePlus size={15} /> Upload
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => onSelectBackground(event.target.files?.[0])} />
            </label>
            {customBackground && (
              <button type="button" onClick={onResetBackground} title="Reset background" aria-label="Reset background" className="grid h-10 w-10 cursor-pointer place-items-center border border-white/15 text-slate-200 hover:bg-white/10">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div data-settings-group="information" className="launcher-surface md:col-span-2 flex flex-wrap items-center justify-between gap-6 rounded-md p-6">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">Local PAK / SIG files</h3>
            <p className="mt-2 text-xs text-slate-400">Files in Documents/Project Fishk/Paks are copied into game builds when added or launched.</p>
          </div>
          <button
            type="button"
            onClick={onOpenPakFolder}
            className="launcher-play-button flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-xs font-bold"
          >
            <FolderOpen size={15} />
            Open PAK folder
          </button>
        </div>

        <div data-settings-group="information" className="launcher-surface md:col-span-2 flex flex-wrap items-center justify-between gap-6 rounded-md p-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Software updates</h3>
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${updateTrackerStatus === "available" ? "bg-emerald-400/15 text-emerald-200" : updateTrackerStatus === "error" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-slate-300"}`}>
                {updateTrackerStatus === "available" ? "Update available" : updateTrackerStatus === "checking" ? "Checking" : updateTrackerStatus === "installing" ? "Installing" : updateTrackerStatus === "current" ? "Up to date" : updateTrackerStatus === "browser" ? "Desktop app required" : "Updates disabled"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-400">{updateTrackerMessage}</p>
            {updateManifest?.body && <p className="mt-2 text-xs text-slate-300">{updateManifest.body}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onCheckForUpdates}
              disabled={updateTrackerStatus === "checking" || updateTrackerStatus === "installing" || updateTrackerStatus === "setup" || updateTrackerStatus === "browser"}
              className="cursor-pointer rounded-md border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateTrackerStatus === "checking" ? "Checking..." : "Check for updates"}
            </button>
            {updateTrackerStatus === "available" && (
              <button
                type="button"
                onClick={onInstallAvailableUpdate}
                className="launcher-play-button cursor-pointer rounded-md px-4 py-2 text-xs font-bold"
              >
                Install & restart
              </button>
            )}
          </div>
        </div>

        <div data-settings-group="appearance" className="launcher-surface md:col-span-2 flex flex-wrap items-center justify-between gap-6 rounded-md p-6">
          <div>
            <h3 className="text-sm font-semibold text-white">Accent color</h3>
            <p className="mt-1 text-xs text-slate-400">Personalize the launcher highlights. This is saved on this device.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { name: "Lava", color: "#f04444" },
              { name: "Sunset", color: "#ff8054" },
              { name: "Peach", color: "#ffb36f" },
              { name: "Gold", color: "#f3c949" },
              { name: "Lime", color: "#a6d94a" },
              { name: "Emerald", color: "#38c995" },
              { name: "Mint", color: "#65d7c5" },
              { name: "Arctic", color: "#71cbe8" },
              { name: "Royal", color: "#5b8def" },
              { name: "Violet", color: "#9879ec" },
              { name: "Rose", color: "#e879a4" },
              { name: "Noir", color: "#e5e0df" },
            ].map((option) => (
              <button
                key={option.name}
                type="button"
                aria-label={`${option.name} accent`}
                aria-pressed={accentColor.toLowerCase() === option.color}
                title={`${option.name} accent`}
                onClick={() => setAccentColor(option.color)}
                className={`launcher-swatch cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${accentColor.toLowerCase() === option.color ? "border-white/70 bg-white/10 text-white" : "border-white/10 text-slate-300 hover:bg-white/5"}`}
              >
                <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-white/25" style={{ backgroundColor: option.color }} />{option.name}</span>
              </button>
            ))}
            <label className="flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-white/20 bg-white/5" title="Choose custom accent color">
              <input
                type="color"
                aria-label="Choose custom accent color"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
                className="h-12 w-12 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
          </div>
        </div>

      </div>
        </main>
      </div>
    </div>
  );
};

  const [LeaderboardPanelView] = useState<React.FC>(() => LeaderboardPanel);
  const [ShopPanelView] = useState<React.FC>(() => ShopPanel);

  const selectTheme = (nextTheme: LauncherTheme) => {
    const preset = launcherThemes.find((item) => item.id === nextTheme);
    if (!preset) return;
    setTheme(nextTheme);
    setAccentColor(preset.accent);
    localStorage.setItem("launcherTheme", nextTheme);
    localStorage.setItem("launcherAccentColor", preset.accent);
  };

  const selectNavigationPosition = (position: NavigationPosition) => {
    setNavigationPosition(position);
    localStorage.setItem("launcherNavigationPosition", position);
  };

  const selectBackground = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setBackgroundMessage("Choose a PNG, JPG, WebP, or GIF image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setBackgroundMessage("Choose an image smaller than 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setBackgroundMessage("Could not read that image.");
        return;
      }
      try {
        localStorage.setItem("launcherCustomBackground", reader.result);
        setCustomBackground(reader.result);
        setBackgroundMessage("");
      } catch {
        setBackgroundMessage("Could not save that image. Try a smaller file.");
      }
    };
    reader.onerror = () => setBackgroundMessage("Could not read that image.");
    reader.readAsDataURL(file);
  };

  const resetBackground = () => {
    localStorage.removeItem("launcherCustomBackground");
    setCustomBackground("");
    setBackgroundMessage("");
  };

  const finishTutorial = () => {
    localStorage.setItem("dust.tutorial.completed.v1", "true");
    setTutorialStep(-1);
  };

  const advanceTutorial = () => {
    const nextStep = tutorialStep + 1;
    if (nextStep >= tutorialSteps.length) {
      finishTutorial();
      return;
    }
    setTutorialStep(nextStep);
    setActive(tutorialSteps[nextStep].tab);
  };

  const goBackInTutorial = () => {
    if (tutorialStep <= 0) return;
    const previousStep = tutorialStep - 1;
    setTutorialStep(previousStep);
    setActive(tutorialSteps[previousStep].tab);
  };

  const activeHomeBuild = builds.find((build) => build.path === path) ?? builds[0];

/* -------------------- Render main layout -------------------- */
  return (
  <div className="launcher-app w-screen h-screen flex text-slate-100 relative overflow-hidden rounded-xl border border-white/10" data-theme={theme} data-nav-position={navigationPosition} data-tutorial-step={tutorialStep} style={{ "--launcher-lime": accentColor, "--launcher-wallpaper": customBackground ? `url("${customBackground}")` : "none" } as React.CSSProperties}>

    {CustomTitleBar()}

    {/* Main content */}
    <div className="relative z-10 flex w-full h-full pt-8">
      {/* Pass props to LeftNav */}
      {LeftNav({ active, setActive, user, handleLogout })}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Pass user to TopBar */}
        {error && (
          <div className="absolute right-6 top-6 z-50">
            <div className="bg-red-600/90 text-white px-4 py-2 rounded-md shadow-lg border border-red-500/50">
              {error}
            </div>
          </div>
        )}

        <div className="launcher-main-scroll flex-1 overflow-auto p-4 md:p-5 custom-scrollbar">
  <div>
    {active === "home" && (
      <TabTransition key="home">
        <NewsPanel
          user={user}
          variant="home"
          onPlay={() => {
            if (!activeHomeBuild) { void downloadBuild(); return; }
            if (isGameRunning) { void handleCloseGame(); return; }
            void handleLaunch(activeHomeBuild.path);
          }}
          playLabel={isHostRunning ? "Host running" : isClosingGame ? "Closing..." : isGameRunning ? "Close game" : isLaunching ? "Launching..." : activeHomeBuild ? "Play now" : "Download build"}
          playDisabled={isLaunching || isClosingGame || isHostRunning || (Boolean(activeHomeBuild) && !user && !isGameRunning)}
          isAdmin={user?.isAdmin === true}
          hostLabel={isHostRunning ? "Stop host" : "Start Erbium host"}
          hostStatus={erbiumDllPath ? "Change Erbium.dll" : hostStatus}
          hostBusy={isHostStarting || isLaunching || isClosingGame}
          onStartHost={() => void handleErbiumHost()}
          onSelectErbiumDll={() => void selectErbiumDll()}
          onOpenShop={() => setActive("shop")}
        />
            </TabTransition>
          )}
            {active === "library" && (
              <TabTransition key="library">
                {LibraryPanel({})}
              </TabTransition>
            )}

            {active === "shop" && (
              <TabTransition key="shop">
                <ShopPanelView />
              </TabTransition>
            )}

            {active === "settings" && (
              <TabTransition key="settings">
                {SettingsPanel({
                  eor, setEor, ror, setRor,
                  disablePreedits, setDisablePreedits,
                  bubbleBuilds, setBubbleBuilds: (enabled) => void handleBuildModeToggle("bubble", enabled),
                  isApplyingBubbleBuilds,
                  stretchResolutionEnabled, setStretchResolutionEnabled,
                  resolutionWidth, setResolutionWidth,
                  resolutionHeight, setResolutionHeight,
                  mobileBuilds, setMobileBuilds: (enabled) => void handleBuildModeToggle("mobile", enabled),
                  accentColor,
                  theme,
                  onSelectTheme: selectTheme,
                  navigationPosition,
                  onSelectNavigationPosition: selectNavigationPosition,
                  customBackground,
                  backgroundMessage,
                  onSelectBackground: selectBackground,
                  onResetBackground: resetBackground,
                  preferencesView,
                  onSelectPreferencesView: setPreferencesView,
                  user,
                  onSignOut: handleLogout,
                  setAccentColor: (color) => {
                    setAccentColor(color);
                    localStorage.setItem("launcherAccentColor", color);
                  },
                  updateTrackerStatus,
                  updateTrackerMessage,
                  updateManifest,
                  onOpenPakFolder: async () => {
                    try {
                      await invoke("open_pak_drop_folder_cmd");
                    } catch (folderError) {
                      setError("Could not open the PAK folder: " + String(folderError));
                      setTimeout(() => setError(null), 5000);
                    }
                  },
                  onCheckForUpdates: checkForUpdates,
                  onInstallAvailableUpdate: installAvailableUpdate,
                })}
              </TabTransition>
            )}

            {active === "admin" && (
              <TabTransition key="admin">
                <AdminPanelView
                  user={user}
                  onOpenDiscord={() => void openExternal(Defaults.DISCORD_LINK)}
                  onOpenSettings={() => setActive("settings")}
                  onRefreshSession={() => {
                    const savedUser = localStorage.getItem("user");
                    if (!savedUser) {
                      navigate("/login", { replace: true, state: { authNotice: "Please sign in again." } });
                      return;
                    }
                    const parsed = JSON.parse(savedUser) as Partial<UserData>;
                    if (!parsed.email || (!parsed.password && !parsed.authToken)) {
                      navigate("/login", { replace: true, state: { authNotice: "Your saved sign-in details are incomplete." } });
                      return;
                    }
                    void fetch(`${Defaults.AUTH_API_URL}/api/auth/validate`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: Body.json(parsed.authToken ? { authToken: parsed.authToken } : { email: parsed.email, password: parsed.password }),
                      responseType: ResponseType.JSON,
                    }).then((response) => {
                      const data = (response.data ?? {}) as { success?: boolean; user?: Partial<UserData>; message?: string };
                      if (response.ok && data.success && data.user) {
                        const refreshedUser = { ...parsed, ...data.user, password: parsed.password, authToken: parsed.authToken } as UserData;
                        setUser(refreshedUser);
                        localStorage.setItem("user", JSON.stringify(refreshedUser));
                        setError("Session refreshed.");
                        setTimeout(() => setError(null), 2500);
                        return;
                      }
                      setError(data.message || "Session refresh failed.");
                      setTimeout(() => setError(null), 3500);
                    }).catch(() => {
                      setError("Could not refresh the session.");
                      setTimeout(() => setError(null), 3500);
                    });
                  }}
                  onOpenHost={() => void handleErbiumHost()}
                />
              </TabTransition>
            )}

            {active === "leaderboard" && (
              <TabTransition key="leaderboard">
                <LeaderboardPanelView />
              </TabTransition>
            )}
          </div>
            {showGamePasswordPrompt && (
              <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
                <form
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="game-password-title"
                  onSubmit={(event) => { event.preventDefault(); confirmGamePassword(); }}
                  className="w-full max-w-md border border-white/15 bg-[#111820] p-6 shadow-2xl"
                >
                  <span className="home-panel-kicker">FORTNITE ACCOUNT</span>
                  <h2 id="game-password-title" className="mt-2 text-xl font-bold text-white">Game password needed</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">Discord signed you into the launcher. Enter your game account password once so Fortnite can authenticate.</p>
                  <input
                    autoFocus
                    type="password"
                    autoComplete="current-password"
                    value={gamePasswordDraft}
                    onChange={(event) => setGamePasswordDraft(event.target.value)}
                    placeholder="Game account password"
                    className="mt-4 h-11 w-full border border-white/15 bg-white/5 px-3 text-sm text-white outline-none focus:border-cyan-300/60"
                  />
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={() => { setShowGamePasswordPrompt(false); setGamePasswordDraft(""); }} className="border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">Cancel</button>
                    <button type="submit" disabled={!gamePasswordDraft} className="launcher-play-button px-4 py-2 text-sm font-semibold disabled:opacity-50">Continue</button>
                  </div>
                </form>
              </div>
            )}
            {isDownloading && (
              <div
                className="fixed inset-0 z-[999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
              >
                <div
                  className={`grid w-full max-w-[760px] overflow-hidden rounded-lg border bg-[#101820] text-left shadow-2xl transition-colors duration-300 md:grid-cols-[260px_minmax(0,1fr)] ${warningMsg ? "border-red-500 shadow-red-500/20" : "border-white/10"}`}
                >
                  <div className="relative min-h-36 overflow-hidden bg-black/40 md:min-h-[340px]">
                    <img src={Defaults.PLACEHOLDER_IMAGE} alt="Game artwork" className="absolute inset-0 h-full w-full object-cover opacity-75" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                    <div className="absolute bottom-5 left-5 right-5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">Game library</div>
                      <div className="mt-1 text-xl font-bold text-white">Fortnite</div>
                      <div className="mt-1 text-xs text-white/65">{isBuildDownload ? "Build download" : "File sync"}</div>
                    </div>
                  </div>
                  <div className="min-w-0 p-5 md:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{warningMsg ? "Download issue" : currentStatus || "Preparing download"}</p>
                        <h2 className="mt-2 truncate text-xl font-bold text-white">{warningMsg ? "Could not finish" : progress >= 100 && isBuildDownload ? "Installing build" : "Downloading game"}</h2>
                      </div>
                      {warningMsg ? <X className="mt-1 shrink-0 text-red-400" size={20} /> : <Download className="mt-1 shrink-0 text-[var(--launcher-lime)]" size={20} />}
                    </div>

                    <div className="mt-7 flex items-end justify-between gap-4">
                      <span className="text-sm text-slate-400">{warningMsg || "Progress"}</span>
                      <span className="text-3xl font-bold tabular-nums text-white">{Math.max(0, Math.min(progress, 100))}%</span>
                    </div>
                    <div
                      className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
                      role="progressbar"
                      aria-label="Build download progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.max(0, Math.min(progress, 100))}
                    >
                      <div
                        className={`h-full rounded-full ${warningMsg ? "bg-red-500" : "bg-[var(--launcher-lime)]"}`}
                        style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
                      />
                    </div>

                    <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                      <span className="text-xs font-medium text-slate-300">Transfer details</span>
                      <button
                        type="button"
                        onClick={() => setShowDownloadDetails((visible) => !visible)}
                        className="grid h-9 w-9 place-items-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white"
                        aria-label={showDownloadDetails ? "Hide download details" : "Show download details"}
                        title={showDownloadDetails ? "Hide download details" : "Show download details"}
                      >
                        {showDownloadDetails ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                      {showDownloadDetails && (
                        <div
                          className="grid grid-cols-2 gap-x-5 gap-y-4 overflow-hidden pt-2"
                        >
                          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Speed</div><div className="mt-1 text-sm font-semibold text-white">{downloadRate > 0 ? formatTransferRate(downloadRate) : "Calculating"}</div></div>
                          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Network rate</div><div className="mt-1 text-sm font-semibold text-white">{downloadRate > 0 ? `${(downloadRate * 8 / 1_000_000).toFixed(1)} Mbps` : "Calculating"}</div></div>
                          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Downloaded</div><div className="mt-1 text-sm font-semibold text-white">{formatBytes(downloadedBytes)} / {formatBytes(downloadTotalBytes)}</div></div>
                          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Time remaining</div><div className="mt-1 text-sm font-semibold text-white">{progress >= 100 ? "Finishing up" : formatEta(downloadEta)}</div></div>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            )}
            {tutorialStep >= 0 && (
              <div className="dust-tour-backdrop">
                <section className="dust-tour-card" role="dialog" aria-modal="true" aria-label="Launcher introduction">
                  <div className="dust-tour-progress" aria-label={`Step ${tutorialStep + 1} of ${tutorialSteps.length}`}>
                    {tutorialSteps.map((_, index) => (
                      <span key={index} data-complete={index <= tutorialStep} />
                    ))}
                  </div>
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-red-300">
                    {Defaults.LAUNCHER_NAME} · Getting started
                  </p>
                  <h2 className="dust-tour-title">{tutorialSteps[tutorialStep].title}</h2>
                  <p className="dust-tour-description">{tutorialSteps[tutorialStep].description}</p>
                  <div className="dust-tour-actions">
                    <button type="button" className="dust-tour-button border-0 bg-transparent px-0 text-slate-400 hover:text-white" onClick={finishTutorial}>
                      Skip
                    </button>
                    <div className="flex items-center gap-2">
                      {tutorialStep > 0 && (
                        <button type="button" className="dust-tour-button" onClick={goBackInTutorial}>
                          Back
                        </button>
                      )}
                      <button type="button" className="dust-tour-button dust-tour-button-primary" onClick={advanceTutorial}>
                        {tutorialStep === tutorialSteps.length - 1 ? "Finish" : "Next"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}
        </div>
      </div>
    </div>
  </div>
);
}
