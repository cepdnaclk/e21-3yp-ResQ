import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { DashboardPage } from './pages/instructor/DashboardPage';
import { PairingPage } from './pages/instructor/PairingPage';
import { SessionsPage } from './pages/instructor/SessionsPage';
import { LivePage } from './pages/trainee/LivePage';
import { HistoryPage } from './pages/trainee/HistoryPage';
import { LoginPage } from './pages/shared/LoginPage';
import { NotFoundPage } from './pages/shared/NotFoundPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/pairing" element={<PairingPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/trainee/live" element={<LivePage />} />
        <Route path="/trainee/history" element={<HistoryPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}