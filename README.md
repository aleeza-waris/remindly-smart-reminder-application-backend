# Remindly Backend

The Remindly backend provides the API, MongoDB persistence, authentication, and scheduled email delivery for one-time reminders.

**Deployed API:** [https://remindly-smart-reminder-application.onrender.com](https://remindly-smart-reminder-application.onrender.com)  
**Health check:** `/api/health`  
**Backend repository:** [aleeza-waris/remindly-smart-reminder-application-backend](https://github.com/aleeza-waris/remindly-smart-reminder-application-backend)

## Backend capabilities

- Email/password registration and login, plus verification of Google ID tokens.
- Expiring bearer sessions stored in MongoDB.
- User-scoped reminder CRUD, completion, list filtering, and dashboard statistics.
- Per-user reminder title uniqueness after trimming and case normalization.
- A scheduled worker that sends reminder emails through the Gmail API.
- User time zones, advance notice preferences, and Email Alerts settings.

## Technology

- Node.js ES modules and Express
- MongoDB and Mongoose
- Zod, `bcryptjs`, and `google-auth-library`
- `googleapis` and `node-cron`
- Node.js built-in test runner and Supertest

## API reference

Routes use the `/api` prefix. Protected routes require `Authorization: Bearer <token>`.

### Health and authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check. |
| `POST` | `/api/auth/register` | Register with email and password. |
| `POST` | `/api/auth/login` | Sign in with email and password. |
| `POST` | `/api/auth/google` | Verify a Google ID token and sign in. |
| `GET` | `/api/auth/me` | Read the authenticated user's profile. |
| `PATCH` | `/api/auth/me` | Update profile and reminder preferences. |
| `POST` | `/api/auth/logout` | Revoke the current session. |
| `GET` | `/api/auth/sessions` | List the authenticated user's unexpired sessions. |
| `DELETE` | `/api/auth/sessions` | Revoke the authenticated user's other sessions. |

### Reminder API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/reminders` | List reminders; accepts `status`, `category`, `priority`, `search`, `dueFrom`, `dueTo`, `page`, and `limit`. |
| `POST` | `/api/reminders` | Create a one-time reminder. |
| `GET` | `/api/reminders/stats` | Return dashboard reminder statistics. |
| `GET` | `/api/reminders/:id` | Read one reminder owned by the caller. |
| `PUT` | `/api/reminders/:id` | Update an owned reminder. |
| `DELETE` | `/api/reminders/:id` | Delete an owned reminder. |
| `PATCH` | `/api/reminders/:id/complete` | Set an owned reminder's completion state. |

Reminder titles are trimmed and limited to 120 characters; descriptions are limited to 2,000 characters. Supported advance notice values are 0, 5, 10, 15, 30, 60, and 1,440 minutes. New reminders and changed due dates must be in the future; an unchanged overdue due date can be retained when editing.

## Prerequisites and local setup

- Node.js 22 or newer (`googleapis` in the lockfile requires Node.js `>=22`)
- npm
- A reachable MongoDB instance

Install from the backend repository root:

```bash
npm install
cp .env.example .env
```

In PowerShell, copy the example with `Copy-Item .env.example .env`. Set the local values in `.env` before starting the server. Do not commit this file.

### Environment variables

| Variable | Required when | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Always | Database used by the API and title migration. |
| `CLIENT_ORIGINS` | Required in production | Comma-separated exact frontend origins; production origins must use HTTPS. |
| `NODE_ENV` | Production deployment | Set to `production` for production CORS validation. |
| `PORT` | Optional | HTTP port; defaults to `5000`. |
| `MONGODB_TEST_URI` | Backend integration tests | Test database; defaults to `mongodb://127.0.0.1:27017/remindly_phase2_test`. |
| `GOOGLE_CLIENT_ID` | Google Sign-In and Gmail OAuth | Google OAuth client ID; must match the frontend ID for sign-in. |
| `GOOGLE_CLIENT_SECRET` | Gmail email delivery | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Gmail email delivery | Refresh token authorized for the sender account. |
| `GMAIL_SENDER_EMAIL` | Gmail email delivery | Sender address used in reminder emails. |

Variable names and local placeholders come from `.env.example`. Use private values in local or hosting environment settings; never put real credentials in documentation or source control.

## Available scripts

```bash
npm run dev     # Start with nodemon
npm start       # Start the API server
npm test        # Run backend tests
```

The backend integration tests need a reachable MongoDB test database. They use an injected email sender for worker tests and do not send real email.

## Authentication and email delivery

Password accounts use bcrypt. Google sign-in verifies the ID token and requires a verified email. Successful authentication returns an opaque token backed by a seven-day MongoDB session; send the token as a bearer credential on protected requests. Logout revokes the current session, and reminder operations are scoped to the authenticated user.

The worker checks once per minute for pending reminders whose notification time has arrived. It sends through the Gmail API and records successful delivery. Failed messages remain eligible for a later attempt; users with Email Alerts disabled are skipped. Email due times use the recipient's saved time zone, with UTC fallback. Gmail API access, an authorized refresh token, and a valid sender configuration are required for live delivery. The cron runs in each backend process, so deploy one instance unless distributed worker coordination is added.

## Developer maintenance: reminder-title migration

The migration checks all reminder titles after trimming and lowercasing. First run the no-write preflight:

```bash
npm run reminders:titles:migrate
```

It reports duplicate groups by user and reminder IDs without changing data. Resolve any conflicts manually and rerun the preflight. Back up important data and pause reminder writes before applying a clean migration:

```bash
npm run reminders:titles:migrate -- --apply
```

`--apply` backfills normalized title keys and creates a per-user unique index. Confirm `MONGODB_URI` points to the intended database. The script does not rename or delete reminders.

## Deploy to Render

1. Create a Web Service from the backend GitHub repository; its repository root is the backend project root.
2. Set the build command to `npm install` and the start command to `npm start`.
3. Configure `MONGODB_URI`, production `CLIENT_ORIGINS`, `NODE_ENV=production`, and the Google/Gmail values required for enabled integrations. The server reads `PORT` and defaults to `5000` when it is unset.
4. Ensure the database allows the Render service to connect and the frontend's `NEXT_PUBLIC_API_URL` points to this API with `/api` appended.
5. Configure Google authorized origins and verify the health check, frontend CORS, authentication, and email delivery after deployment.

## Project structure

```text
backend/
├── scripts/          # Reminder-title migration
├── src/config/       # CORS configuration
├── src/controllers/  # HTTP handlers
├── src/cron/         # Scheduled reminder worker
├── src/db/           # MongoDB connection
├── src/middleware/   # Authentication and error handling
├── src/models/       # User, session, and reminder schemas
├── src/routes/       # Auth and reminder routes
├── src/services/     # Auth, reminders, and Gmail
├── src/validators/   # Request validation
└── tests/            # API, integration, CORS, and service tests
```
