import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { Mail, Loader2 } from 'lucide-react';
import TurnstileWidget from '../components/TurnstileWidget';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, turnstileToken);
      navigate('/');
    } catch (err: any) {
      setError(err.message || t('login.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
            <Mail size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{t('login.title')}</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t('login.subtitle')}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm text-[var(--text-secondary)]">{t('login.emailLabel')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              required
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-blue-600"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-[var(--text-secondary)]">{t('login.passwordLabel')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              required
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-blue-600"
            />
          </div>

          <TurnstileWidget
            onVerify={(token) => setTurnstileToken(token)}
            onExpire={() => setTurnstileToken('')}
          />

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {t('login.signIn')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          {t('login.noAccount')}{' '}
          <Link to="/register" className="text-blue-400 hover:underline">
            {t('login.createOne')}
          </Link>
        </p>
      </div>
    </div>
  );
}
