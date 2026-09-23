import type { Metadata } from 'next';
import './globals.css';
import './extras.css';

export const metadata: Metadata = {
  title: 'EKT — умный помощник',
  description: 'Помощник по каталогу электротехнических товаров ekt.kz',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
