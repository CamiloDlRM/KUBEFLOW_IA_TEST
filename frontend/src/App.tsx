import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import AddRepository from './pages/AddRepository';
import PipelineDetail from './pages/PipelineDetail';
import Models from './pages/Models';
import ModelDetail from './pages/ModelDetail';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ForgotPasswordSent from './pages/ForgotPasswordSent';
import ResetPassword from './pages/ResetPassword';
import ResetPasswordSuccess from './pages/ResetPasswordSuccess';
import Docs from './pages/Docs';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/forgot-password/sent" element={<ForgotPasswordSent />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/reset-password/success" element={<ResetPasswordSuccess />} />
      <Route path="/docs" element={<Docs />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/repos/new" element={<AddRepository />} />
        <Route path="/pipelines/:id" element={<PipelineDetail />} />
        <Route path="/models" element={<Models />} />
        <Route path="/models/:name" element={<ModelDetail />} />
      </Route>
    </Routes>
  );
}
