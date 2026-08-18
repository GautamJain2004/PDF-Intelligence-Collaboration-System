import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'PDF Intelligence',
    template: '%s · PDF Intelligence',
  },
  description:
    'Upload PDFs, get AI summaries, ask questions about their contents, and collaborate through comments.',
  robots: {
    // Documents are private or share-token gated; nothing here should be indexed.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint so a dark-mode user never
          sees a white flash. Inline by necessity — an external script would run
          after the first paint.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var stored = localStorage.getItem('pdfiq-theme');
  var dark = stored ? stored === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
            `.trim(),
          }}
        />
      </head>
      <body className={`${inter.variable} ${mono.variable} font-sans`}>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast:
                'bg-card text-card-foreground border border-border shadow-lg rounded-lg',
              description: 'text-muted-foreground',
            },
          }}
        />
      </body>
    </html>
  );
}
