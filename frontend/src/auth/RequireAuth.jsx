import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Оборачивает защищённые роуты. Пока сессия проверяется — не решаем ничего
// (иначе будет ложный редирект на /login при обновлении страницы, пока
// getSession() ещё не отработал).
export default function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">Загрузка…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
