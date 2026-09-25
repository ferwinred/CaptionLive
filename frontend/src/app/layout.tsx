import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "swap" });

export const metadata: Metadata = {
  title: { default: "CaptionLive — subtítulos en vivo en tu idioma", template: "%s · CaptionLive" },
  description:
    "Transcripción y traducción simultánea open source para conferencias: subtítulos en tiempo real, en el idioma original y en español, para muchas salas en paralelo.",
  applicationName: "CaptionLive",
  openGraph: { title: "CaptionLive", description: "Subtítulos en vivo, en tu idioma.", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#12151c" },
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
