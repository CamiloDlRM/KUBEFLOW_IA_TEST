import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AddRepository from './pages/AddRepository';
import PipelineDetail from './pages/PipelineDetail';
import Models from './pages/Models';

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />

      {/* Authenticated app */}
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/repos/new" element={<AddRepository />} />
        <Route path="/pipelines/:id" element={<PipelineDetail />} />
        <Route path="/models" element={<Models />} />
      </Route>
    </Routes>
  );
}
