// components/RootErrorBoundary.tsx
// ─────────────────────────────────────────────────────────────────────────────
// App-wide React error boundary. Wraps the entire app tree in _layout.tsx,
// catches any uncaught render error, and shows the full-screen ErrorScreen
// instead of the bare white-screen-of-death React falls back to on crash.
//
// Why this is critical for App Store submission:
//   Apple rejects apps that render a blank white screen on error, that crash
//   to springboard, or that have no way for the user to recover. An error
//   boundary is the only sanctioned React pattern for catching render
//   exceptions — try/catch in components doesn't catch them.
//
// The error boundary's onReset callback re-mounts the children by changing
// the boundary's `key`. We rely on Expo Router's stable tree to mean a
// re-mount usually puts the user back where they were; if not, they can
// navigate from the home tab.
//
// Errors are reported via utils/errorReporting.ts so they show up in dev
// console and (once wired) Crashlytics.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { ErrorScreen } from "./ErrorScreen";
import { reportError } from "../utils/errorReporting";

interface Props {
  children: React.ReactNode;
}

interface State {
  /** Bumped when the user taps "Try Again" — used to re-mount children. */
  resetKey: number;
  /** Latest caught error, or null when we're rendering children normally. */
  error: Error | null;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { resetKey: 0, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Fatal severity — by definition we hit the top-level boundary, so
    // nothing below us was able to recover.
    reportError(
      error,
      {
        source: "RootErrorBoundary",
        component_stack: info.componentStack ?? undefined,
      },
      "fatal"
    );
  }

  handleRetry = (): void => {
    // Bump the key to force the children to re-mount, then clear the error.
    // Re-mounting is the only safe recovery — the previous tree's state may
    // be corrupted in ways we can't introspect.
    this.setState((prev) => ({ resetKey: prev.resetKey + 1, error: null }));
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorScreen
          kicker="SOMETHING WENT WRONG"
          title="The app hit a snag."
          message={
            // Show the actual error message in dev for debuggability.
            // In production keep it generic so we don't expose stack
            // traces or internals to end users.
            __DEV__
              ? `${this.state.error.message}\n\nTap below to reload the screen. If this keeps happening, restart the app.`
              : "We couldn't finish loading this part of the app. Tap below to try again. If this keeps happening, restart the app."
          }
          onRetry={this.handleRetry}
          retryLabel="Reload"
        />
      );
    }
    // `key` forces remount of the whole subtree after a retry.
    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
