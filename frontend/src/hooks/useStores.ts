import { create } from "zustand";
import { getInitialTheme, persistTheme, type ThemeMode } from "../lib/theme";

interface AuthState {
  token: string | null;
  user: any | null;
  setToken: (token: string) => void;
  setUser: (user: any) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("token"),
  user: null,
  setToken: (token) => {
    localStorage.setItem("token", token);
    set({ token });
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem("token");
    set({ token: null, user: null });
  },
}));

interface ThemeState {
  dark: boolean;
  toggle: () => void;
}

const initialTheme = getInitialTheme();

export const useThemeStore = create<ThemeState>((set) => ({
  dark: initialTheme === "dark",
  toggle: () =>
    set((s) => {
      const next: ThemeMode = s.dark ? "light" : "dark";
      persistTheme(next);
      return { dark: next === "dark" };
    }),
}));
