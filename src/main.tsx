import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css' // Opcional: Se você tiver um arquivo de CSS global
import { useAppStore } from './hooks/useAppStore'
import { diagnoseImportLogAlertsDebug } from './utils/importLogHealth'

declare global {
  interface Window {
    __finEloDebug?: {
      /** Estado completo Zustand (transações, importLogs, contas…) */
      getAppState: () => ReturnType<typeof useAppStore.getState>
      diagnoseImportLog: (partialFileName: string) => ReturnType<typeof diagnoseImportLogAlertsDebug> | void
    }
  }
}

if (import.meta.env.DEV) {
  window.__finEloDebug = {
    getAppState: () => useAppStore.getState(),
    diagnoseImportLog(partialFileName: string) {
      const state = useAppStore.getState()
      const log = state.importLogs.find((l) => l.file_name.includes(partialFileName.trim()))
      if (!log) {
        console.warn('[finElo] Nenhum import_log com file_name que contenha:', partialFileName)
        console.log(
          'Dica: liste nomes com getAppState().importLogs.map((l) => l.file_name)'
        )
        return
      }
      const ctx = { accounts: state.accounts, transactions: state.transactions }
      const diag = diagnoseImportLogAlertsDebug(log, ctx)
      console.log('[finElo] diagnoseImportLog', diag)
      return diag
    },
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)