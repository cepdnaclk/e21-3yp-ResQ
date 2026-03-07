import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import InstructorDashboard from './pages/InstructorDashboard';
import PairingPage from './pages/PairingPage';
import SessionsPage from './pages/SessionsPage';
import TraineeLivePage from './pages/TraineeLivePage';
import TraineeHistoryPage from './pages/TraineeHistoryPage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<InstructorDashboard />} />
        <Route path="/pairing" element={<PairingPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/trainee/live" element={<TraineeLivePage />} />
        <Route path="/trainee/history" element={<TraineeHistoryPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}import React from 'react';

export const App = () => <div>Web App (TODO)</div>;
