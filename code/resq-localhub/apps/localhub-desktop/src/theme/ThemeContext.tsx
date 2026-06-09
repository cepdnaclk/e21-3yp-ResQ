import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "resq-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Force light theme; dark mode removed
  const [theme, setTheme] = useState<Theme>(() => "light");

  useEffect(() => {
<<<<<<< HEAD
    document.documentElement.classList.add("sim-theater");
    // Dark mode removed; ensure `dark` class is not present
    document.documentElement.classList.remove("dark");
  }, []);
=======
    // Apply theme to document
    if (theme === "dark") {
      document.documentElement.classList.add("sim-theater");
    } else {
      document.documentElement.classList.remove("sim-theater");
    }
    // Save preference
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);
>>>>>>> origin/home-page-ui

  function toggleTheme() {
    // No-op: theme is fixed to light
    return;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
