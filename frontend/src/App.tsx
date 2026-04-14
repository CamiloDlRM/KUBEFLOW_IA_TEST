import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AddRepository from './pages/AddRepository';
import PipelineDetail from './pages/PipelineDetail';
import Models from './pages/Models';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/repos/new" element={<AddRepository />} />
        <Route path="/pipelines/:id" element={<PipelineDetail />} />
        <Route path="/models" element={<Models />} />
      </Route>
    </Routes>
  );
}
