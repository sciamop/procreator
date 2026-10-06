import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Procreator',
  description: 'Your artwork and time-lapse recordings, collected in one place.',
  icons: { icon: '/favicon.svg' },
};

const inkScript = `(function(){try{var a=['blue','red','orange','yellow','olive','green'];var n=parseInt(sessionStorage.getItem('procreate-ink-step')||'0',10)||0;document.documentElement.className='on-'+a[Math.abs(n)%6];sessionStorage.setItem('procreate-ink-step',String((n+1)%6));}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className="on-blue" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: inkScript }}/></head><body>{children}</body></html>;
}
