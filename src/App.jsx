import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ClinicProvider } from '@/lib/ClinicContext';
import { resolveRuntimeClinicId } from '@/lib/runtimeClinicScope';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import Dashboard from "./pages/Dashboard";
import DailyReview from "./pages/DailyReview";
import StaffPad from "./pages/StaffPad";
import StaffManagement from "./pages/StaffManagement";
import StaffOnboarding from "./pages/StaffOnboarding";
import AnalyticsDashboard from "./pages/AnalyticsDashboard";
import ClinicSettings from "./pages/ClinicSettings";
import PerformanceReport from "./pages/PerformanceReport";

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/daily-review" element={<DailyReview />} />
      <Route path="/staff-pad" element={<StaffPad />} />
      <Route path="/staff-mgmt" element={<StaffManagement />} />
      <Route path="/staff-onboarding" element={<StaffOnboarding />} />
      <Route path="/analytics-dashboard" element={<AnalyticsDashboard />} />
      <Route path="/clinic-settings" element={<ClinicSettings />} />
      <Route path="/performance-report" element={<PerformanceReport />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  const clinicId = resolveRuntimeClinicId();

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <ClinicProvider clinicId={clinicId}>
          <Router>
            <ScrollToTop />
            <AuthenticatedApp />
          </Router>
        </ClinicProvider>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
