# NDC Tracking Client
## Frontend Application Specification and Operations Guide

### 1. Overview and Functional Scope

The `client` directory contains the Single Page Application (SPA) for the NDC Tracking Platform. This web application provides Human Resources, operations managers, and department approvers with real-time operational oversight across the employee clearance lifecycle.

Core functional capabilities:
* Executive Overview Grid: Searchable and sortable registry of all active separation records, with visual status indicators across 13 approval checkpoints.
* Multidimensional Filtering: Real-time queries filtered by legal entity, business unit, department, location, employee grade, resignation date, and SLA boundary.
* Clearance Analytics Engine: Turnaround time (TAT) computation, clearance velocity tracking, and stage-by-stage bottleneck identification powered by Highcharts and Recharts.
* Full and Final (F&F) Settlement Management: Real-time audit of SharePoint repositories to confirm the availability of Relieving Letters, Service Certificates, and F&F Statements, with automated and manual email dispatch triggers.
* Administrative Operations Center: User provisioning, role assignment, system credentials management, automation scheduler configuration, and department notification rules.

### 2. Technical Stack and Dependencies

| Layer | Technology | Specification |
| :--- | :--- | :--- |
| Runtime Framework | React 18 | Component architecture with concurrent rendering |
| Bundler and Tooling | Vite 6 | Development server with Hot Module Replacement and production bundling |
| Type Enforcement | TypeScript | Strict schema definitions for data payloads and API contracts |
| Presentation Layer | Tailwind CSS v4 | Utility-first CSS architecture with customized design tokens |
| Navigation | React Router v7 | Nested route management with client-side history API |
| Component Primitives | Radix UI | Headless accessible components (dialogs, dropdowns, tabs, popovers) |
| Data Visualization | Highcharts & Recharts | Interactive SVG rendering for analytics and trends |
| User Notifications | Sonner | Real-time toast notifications for asynchronous actions |
| Document Export | XLSX & PPTXGenJS | Client-side generation of Excel workbooks and presentation slides |

### 3. Prerequisites

The following software must be installed on the local system:

* Node.js: Version 18.x or 20.x LTS
* npm: Version 9.x or higher (or pnpm 8.x+)
* Backend API: The FastAPI service should be running on `http://127.0.0.1:8010` to support data loading and authentication.

### 4. Installation and Environment Setup

#### Step 4.1: Install Node Dependencies

Execute from the `client/` directory:

```bash
npm install
```

#### Step 4.2: Provision Environment File

Generate the local configuration file from the provided template:

* Windows (PowerShell):
  ```powershell
  Copy-Item .env.sample .env
  ```
* Linux / macOS:
  ```bash
  cp .env.sample .env
  ```

#### Step 4.3: Review Environment Parameters

Configure the following parameters in `client/.env`:

```ini
# Base URL path for client routing (use /ndc/ for local development, /ndc/v2/ for production)
VITE_BASE_PATH=/ndc/

# Go-Live Baseline Filter
VITE_USE_GO_LIVE_BASELINE=true
VITE_GO_LIVE_DATE=2026-08-07

# Enhancement Features Flag (Credentials, Scheduler, Email Rules, Logs)
VITE_ENHANCEMENT_FEATURES=true
```

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `VITE_BASE_PATH` | string | `/ndc/` | Sets the application URL prefix and router base path. Use `/ndc/` for local development; use `/ndc/v2/` for production deployments behind Nginx. |
| `VITE_USE_GO_LIVE_BASELINE` | boolean | `true` | Restricts grid queries and analytics calculations to records occurring on or after the specified baseline date. |
| `VITE_GO_LIVE_DATE` | string | `2026-08-07` | Baseline date boundary formatted as YYYY-MM-DD. |
| `VITE_ENHANCEMENT_FEATURES` | boolean | `true` | Master flag to control visibility of advanced administrative tabs (Credentials, Scheduler, Email Config, SharePoint Docs, Logs). |

### 5. Local Execution and API Proxy

Launch the local Vite development server:

```bash
npm run dev
```

The application initiates on `http://localhost:7002/ndc/ndc-reporting/overview`.

#### Reverse Proxy Architecture

To avoid Cross-Origin Resource Sharing (CORS) complications during development, the Vite server acts as an inline proxy configured in `client/vite.config.ts`:

* Outbound requests prefixed with `/ndc/api/*` are intercepted by the Vite dev server.
* The proxy rewrites the path and forwards the request directly to the backend at `http://127.0.0.1:8010/api/*`.
* All API response JSON keys are serialized in camelCase format to match TypeScript conventions.

### 6. Component and Feature Architecture

The application is structured around domain-driven feature modules in `client/src/`:

```
client/src/
├── assets/                    Static images, logos, and iconography
├── components/                Reusable presentation components
│   ├── common/                Authentication guards (ProtectedRoute), error boundary wrappers
│   └── ui/                    Design system primitives (buttons, dialogs, forms, selects)
├── context/
│   ├── AuthContext.tsx        Authentication state, token persistence, and role resolution
│   └── SidebarContext.tsx     Layout navigation state management
├── features/                  Domain-specific page views
│   ├── analytics/             Turnaround time metrics, clearance bottlenecks, trend charts
│   ├── auth/                  Authentication forms (Login, Password Reset, Pending Approval)
│   ├── email-config/          Department notification scheduling and CC rule settings
│   ├── employee-email-master/ Master email mapping registry for separated personnel
│   ├── fnf/                   Full and Final document audit grid and settlement dispatches
│   ├── overview/              Main operational grid, KPI scorecards, multi-filter query bar
│   ├── rm-email-configuration/Reporting Manager reminder escalation policies
│   └── user-management/       Administrative tabs (Access approvals, Credentials, Scheduler, Logs)
├── layouts/
│   └── Sidebar.tsx            Primary enterprise navigation shell
├── lib/                       CSS class utilities (clsx, tailwind-merge)
├── types/                     TypeScript data schemas for API payloads and clearance records
├── utils/                     Data transformation utilities, date formatters, export helpers
├── App.tsx                    Route configuration and layout composition
└── main.tsx                   React DOM bootstrapping
```

### 7. Production Compilation and Distribution

Compile the production-optimized distribution bundle:

```bash
npm run build
```

#### Compilation Characteristics:
* The build artifact is generated in `client/dist/`.
* JavaScript and CSS bundles are minified, tree-shaken, and content-hashed for optimal client-side caching.
* The output is fully static and compatible with any web server (FastAPI integrated static server, Nginx, Apache, or CDN edge storage).

### 8. Operational Runbook and Troubleshooting

#### Symptom 1: Network requests fail with 404 or connection refused
* Verification: Ensure the backend FastAPI service is running on port 8010.
* Verification: Confirm that `vite.config.ts` points to `http://127.0.0.1:8010` in the proxy block.

#### Symptom 2: Port 7002 is unavailable
* Resolution: If port 7002 is allocated to another process, adjust the port value in `client/vite.config.ts`:
  ```typescript
  server: {
    port: 7003,
  }
  ```

#### Symptom 3: Browser displays a 404 error upon hard refresh in production
* Resolution: In production environments, client-side routing requires the host server (FastAPI `spa_server` or Nginx) to route all non-file requests to `index.html`. Verify that the hosting server has SPA fallback routing enabled.
