import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  ArrowLeft,
  Send,
  Paperclip,
  X,
  ShieldCheck,
  ChevronDown,
  Loader2,
  Plus,
} from 'lucide-react';

export default function ComposeMail() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [signatureId, setSignatureId] = useState<string>('');

  const { data: signatureData } = useQuery({
    queryKey: ['signatures'],
    queryFn: () => api.getSignatures(),
  });

  const signatures = (signatureData as any)?.signatures || [];

  const sendMutation = useMutation({
    mutationFn: () =>
      api.sendMail({
        to: to.split(',').map((s) => s.trim()).filter(Boolean),
        cc: cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        bcc: bcc ? bcc.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        subject,
        body,
        encrypt,
        signatureId: signatureId || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    onSuccess: () => {
      navigate('/');
    },
  });

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (!to.trim() || !subject.trim()) return;
    sendMutation.mutate();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t('compose.newMessage')}</h1>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* To */}
          <div className="flex items-center gap-3 border-b border-[var(--border-primary)] pb-3">
            <label className="w-12 text-sm text-[var(--text-muted)]">{t('compose.to')}</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('compose.recipientPlaceholder')}
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            />
            <div className="flex gap-1">
              {!showCc && (
                <button
                  onClick={() => setShowCc(true)}
                  className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  {t('compose.cc')}
                </button>
              )}
              {!showBcc && (
                <button
                  onClick={() => setShowBcc(true)}
                  className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  {t('compose.bcc')}
                </button>
              )}
            </div>
          </div>

          {/* CC */}
          {showCc && (
            <div className="flex items-center gap-3 border-b border-[var(--border-primary)] pb-3">
              <label className="w-12 text-sm text-[var(--text-muted)]">{t('compose.cc')}</label>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder={t('compose.ccPlaceholder')}
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
              />
              <button
                onClick={() => { setShowCc(false); setCc(''); }}
                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* BCC */}
          {showBcc && (
            <div className="flex items-center gap-3 border-b border-[var(--border-primary)] pb-3">
              <label className="w-12 text-sm text-[var(--text-muted)]">{t('compose.bcc')}</label>
              <input
                type="text"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder={t('compose.bccPlaceholder')}
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
              />
              <button
                onClick={() => { setShowBcc(false); setBcc(''); }}
                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-3 border-b border-[var(--border-primary)] pb-3">
            <label className="w-12 text-sm text-[var(--text-muted)]">{t('compose.subject')}</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('compose.subjectPlaceholder')}
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            />
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('compose.bodyPlaceholder')}
            rows={20}
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
          />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              {attachments.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2"
                >
                  <Paperclip size={14} className="text-[var(--text-muted)]" />
                  <span className="flex-1 truncate text-xs text-[var(--text-secondary)]">{file.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">{formatSize(file.size)}</span>
                  <button
                    onClick={() => removeAttachment(index)}
                    className="rounded p-0.5 text-[var(--text-muted)] hover:text-red-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border-primary)] px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={!to.trim() || !subject.trim() || sendMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {sendMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {t('compose.send')}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleAttach}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              title={t('compose.attachFiles')}
            >
              <Paperclip size={16} />
            </button>

            {/* PGP Toggle */}
            <button
              onClick={() => setEncrypt(!encrypt)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors',
                encrypt
                  ? 'bg-emerald-600/20 text-emerald-400'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              )}
              title={t('compose.pgpEncrypt')}
            >
              <ShieldCheck size={14} />
              {encrypt ? t('compose.encrypted') : t('compose.encrypt')}
            </button>
          </div>

          {/* Signature selector */}
          {signatures.length > 0 && (
            <div className="relative">
              <select
                value={signatureId}
                onChange={(e) => setSignatureId(e.target.value)}
                className="appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 pr-8 text-xs text-[var(--text-secondary)] outline-none"
              >
                <option value="">{t('compose.noSignature')}</option>
                {signatures.map((sig: any) => (
                  <option key={sig.id} value={sig.id}>
                    {sig.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
