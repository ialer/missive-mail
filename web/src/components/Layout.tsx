import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';
import {
  Inbox,
  Send,
  FileText,
  Archive,
  Trash2,
  Tag,
  Search,
  PenSquare,
  Settings,
  Shield,
  LogOut,
  Menu,
  X,
  ChevronDown,
  User,
} from 'lucide-react';

const folderIds = ['inbox', 'sent', 'drafts', 'archive', 'trash'] as const;
const folderIcons: Record<string, any> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  trash: Trash2,
};
const folderPaths: Record<string, string> = {
  inbox: '/',
  sent: '/sent',
  drafts: '/drafts',
  archive: '/archive',
  trash: '/trash',
};
const folderCounts: Record<string, number> = {
  inbox: 12,
  sent: 0,
  drafts: 2,
  archive: 0,
  trash: 0,
};

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [labels] = useState<{ id: string; name: string }[]>([]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh-CN' ? 'en' : 'zh-CN';
    i18n.changeLanguage(newLang);
  };

  const folders = folderIds.map((id) => ({
    id,
    label: t(`mail.${id}`),
    icon: folderIcons[id],
    path: folderPaths[id],
    count: folderCounts[id],
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-14 items-center justify-between border-b border-[var(--border-primary)] px-4">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
                M
              </div>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Missive Mail</span>
            </Link>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] lg:hidden"
            >
              <X size={18} />
            </button>
          </div>

          {/* Compose */}
          <div className="p-3">
            <Link
              to="/compose"
              className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <PenSquare size={16} />
              {t('mail.compose')}
            </Link>
          </div>

          {/* Folders */}
          <nav className="flex-1 space-y-0.5 px-3">
            {folders.map((folder) => {
              const isActive =
                folder.path === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(folder.path);
              return (
                <Link
                  key={folder.id}
                  to={folder.path}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <folder.icon size={16} />
                  <span className="flex-1">{folder.label}</span>
                  {folder.count > 0 && (
                    <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                      {folder.count}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Labels */}
            {labels.length > 0 && (
              <>
                <div className="my-2 border-t border-[var(--border-primary)]" />
                <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {t('mail.labels')}
                </p>
                {labels.map((label) => (
                  <Link
                    key={label.id}
                    to={`/label/${label.id}`}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      location.pathname === `/label/${label.id}`
                        ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Tag size={16} />
                    <span className="flex-1 truncate">{label.name}</span>
                  </Link>
                ))}
              </>
            )}
          </nav>

          {/* Bottom nav */}
          <div className="space-y-0.5 border-t border-[var(--border-primary)] p-3">
            <Link
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                location.pathname === '/settings'
                  ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              )}
            >
              <Settings size={16} />
              {t('layout.settings')}
            </Link>
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  location.pathname === '/admin'
                    ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                )}
              >
                <Shield size={16} />
                {t('layout.admin')}
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-4 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <Menu size={20} />
          </button>

          <form onSubmit={handleSearch} className="flex-1 max-w-lg">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder={t('mail.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] py-2 pl-9 pr-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-blue-600"
              />
            </div>
          </form>

          {/* Language toggle */}
          <button
            onClick={toggleLanguage}
            className="rounded-lg border border-[var(--border-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            {i18n.language === 'zh-CN' ? 'EN' : '中'}
          </button>

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600/20 text-xs font-medium text-blue-400">
                {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
              </div>
              <span className="hidden sm:inline">{user?.name || user?.email}</span>
              <ChevronDown size={14} />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1 shadow-xl animate-fade-in">
                  <div className="border-b border-[var(--border-primary)] px-3 py-2">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{user?.name || t('common.user')}</p>
                    <p className="text-xs text-[var(--text-muted)]">{user?.email}</p>
                  </div>
                  <Link
                    to="/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <User size={14} />
                    {t('layout.profileAndSettings')}
                  </Link>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-red-400"
                  >
                    <LogOut size={14} />
                    {t('common.signOut')}
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
