import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import type { ChatTurn, Method, ProcessResult, QAItem, Settings, UploadResponse } from '@/types/api'

const MAX_STORED_TURNS = 100

export type AppTheme = 'light' | 'dark'

export interface AuthState {
  username: string
  token: string
}

interface AppState {
  doc_id: string | null
  filename: string | null
  settings: Settings
  processResult: ProcessResult | null
  histories: Record<Method, ChatTurn[]>
  qaItems: QAItem[]
  demoMode: boolean
  /** Colour theme of every page except the landing page, which is always dark. */
  appTheme: AppTheme
  /** Logged-in user for the real backend (null when logged out). */
  auth: AuthState | null

  /** A new document was uploaded: remember it and clear everything that belonged to the old one. */
  setDocument: (upload: UploadResponse) => void
  /** Switch to an already processed document (Knowledge Base) and clear old chats and votes. */
  selectDocument: (docId: string, filename: string, result: ProcessResult | null) => void
  clearDocument: () => void
  setSettings: (settings: Settings) => void
  setProcessResult: (result: ProcessResult | null) => void
  appendTurns: (method: Method, turns: ChatTurn[]) => void
  clearHistory: (method?: Method) => void
  upsertQAItem: (item: QAItem) => void
  setQAWinner: (question: string, winner: QAItem['winner']) => void
  clearQAItems: () => void
  setDemoMode: (on: boolean) => void
  setAppTheme: (theme: AppTheme) => void
  /** Logging in as someone else (or out) clears the previous user's document, chats and votes. */
  setAuth: (auth: AuthState | null) => void
}

const emptyHistories = (): Record<Method, ChatTurn[]> => ({ smart: [], naive: [] })

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      doc_id: null,
      filename: null,
      settings: DEFAULT_SETTINGS,
      processResult: null,
      histories: emptyHistories(),
      qaItems: [],
      demoMode: false,
      appTheme: 'light',
      auth: null,

      setDocument: (upload) =>
        set({
          doc_id: upload.doc_id,
          filename: upload.filename,
          processResult: null,
          histories: emptyHistories(),
          qaItems: [],
        }),

      selectDocument: (docId, filename, result) =>
        set({
          doc_id: docId,
          filename,
          processResult: result,
          histories: emptyHistories(),
          qaItems: [],
        }),

      clearDocument: () =>
        set({
          doc_id: null,
          filename: null,
          processResult: null,
          histories: emptyHistories(),
          qaItems: [],
        }),

      setSettings: (settings) => set({ settings }),

      setProcessResult: (processResult) => set({ processResult }),

      appendTurns: (method, turns) =>
        set((state) => ({
          histories: {
            ...state.histories,
            [method]: [...state.histories[method], ...turns].slice(-MAX_STORED_TURNS),
          },
        })),

      clearHistory: (method) =>
        set((state) => ({
          histories: method ? { ...state.histories, [method]: [] } : emptyHistories(),
        })),

      upsertQAItem: (item) =>
        set((state) => {
          const exists = state.qaItems.some((existing) => existing.question === item.question)
          return {
            qaItems: exists
              ? state.qaItems.map((existing) =>
                  existing.question === item.question ? item : existing,
                )
              : [...state.qaItems, item],
          }
        }),

      setQAWinner: (question, winner) =>
        set((state) => ({
          qaItems: state.qaItems.map((item) =>
            item.question === question ? { ...item, winner } : item,
          ),
        })),

      clearQAItems: () => set({ qaItems: [] }),

      setDemoMode: (demoMode) => set({ demoMode }),

      setAppTheme: (appTheme) => set({ appTheme }),

      setAuth: (auth) =>
        set((state) =>
          auth !== null && state.auth?.username === auth.username
            ? { auth }
            : {
                auth,
                doc_id: null,
                filename: null,
                processResult: null,
                histories: emptyHistories(),
                qaItems: [],
              },
        ),
    }),
    {
      name: 'smartchunk-store',
      version: 2,
      // v2 lowered the default "Not found" cut-off from 0.25 to 0.15 so loosely related questions
      // still reach the model. Saved settings that still hold the old default are moved along.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<AppState>
        if (version < 2 && state.settings && state.settings.not_found_threshold === 0.25) {
          state.settings = { ...state.settings, not_found_threshold: 0.15 }
        }
        return state as AppState
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        doc_id: state.doc_id,
        filename: state.filename,
        settings: state.settings,
        processResult: state.processResult,
        histories: state.histories,
        qaItems: state.qaItems,
        demoMode: state.demoMode,
        appTheme: state.appTheme,
        auth: state.auth,
      }),
    },
  ),
)
