import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import AnalysisPage from './pages/AnalysisPage'
import RecordingPage from './pages/RecordingPage'
import SessionDetailPage from './pages/SessionDetailPage'
import SessionsPage from './pages/SessionsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
    return (
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
                <Route path="/" element={<AppLayout />}>
                    <Route index element={<Navigate to="/sessions" replace />} />
                    <Route path="sessions" element={<SessionsPage />} />
                    <Route path="sessions/:id" element={<SessionDetailPage />} />
                    <Route path="analysis" element={<AnalysisPage />} />
                    <Route path="recording" element={<RecordingPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </HashRouter>
    )
}
