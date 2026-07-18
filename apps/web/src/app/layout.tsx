import type { Metadata } from "next";

import { Providers } from "@/app/providers";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Whiteboard Todos",
  description: "T3 and ZenStack verification surface for the whiteboard workspace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
