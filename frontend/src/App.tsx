import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import AddRepository from './pages/AddRepository';
import PipelineDetail from './pages/PipelineDetail';
import Models from './pages/Models';
import Landing from './pages/Landing';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/repos/new" element={<AddRepository />} />
        <Route path="/pipelines/:id" element={<PipelineDetail />} />
        <Route path="/models" element={<Models />} />
      </Route>
    </Routes>
  );
}
