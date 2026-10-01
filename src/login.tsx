import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/api/shell";
import { fetch, ResponseType, Body } from "@tauri-apps/api/http";
import { Defaults } from "./defaults";
import { Maximize2, Minus, X } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { appWindow } from "@tauri-apps/api/window";
import "./launcher.css";

const IconEye = (props: any) => (
  <svg viewBox="0 0 24 24" width="20" height="20" {...props}>
    <path fill="currentColor" d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
  </svg>
);

const IconEyeOff = (props: any) => (
  <svg viewBox="0 0 24 24" width="20" height="20" {...props}>
    <path
      fill="currentColor"
      d="M2 5.27 3.28 4 20 20.72 18.73 22l-3.2-3.2A11.58 11.58 0 0 1 12 19C5 19 2 12 2 12a18.85 18.85 0 0 1 4.1-5.57L2 5.27Zm8.83 3.54a4 4 0 0 1 4.36 4.36l-4.36-4.36ZM12 7c7 0 10 7 10 7a18.92 18.92 0 0 1-4.54 5.72l-1.42-1.42A11.83 11.83 0 0 0 20 12s-3-7-8-7a11.83 11.83 0 0 0-4.3.8l-1.5-1.5A13.68 13.68 0 0 1 12 7Z"
    />
  </svg>
);

interface Credentials {
  email: string;
  password: string;
}

