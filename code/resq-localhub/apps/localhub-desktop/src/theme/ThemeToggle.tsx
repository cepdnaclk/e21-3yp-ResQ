import { useTheme } from "./ThemeContext";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      style={{
        width: "40px",
        height: "40px",
        borderRadius: "999px",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        color: "var(--text)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1rem",
        transition: "all 0.3s ease",
        padding: 0,
      }}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a6.5 6.5 0 1 0 9 9A9 9 0 1 1 12 3Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.75v2.5M12 18.75v2.5M4.05 4.05l1.77 1.77M18.18 18.18l1.77 1.77M2.75 12h2.5M18.75 12h2.5M4.05 19.95l1.77-1.77M18.18 5.82l1.77-1.77" />
        </svg>
      )}
    </button>
  );
}
