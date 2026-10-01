import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./App";
import Login from "./login";
import Onboard from "./onboard";
import Settings from "./settings";
import AccountStatus from "./AccountStatus";

function Main() {
  useEffect(() => {
    const handleMouseNavigation = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
      return undefined;
    };

    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      const isBrowserNavigationKey = (event.key === "ArrowLeft" || event.key === "ArrowRight") && (event.ctrlKey || event.metaKey);
      if (isBrowserNavigationKey) {
        event.preventDefault();
      }
    };

    window.addEventListener("mousedown", handleMouseNavigation, { passive: false });
    window.addEventListener("mouseup", handleMouseNavigation, { passive: false });
    window.addEventListener("keydown", handleKeyboardNavigation, { passive: false });

    return () => {
      window.removeEventListener("mousedown", handleMouseNavigation);
      window.removeEventListener("mouseup", handleMouseNavigation);
      window.removeEventListener("keydown", handleKeyboardNavigation);
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboard" element={<Onboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/account-status" element={<AccountStatus />} />
      </Routes>
    </Router>
  );
}

export default Main;
