"use client";

import { Contrast, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

const order = ["dark", "light", "contrast"] as const;
const icons = { dark: Moon, light: Sun, contrast: Contrast };
const labels = { dark: "Tema oscuro", light: "Tema claro", contrast: "Alto contraste" };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted && order.includes(theme as never) ? theme : "dark") as (typeof order)[number];
  const Icon = icons[current];
  const next = order[(order.indexOf(current) + 1) % order.length];
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} title={`${labels[current]} (cambiar)`} aria-label="Cambiar tema">
      <Icon className="h-[18px] w-[18px]" />
    </Button>
  );
}
