// utils/errorReporting.ts
// ─────────────────────────────────────────────────────────────────────────────
// Central error-reporting entry point. Every error boundary, network failure,
// concierge error, and Firestore failure goes through reportError() so we have
// ONE place to wire telemetry in or out.
//
// Today this is intentionally minimal — it logs to console in dev, no-ops in
// production. The shape is Crashlytics-ready: when you're ready to switch to
// real telemetry, swap the body of `reportError` for a `crashlytics().recordError(err)`
// call and every existing call site lights up. See docs/setup-crashlytics.md.
//
// Design notes:
//   • Always swallows internal failures. Reporting an error must never throw —
//     that would cascade into the error boundary that called us.
//   • `context` is structured metadata (screen name, user action, regionId).
//     Crashlytics surfaces this as custom keys; the dev console formats it
//     readably. Keep keys snake_case for Crashlytics compatibility.
//   • `severity` lets us distinguish a recoverable network blip from an
//     uncaught render error. Both get logged; severity drives how loud the
//     telemetry channel surfaces it (Crashlytics dashboards filter by it).
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorSeverity = "info" | "warning" | "error" | "fatal";

export interface ErrorContext {
  /** Where the error happened — screen name, function name, etc. */
  source?: string;
  /** What the user was trying to do. Free text. */
  action?: string;
  /** Active region at the time of error, if known. */
  region_id?: string;
  /** Anything else useful. Keys must be snake_case. */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Log an error to telemetry. Safe to call from anywhere — never throws.
 *
 * Usage:
 *   try { … }
 *   catch (err) {
 *     reportError(err, { source: "wineries/index", action: "loadCorpus" });
 *     // …show user-facing error UI…
 *   }
 *
 * The same call site will start sending to Crashlytics once you wire it up
 * (see docs/setup-crashlytics.md) without any changes here.
 */
export function reportError(
  err: unknown,
  context: ErrorContext = {},
  severity: ErrorSeverity = "error"
): void {
  try {
    const error = normaliseError(err);
    const tag = severityTag(severity);

    if (__DEV__) {
      // Dev: rich console output. Stack first, then a labeled metadata table.
      // eslint-disable-next-line no-console
      console.warn(
        `${tag} [${context.source ?? "unknown"}] ${error.message}`,
        {
          stack: error.stack,
          ...context,
        }
      );
    } else {
      // Production: minimal output so we don't flood the device log with
      // PII. When Crashlytics is wired in, the dashboard becomes the
      // primary signal source and this branch becomes a no-op or a
      // one-line breadcrumb.
      // eslint-disable-next-line no-console
      console.warn(`${tag} ${error.message}`);
    }

    // ── Crashlytics hook (placeholder — wire up when ready) ────────────
    // When you're ready to enable real telemetry:
    //   1. npx expo install @react-native-firebase/app @react-native-firebase/crashlytics
    //   2. Add config plugins to app.config.js (see docs/setup-crashlytics.md)
    //   3. Uncomment the import + lines below.
    //
    // import crashlytics from "@react-native-firebase/crashlytics";
    // for (const [k, v] of Object.entries(context)) {
    //   if (v !== undefined) crashlytics().setAttribute(k, String(v));
    // }
    // crashlytics().recordError(error, severity === "fatal" ? "fatal" : undefined);
  } catch {
    // Reporting itself failed. Nothing safe to do — swallow.
  }
}

/**
 * Convenience: log a non-fatal informational event. Same plumbing as
 * reportError but with severity=info. Useful for "the user denied location
 * permission" — not a bug, but worth knowing the rate of.
 */
export function reportEvent(
  message: string,
  context: ErrorContext = {}
): void {
  reportError(new Error(message), context, "info");
}

// ─── Internals ───────────────────────────────────────────────────────────────

function normaliseError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error("Unknown error (unserialisable)");
  }
}

function severityTag(s: ErrorSeverity): string {
  switch (s) {
    case "info":    return "[info]";
    case "warning": return "[warn]";
    case "fatal":   return "[FATAL]";
    case "error":
    default:        return "[error]";
  }
}
