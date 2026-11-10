import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AddRepository from './pages/AddRepository';
import Datasets from './pages/Datasets';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import DataFactory from './pages/DataFactory';
import PipelineDetail from './pages/PipelineDetail';
import Pipelines from './pages/Pipelines';
import PipelineCanva from './pages/PipelineCanva';
import Models from './pages/Models';
import Admin from './pages/Admin';
import Account from './pages/Account';
import ConfirmChange from './pages/ConfirmChange';
import GithubCallback from './pages/GithubCallback';
import SetPassword from './pages/SetPassword';
import Docs from './pages/Docs';
import NotFound from './pages/NotFound';
import NotebookEditor from './pages/NotebookEditor';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (isAuthenticated) return children;
  // Visitors landing on the root see the marketing page; any other
  // protected route redirects straight to the login form.
  return location.pathname === '/' ? <Landing /> : <Navigate to="/login" replace />;
}

/** The old per-project pipeline page now lives on the canvas; `?run=` carries over. */
function ProjectPipelineRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const { search } = useLocation();
  return <Navigate to={`/pipelines/canvas/${projectId}${search}`} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/confirm-change" element={<ConfirmChange />} />
      <Route path="/auth/github" element={<GithubCallback />} />
      <Route path="/set-password" element={<RequireAuth><SetPassword /></RequireAuth>} />
      <Route path="/docs" element={<Docs />} />
      {/* Opens in its own tab, full screen: outside the app's Layout. */}
      <Route path="/repos/:repoId/notebook" element={<RequireAuth><NotebookEditor /></RequireAuth>} />

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
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/projects/:projectId/data" element={<DataFactory />} />
        {/* The old pipeline page; kept as a redirect for bookmarks and links. */}
        <Route path="/projects/:projectId/pipeline" element={<ProjectPipelineRedirect />} />
        {/* The builds gold has produced, with the one the pipeline uses. Its
            own route rather than a seventh stage: it is a record of outputs,
            not a step in making them. */}
        <Route path="/projects/:projectId/datasets" element={<Datasets />} />
        <Route path="/pipelines" element={<Pipelines />} />
        <Route path="/pipelines/canvas/:projectId?" element={<PipelineCanva />} />
        <Route path="/pipelines/:id" element={<PipelineDetail />} />
        <Route path="/models" element={<Models />} />
        {/* The Grafana panels are a section of the dashboard now. Kept as a
            redirect because the old path is in people's bookmarks. */}
        <Route path="/dashboards" element={<Navigate to="/" replace />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/account" element={<Account />} />
        {/* The page was called Settings; kept as a redirect for bookmarks. */}
        <Route path="/settings" element={<Navigate to="/account" replace />} />
        {/* Last: any address the app does not know. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
