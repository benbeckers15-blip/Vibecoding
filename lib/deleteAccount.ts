// lib/deleteAccount.ts
// ─────────────────────────────────────────────────────────────────────────────
// Client-side wrapper for the `deleteAccount` callable Cloud Function.
//
// Why the re-auth?
//   Even though the actual `deleteUser()` call happens server-side (with the
//   Admin SDK, which doesn't need recent reauth), Apple's App Review team
//   specifically looks for an "are you sure?" gate that proves the person
//   initiating the deletion is the account holder — not someone who picked
//   up an unlocked phone. Re-prompting for the password (or whatever the
//   user signed in with) is the simplest way to satisfy that.
//
//   It also defends against the user accidentally tapping "Delete account"
//   from a settings screen and losing everything in a single tap.
//
// Failure modes we surface (with friendly messages):
//   • Wrong password (auth/invalid-credential, auth/wrong-password)
//   • Network failure (auth/network-request-failed)
//   • Too many recent attempts (auth/too-many-requests)
//   • Cloud Function rejected the call (functions/*)
//
// On success the Auth user is gone — onAuthStateChanged in AuthContext fires
// with `null`, AuthContext flips user → null, and the caller routes to /auth.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../firebaseConfig";

/** Human-readable error returned to the UI layer. */
export class DeleteAccountError extends Error {
  constructor(public friendly: string, public code?: string) {
    super(friendly);
    this.name = "DeleteAccountError";
  }
}

function friendlyFromCode(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "That password doesn't match. Please try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    case "auth/user-mismatch":
    case "auth/user-not-found":
      return "Your session has expired. Please sign in again before deleting your account.";
    case "functions/unauthenticated":
      return "Your session has expired. Please sign in again before deleting your account.";
    case "functions/internal":
      return "Something went wrong deleting your account. Please try again or contact support.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Re-authenticate the current user with their password, then call the
 * `deleteAccount` Cloud Function which wipes Firestore + Auth.
 *
 * Throws DeleteAccountError on any failure; on success the auth user is gone
 * and AuthContext will flip to null shortly after.
 */
export async function deleteAccountWithPassword(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new DeleteAccountError(
      "Your session has expired. Please sign in again before deleting your account.",
      "auth/user-not-found"
    );
  }

  // ── 1. Re-authenticate ──────────────────────────────────────────────────
  // Firebase requires this for any destructive account action (delete,
  // change email, change password). We require it here even though the
  // server-side Admin SDK doesn't strictly need a fresh credential, so the
  // user has to actively prove identity before deletion proceeds.
  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    throw new DeleteAccountError(friendlyFromCode(code), code);
  }

  // ── 2. Call the Cloud Function ──────────────────────────────────────────
  // The function reads request.auth.uid (set automatically by httpsCallable),
  // wipes the users/{uid} tree, then deletes the Auth user. After this
  // returns, onAuthStateChanged fires with null.
  try {
    const fn = httpsCallable<void, { ok: true }>(functions, "deleteAccount");
    await fn();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    throw new DeleteAccountError(friendlyFromCode(code), code);
  }
}
