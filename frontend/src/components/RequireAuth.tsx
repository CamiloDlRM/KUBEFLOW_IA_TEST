import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../auth';

/** Route guard: redirects to /login when no session token is stored. */
export default function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}
