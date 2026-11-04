import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './lib/auth';
import { ApiError } from './lib/api';
import { AdmissionsPage } from './pages/AdmissionsPage';
import { AttendancePage } from './pages/AttendancePage';
import { DashboardPage } from './pages/DashboardPage';
import { FeesPage } from './pages/FeesPage';
import { HomeworkPage } from './pages/HomeworkPage';
import { HostelPage } from './pages/HostelPage';
import { HrPage } from './pages/HrPage';
import { InventoryPage } from './pages/InventoryPage';
import { LibraryPage } from './pages/LibraryPage';
import { LoginPage } from './pages/LoginPage';
import { MessagesPage } from './pages/MessagesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NoticesPage } from './pages/NoticesPage';
import { PayrollPage } from './pages/PayrollPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StudentDetailPage } from './pages/StudentDetailPage';
import { StudentsPage } from './pages/StudentsPage';
import { TransportPage } from './pages/TransportPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="students" element={<StudentsPage />} />
                <Route path="students/:id" element={<StudentDetailPage />} />
                <Route path="admissions" element={<AdmissionsPage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="fees" element={<FeesPage />} />
                <Route path="hr" element={<HrPage />} />
                <Route path="payroll" element={<PayrollPage />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="transport" element={<TransportPage />} />
                <Route path="hostel" element={<HostelPage />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route path="homework" element={<HomeworkPage />} />
                <Route path="messages" element={<MessagesPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="notices" element={<NoticesPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
