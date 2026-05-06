import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Users,
  Globe,
  BarChart3,
  Shield,
  Trash2,
  Plus,
  Loader2,
  ChevronDown,
  AlertTriangle,
  Mail,
  HardDrive,
} from 'lucide-react';

type Tab = 'users' | 'domains' | 'stats';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const { t } = useTranslation();

  const tabs = [
    { id: 'users' as Tab, label: t('admin.users'), icon: Users },
    { id: 'domains' as Tab, label: t('admin.domains'), icon: Globe },
    { id: 'stats' as Tab, label: t('admin.statistics'), icon: BarChart3 },
  ];

  return (
    <div className="flex h-full">
      {/* Tab nav */}
      <div className="hidden w-56 flex-shrink-0 border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 lg:block">
        <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{t('admin.title')}</h2>
        <nav className="space-y-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === tab.id
                  ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              )}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border-primary)] px-4 py-2 lg:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition-colors',
              activeTab === tab.id
                ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'domains' && <DomainsTab />}
          {activeTab === 'stats' && <StatsTab />}
        </div>
      </div>
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.getUsers({ limit: 100 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateUser(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const users = (data as any)?.users || [];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('admin.usersTab.title')}</h3>

      {isLoading ? (
        <div className="py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user: any) => (
            <div
              key={user.id}
              className="flex items-center gap-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600/20 text-sm font-medium text-blue-400">
                {(user.name?.[0] || user.email[0]).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {user.name || t('common.unnamed')}
                </p>
                <p className="text-xs text-[var(--text-muted)]">{user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    user.role === 'admin'
                      ? 'bg-amber-600/20 text-amber-400'
                      : 'bg-zinc-700/50 text-zinc-400'
                  )}
                >
                  {user.role}
                </span>
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    user.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-600'
                  )}
                />
                <button
                  onClick={() =>
                    updateMutation.mutate({
                      id: user.id,
                      data: { role: user.role === 'admin' ? 'user' : 'admin' },
                    })
                  }
                  className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  title={t('admin.usersTab.toggleRole')}
                >
                  <Shield size={14} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(t('admin.usersTab.confirmDelete', { email: user.email }))) {
                      deleteMutation.mutate(user.id);
                    }
                  }}
                  className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-red-950/30 hover:text-red-400"
                  title={t('admin.usersTab.deleteUser')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DomainsTab() {
  const [newDomain, setNewDomain] = useState('');
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-domains'],
    queryFn: () => api.getDomains(),
  });

  const addMutation = useMutation({
    mutationFn: () => api.addDomain(newDomain),
    onSuccess: () => {
      setNewDomain('');
      queryClient.invalidateQueries({ queryKey: ['admin-domains'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDomain(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-domains'] }),
  });

  const domains = (data as any)?.domains || [];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('admin.domainsTab.title')}</h3>

      {/* Add domain */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="example.com"
          className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-blue-600"
        />
        <button
          onClick={() => addMutation.mutate()}
          disabled={!newDomain.trim() || addMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t('common.add')}
        </button>
      </div>

      {/* Domain list */}
      {isLoading ? (
        <div className="py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
        </div>
      ) : (
        <div className="space-y-2">
          {domains.map((domain: any) => (
            <div
              key={domain.id}
              className="flex items-center gap-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
            >
              <Globe size={16} className="text-[var(--text-muted)]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">{domain.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  MX: {domain.mxRecord || t('admin.domainsTab.notVerified')} · SPF: {domain.spfValid ? '✓' : '✗'} · DKIM:{' '}
                  {domain.dkimValid ? '✓' : '✗'}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  domain.verified
                    ? 'bg-emerald-600/20 text-emerald-400'
                    : 'bg-amber-600/20 text-amber-400'
                )}
              >
                {domain.verified ? t('admin.domainsTab.verified') : t('admin.domainsTab.pending')}
              </span>
              <button
                onClick={() => {
                  if (confirm(t('admin.domainsTab.confirmDelete', { name: domain.name }))) {
                    deleteMutation.mutate(domain.id);
                  }
                }}
                className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-red-950/30 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatsTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.getOverview(),
  });

  const stats = (data as any)?.stats || {};

  const cards = [
    { label: t('admin.statsTab.totalMails'), value: stats.totalMails || 0, icon: Mail, color: 'text-blue-400' },
    { label: t('admin.statsTab.unreadMails'), value: stats.unreadMails || 0, icon: Mail, color: 'text-violet-400' },
    { label: t('admin.statsTab.starredMails'), value: stats.starredMails || 0, icon: Mail, color: 'text-amber-400' },
    { label: t('admin.statsTab.attachments'), value: stats.totalAttachments || 0, icon: HardDrive, color: 'text-emerald-400' },
    { label: t('admin.statsTab.activeAgents'), value: stats.activeAgents || 0, icon: Users, color: 'text-cyan-400' },
    { label: t('admin.statsTab.activeWebhooks'), value: stats.activeWebhooks || 0, icon: Globe, color: 'text-pink-400' },
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('admin.statsTab.title')}</h3>

      {isLoading ? (
        <div className="py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {cards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
              >
                <div className="flex items-center gap-2">
                  <card.icon size={16} className={card.color} />
                  <span className="text-xs text-[var(--text-muted)]">{card.label}</span>
                </div>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Activity chart placeholder */}
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
            <h4 className="mb-4 text-sm font-medium text-[var(--text-primary)]">{t('admin.statsTab.mailActivity30')}</h4>
            <div className="flex items-end gap-1 h-32">
              {Array.from({ length: 30 }, (_, i) => {
                const height = Math.random() * 100;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-blue-600/30 transition-all hover:bg-blue-600/50"
                    style={{ height: `${Math.max(4, height)}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-[var(--text-muted)]">
              <span>{t('admin.statsTab.daysAgo')}</span>
              <span>{t('admin.statsTab.today')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
