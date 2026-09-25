"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={["dark", "light", "contrast"]}
      value={{ dark: "dark", light: "light", contrast: "contrast" }}
      disableTransitionOnChange
    >
      {children}
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  );
}
