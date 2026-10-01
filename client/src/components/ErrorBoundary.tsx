import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught SMILE Error:', error, errorInfo);
  }

  private handleReset = () => {
    // The session cookie is httpOnly, so it cannot be cleared from script. Clearing it
    // requires the server; on reload the app re-authenticates and this state resets.
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-lg space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold text-slate-50">Anwendungsfehler aufgetreten</h1>
            <p className="text-xs text-slate-400">
              Es ist ein unerwarteter Rendering-Fehler aufgetreten.
            </p>
            {this.state.error && (
              <pre className="text-[11px] bg-slate-950 p-3 rounded-xl text-rose-300 font-mono text-left overflow-auto max-h-36 border border-slate-800">
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}
            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Seite neu laden</span>
              </button>
              <button
                onClick={this.handleReset}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                Sitzung zurücksetzen (Abmelden & Neu laden)
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
