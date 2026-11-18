import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'kanso — minimalist task micromanagement',
  description:
    'Keep track of the big picture and execute every microtask with focus.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#0A0A0C] text-white antialiased selection:bg-white selection:text-[#0A0A0C]">
        {children}
      </body>
    </html>
  );
}
