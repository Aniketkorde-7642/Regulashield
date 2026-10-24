# Regula Shield AI

A local-first document review workflow for synthetic academic compliance applications:

1. Create an Institution Applicant account and start an application.
2. Upload PDF evidence.
3. Extract text and candidate fields.
4. Run explainable rule, cross-document, duplicate, and mock-issuer checks.
5. Review extracted fields and findings.
6. Confirm required evidence fields and resolve high-severity findings before approval.
7. Submit the completed application for a System Administrator decision.
8. Request corrections or record an approval/rejection in a hash-linked audit trail and provide the institution with a decision report.

This is a demonstration system. Rules and issuer checks are synthetic and must not
be used to make real accreditation decisions.

## Run on Windows

Requires Python 3.11 or newer.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
python -m uvicorn app.main:app --reload
```

The backend API is available at <http://127.0.0.1:8000> and its OpenAPI interface
is at `/docs`. On first start, the application creates accounts for the System
Administrator (`admin`), AICTE Scrutiny Officer (`officer`), Regulatory /
Verification Officer (`regulatory`), Regulatory / Compliance Administrator
(`compliance`), and Institution Applicant (`institution`).
If a password variable is not configured, a one-time password is generated and
printed to the backend console. Set `ADMIN_PASSWORD`, `OFFICER_PASSWORD`,
`REGULATORY_PASSWORD`, `COMPLIANCE_ADMIN_PASSWORD`, `INSTITUTION_PASSWORD`,
and a long random `SECRET_KEY` before starting to choose credentials yourself.
Existing users are not overwritten on later starts. The sign-in screen includes
role shortcuts that fill the account name; each user enters their own password.
For a disposable local demo only, set `DEMO_MODE=true` before the first startup
to seed role accounts with distinct demo passwords and let the sign-in screen
autofill them. The demo credentials are exposed only while demo mode is enabled
and only for active accounts that still have those seeded passwords. Do not
enable demo mode in production; existing accounts are never overwritten.
Administrators can create accounts, change roles, and disable or enable users
from the System Administrator dashboard.
The sign-in screen lets institutions request an account using a 12-character
password. A request appears in the System Administrator dashboard; no login
account is created until an administrator approves it. Approved accounts
receive only the Institution Applicant role and can access only their own
applications.

The administrator dashboard manages accounts and shows audit integrity and
security status. The AICTE Scrutiny Officer dashboard prioritizes applications
by open findings and pending review fields, with explainable evidence reports.
The Regulatory / Verification Officer dashboard tracks and resolves findings.
The Regulatory / Compliance Administrator can manage academic-year-specific
rule proposals, attest to official clause/source checks, simulate candidate
rules, and submit proposals for independent System Administrator approval.
Approvals publish immutable new versions; prior versions and previously
recorded evaluation findings remain unchanged. Rule drafts, source attestations,
simulations, submissions, approvals, and rejections are recorded in the audit
trail. The AICTE Scrutiny Officer may review applications but cannot create new
applications.
Institutions can run an advisory metadata pre-check before creating an
application, edit their own draft details, upload typed evidence, and view
missing-document and validation guidance. After all uploaded documents finish
processing, an institution submits the application into the System
Administrator decision queue. If corrections are requested, the institution
can edit its details or evidence and resubmit. Other submitted applications
remain locked against institution edits; AICTE Scrutiny Officers cannot issue
final decisions on institution-owned applications.
After approval or rejection, the institution receives an owner-scoped decision
report with the outcome, note, decision maker/date, score summary, evidence,
and findings; the report can be printed or saved as PDF. A rejected application
can be resubmitted as a new draft with a revision number; its original decision
remains unchanged, and evidence must be uploaded again. Institution accounts
cannot access reviewer field corrections, findings resolution, or the audit
trail.

The initial rules are explicitly synthetic examples. This system does not
automatically retrieve or verify AICTE amendments, and does not use a
generative-AI model to write scrutiny reports. Reports are produced by OCR,
cross-document consistency checks, and the configured rule engine. Authorized
staff must verify official regulatory sources before adding production rules.
Text-bearing PDFs use native text extraction; image-based pages and text-free
vector pages are sent through Tesseract OCR. Unreadable documents are marked
failed rather than processed. Extracted field labels are matched against known
variants with TF-IDF, and extraction responses include source page references.
The compliance score weights metadata consistency, required-document
completeness, and regulatory compliance. Configure weights, the advisory
approval threshold, and required document types with
`COMPLIANCE_WEIGHT_METADATA_CONSISTENCY`,
`COMPLIANCE_WEIGHT_DOCUMENT_COMPLETENESS`,
`COMPLIANCE_WEIGHT_REGULATORY_COMPLIANCE`,
`COMPLIANCE_APPROVE_THRESHOLD`, and
`COMPLIANCE_REQUIRED_DOCUMENT_TYPES`. The score and recommendation are
explainable and advisory; an authorized reviewer records the final decision.
Rejections require a reason, and correction requests and status transitions are
recorded in the audit trail.

Uploaded files and the SQLite database are stored under `backend/storage/`.

## Run the Next.js frontend

The standalone frontend is in `frontend/` and proxies API requests to the
backend. Start the backend as described above, then in a second PowerShell
window run:

```powershell
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. To point the frontend at a backend on another
host or port, set `BACKEND_URL` before starting Next.js, for example:

