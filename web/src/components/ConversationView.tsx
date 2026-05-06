import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Bot,
  Paperclip,
  ShieldCheck,
  Download,
  Reply,
  ReplyAll,
  Forward,
  MoreHorizontal,
  Archive,
  Trash2,
  Eye,
  EyeOff,
  Send,
  Loader2,
} from 'lucide-react';
import PostalMime from 'postal-mime';

interface MailMessage {
  id: string;
  from: { name: string; address: string };
  to: { name: string; address: string }[];
  cc?: { name: string; address: string }[];
  subject: string;
  date: string;
  body: string;
  htmlBody?: string;
  rawBody?: string;
  readReceipt?: 'sent' | 'delivered' | 'read';
  isAgent: boolean;
  agentName?: string;
  encrypted: boolean;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
  }[];
  isOwn: boolean;
}

interface Conversation {
  id: string;
  subject: string;
  messages: MailMessage[];
}

export default function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [replyText, setReplyText] = useState('');
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['mail', id],
    queryFn: () => api.getMail(id!),
    enabled: !!id,
  });

  const markReadMutation = useMutation({
    mutationFn: () => Promise.resolve(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mails'] });
    },
  });

  const conversation: Conversation | undefined = data?.mail
    ? { id: data.mail.id, subject: data.mail.subject, messages: [data.mail] }
    : undefined;

  if (conversation && !data?.mail?.read && data?.mail) {
    markReadMutation.mutate();
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownloadAttachment = async (mailId: string, attachmentId: string, filename: string) => {
    try {
      const res = await api.getAttachment(mailId, attachmentId);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !conversation) return;
    setSending(true);
    try {
      const lastMsg = conversation.messages[conversation.messages.length - 1];
      await api.sendMail({
        to: [lastMsg.from.address],
        subject: conversation.subject.startsWith('Re:') ? conversation.subject : `Re: ${conversation.subject}`,
        body: replyText,
      });
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['mail', id] });
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleAction = async (action: 'archive' | 'delete') => {
    if (!id) return;
    if (action === 'archive') {
      await api.archiveMail(id);
    } else {
      await api.deleteMail(id);
    }
    queryClient.invalidateQueries({ queryKey: ['mails'] });
    navigate('/');
  };

  const ReadReceiptIcon = ({ status }: { status?: string }) => {
    switch (status) {
      case 'read':
        return (
          <span className="flex items-center">
            <CheckCheck size={12} className="text-blue-400" />
          </span>
        );
      case 'delivered':
        return <CheckCheck size={12} className="text-blue-400" />;
      case 'sent':
        return <Check size={12} className="text-[var(--text-muted)]" />;
      default:
        return <Check size={12} className="text-[var(--text-muted)]" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </div>
    );
  }

  if (!conversation) {
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
            {conversation.subject || t('common.noSubject')}
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            {conversation.messages.length === 1
              ? t('conversation.messageCount', { count: conversation.messages.length })
              : t('conversation.messagesCount', { count: conversation.messages.length })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleAction('archive')}
            className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title={t('mail.archive')}
          >
            <Archive size={16} />
          </button>
          <button
            onClick={() => handleAction('delete')}
            className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-red-400"
            title={t('common.delete')}
          >
            <Trash2 size={16} />
          </button>
          <button className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {conversation.messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'animate-fade-in rounded-xl border p-4',
                msg.isOwn
                  ? 'ml-12 border-blue-900/30 bg-blue-950/20'
                  : 'mr-12 border-[var(--border-primary)] bg-[var(--bg-secondary)]'
              )}
            >
              {/* Message header */}
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium',
                      msg.isAgent
                        ? 'bg-violet-600/20 text-violet-400'
                        : msg.isOwn
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-zinc-700/50 text-zinc-300'
                    )}
                  >
                    {msg.isAgent ? (
                      <Bot size={14} />
                    ) : (
                      (msg.from.name?.[0] || msg.from.address[0]).toUpperCase()
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {msg.from.name || msg.from.address}
                      </span>
                      {msg.isAgent && msg.agentName && (
                        <span className="rounded bg-violet-600/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                          {t('conversation.viaAgent', { name: msg.agentName })}
                        </span>
                      )}
                      {msg.encrypted && (
                        <span title={t('conversation.pgpEncrypted')}>
                          <ShieldCheck size={12} className="text-emerald-400" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      {msg.from.address} · {formatDate(msg.date)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {msg.readReceipt && <ReadReceiptIcon status={msg.readReceipt} />}
                  {msg.rawBody && (
                    <button
                      onClick={() => setShowRaw((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                      className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      title="Toggle raw view"
                    >
                      {showRaw[msg.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Message body */}
              <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                {showRaw[msg.id] ? (
                  <pre className="whitespace-pre-wrap rounded-lg bg-[var(--bg-primary)] p-3 text-xs font-mono">
                    {msg.rawBody || msg.body}
                  </pre>
                ) : msg.htmlBody ? (
                  <div
                    className="prose-invert prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: msg.htmlBody }}
                  />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.body}</div>
                )}
              </div>

              {/* Attachments */}
              {msg.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {msg.attachments.map((att) => (
                    <button
                      key={att.id}
                      onClick={() => handleDownloadAttachment(msg.id, att.id, att.filename)}
                      className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-xs transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <Paperclip size={12} className="text-[var(--text-muted)]" />
                      <span className="text-[var(--text-secondary)]">{att.filename}</span>
                      <span className="text-[var(--text-muted)]">{formatSize(att.size)}</span>
                      <Download size={12} className="text-[var(--text-muted)]" />
                    </button>
                  ))}
                </div>
              )}

              {/* Reply actions */}
              <div className="mt-3 flex gap-1">
                <button
                  onClick={() => {
                    setReplyText('');
                    document.getElementById('reply-input')?.focus();
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Reply size={12} />
                  {t('conversation.reply')}
                </button>
                <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <ReplyAll size={12} />
                  {t('conversation.replyAll')}
                </button>
                <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Forward size={12} />
                  {t('conversation.forward')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reply box */}
      <div className="border-t border-[var(--border-primary)] px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
            <textarea
              id="reply-input"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t('conversation.replyPlaceholder')}
              rows={3}
              className="w-full resize-none rounded-t-xl bg-transparent p-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            />
            <div className="flex items-center justify-between border-t border-[var(--border-primary)] px-3 py-2">
              <div className="flex gap-1">
                <button className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Paperclip size={16} />
                </button>
                <button className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <ShieldCheck size={16} />
                </button>
              </div>
              <button
                onClick={handleReply}
                disabled={!replyText.trim() || sending}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
              >
                {sending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                {t('compose.send')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
