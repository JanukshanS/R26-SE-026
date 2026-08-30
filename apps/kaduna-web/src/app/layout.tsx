import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Bricolage_Grotesque,
  Noto_Sans_Sinhala,
  Noto_Sans_Tamil,
} from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
});

// Geist and Bricolage carry no Sinhala or Tamil glyphs, so without these the
// two languages render as tofu. They sit behind the Latin faces in the stacks
// declared in globals.css, which keeps English typography untouched.
const notoSinhala = Noto_Sans_Sinhala({
  subsets: ["sinhala"],
  variable: "--font-noto-sinhala",
  display: "swap",
});
const notoTamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-noto-tamil",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kaduna.lk — Roadside assistance for Colombo",
  description:
    "Stranded in Colombo? Kaduna.lk sends tow trucks, mechanics, battery jumpstarts and fuel — and understands the breakdown before help is sent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${notoSinhala.variable} ${notoTamil.variable}`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          crossOrigin=""
        />
      </head>
      <body className="antialiased">
        {/* One session for the whole site: the landing, the portals and the
            dashboard share it, so navigating between areas never re-authenticates. */}
        <I18nProvider>
          <SessionProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
