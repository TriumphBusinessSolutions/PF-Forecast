import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PF Forecast",
  description: "Profit First forecasting MVP",
};

export default function RootLayout({
  children,
}: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&display=swap"
        />
      </head>
      <body
        style={{
          background: "#f6f7f9",
          color: "#111",
          margin: 0,
          fontFamily: "Rubik, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