const CustomTitleBar = () => (
  <div 
    data-tauri-drag-region 
    className="dust-login-titlebar h-8 w-full bg-[#071422]/90 border-b border-white/10 flex justify-between items-center fixed top-0 left-0 z-[999] backdrop-blur-md select-none rounded-t-xl"
  >
    <div className="dust-login-window-title pl-4 pointer-events-none">{Defaults.LAUNCHER_NAME}</div>

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

export default function Login() {
  const [avatarHash, setAvatarHash] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [username, setUsername] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState<Credentials>({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => (location.state as { authNotice?: string } | null)?.authNotice || null);
  const [showPw, setShowPw] = useState(false);
  const [remember] = useState(true);

  const handleDiscordLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const startResponse = await fetch(`${Defaults.AUTH_API_URL}/api/auth/discord/start`, {
        method: "POST",
        responseType: ResponseType.JSON,
      });
      const startData = (startResponse.data ?? {}) as { state?: string; authorizationUrl?: string; message?: string };
      if (!startResponse.ok || !startData.state || !startData.authorizationUrl) {
        throw new Error(startData.message || "Discord sign-in could not be started.");
      }

      await open(startData.authorizationUrl);
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const pollResponse = await fetch(`${Defaults.AUTH_API_URL}/api/auth/discord/poll?state=${encodeURIComponent(startData.state)}`, {
          method: "GET",
          responseType: ResponseType.JSON,
        });
        if (pollResponse.status === 202) continue;

        const pollData = (pollResponse.data ?? {}) as {
          success?: boolean;
          message?: string;
          authToken?: string;
          user?: { email?: string; username?: string; discordId?: string; avatarHash?: string | null; accountId?: string | null; role?: string; isAdmin?: boolean };
        };
        if (!pollResponse.ok || !pollData.success || !pollData.authToken || !pollData.user?.email) {
          throw new Error(pollData.message || "Discord sign-in was not completed.");
        }

        const sessionUser = {
          ...pollData.user,
          password: undefined,
          authToken: pollData.authToken,
          username: pollData.user.username ?? pollData.user.email.split("@")[0],
          discordId: pollData.user.discordId ?? "",
          avatarHash: pollData.user.avatarHash ?? null,
          role: pollData.user.role ?? "USER",
          isAdmin: pollData.user.isAdmin === true,
        };
        localStorage.setItem("user", JSON.stringify(sessionUser));
        setUsername(sessionUser.username);
        setDiscordId(sessionUser.discordId);
        setAvatarHash(sessionUser.avatarHash ?? "");
        setIsSuccess(true);
        window.setTimeout(() => navigate("/onboard"), 1200);
        return;
      }
      throw new Error("Discord sign-in timed out. Try again.");
    } catch (authError) {
      setError(String(authError).replace(/^Error: /, ""));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (error) setError(null);
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleDiscordSignup = () => {
    void open(Defaults.DISCORD_LINK || "https://discord.com");
  };

  const handleCreateAccount = () => {
    void open(Defaults.DISCORD_LINK || "https://discord.com");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const emailOk = /\S+@\S+\.\S+/.test(form.email);
    if (!emailOk) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    const isApiEnabled = Defaults.ENABLE_API;

    if (!isApiEnabled) {
      setError("Account verification is disabled. Enable the launcher auth API before signing in.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${Defaults.AUTH_API_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: Body.json({
          email: form.email,
          password: form.password,
        }),
        responseType: ResponseType.JSON,
      });

      if (response.ok) {
        const data = (response.data ?? {}) as {
          success?: boolean;
          user?: {
            accountId?: string | null;
            email?: string;
            username?: string;
            discordId?: string;
            avatarHash?: string | null;
            role?: string;
            isAdmin?: boolean;
          };
          message?: string;
          code?: string;
          ban?: {
            reason: string;
            expiresAt: string | null;
            permanent: boolean;
            canAppeal: boolean;
            appealPending: boolean;
          };
        };

        if (!data.user) {
          setError("Login response was invalid.");
          return;
        }

        const sessionUser = {
          email: data.user.email ?? form.email,
          password: form.password,
          username: data.user.username ?? (data.user.email ? data.user.email.split("@")[0] : "Player"),
          discordId: data.user.discordId ?? "",
          avatarHash: data.user.avatarHash ?? null,
          role: data.user.role ?? "USER",
          isAdmin: data.user.isAdmin === true,
        };

        setUsername(sessionUser.username);
        setDiscordId(sessionUser.discordId);
        setAvatarHash(sessionUser.avatarHash ?? "");

        if (remember) {
          localStorage.setItem("user", JSON.stringify(sessionUser));
        }
        setIsSuccess(true);
        setTimeout(() => navigate("/onboard"), 2000);
      } else {
        const payload = (response.data ?? {}) as {
          message?: string;
          code?: string;
          user?: { username?: string };
          ban?: {
            reason: string;
            expiresAt: string | null;
            permanent: boolean;
            canAppeal: boolean;
            appealPending: boolean;
          };
        };
        const serverMessage = typeof response.data === "string"
          ? response.data
          : payload.message || "Wrong credentials or Discord account not linked.";
        if (response.status === 403 && payload.code === "account_banned" && payload.ban) {
          navigate("/account-status", {
            state: {
              user: { email: form.email, password: form.password, username: payload.user?.username },
              ban: payload.ban,
            },
          });
          return;
        }
        setError(serverMessage || "Wrong credentials or Discord account not linked.");
      }
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
};

  return (
      <div className="dust-login w-screen h-screen relative overflow-hidden text-gray-100 bg-[#0b0c10] select-none rounded-xl border border-white/10 font-sans">
      <CustomTitleBar />

      {/* BACKGROUND */}
      <div className="absolute inset-0 rounded-xl overflow-hidden z-0">
        <img
          src={Defaults.BACKGROUND_URL}
          alt="background"
          className="w-full h-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none" />
      </div>

      {/* CENTERED LOGIN CARD */}
      <div className="dust-login-content relative flex flex-col items-center justify-center h-full w-full px-10">
    <>
        {!isSuccess ? (
      <div
          className="dust-login-panel relative w-full max-w-[400px] bg-black/60 backdrop-blur-2xl border border-white/10 p-8 md:p-10 rounded-2xl shadow-2xl z-10"
        >
          <div className="text-left mb-8">
            <img
              src={Defaults.LOGO_URL}
              alt="Logo"
              className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#07080a] border border-white/10 flex items-center justify-center shadow-[0_0_20px_rgba(14,165,233,0.15)] overflow-hidden relative" 
            />
            <div className="min-w-0">
              <h1 className="dust-display-heading text-4xl font-bold text-white tracking-tight">
                {Defaults.LAUNCHER_NAME}
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                Sign in to continue to your game library
              </p>
            </div>
          </div>

          <div className="mb-5 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[11px] leading-5 text-cyan-100/90">
            Create your launcher account in Discord with /create, then sign in here with the same email and password.
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate autoComplete="off">
            <div>
              <label className="text-sm text-gray-300">Email</label>
              <input
                type="email"
                name="email"
                autoComplete="one-time-code" 
                spellCheck="false"
                value={form.email}
                onChange={handleChange}
                placeholder="name@example.com"
                className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none focus:border-blue-500/50 focus:bg-blue-500/5 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-500"
              />
            </div>

            <div>
              <label className="text-sm text-gray-300">Password</label>
              <div className="relative mt-1">
                <input
                  type={showPw ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none focus:border-blue-500/50 focus:bg-blue-500/5 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="cursor-pointer absolute inset-y-0 right-2 flex items-center px-2 rounded-lg hover:bg-white/5 transition"
                >
                  {showPw ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            {error && (
              <div className="overflow-hidden">
                <p className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs text-center font-medium">
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
                className="dust-login-primary cursor-pointer w-full rounded-lg px-6 py-3 font-bold text-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
            {loading ? "Logging in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
              <div className="relative flex justify-center"><span className="bg-[#071422] px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">account access</span></div>
            </div>
            <button
              type="button"
              onClick={() => void handleDiscordLogin()}
              disabled={loading}
              className="dust-discord-login mb-3 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
            >
              <SiDiscord size={18} />
              {loading ? "Connecting to Discord..." : "Login with Discord"}
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleDiscordSignup}
                className="cursor-pointer rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20"
              >
                Join Discord
              </button>
              <button
                type="button"
                onClick={handleCreateAccount}
                className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-white transition hover:border-purple-400/40 hover:bg-purple-500/10"
              >
                Create account
              </button>
            </div>
          </div>

            <div className="mt-8 text-center">
              <span className="text-slate-500 text-xs">Need an account? </span>
              <button 
                type="button" 
                onClick={handleCreateAccount} 
                className="dust-login-link text-xs font-bold hover:underline cursor-pointer"
              >
                Open Discord
              </button>
            </div>
        </div>
        ) : (
          <div className="text-center z-50">
  {/* NEW PROFILE PICTURE CONTAINER */}
  <div className="w-24 h-24 mx-auto mb-6 relative">
  
  <div className="relative w-full h-full rounded-full border-2 border-blue-500 overflow-hidden bg-[#0b0c10] shadow-[0_0_40px_rgba(37,99,235,0.4)]">
  {discordId ? (
    <img 
      key={discordId}
  src={
    avatarHash 
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=256`
      : `https://ui-avatars.com/api/?name=${username}&background=0ea5e9&color=fff`
  } 
  alt="Profile"
  className="w-full h-full object-cover"
  onError={(e) => {
    e.currentTarget.src = `https://ui-avatars.com/api/?name=${username}&background=0ea5e9&color=fff`;
  }}
    />
  ) : null}

  <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-white -z-10">
     {username.charAt(0).toUpperCase()}
  </div>
</div>
</div>

  <h2 className="text-4xl font-bold text-white tracking-tight">
    Welcome, <span className="text-blue-400">{username}</span>
  </h2>
  <p className="text-slate-400 mt-3 text-lg">Launching...</p>
</div>
        )}
  </>
      </div>
    </div>
  );
}
