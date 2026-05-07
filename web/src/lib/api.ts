const BASE_URL = '/api/v1';
const AUTH_URL = '/auth';

interface RequestConfig extends RequestInit {
  params?: Record<string, string>;
  /** When true, bypass BASE_URL prefix (used for /auth routes) */
  raw?: boolean;
}

/** Normalize a raw backend mail record to the shape the frontend components expect */
function normalizeMail(mail: any) {
  return {
    ...mail,
    id: mail.id,
    subject: mail.subject,
    from: { name: '', address: mail.fromAddr || '' },
    to: (mail.toAddr || '').split(',').map((a: string) => ({ name: '', address: a.trim() })),
    date: mail.createdAt,
    read: mail.isRead,
    starred: mail.isStarred,
    labels: Array.isArray(mail.labels) ? mail.labels : [],
    preview: '',
    hasAttachments: false,
    isAgent: false,
    encrypted: false,
    importance: mail.importance,
    folder: mail.folder,
  };
}

class ApiClient {
  private getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem('refresh_token');
  }

  private setTokens(access: string, refresh: string) {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
  }

  private clearTokens() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  private async refreshAccessToken(): Promise<boolean> {
    const refresh = this.getRefreshToken();
    if (!refresh) return false;

    try {
      const res = await fetch(`${AUTH_URL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });

      if (!res.ok) {
        this.clearTokens();
        return false;
      }

      const data = await res.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      this.clearTokens();
      return false;
    }
  }

  async request<T = any>(path: string, config: RequestConfig = {}): Promise<T> {
    const { params, raw, ...fetchConfig } = config;
    const basePath = raw ? '' : BASE_URL;
    const url = new URL(path.startsWith('http') ? path : `${basePath}${path}`, window.location.origin);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
    }

    const headers = new Headers(fetchConfig.headers);
    const token = this.getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Content-Type') && fetchConfig.body && typeof fetchConfig.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    let res = await fetch(url.toString(), { ...fetchConfig, headers });

    // Auto-refresh on 401
    if (res.status === 401) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        headers.set('Authorization', `Bearer ${this.getAccessToken()}`);
        res = await fetch(url.toString(), { ...fetchConfig, headers });
      } else {
        window.location.href = '/login';
        throw new Error('Session expired');
      }
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || error.error || `HTTP ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ─── Auth (mounted at /auth, not /api/v1/auth) ────────────────────────────

  login(email: string, password: string, turnstileToken?: string) {
    return this.request<{
      user: any;
      accessToken: string;
      refreshToken: string;
      requiresTwoFactor?: boolean;
      tempToken?: string;
    }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, turnstileToken }), raw: true });
  }

  register(email: string, password: string, name?: string) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
      raw: true,
    });
  }

  logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  getProfile() {
    return this.request<{ user: any }>('/auth/me', { raw: true });
  }

  // ─── Profile (under /admin) ────────────────────────────────────────────────

  updateProfile(data: { name?: string; email?: string }) {
    return this.request('/admin/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  updatePassword(data: { currentPassword: string; newPassword: string }) {
    return this.request('/admin/password', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ─── Mails ─────────────────────────────────────────────────────────────────

  getMails(params: { folder?: string; label?: string; page?: number; limit?: number; search?: string; starred?: boolean; unread?: boolean } = {}) {
    return this.request<{
      mails: any[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>('/mails', { params: params as any }).then((res) => ({
      ...res,
      mails: (res.mails || []).map(normalizeMail),
      total: res.pagination?.total || 0,
      page: res.pagination?.page || 1,
      limit: res.pagination?.limit || 20,
    }));
  }

  getMail(id: string) {
    return this.request<{ mail: any; body: any; attachments: any[] }>(`/mails/${id}`).then((res) => {
      const normalizedMail = normalizeMail(res.mail);
      normalizedMail.hasAttachments = (res.attachments || []).length > 0;
      return {
        ...res,
        mail: normalizedMail,
        // Map body fields for component convenience
        body: res.body ? {
          text: res.body.textContent || '',
          html: res.body.htmlContent || '',
          headers: res.body.rawHeaders || {},
        } : null,
      };
    });
  }

  sendMail(data: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text?: string; html?: string; body?: string; replyTo?: string; importance?: number; encrypt?: boolean; signatureId?: string; attachments?: File[] }) {
    // Map user-friendly 'body' field to 'text' for backend compatibility
    const payload: Record<string, unknown> = {
      to: data.to,
      subject: data.subject,
      text: data.text || data.body,
      html: data.html,
      cc: data.cc,
      bcc: data.bcc,
      replyTo: data.replyTo,
      importance: data.importance,
    };
    // Remove undefined fields
    Object.keys(payload).forEach((k) => {
      if (payload[k] === undefined) delete payload[k];
    });
    return this.request('/mails/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  replyMail(id: string, data: { text?: string; html?: string; body?: string; cc?: string[]; bcc?: string[] }) {
    return this.request(`/mails/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({
        text: data.text || data.body,
        html: data.html,
        cc: data.cc,
        bcc: data.bcc,
      }),
    });
  }

  archiveMail(id: string) {
    return this.request(`/mails/${id}/archive`, { method: 'POST' });
  }

  setMailLabels(id: string, labels: string[]) {
    return this.request(`/mails/${id}/label`, {
      method: 'PUT',
      body: JSON.stringify({ labels }),
    });
  }

  deleteMail(id: string) {
    return this.request(`/mails/${id}`, { method: 'DELETE' });
  }

  getAttachment(id: string, attachmentId: string) {
    return fetch(`${BASE_URL}/mails/${id}/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${this.getAccessToken()}` },
    });
  }

  // ─── Labels (under /admin) ─────────────────────────────────────────────────

  getLabels() {
    return this.request<{ labels: any[] }>('/admin/labels');
  }

  createLabel(name: string, color?: string) {
    return this.request('/admin/labels', {
      method: 'POST',
      body: JSON.stringify({ name, color: color || '#3b82f6' }),
    });
  }

  deleteLabel(id: string) {
    return this.request(`/admin/labels/${id}`, { method: 'DELETE' });
  }

  // ─── Rules (under /admin) ──────────────────────────────────────────────────

  getRules() {
    return this.request<{ rules: any[] }>('/admin/rules');
  }

  createRule(data: { name: string; conditions: Record<string, unknown>; actions: Record<string, unknown>; enabled?: boolean; priority?: number }) {
    return this.request('/admin/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateRule(id: string, data: { name?: string; conditions?: Record<string, unknown>; actions?: Record<string, unknown>; enabled?: boolean; priority?: number }) {
    return this.request(`/admin/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteRule(id: string) {
    return this.request(`/admin/rules/${id}`, { method: 'DELETE' });
  }

  // ─── Admin ──────────────────────────────────────────────────────────────────

  getOverview() {
    return this.request('/admin/overview');
  }

  getAuditLogs(params?: { page?: number; limit?: number; action?: string }) {
    return this.request('/admin/audit-logs', { params: params as any });
  }

  getLoginHistory(params?: { page?: number; limit?: number }) {
    return this.request('/admin/login-history', { params: params as any });
  }

  // Alias for backwards compatibility with AdminPage
  getStats() {
    return this.getOverview();
  }

  getUsers(_params?: { page?: number; limit?: number }) {
    // No backend route for user management — return empty
    return Promise.resolve({ users: [] });
  }

  updateUser(_id: string, _data: any) {
    return Promise.reject(new Error('User management not yet implemented on server'));
  }

  deleteUser(_id: string) {
    return Promise.reject(new Error('User management not yet implemented on server'));
  }

  getDomains() {
    // No backend route for domain management — return empty
    return Promise.resolve({ domains: [] });
  }

  addDomain(_domain: string) {
    return Promise.reject(new Error('Domain management not yet implemented on server'));
  }

  deleteDomain(_id: string) {
    return Promise.reject(new Error('Domain management not yet implemented on server'));
  }

  // ─── Webhooks ──────────────────────────────────────────────────────────────

  getWebhooks() {
    return this.request<{ webhooks: any[] }>('/webhooks');
  }

  createWebhook(data: { url: string; events: string[]; filter?: Record<string, unknown> }) {
    return this.request('/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateWebhook(id: string, data: { url?: string; events?: string[]; enabled?: boolean; filter?: Record<string, unknown> }) {
    return this.request(`/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteWebhook(id: string) {
    return this.request(`/webhooks/${id}`, { method: 'DELETE' });
  }

  testWebhook(id: string) {
    return this.request(`/webhooks/${id}/test`, { method: 'POST' });
  }

  // ─── Agents ────────────────────────────────────────────────────────────────

  getAgents() {
    return this.request<{ agents: any[] }>('/agents');
  }

  createAgent(data: { name: string; permissions?: string[]; signatureTemplate?: string; rateLimit?: number }) {
    return this.request('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getAgent(id: string) {
    return this.request<{ agent: any }>(`/agents/${id}`);
  }

  updateAgent(id: string, data: { name?: string; permissions?: string[]; signatureTemplate?: string; rateLimit?: number; enabled?: boolean }) {
    return this.request(`/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteAgent(id: string) {
    return this.request(`/agents/${id}`, { method: 'DELETE' });
  }

  regenerateAgentKey(id: string) {
    return this.request<{ apiKey: string }>(`/agents/${id}/regenerate-key`, {
      method: 'POST',
    });
  }

  // ─── PGP Keys (no backend route — stubs) ──────────────────────────────────

  getPGPKeys() {
    return Promise.resolve({ keys: [] });
  }

  uploadPGPKey(_publicKey: string) {
    return Promise.reject(new Error('PGP key management not yet implemented on server'));
  }

  deletePGPKey(_id: string) {
    return Promise.reject(new Error('PGP key management not yet implemented on server'));
  }

  // ─── Signatures (no backend route — stubs) ─────────────────────────────────

  getSignatures() {
    return Promise.resolve({ signatures: [] });
  }

  createSignature(_data: { name: string; content: string }) {
    return Promise.reject(new Error('Signature management not yet implemented on server'));
  }

  deleteSignature(_id: string) {
    return Promise.reject(new Error('Signature management not yet implemented on server'));
  }

  // ─── 2FA (no dedicated route — stubs) ──────────────────────────────────────

  enable2FA() {
    return Promise.reject(new Error('2FA management not yet implemented on server'));
  }

  verify2FA(_code: string) {
    return Promise.reject(new Error('2FA management not yet implemented on server'));
  }

  disable2FA() {
    return Promise.reject(new Error('2FA management not yet implemented on server'));
  }
}

export const api = new ApiClient();
