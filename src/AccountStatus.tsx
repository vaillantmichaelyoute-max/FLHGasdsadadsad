import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Body, fetch, ResponseType } from "@tauri-apps/api/http";
import { AlertTriangle, Clock3, LogOut, Send } from "lucide-react";
import { Defaults } from "./defaults";

type SavedUser = {
  email: string;
  password: string;
  username?: string;
};

type BanStatus = {
  reason: string;
  expiresAt: string | null;
  permanent: boolean;
  canAppeal: boolean;
  appealPending: boolean;
};

type RouteState = { user?: SavedUser; ban?: BanStatus };

export default function AccountStatus() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state || {}) as RouteState;
  const savedUser = localStorage.getItem("user");
  const [user] = useState<SavedUser | null>(() => {
    if (routeState.user) return routeState.user;
    try {
      return savedUser ? JSON.parse(savedUser) as SavedUser : null;
    } catch {
      return null;
    }
  });
  const [ban, setBan] = useState<BanStatus | null>(routeState.ban || null);
  const [appealReason, setAppealReason] = useState("");
  const [appealSubmitted, setAppealSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!routeState.ban && savedUser) {
      navigate("/", { replace: true });
    } else if (!user?.email || !user.password || !ban) {
      navigate("/login", { replace: true });
    }
  }, [ban, navigate, routeState.ban, savedUser, user]);

  const handleAppeal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || appealReason.trim().length < 10) return;

    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`${Defaults.AUTH_API_URL}/api/auth/appeal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: Body.json({ email: user.email, password: user.password, reason: appealReason.trim() }),
        responseType: ResponseType.JSON,
      });
      const data = (response.data ?? {}) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "appeal_pending") {
          setBan((current) => current ? { ...current, canAppeal: false, appealPending: true } : current);
        }
        throw new Error(data.message || "Appeal submission failed.");
      }

      setAppealSubmitted(true);
      setBan((current) => current ? { ...current, canAppeal: false, appealPending: true } : current);
      setAppealReason("");
      setMessage(data.message || "Your appeal was submitted for administrator review.");
    } catch (appealError) {
      setMessage(String(appealError));
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem("user");
    navigate("/login", { replace: true, state: { authNotice: "You have been signed out." } });
  };

  if (!ban) return null;

  const expiresAt = ban.expiresAt ? new Date(ban.expiresAt) : null;
  const hasValidExpiry = expiresAt && !Number.isNaN(expiresAt.getTime());
  const appealPending = appealSubmitted || ban.appealPending;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#101619] px-5 py-10 text-slate-100">
      <section className="w-full max-w-xl border border-red-300/20 bg-[#151d20] shadow-2xl">
        <div className="border-b border-white/10 px-7 py-6 sm:px-9">
          <div className="flex items-center gap-3 text-red-300">
            <AlertTriangle size={21} />
            <span className="text-xs font-bold uppercase tracking-[0.18em]">Account access</span>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">Account banned</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {user?.username || user?.email} cannot launch Fortnite while this ban is active.
          </p>
        </div>

        <div className="space-y-5 px-7 py-6 sm:px-9">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reason</div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{ban.reason || "No reason was provided."}</p>
          </div>

          <div className="flex items-start gap-3 border-t border-white/10 pt-4">
            <Clock3 size={17} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Duration</div>
              <p className="mt-1 text-sm text-slate-200">
                {ban.permanent || !hasValidExpiry ? "Permanent" : `Until ${expiresAt.toLocaleString()}`}
              </p>
            </div>
          </div>

          {appealPending ? (
            <p className="border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">
              Your appeal is pending administrator review.
            </p>
          ) : ban.canAppeal ? (
            <form onSubmit={handleAppeal} className="space-y-3 border-t border-white/10 pt-5">
              <label htmlFor="appeal-reason" className="block text-sm font-semibold text-slate-200">Submit an appeal</label>
              <textarea
                id="appeal-reason"
                value={appealReason}
                onChange={(event) => setAppealReason(event.target.value)}
                maxLength={2000}
                minLength={10}
                rows={4}
                required
                placeholder="Explain why you believe this ban should be reviewed."
                className="w-full resize-y border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">10 to 2000 characters</span>
                <button
                  type="submit"
                  disabled={submitting || appealReason.trim().length < 10}
                  className="inline-flex items-center gap-2 bg-cyan-300 px-4 py-2 text-sm font-bold text-[#101619] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={15} /> {submitting ? "Submitting..." : "Submit appeal"}
                </button>
              </div>
              {message && <p role="alert" className="text-sm text-amber-200">{message}</p>}
            </form>
          ) : (
            <p className="border-t border-white/10 pt-4 text-sm text-slate-400">Appeals are not available for this ban.</p>
          )}

          <div className="flex justify-end border-t border-white/10 pt-4">
            <button type="button" onClick={signOut} className="inline-flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
