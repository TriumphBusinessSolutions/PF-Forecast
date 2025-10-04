import "./globals.css";

export const metadata = {
  title: "PF Forecast",
  description: "Profit First forecasting MVP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-slate-100">
      <body className="min-h-screen bg-slate-100 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
