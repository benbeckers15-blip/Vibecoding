// functions/src/deleteAccount.ts
// ─────────────────────────────────────────────────────────────────────────────
// Callable Cloud Function that fully deletes the calling user's account.
//
// Apple App Review guideline 5.1.1(v) requires:
//   • Account deletion offered IN-APP (not just a link to a website).
//   • Removes the account AND all associated personal data, not just deactivate.
//   • As easy to find as the sign-up entry point.
//
// Why a Cloud Function (instead of doing it from the client)?
//   • Deleting Firestore subcollections from the client requires N round-trips
//     and is interruptible — the user could end up half-deleted if the app
//     crashes or loses network mid-delete. The Admin SDK's `recursiveDelete`
//     is atomic-enough and runs server-side, surviving client churn.
//   • Deleting the Auth user itself requires recent reauth on the client OR
//     admin privileges on the server. We keep the client flow simple (no
//     credential token handling) by doing it all server-side once the caller
//     has proved their identity via `request.auth`.
//   • One audit trail (Cloud Functions logs) of every deletion, which is
//     useful when App Review or a user later asks "did you actually delete
//     my data?".
//
// Flow:
//   1. Client calls `deleteAccount` (auth context is automatic).
//   2. Function reads `request.auth.uid`. If missing → reject.
//   3. Recursively delete `users/{uid}` (which removes the doc AND every
//      subcollection — savedWineries, savedArticles, lists, tastings, etc.).
//   4. Best-effort delete the user's Storage folder at `users/{uid}/`
//      (no-op if there are no files — kept here so it stays compliant if
//      we add avatars / photo uploads later).
//   5. Delete the Firebase Auth user. After this returns, the client's
//      onAuthStateChanged listener fires with null and the app routes to /auth.
//
// Failure handling: each step is wrapped so a missing-permissions or
// already-deleted error doesn't block the rest of the cleanup. The Auth
// delete is last — if anything earlier blows up we'd rather leave the data
// orphaned than leave a "logged-in user with no data" zombie.
// ─────────────────────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export const deleteAccount = onCall(
  {
    // Public-callable (any client can invoke it), but `request.auth` must be
    // populated — `onCall` rejects unauthenticated calls automatically when
    // we check `request.auth` below.
    //
    // App Check ENFORCEMENT should be turned on once the iOS app is
    // registered with App Attest in the Firebase console (same path the
    // concierge function will take). Until then we leave it off so dev
    // builds can still call this. Flip the flag below to `true` before
    // submitting to the App Store.
    enforceAppCheck: false,
    // Region must match the client (see firebaseConfig.js → getFunctions).
    region: "us-central1",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      // Callable's standard error code — surfaces on the client as
      // FirebaseError with code "functions/unauthenticated".
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to delete your account."
      );
    }

    logger.info("deleteAccount: starting", { uid });

    // ─── 1. Wipe Firestore: users/{uid} doc + every subcollection ──────────
    // recursiveDelete handles deeply-nested subcollections atomically
    // (server-side). It's the single most important call here — the
    // Firestore profile and its savedWineries / savedArticles / lists /
    // tastings subcollections all live under users/{uid}.
    try {
      const userRef = getFirestore().doc(`users/${uid}`);
      await getFirestore().recursiveDelete(userRef);
      logger.info("deleteAccount: Firestore wipe complete", { uid });
    } catch (err) {
      // Log but don't bail — we still want to nuke Auth + Storage so the
      // user is fully signed out and any photos are gone, even if a
      // single Firestore subcollection misbehaved.
      logger.error("deleteAccount: Firestore wipe failed", { uid, err });
    }

    // ─── 2. Best-effort Storage cleanup ────────────────────────────────────
    // Today the app doesn't upload anything to Storage, but the bucket is
    // initialised in firebaseConfig.js and the storage rules likely allow
    // `users/{uid}/` writes. This block keeps the function future-proof:
    // if avatars or tasting photos ship later, no extra work is needed for
    // Apple compliance.
    try {
      const bucket = getStorage().bucket();
      await bucket.deleteFiles({ prefix: `users/${uid}/` });
      logger.info("deleteAccount: Storage cleanup complete", { uid });
    } catch (err) {
      logger.warn("deleteAccount: Storage cleanup skipped", { uid, err });
    }

    // ─── 3. Delete the Firebase Auth user ──────────────────────────────────
    // After this returns, the client's onAuthStateChanged listener fires
    // with `null` and AuthContext flips user → null. Any cached ID token
    // on the device is immediately invalid; subsequent Firestore reads
    // are denied by the security rules.
    try {
      await getAuth().deleteUser(uid);
      logger.info("deleteAccount: Auth user deleted", { uid });
    } catch (err) {
      logger.error("deleteAccount: Auth deletion failed", { uid, err });
      // This is the one failure we DO surface to the client — if the auth
      // user is still around, the user will look "signed in" after the
      // function returns, which is confusing. Better to throw so they
      // retry.
      throw new HttpsError(
        "internal",
        "Failed to delete account. Please try again or contact support."
      );
    }

    return { ok: true };
  }
);
