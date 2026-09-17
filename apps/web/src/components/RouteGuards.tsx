import { ReactNode } from "react";
import { Navigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export type Role = "FARMER" | "RESEARCHER" | "EXPERT";

/** Authenticated-only. Redirects to /login, remembering where the user wanted to go. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <p className="text-sm text-gray-500">Checking session…</p>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Role gate for the AuthenticatedLayout: allowed roles may see the route. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <p className="text-sm text-gray-500">Checking session…</p>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!roles.includes(user.role)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}

export function AccessDenied() {
  return (
    <div className="max-w-md mx-auto rounded-lg bg-red-50 border border-red-200 p-6 text-center">
      <p className="text-3xl mb-2">🔒</p>
      <h2 className="font-semibold text-red-800">Not authorized</h2>
      <p className="text-sm text-red-700 mt-1">
        Your account role does not have permission to access this page.
      </p>
      <Link to="/dashboard" className="inline-block mt-4 text-sm font-medium text-red-700 underline">
        Go to Dashboard
      </Link>
    </div>
  );
}