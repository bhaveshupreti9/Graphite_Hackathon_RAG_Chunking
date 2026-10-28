import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { DocGuard } from '@/components/DocGuard'
import { Layout } from '@/components/Layout'
import { RequireAuth } from '@/components/RequireAuth'

const LandingPage = lazy(() => import('@/pages/LandingPage'))
const UploadPage = lazy(() => import('@/pages/UploadPage'))
const ExplorerPage = lazy(() => import('@/pages/ExplorerPage'))
const SmartChatPage = lazy(() => import('@/pages/SmartChatPage'))
const TraditionalChatPage = lazy(() => import('@/pages/TraditionalChatPage'))
const CompareChunksPage = lazy(() => import('@/pages/CompareChunksPage'))
const CompareAnswersPage = lazy(() => import('@/pages/CompareAnswersPage'))
const VisualizerPage = lazy(() => import('@/pages/VisualizerPage'))
const SummaryPage = lazy(() => import('@/pages/SummaryPage'))
const EvaluationPage = lazy(() => import('@/pages/EvaluationPage'))
const KnowledgePage = lazy(() => import('@/pages/KnowledgePage'))
const HowItWorksPage = lazy(() => import('@/pages/HowItWorksPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const HistoryPage = lazy(() => import('@/pages/HistoryPage'))

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LandingPage />} />
          <Route
            path="upload"
            element={
              <RequireAuth>
                <UploadPage />
              </RequireAuth>
            }
          />
          <Route
            path="explorer"
            element={
              <RequireAuth>
                <DocGuard>
                  <ExplorerPage />
                </DocGuard>
              </RequireAuth>
            }
          />
          <Route
            path="chat/smart"
            element={
              <RequireAuth>
                <DocGuard>
                  <SmartChatPage />
                </DocGuard>
              </RequireAuth>
            }
          />
          <Route
            path="chat/traditional"
            element={
              <RequireAuth>
                <DocGuard>
                  <TraditionalChatPage />
                </DocGuard>
              </RequireAuth>
            }
          />
          <Route
            path="compare/chunks"
            element={
              <RequireAuth>
                <DocGuard>
                  <CompareChunksPage />
                </DocGuard>
              </RequireAuth>
            }
          />
          <Route
            path="visualize"
            element={
              <RequireAuth>
                <DocGuard>
                  <VisualizerPage />
                </DocGuard>
              </RequireAuth>
            }
          />
          <Route
            path="compare/answers"
            element={
              <RequireAuth>
                <DocGuard>
                  <CompareAnswersPage />
                </DocGuard>
              </RequireAuth>
            }
          />
          <Route
            path="summary"
            element={
              <RequireAuth>
                <DocGuard>
                  <SummaryPage />
                </DocGuard>
              </RequireAuth>
            }
          />
          <Route path="evaluation" element={<EvaluationPage />} />
          <Route
            path="knowledge"
            element={
              <RequireAuth>
                <KnowledgePage />
              </RequireAuth>
            }
          />
          <Route path="login" element={<LoginPage />} />
          <Route
            path="history"
            element={
              <RequireAuth>
                <HistoryPage />
              </RequireAuth>
            }
          />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
