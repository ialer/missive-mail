import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  ArrowLeft,
  Bot,
  Paperclip,
  ShieldCheck,
  Download,
  Archive,
  Trash2,
  Send,
  Loader2,
  MoreHorizontal,
} from 'lucide-react';

interface MailMessage {
  id: string;
  from: { name: string; address: string };
  subject: string;
  date: string;
  body: string;
  htmlBody?: string;
  isAgent: boolean;
  agentName?: string;
  encrypted: boolean;
  attachments: { id: string; filename: string; size: number }[];
  isOwn: boolean;
}

export default function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['mail', id],
    queryFn: () => api.getMail(id!),
    enabled: !!id,
    refetchInterval: 3000,
  });

  const msg: MailMessage | undefined = data ? {
    ...data.mail,
    body: data.body?.text || data.mail.textContent || '',
    htmlBody: data.body?.html || data.mail.htmlContent || '',
    attachments: data.attachments || [],
  } : undefined;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msg]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const handleReply = async () => {
    if (!replyText.trim() || !msg) return;
    setSending(true);
    try {
      await api.replyMail(msg.id, { text: replyText });
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['mail', id] });
      queryClient.invalidateQueries({ queryKey: ['mails'] });
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </div>
    );
  }

  if (!msg) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-[var(--text-muted)]">
        <p>{t('conversation.mailNotFound')}</p>
        <button onClick={() => navigate(-1)} className="mt-2 text-sm text-blue-400 hover:underline">
          {t('common.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border-primary)] px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {msg.subject || t('common.noSubject')}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <button className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <Archive size={16} />
          </button>
          <button className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-red-400">
            <Trash2 size={16} />
          </button>
          <button className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Message */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-4">
          {/* Sender */}
          <div className="flex items-center gap-2 mb-3">
            <div className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium',
              msg.isAgent
                ? 'bg-violet-600/20 text-violet-400'
                : msg.isOwn
                ? 'bg-blue-600/20 text-blue-400'
                : 'bg-zinc-600/30 text-zinc-300'
            )}>
              {msg.isAgent ? <Bot size={16} /> : (msg.from.name?.[0] || msg.from.address[0]).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {msg.isAgent ? (msg.agentName || 'Agent') : (msg.from.name || msg.from.address)}
              </span>
              {msg.isAgent && (
                <span className="ml-1.5 rounded bg-violet-600/20 px-1 py-0.5 text-[9px] font-medium text-violet-400">Agent</span>
              )}
              {msg.encrypted && <ShieldCheck size={11} className="ml-1 inline text-emerald-400" />}
              <span className="ml-2 text-xs text-[var(--text-muted)]">{msg.from.address}</span>
            </div>
            <span className="text-xs text-[var(--text-muted)] flex-shrink-0">{formatDate(msg.date)}</span>
          </div>

          {/* Body */}
          <div className="pl-10">
            {msg.htmlBody ? (
              <div
                className="prose-invert prose-sm max-w-none text-sm leading-relaxed text-[var(--text-secondary)]"
                dangerouslySetInnerHTML={{ __html: msg.htmlBody }}
              />
            ) : (
              <p className="text-sm leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                {msg.body}
              </p>
            )}

            {/* Attachments */}
            {msg.attachments?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {msg.attachments.map((att) => (
                  <button
                    key={att.id}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <Paperclip size={11} />
                    <span>{att.filename}</span>
                    <Download size={11} className="text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reply */}
      <div className="border-t border-[var(--border-primary)] px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入回复..."
              rows={2}
              className="w-full resize-none rounded-t-xl bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            />
            <div className="flex items-center justify-between border-t border-[var(--border-primary)] px-3 py-2">
              <button className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                <Paperclip size={16} />
              </button>
              <button
                onClick={handleReply}
                disabled={!replyText.trim() || sending}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                发送
              </button>
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] text-[var(--text-muted)]">回车发送 · Shift+回车换行</p>
        </div>
      </div>
    </div>
  );
}
