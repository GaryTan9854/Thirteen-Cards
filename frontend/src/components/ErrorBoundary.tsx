import React from 'react'

interface State { error: Error | null }

/**
 * Catches unhandled React render errors — shows a friendly reload screen
 * instead of the blank white page Ian was seeing.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ThirteenCards ErrorBoundary]', error.message, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="text-5xl">⚠️</div>
          <div className="text-xl text-gray-200 font-semibold">系統發生錯誤</div>
          <div className="text-gray-400 text-sm max-w-sm">
            畫面發生例外情況，請重新整理頁面。若問題持續，請聯繫 Gary。
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-orange-500 hover:bg-orange-400 text-white font-bold
                       rounded-xl text-lg active:scale-95 transition">
            🔄 重新整理
          </button>
          <details className="text-xs text-gray-600 max-w-sm text-left">
            <summary className="cursor-pointer text-gray-500">錯誤詳情</summary>
            <pre className="mt-2 overflow-auto bg-black/40 rounded p-3 text-gray-400 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}
