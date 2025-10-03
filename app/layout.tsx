export const metadata = {
  title: 'PF Forecast',
  description: 'Profit First forecasting MVP',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ background: '#f6f7f9', color: '#111', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
