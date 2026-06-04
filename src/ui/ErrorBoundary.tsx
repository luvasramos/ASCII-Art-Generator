import React from "react";

interface ErrorBoundaryState {
  error: Error | null;
  stack: string | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    stack: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      stack: error.stack ?? null
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({
      error,
      stack: error.stack || info.componentStack || null
    });
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="grid min-h-screen place-items-center bg-ink p-6 text-zinc-100">
        <section className="w-full max-w-3xl rounded border border-red-500/40 bg-panel p-5 shadow-studio">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-red-300">Render crashed</div>
          <h1 className="mt-3 text-2xl font-semibold">The studio hit a runtime error.</h1>
          <p className="mt-2 text-sm text-zinc-400">
            The app shell is still alive. Reload after fixing the error below, or reset stored site data if the
            message mentions a saved preset or font.
          </p>
          <pre className="mt-4 max-h-80 overflow-auto rounded border border-line bg-ink p-4 text-xs leading-relaxed text-red-100">
            {this.state.stack || this.state.error.message}
          </pre>
        </section>
      </main>
    );
  }
}
