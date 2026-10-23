import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BTCHunter — BTC/USD paper-trading research demo',
  description: 'Causal BTC/USD paper replay and read-only decision research built on completed public data.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
