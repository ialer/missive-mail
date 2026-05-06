import { useEffect, useRef, useState } from 'react';

const TURNSTILE_SITE_KEY = '0x4AAAAAADKZ7gcO8fckYL4i';

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

export default function TurnstileWidget({ onVerify, onExpire }: TurnstileWidgetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Load Turnstile script
    if (document.getElementById('cf-turnstile-script')) {
      setReady(true);
      return;
    }
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!ready || !ref.current || !window.turnstile) return;
    
    const widgetId = window.turnstile.render(ref.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token: string) => onVerify(token),
      'expired-callback': () => onExpire?.(),
      theme: 'dark',
    });

    return () => {
      window.turnstile?.remove(widgetId);
    };
  }, [ready, onVerify, onExpire]);

  return <div ref={ref} className="mt-2" />;
}

// Extend Window for Turnstile
declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: any) => string;
      remove: (widgetId: string) => void;
    };
  }
}
