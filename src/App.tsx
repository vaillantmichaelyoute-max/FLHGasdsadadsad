import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Body, fetch, ResponseType } from "@tauri-apps/api/http";
import { Defaults } from "./defaults";

type SavedUser = {
  email: string;
  password?: string;
  authToken?: string;
  username?: string;
  discordId?: string;
  avatarHash?: string | null;
  accountId?: string | null;
  isAdmin?: boolean;
};

type BanStatus = {
  reason: string;
  expiresAt: string | null;
  permanent: boolean;
  canAppeal: boolean;
  appealPending: boolean;
};

type AuthResponse = {
  success?: boolean;
  code?: string;
  message?: string;
  user?: Partial<SavedUser>;
  ban?: BanStatus;
};

function App() {
  const navigate = useNavigate();
  const [retryCount, setRetryCount] = useState(0);
  const [verificationMessage, setVerificationMessage] = useState("Checking your account...");

  useEffect(() => {
    let cancelled = false;
    const raw = localStorage.getItem("user");
    if (!raw) {
      navigate("/login", { replace: true });
      return;
    }

    let savedUser: SavedUser;
    try {
      savedUser = JSON.parse(raw) as SavedUser;
    } catch {
      localStorage.removeItem("user");
      navigate("/login", { replace: true, state: { authNotice: "Your saved sign-in could not be read. Please sign in again." } });
      return;
    }

    if (!savedUser?.email || (!savedUser.password && !savedUser.authToken)) {
      localStorage.removeItem("user");
      navigate("/login", { replace: true, state: { authNotice: "Your saved sign-in is incomplete. Please sign in again." } });
      return;
    }

    if (!Defaults.ENABLE_API) {
      setVerificationMessage("Account verification is disabled. Enable the launcher auth API before continuing.");
      return;
    }

    const validateAccount = async () => {
      try {
        const response = await fetch(`${Defaults.AUTH_API_URL}/api/auth/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: Body.json(savedUser.authToken ? { authToken: savedUser.authToken } : { email: savedUser.email, password: savedUser.password }),
          responseType: ResponseType.JSON,
        });
        const data = (response.data ?? {}) as AuthResponse;
        if (cancelled) return;

        if (response.ok && data.success && data.user) {
          localStorage.setItem("user", JSON.stringify({ ...savedUser, ...data.user, password: savedUser.password }));
          navigate("/onboard", { replace: true });
          return;
        }

        if (data.code === "account_banned" && data.ban) {
          navigate("/account-status", { replace: true, state: { user: savedUser, ban: data.ban } });
          return;
        }

        if (["account_deleted", "credentials_changed", "account_unlinked", "missing_credentials"].includes(data.code || "")) {
          localStorage.removeItem("user");
          navigate("/login", { replace: true, state: { authNotice: data.message || "Your account is no longer available. Please sign in again." } });
          return;
        }

        setVerificationMessage(data.message || "Could not verify your account. Check your connection and retry.");
      } catch {
        if (!cancelled) setVerificationMessage("Could not reach the account service. Your saved sign-in has been kept; retry when the service is available.");
      }
    };

    void validateAccount();
    return () => { cancelled = true; };
  }, [navigate, retryCount]);

  const signOut = () => {
    localStorage.removeItem("user");
    navigate("/login", { replace: true, state: { authNotice: "You have been signed out." } });
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#101619] px-6 text-sm text-gray-300">
      <section className="w-full max-w-md border border-white/10 bg-[#111d25] p-7 text-center shadow-2xl">
        <div className="mx-auto mb-4 h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
        <h1 className="text-lg font-semibold text-white">Account check</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{verificationMessage}</p>
        <div className="mt-6 flex justify-center gap-3">
          {verificationMessage !== "Checking your account..." && (
            <button type="button" onClick={() => setRetryCount((count) => count + 1)} className="border border-cyan-300/40 px-4 py-2 font-semibold text-cyan-100 hover:bg-cyan-300/10">
              Retry
            </button>
          )}
          <button type="button" onClick={signOut} className="border border-white/15 px-4 py-2 text-slate-200 hover:bg-white/5">
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
