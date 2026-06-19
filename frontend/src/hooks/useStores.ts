import { create } from "zustand";

interface AuthState {
  token: string | null;
  setToken: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("token"),
  setToken: (token) => {
    localStorage.setItem("token", token);
    set({ token });
  },
  logout: () => {
    localStorage.removeItem("token");
    set({ token: null });
  },
}));

interface ThemeState {
  dark: boolean;
  toggle: () => void;
}

const savedDark = localStorage.getItem("theme") === "dark";
if (savedDark) document.documentElement.classList.add("dark");

export const useThemeStore = create<ThemeState>((set) => ({
  dark: savedDark,
  toggle: () =>
    set((s) => {
      const next = !s.dark;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return { dark: next };
    }),
}));