```powershell
$env:BACKEND_URL = "http://127.0.0.1:8000"
npm run dev
```

Run `npm run typecheck` and `npm run build` from `frontend/` to validate the
frontend or produce a production build. Development uses a separate `.next-dev`
directory so a dev server and production build do not overwrite each other's
webpack chunks. For production, run `npm run start` after building; do not
rebuild `.next` while a production server is using that directory. The build
prepares the standalone server and its static assets. Set `BACKEND_URL` before
building so the production API proxy targets the backend host and port.

## OCR for scanned PDFs

The backend uses the Tesseract OCR engine through PyMuPDF for scanned pages
and image pages without an existing text layer. On Windows, install Tesseract
and its English language data before starting the backend. One option is:

```powershell
winget install --id tesseract-ocr.tesseract --exact
```

In the same PowerShell window you use to start the backend, verify Tesseract is
on `PATH`:

```powershell
tesseract --version
```

If the command is not found and you used the default installer location, add it
for that session before starting Uvicorn:

```powershell
$env:Path += ";C:\Program Files\Tesseract-OCR"
tesseract --version
```

The Docker backend image installs Tesseract and English language data during
its build. OCR defaults to English at 300 DPI; configure `OCR_LANGUAGE`,
`OCR_DPI`, or `TESSDATA_PATH` if your local Tesseract installation needs
different settings.

OCR runs in the background after upload. OCR-derived values are deliberately
given a low confidence score and left for reviewer confirmation. The extractor
handles both `Label: value` lines and PDFs whose table text is flattened into
alternating label and value lines. A mismatch against declared application
metadata lowers the displayed confidence and requires review. A processed
document can be reprocessed from its review page after extraction logic changes.
If a scanned page produces no readable text,
the application shows a blocking `extraction.scanned_pdf_no_ocr` finding;
reviewers must inspect the PDF, enter any required values, and resolve or
dismiss the finding with a reason. Handwriting and non-English documents may
not be recognized reliably.

Recognized field labels are matched against known label variants with a
TF-IDF cosine-similarity score, so common alternatives such as “Name of
Institution” can populate the extracted-field review. Each candidate is
prefilled in its review input and compared with the application metadata when
there is a corresponding declared value; the review shows both the label and
metadata match percentages. These scores are advisory, and OCR candidates
still require reviewer confirmation or correction before approval. Application
metadata is never silently overwritten by an uploaded document.

The officer decision panel also shows an overall exact metadata match score
across seven expected application fields. Missing or mismatched extracted
values count as non-matches; case, spacing, numeric formatting, and equivalent
academic-year formats are normalized. A score strictly above 50% suggests
approval; 50% or lower suggests rejection. This is an advisory recommendation,
not an automated decision: an officer must explicitly approve or reject the
application, and its final status reflects that recorded action. The officer
may explicitly override outstanding approval blockers; the confirmation and
overridden blockers are written to the audit trail.

For a containerized PostgreSQL run, copy `.env.example` to `.env`, replace all
placeholder secrets, then run `docker compose up --build`. The frontend will be
available at <http://127.0.0.1:3000> and the backend API at
<http://127.0.0.1:8000>.

## Configuration

Environment variables can be set in PowerShell before launching:

```powershell
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:ADMIN_PASSWORD = "replace-with-a-strong-admin-password"
$env:OFFICER_PASSWORD = "replace-with-a-strong-officer-password"
$env:REGULATORY_PASSWORD = "replace-with-a-strong-regulatory-password"
$env:INSTITUTION_PASSWORD = "replace-with-a-strong-institution-password"
$env:COMPLIANCE_ADMIN_PASSWORD = "replace-with-a-strong-compliance-admin-password"
$env:DATABASE_URL = "sqlite:///./storage/regula.db"
```

