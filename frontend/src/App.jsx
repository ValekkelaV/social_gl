import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import LoginPage from "./auth/LoginPage";
import NavShell from "./layout/NavShell";
import TicketsPage from "./pages/TicketsPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import CreateTicketPage from "./pages/CreateTicketPage";
import ContentPlanPage from "./pages/ContentPlanPage";
import ApplicationsPage from "./pages/ApplicationsPage";
import SchedulingPage from "./pages/SchedulingPage";
import DocumentsPage from "./pages/DocumentsPage";
import CommitteesPage from "./pages/CommitteesPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <RequireAuth>
                <NavShell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/tickets" replace />} />
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/tickets/new" element={<CreateTicketPage />} />
            <Route path="/tickets/:id" element={<TicketDetailPage />} />
            <Route path="/content-plan" element={<ContentPlanPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/scheduling" element={<SchedulingPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/committees" element={<CommitteesPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
