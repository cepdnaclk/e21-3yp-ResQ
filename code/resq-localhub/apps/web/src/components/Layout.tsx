import { Link } from 'react-router-dom';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', fontFamily: 'sans-serif', background: '#f7f7f7' }}>
      <nav style={{ background: '#222', color: '#fff', padding: '1rem' }}>
        <Link to="/" style={{ color: '#fff', marginRight: 16 }}>Instructor Dashboard</Link>
        <Link to="/pairing" style={{ color: '#fff', marginRight: 16 }}>Pairing</Link>
        <Link to="/sessions" style={{ color: '#fff', marginRight: 16 }}>Sessions</Link>
        <Link to="/trainee/live" style={{ color: '#fff', marginRight: 16 }}>Trainee Live</Link>
        <Link to="/trainee/history" style={{ color: '#fff', marginRight: 16 }}>Trainee History</Link>
        <Link to="/login" style={{ color: '#fff', marginRight: 16 }}>Login</Link>
      </nav>
      <main style={{ maxWidth: 900, margin: '2rem auto', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #ddd', padding: '2rem' }}>
        {children}
      </main>
    </div>
  );
}