`DATABASE_URL` may also point to PostgreSQL, for example
`postgresql+psycopg://user:password@localhost:5432/regula_shield`. The local
filesystem storage adapter is used by default so the app runs without Docker or
an object-storage service.

## Tests and sample documents

From the project root:

```powershell
pytest -q
python sample_data\make_samples.py
```

The generated PDFs are synthetic text-layer documents. Scanned-PDF OCR uses the
locally installed Tesseract engine and is covered by mocked OCR workflow tests;
install Tesseract to run it locally. OCR may not reliably recognize handwriting
or documents in languages without matching Tesseract language data.

## Project structure

```text
backend/
  app/
    api/           HTTP routes and authentication
    services/      storage, extraction, validation, audit, pipeline
    config.py      environment configuration
    db.py          SQLAlchemy engine and session lifecycle
    models.py      applications, documents, findings, reviews, users, audit
    schemas.py     API request/response validation
    rules.json     clearly labeled synthetic checks
  tests/           API workflow and engine tests
frontend/
  src/app/         Next.js routes and responsive global styles
  src/components/  sign-in, application review, and shared UI
  src/lib/         API client, domain types, and formatting helpers
sample_data/       repeatable synthetic PDF generator
```

## Before real-world use

Replace synthetic rules and mock issuer verification with authoritative,
versioned sources. The following production capabilities are not implemented:
legal/privacy review, malware scanning, retention controls, production identity
management, HTTPS/TLS, database migrations, and backups.
Human reviewers remain responsible for decisions.

## Deploy on Vercel

The root `vercel.json` defines a Next.js frontend service and a Docker-backed
FastAPI service. The backend container installs Tesseract and routes are sent
to FastAPI under `/api/`; all other paths go to Next.js. PostgreSQL and private
Vercel Blob storage are required because Vercel's container filesystem is
ephemeral.

Connect the repository to a Vercel project with Services enabled, connect a
PostgreSQL provider and a **private** Blob store, and configure these project
environment variables for Production and Preview:

- `DATABASE_URL`: provider's PostgreSQL URL (use its non-pooling URL if offered).
- Connect the **private** Blob store to the Vercel project. Production uploads
  use its OIDC-connected `BLOB_STORE_ID`, and the backend needs
  `BLOB_READ_WRITE_TOKEN` (or a backend-provided `VERCEL_OIDC_TOKEN`) to read
  and process private evidence. Do not use a public Blob store token for evidence.
- `SECRET_KEY`: a stable, randomly generated signing key (at least 32 random
  bytes); keep it private and do not commit it.
- `ADMIN_PASSWORD`: a strong initial System Administrator password.
- `DOCUMENT_STORAGE=vercel_blob`.
- `DEMO_MODE=false`.
- `NEXT_PUBLIC_BLOB_UPLOADS=true`.

Optional bootstrap role passwords are `OFFICER_PASSWORD`,
`REGULATORY_PASSWORD`, `COMPLIANCE_ADMIN_PASSWORD`, and
`INSTITUTION_PASSWORD`. If omitted, the accounts receive random passwords that
are not printed in Vercel logs; the administrator can set passwords from the
user-management dashboard. Do not enable demo mode in the public production
project.

For a controlled System Administrator password reset, set a new strong
`ADMIN_PASSWORD` secret and temporarily set `RESET_ADMIN_PASSWORD=true` for
Production, then deploy. This resets only the seeded `admin` account; other
role passwords are unchanged. After the reset deployment is ready, remove
`RESET_ADMIN_PASSWORD` and deploy again. Never commit or log the password.

### Protected demo deployment

If shared demo accounts are needed, use a separate Vercel project with its own
PostgreSQL database and private Blob store. Enable Vercel SSO deployment
protection for the entire demo project and limit access to authorized team
members before enabling demo mode. Configure `DEMO_MODE=true`,
`DEMO_ACCESS_PROTECTION=vercel_sso`, and the secret `DEMO_ROLE_PASSWORD` only
in that protected project. The backend resets the five seeded role accounts to
that shared password on startup, and the demo login page displays it only when
the protected backend enables the demo-credentials endpoint. The public
production project must keep `DEMO_MODE=false`; its demo-credentials endpoint
returns no passwords. Never reuse the demo database or storage for production
records.

The project uses the backend Dockerfile so scanned-PDF OCR keeps its Tesseract
runtime. A Vercel-managed `*.vercel.app` domain is assigned to the project;
add a custom domain separately if desired. Do not use this demonstration
application for official accreditation decisions.
#   R e g u l a S h i e l d  
 