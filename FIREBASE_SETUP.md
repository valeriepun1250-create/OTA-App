# Firebase prototype setup

1. In Firebase Console, enable **Authentication > Sign-in method > Anonymous**.
2. Confirm Realtime Database is created at:
   `https://ota-app-cbdc2-default-rtdb.firebaseio.com`
3. Deploy the database rules:

   ```sh
   npx firebase-tools login
   npx firebase-tools use ota-app-cbdc2
   npx firebase-tools deploy --only database
   ```

4. In the GitHub repository settings, enable **Pages > GitHub Actions**.
5. Add the `NEXT_PUBLIC_FIREBASE_*` values from `.env.example` as repository variables.

The prototype uses anonymous Firebase users. The Realtime Database rules require
an authenticated user, but currently allow authenticated prototype users to read
and write all data. Replace these rules with role-based rules before using real
patient or staff information.
