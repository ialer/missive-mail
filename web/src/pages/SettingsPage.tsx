import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Shield,
  Key,
  FileSignature,
  Filter,
  User,
  Lock,
  Smartphone,
  Loader2,
  Plus,
  Trash2,
  Check,
  AlertTriangle,
} from 'lucide-react';

type Tab = 'profile' | 'security' | 'pgp' | 'signatures' | 'rules';

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'profile', label: t('settings.profile'), icon: User },
    { id: 'security', label: t('settings.security'), icon: Shield },
    { id: 'pgp', label: t('settings.pgpKeys'), icon: Key },
    { id: 'signatures', label: t('settings.signatures'), icon: FileSignature },
    { id: 'rules', label: t('settings.rules'), icon: Filter },
  ];

  return (
    <div className="flex h-full">
      {/* Tab nav */}
      <div className="hidden w-56 flex-shrink-0 border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 lg:block">
        <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{t('settings.title')}</h2>
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
              'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition-colors',
              activeTab === tab.id
                ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl">
          {activeTab === 'profile' && <ProfileTab />}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'pgp' && <PGPTab />}
          {activeTab === 'signatures' && <SignaturesTab />}
          {activeTab === 'rules' && <RulesTab />}
        </div>
      </div>
    </div>
  );
}

function ProfileTab() {
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (name && name !== user?.name) {
        await api.updateProfile({ name });
      }
      if (newPassword && currentPassword) {
        await api.updatePassword({ currentPassword, newPassword });
      }
    },
    onSuccess: () => {
      refreshUser();
      setSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setError('');
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: any) => {
      setError(err.message || t('settings.profileTab.failedToUpdate'));
    },
  });

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('settings.profileTab.title')}</h3>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-[var(--text-secondary)]">{t('settings.profileTab.email')}</label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-2.5 text-sm text-[var(--text-muted)]"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t('settings.profileTab.emailCannotChange')}</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-[var(--text-secondary)]">{t('settings.profileTab.displayName')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-blue-600"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-[var(--text-secondary)]">{t('settings.profileTab.currentPassword')}</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t('settings.profileTab.currentPasswordPlaceholder')}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-blue-600"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-[var(--text-secondary)]">{t('settings.profileTab.newPassword')}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('settings.profileTab.newPasswordPlaceholder')}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-blue-600"
          />
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <button
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
          {saved ? <><Check size={14} /> {t('settings.profileTab.saved')}</> : t('settings.profileTab.saveChanges')}
        </button>
      </div>
    </div>
  );
}

