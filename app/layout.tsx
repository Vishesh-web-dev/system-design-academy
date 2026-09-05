import type { Metadata, Viewport } from 'next';
import { Archivo, Source_Serif_4, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { ThemeScript } from '@/components/shell/ThemeScript';

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
  style: ['normal', 'italic'],
  weight: ['400', '600'],
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'System Design Academy',
  description:
    'A private training platform for system design interviews: derive architectures, defend trade-offs, and practise under interviewer follow-up.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0e141b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${archivo.variable} ${sourceSerif.variable} ${jetbrains.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
