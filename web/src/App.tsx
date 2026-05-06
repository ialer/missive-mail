import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import MailList from './components/MailList';
import ConversationView from './components/ConversationView';
import ComposeMail from './components/ComposeMail';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <AuthGuard>
            <Layout>
              <Routes>
                <Route path="/" element={<MailList folder="inbox" />} />
                <Route path="/sent" element={<MailList folder="sent" />} />
                <Route path="/drafts" element={<MailList folder="drafts" />} />
                <Route path="/archive" element={<MailList folder="archive" />} />
                <Route path="/trash" element={<MailList folder="trash" />} />
                <Route path="/label/:labelId" element={<MailList folder="label" />} />
                <Route path="/mail/:id" element={<ConversationView />} />
                <Route path="/compose" element={<ComposeMail />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </AuthGuard>
        }
      />
    </Routes>
  );
}