function SecurityTab() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);

  const enableMutation = useMutation({
    mutationFn: () => api.enable2FA(),
    onSuccess: (data: any) => {
      setQrCode(data.qrCode || data.otpauth_url || '');
      setEnabled(true);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.verify2FA(code),
    onSuccess: () => {
      setVerified(true);
    },
  });

  const disableMutation = useMutation({
    mutationFn: () => api.disable2FA(),
    onSuccess: () => {
      setEnabled(false);
      setVerified(false);
      setQrCode('');
    },
  });

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('settings.securityTab.title')}</h3>

      {/* 2FA */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/20">
            <Smartphone size={18} className="text-emerald-400" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">{t('settings.securityTab.twoFactor')}</h4>
            <p className="text-xs text-[var(--text-muted)]">{t('settings.securityTab.twoFactorDesc')}</p>
          </div>
          {verified ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-600/20 px-2.5 py-1 text-xs text-emerald-400">
              <Check size={12} /> {t('settings.securityTab.enabled')}
            </span>
          ) : (
            <button
              onClick={() => enableMutation.mutate()}
              disabled={enableMutation.isPending}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {enableMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t('settings.securityTab.enable')}
            </button>
          )}
        </div>

        {enabled && !verified && (
          <div className="mt-4 space-y-3 border-t border-[var(--border-primary)] pt-4">
            {qrCode && (
              <div className="flex justify-center">
                <img src={qrCode} alt="QR Code" className="h-40 w-40 rounded-lg bg-white p-2" />
              </div>
            )}
            <p className="text-center text-xs text-[var(--text-muted)]">
              {t('settings.securityTab.scanQR')}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
                className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-center font-mono text-sm text-[var(--text-primary)] outline-none focus:border-blue-600"
              />
              <button
                onClick={() => verifyMutation.mutate()}
                disabled={code.length !== 6 || verifyMutation.isPending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {verifyMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : t('common.verify')}
              </button>
            </div>
          </div>
        )}

        {verified && (
          <div className="mt-4 border-t border-[var(--border-primary)] pt-4">
            <button
              onClick={() => disableMutation.mutate()}
              disabled={disableMutation.isPending}
              className="rounded-lg border border-red-900/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/30 disabled:opacity-50"
            >
              {t('settings.securityTab.disable2FA')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PGPTab() {
  const { t } = useTranslation();
  const [publicKey, setPublicKey] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['pgp-keys'],
    queryFn: () => api.getPGPKeys(),
  });

  const uploadMutation = useMutation({
    mutationFn: () => api.uploadPGPKey(publicKey),
    onSuccess: () => {
      setPublicKey('');
      queryClient.invalidateQueries({ queryKey: ['pgp-keys'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deletePGPKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pgp-keys'] });
    },
  });

  const keys = (data as any)?.keys || [];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('settings.pgpTab.title')}</h3>

      {/* Upload */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <h4 className="mb-3 text-sm font-medium text-[var(--text-primary)]">{t('settings.pgpTab.addPublicKey')}</h4>
        <textarea
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
          rows={5}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-600"
        />
        <button
          onClick={() => uploadMutation.mutate()}
          disabled={!publicKey.trim() || uploadMutation.isPending}
          className="mt-3 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploadMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t('settings.pgpTab.addKey')}
        </button>
      </div>

      {/* Key list */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-[var(--text-muted)]">{t('settings.pgpTab.loadingKeys')}</div>
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
            <Key size={32} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">{t('settings.pgpTab.noKeys')}</p>
          </div>
        ) : (
          keys.map((key: any) => (
            <div
              key={key.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
            >
              <Key size={16} className="text-[var(--text-muted)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--text-primary)]">{key.fingerprint || key.id}</p>
                <p className="text-xs text-[var(--text-muted)]">{key.email || key.userId}</p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(key.id)}
                className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-red-950/30 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SignaturesTab() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['signatures'],
    queryFn: () => api.getSignatures(),
  });

  const createMutation = useMutation({
    mutationFn: () => api.createSignature({ name, content }),
    onSuccess: () => {
      setName('');
      setContent('');
      queryClient.invalidateQueries({ queryKey: ['signatures'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSignature(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signatures'] });
    },
  });

  const signatures = (data as any)?.signatures || [];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('settings.signaturesTab.title')}</h3>

      {/* Create */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <h4 className="mb-3 text-sm font-medium text-[var(--text-primary)]">{t('settings.signaturesTab.newSignature')}</h4>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.signaturesTab.signatureNamePlaceholder')}
          className="mb-3 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-600"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('settings.signaturesTab.signatureContentPlaceholder')}
          rows={4}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-600"
        />
        <button
          onClick={() => createMutation.mutate()}
          disabled={!name.trim() || !content.trim() || createMutation.isPending}
          className="mt-3 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t('settings.signaturesTab.addSignature')}
        </button>
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-[var(--text-muted)]">{t('settings.signaturesTab.loadingSignatures')}</div>
        ) : signatures.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
            <FileSignature size={32} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">{t('settings.signaturesTab.noSignatures')}</p>
          </div>
        ) : (
          signatures.map((sig: any) => (
            <div
              key={sig.id}
              className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-[var(--text-primary)]">{sig.name}</h4>
                <button
                  onClick={() => deleteMutation.mutate(sig.id)}
                  className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-red-950/30 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]">{sig.content}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RulesTab() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleField, setRuleField] = useState('from');
  const [ruleOperator, setRuleOperator] = useState('contains');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleAction, setRuleAction] = useState('label');
  const [ruleActionValue, setRuleActionValue] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.getRules(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createRule({
        name: ruleName,
        conditions: { field: ruleField, operator: ruleOperator, value: ruleValue },
        actions: { type: ruleAction, value: ruleActionValue },
      }),
    onSuccess: () => {
      setShowForm(false);
      setRuleName('');
      setRuleValue('');
      setRuleActionValue('');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const rules = (data as any)?.rules || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('settings.rulesTab.title')}</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Plus size={12} />
          {t('settings.rulesTab.newRule')}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
          <div className="space-y-3">
            <input
              type="text"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder={t('settings.rulesTab.ruleNamePlaceholder')}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-600"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={ruleField}
                onChange={(e) => setRuleField(e.target.value)}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-2 text-xs text-[var(--text-secondary)] outline-none"
              >
                <option value="from">{t('settings.rulesTab.from')}</option>
                <option value="to">{t('settings.rulesTab.to')}</option>
                <option value="subject">{t('settings.rulesTab.subject')}</option>
                <option value="body">{t('settings.rulesTab.body')}</option>
              </select>
              <select
                value={ruleOperator}
                onChange={(e) => setRuleOperator(e.target.value)}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-2 text-xs text-[var(--text-secondary)] outline-none"
              >
                <option value="contains">{t('settings.rulesTab.contains')}</option>
                <option value="equals">{t('settings.rulesTab.equals')}</option>
                <option value="starts_with">{t('settings.rulesTab.startsWith')}</option>
                <option value="ends_with">{t('settings.rulesTab.endsWith')}</option>
              </select>
              <input
                type="text"
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
                placeholder={t('settings.rulesTab.valuePlaceholder')}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value)}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-2 text-xs text-[var(--text-secondary)] outline-none"
              >
                <option value="label">{t('settings.rulesTab.applyLabel')}</option>
                <option value="move">{t('settings.rulesTab.moveToFolder')}</option>
                <option value="archive">{t('settings.rulesTab.archive')}</option>
                <option value="delete">{t('settings.rulesTab.delete')}</option>
                <option value="mark_read">{t('settings.rulesTab.markAsRead')}</option>
              </select>
              <input
                type="text"
                value={ruleActionValue}
                onChange={(e) => setRuleActionValue(e.target.value)}
                placeholder={t('settings.rulesTab.labelFolderPlaceholder')}
                className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!ruleName.trim() || !ruleValue.trim() || createMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t('common.create')}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-[var(--text-muted)]">{t('settings.rulesTab.loadingRules')}</div>
        ) : rules.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
            <Filter size={32} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">{t('settings.rulesTab.noRules')}</p>
          </div>
        ) : (
          rules.map((rule: any) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
            >
              <div className="flex-1">
                <h4 className="text-sm font-medium text-[var(--text-primary)]">{rule.name}</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  If {rule.conditions?.field} {rule.conditions?.operator} "{rule.conditions?.value}" →{' '}
                  {rule.actions?.type} {rule.actions?.value || ''}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={rule.enabled !== false}
                  onChange={() =>
                    api.updateRule(rule.id, { enabled: rule.enabled === false }).then(() =>
                      queryClient.invalidateQueries({ queryKey: ['rules'] })
                    )
                  }
                  className="peer sr-only"
                />
                <div className="h-5 w-9 rounded-full bg-[var(--bg-tertiary)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-[var(--text-muted)] after:transition-all peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:bg-white" />
              </label>
              <button
                onClick={() => deleteMutation.mutate(rule.id)}
                className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-red-950/30 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
