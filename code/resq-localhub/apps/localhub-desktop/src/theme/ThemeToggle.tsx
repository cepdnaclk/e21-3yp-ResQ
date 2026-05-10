import { useTheme } from "./ThemeContext";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      style={{
        width: "40px",
        height: "40px",
        borderRadius: "8px",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        color: "var(--text)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.2rem",
        transition: "all 0.3s ease",
        padding: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-strong)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px rgba(29, 78, 216, 0.15)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--surface)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
      }}
    >
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}
