import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../hooks/useStores";

type ThemeToggleProps = {
  style?: React.CSSProperties;
};

export function ThemeToggle({ style }: ThemeToggleProps) {
  const { dark, toggle } = useThemeStore();

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost"
      style={{ padding: "8px 10px", ...style }}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
