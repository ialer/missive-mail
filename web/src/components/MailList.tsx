import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Check,
  CheckCheck,
  ShieldCheck,
  Bot,
  Paperclip,
  Mail,
  MailOpen,
  RefreshCw,
} from 'lucide-react';

interface MailType {
  id: string;
  subject: string;
  from: { name: string; address: string };
  preview: string;
  date: string;
  read: boolean;
  starred: boolean;
  labels: string[];
  hasAttachments: boolean;
  isAgent: boolean;
  encrypted: boolean;
  threadId?: string;
  messageCount?: number;
}

interface MailListProps {
  folder: string;
}

export default function MailList({ folder }: MailListProps) {
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const [page, setPage] = useState(1);
  const { t } = useTranslation();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mails', folder, page, search],
    queryFn: () => api.getMails({ folder, page, limit: 50, search: search || undefined }),
  });

  useEffect(() => {
    setPage(1);
  }, [folder, search]);

  const mails = data?.mails || [];
  const total = data?.total || 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (days === 1) return t('common.yesterday');
    if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] capitalize">
            {folder === 'label' ? t('mail.label') : t(`mail.${folder}`)}
          </h1>
          <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
            {total}
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Mail list */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
          </div>
        ) : mails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
            <Mail size={48} strokeWidth={1} className="mb-4" />
            <p className="text-sm">{t('mail.noMails')}</p>
          </div>
        ) : (
          <div>
            {mails.map((mail: MailType, index: number) => (
              <Link
                key={mail.id}
                to={`/mail/${mail.id}`}
                className={cn(
                  'group flex items-start gap-3 border-b border-[var(--border-primary)] px-4 py-3 transition-colors hover:bg-[var(--bg-hover)] animate-slide-in',
                  !mail.read && 'bg-[var(--bg-secondary)]'
                )}
                style={{ animationDelay: `${index * 20}ms` }}
              >
                {/* Avatar / Read indicator */}
                <div className="relative mt-0.5">
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium',
                      mail.isAgent
                        ? 'bg-violet-600/20 text-violet-400'
                        : 'bg-blue-600/20 text-blue-400'
                    )}
                  >
                    {mail.isAgent ? (
                      <Bot size={16} />
                    ) : (
                      (mail.from.name?.[0] || mail.from.address[0]).toUpperCase()
                    )}
                  </div>
                  {!mail.read && (
                    <div className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500" />
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-sm',
                        mail.read
                          ? 'font-normal text-[var(--text-secondary)]'
                          : 'font-semibold text-[var(--text-primary)]'
                      )}
                    >
                      {mail.from.name || mail.from.address}
                    </span>
                    {mail.isAgent && (
                      <span className="flex-shrink-0 rounded bg-violet-600/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                        {t('mail.agent')}
                      </span>
                    )}
                    {mail.encrypted && (
                      <ShieldCheck size={12} className="flex-shrink-0 text-emerald-400" />
                    )}
                    <span className="ml-auto flex-shrink-0 text-xs text-[var(--text-muted)]">
                      {formatDate(mail.date)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'truncate text-sm',
                      mail.read
                        ? 'font-normal text-[var(--text-secondary)]'
                        : 'font-medium text-[var(--text-primary)]'
                    )}
                  >
                    {mail.subject || t('common.noSubject')}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs text-[var(--text-muted)]">{mail.preview}</p>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {mail.hasAttachments && (
                        <Paperclip size={12} className="text-[var(--text-muted)]" />
                      )}
                      {mail.messageCount && mail.messageCount > 1 && (
                        <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">
                          {mail.messageCount}
                        </span>
                      )}
                    </div>
                  </div>
                  {mail.labels.length > 0 && (
                    <div className="mt-1 flex gap-1">
                      {mail.labels.map((label) => (
                        <span
                          key={label}
                          className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Read status */}
                <div className="flex-shrink-0 pt-1">
                  {mail.read ? (
                    <CheckCheck size={14} className="text-blue-400" />
                  ) : (
                    <Check size={14} className="text-[var(--text-muted)]" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between border-t border-[var(--border-primary)] px-4 py-3">
          <span className="text-xs text-[var(--text-muted)]">
            {t('mail.showing', { from: (page - 1) * 50 + 1, to: Math.min(page * 50, total), total })}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-30"
            >
              {t('common.previous')}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 50 >= total}
              className="rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-30"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
