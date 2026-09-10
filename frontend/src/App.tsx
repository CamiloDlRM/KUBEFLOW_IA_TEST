import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AddRepository from './pages/AddRepository';
import Datasets from './pages/Datasets';
import PipelineDetail from './pages/PipelineDetail';
import Models from './pages/Models';
import Admin from './pages/Admin';
import Settings from './pages/Settings';
import ConfirmChange from './pages/ConfirmChange';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (isAuthenticated) return children;
  // Visitors landing on the root see the marketing page; any other
  // protected route redirects straight to the login form.
  return location.pathname === '/' ? <Landing /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/confirm-change" element={<ConfirmChange />} />

      {/* Protected routes */}
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/repos/new" element={<AddRepository />} />
        <Route path="/repos/:repoId/datasets" element={<Datasets />} />
        <Route path="/pipelines/:id" element={<PipelineDetail />} />
        <Route path="/models" element={<Models />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
