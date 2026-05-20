// components/ScreenErrorBoundary.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Per-screen React error boundary. Wraps each tab / route so one broken
// screen doesn't bring down the whole app — the user can still navigate
// to other tabs while the broken one shows an inline error.
//
// Compared to RootErrorBoundary:
//   • This is a SCREEN-level fallback, not full-screen. Renders ErrorScreen
//     in the bounded area, which fills the tab content while the tab bar
//     stays visible.
//   • Severity is "error" not "fatal" — by definition the rest of the app
//     is still running, the user can still navigate.
//   • Each boundary carries a `screen` label so reports identify which
//     screen failed.
//
// Pattern:
//   <ScreenErrorBoundary screen="wineries/index">
//     <WineriesScreen />
//   </ScreenErrorBoundary>
//
// Wrap the export at the bottom of each screen file:
//   export default withScreenErrorBoundary(WineriesScreen, "wineries/index");
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { ErrorScreen } from "./ErrorScreen";
import { reportError } from "../utils/errorReporting";

interface Props {
  children: React.ReactNode;
  /** Identifier used in error reports. Format: "tab/route" e.g. "wineries/index". */
  screen: string;
}

interface State {
  resetKey: number;
  error: Error | null;
}

export class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { resetKey: 0, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportError(
      error,
      {
        source: `ScreenErrorBoundary:${this.props.screen}`,
        component_stack: info.componentStack ?? undefined,
      },
      "error"
    );
  }

  handleRetry = (): void => {
    this.setState((prev) => ({ resetKey: prev.resetKey + 1, error: null }));
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorScreen
          kicker="THIS SCREEN HIT A SNAG"
          title="We couldn't load this page."
          message={
            __DEV__
              ? `${this.state.error.message}\n\nThe rest of the app is fine — switch tabs and come back, or tap below to retry.`
              : "Switch tabs and come back, or tap below to try again. The rest of the app should be working normally."
          }
          onRetry={this.handleRetry}
        />
      );
    }
    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

/**
 * HOC convenience — wrap a screen's default export so the screen's own
 * render errors land in this boundary.
 *
 * Usage at the bottom of a screen file:
 *   export default withScreenErrorBoundary(MyScreen, "tab/route");
 */
export function withScreenErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  screen: string
): React.ComponentType<P> {
  const Wrapped: React.FC<P> = (props) => (
    <ScreenErrorBoundary screen={screen}>
      <Component {...props} />
    </ScreenErrorBoundary>
  );
  Wrapped.displayName = `WithScreenErrorBoundary(${Component.displayName ?? Component.name ?? "Component"})`;
  return Wrapped;
}
