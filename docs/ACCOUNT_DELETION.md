# Account Deletion — Apple App Store Compliance

SipLocal supports in-app account deletion as required by **App Store Review
Guideline 5.1.1(v)**. This doc explains how the flow is wired up, how to
ship the change, and what to tell App Review.

## What guideline 5.1.1(v) requires

> Apps that support account creation must also offer account deletion within
> the app. Apps may provide additional customer service via web browser or
> other communication methods to help users with account deletion, but must
> not solely rely on those methods. The account deletion option must be
> easy to find within the app. Deleting an account must fully delete the
> account from the developer's systems — temporarily deactivating or
> disabling the account is not sufficient.

Concretely this means:

1. The user can reach the deletion flow without leaving the app.
2. The affordance is "easy to find" (top-level surface, not buried 4 menus deep).
3. After deletion the account and **all** associated personal data is gone
   from Firebase Auth and Firestore — not soft-deleted, not deactivated.
4. The user gets a confirmation step so accidental taps don't nuke their
   account.

## How SipLocal satisfies it

### Entry point — Profile tab → "Delete account"

`app/(tabs)/profile/index.tsx` renders an **Account** section at the bottom
of every profile tab containing two rows: **Sign out** and **Delete
account**. The Delete account row is destructive-styled (red icon + label)
and visible on the same screen the user goes to manage anything else about
their account.

### Confirmation screen — `app/(tabs)/profile/delete-account.tsx`

Tapping "Delete account" pushes a dedicated screen that:

- Lists exactly what will be deleted (profile, saved cellar doors, trips,
  tasting notes, palate breakdown, sign-in account).
- Warns that deletion is irreversible.
- Asks the user to re-enter their password.
- Shows a final `Alert.alert` "are you sure?" before the destructive call.

The re-auth step both prevents accidental deletion and satisfies the
Firebase Auth recent-login requirement that some auth providers enforce.

### Client wrapper — `lib/deleteAccount.ts`

Re-authenticates the user with `EmailAuthProvider.credential` +
`reauthenticateWithCredential`, then calls the `deleteAccount` callable
Cloud Function. Surfaces friendly error messages for wrong password,
network failures, expired sessions, etc.

### Server — `functions/src/deleteAccount.ts`

A `firebase-functions/v2/https` `onCall` function that:

1. Reads `request.auth.uid` (rejected if missing).
2. Calls `getFirestore().recursiveDelete(users/{uid})` — this wipes the
   profile doc plus every subcollection (`savedWineries`, `savedArticles`,
   `lists`, `tastings`).
3. Best-effort deletes `gs://<bucket>/users/{uid}/` from Storage. No-op
   today (the app doesn't upload anything yet); future-proofed for when
   avatars or tasting photos ship.
4. Calls `getAuth().deleteUser(uid)` — after this returns, the client's
   `onAuthStateChanged` listener fires with `null` and `AuthContext`
   flips `user → null`.

Logged to Cloud Functions for an audit trail.

## Files in this change

| File                                          | Purpose                                        |
|-----------------------------------------------|------------------------------------------------|
| `firebaseConfig.js`                           | Export `functions` (callable Functions client) |
| `functions/src/deleteAccount.ts`              | Cloud Function — full server-side cleanup      |
| `functions/src/index.ts`                      | Export the new function                        |
| `lib/deleteAccount.ts`                        | Client wrapper: re-auth + call function        |
| `app/(tabs)/profile/delete-account.tsx`       | Dedicated deletion screen                      |
| `app/(tabs)/profile/_layout.tsx`              | Register the new screen in the stack           |
| `app/(tabs)/profile/index.tsx`                | Account section with sign-out + delete entry   |

## Deploy steps

### 1. Deploy the Cloud Function

```bash
cd functions
npm run build       # tsc
firebase deploy --only functions:deleteAccount
```

(or `firebase deploy --only functions` to deploy everything.)

Verify in the Firebase console under Functions that `deleteAccount` is
listed and the region is `us-central1` (matches `firebaseConfig.js`).

### 2. Confirm the Firestore security rules

The Cloud Function runs as the Admin SDK so it bypasses rules, but make
sure no other rules block the function from accessing the user's data.
The default `users/{uid}` rules don't need to change.

### 3. Enable App Check before submitting to the App Store

In `functions/src/deleteAccount.ts` the option `enforceAppCheck: false` is
currently set so development builds can call the function. Once the iOS
app is registered for App Attest in the Firebase console:

```ts
enforceAppCheck: true,
```

Redeploy. This blocks anyone from invoking `deleteAccount` from a tool
like curl with a stolen ID token.

### 4. Update the support email

`app/(tabs)/profile/delete-account.tsx` currently shows
`support@siplocal.app` in the footnote. Swap in your real support
address.

### 5. Smoke test on a TestFlight build

Create a throwaway account, populate it with saved wineries / a trip /
a tasting note, then walk through:

- Profile → scroll to Account → Delete account
- Read the screen → enter password → tap Delete → confirm
- Verify you land on `/auth` and can't sign back in with that email
- In the Firebase console verify the Auth user is gone and
  `users/{uid}` (with all subcollections) is gone.

## What to tell App Review

In **App Store Connect → App Privacy → Account Deletion**, point them to:

> Sign in → Profile tab → scroll to "Account" section → tap "Delete account"
> → re-enter password → confirm.

In the **Review Notes** for the submission, include:

> The app supports in-app account deletion per guideline 5.1.1(v). To test:
>
> 1. Sign in with the provided test account.
> 2. Tap the **Profile** tab.
> 3. Scroll to the **Account** section at the bottom.
> 4. Tap **Delete account**.
> 5. Re-enter the password to confirm.
>
> This permanently deletes the Firebase Auth user, the Firestore user
> document, and every subcollection (saved cellar doors, saved articles,
> trips/lists, tasting notes). The deletion is processed by a Firebase
> Cloud Function (`deleteAccount`) using the Firebase Admin SDK's
> `recursiveDelete` and `auth().deleteUser` APIs.

Provide a **test account** in the review credentials field so the reviewer
doesn't have to create one. Make sure that account has some saved data so
the reviewer can verify everything is wiped.
