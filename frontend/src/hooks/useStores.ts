import { create } from "zustand";

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
