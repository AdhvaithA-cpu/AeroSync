# AeroSync Flight Proxy

This tiny server keeps the AirLabs API key out of the public iOS app.

The iPhone app calls:

- `GET /api/health`
- `GET /api/features`
- `GET /api/policy/brief`
- `GET /api/flight?flight_iata=AA123`
- `POST /api/account/preflight`

The server privately calls AirLabs with `AIRLABS_API_KEY`.

`/api/account/preflight` validates launch/account profile details for demos. It does not store public user accounts. Before real App Store accounts, attach a real auth provider and database.

## Local Test

```bash
cd outputs/AeroSyncBackend/flight-proxy
export AIRLABS_API_KEY="paste_rotated_key_here"
npm start
```

Then open this URL in a browser:

```text
http://localhost:8080/api/health
```

Also check:

```text
http://localhost:8080/api/features
```

And:

```text
http://localhost:8080/api/policy/brief
```

For the iOS simulator, use this backend URL in AeroSync:

```text
http://127.0.0.1:8080
```

## Deploy

1. Rotate the exposed AirLabs key in the AirLabs dashboard.
2. Create a new web service on a host such as Render, Railway, Fly.io, or another Node-capable host.
3. Point the service at this folder.
4. Set this environment variable on the host:

```text
AIRLABS_API_KEY=your_new_rotated_airlabs_key
```

5. Use `npm start` as the start command.
6. Copy the deployed HTTPS URL.
7. For App Store launch, open `outputs/AeroSync/AeroSync/Models/AviationSettings.swift`.
8. Paste the deployed HTTPS URL into `productionBackendBaseURL`.
9. Build, archive, and upload the iOS app.

For local testing only, you can also open AeroSync, go to `More > Profile & Settings > Live Flight Data`, choose `AeroSync Backend`, paste the deployed HTTPS URL, tap `Test Secure Connection`, then tap `Save Profile`.

## App Store Note

For public release, use `AeroSync Backend` instead of `Direct AirLabs`. This protects the AirLabs provider key because the key lives only on the server host, not in the app bundle.

For public accounts, do not rely on the preflight endpoint alone. Add:

- Auth provider such as Sign in with Apple, Clerk, Auth0, Supabase Auth, or Firebase Auth
- Database such as Postgres, Supabase, Firebase, or another managed store
- Privacy policy covering account data, flight numbers, notifications, and location use
- Account deletion flow for App Store review

## Policy Brief Endpoint

`GET /api/policy/brief` serves the policy module based on Adhvaith Ananth's 2026 fellowship brief, "Improving Passenger Communication and Airport Security in U.S. Aviation."

Use it later if you want the iOS app or portfolio site to pull the policy module from the backend instead of relying only on bundled app copy. The current endpoint is static and safe for demos. If you later add editing or publishing tools, protect them with admin authentication.
