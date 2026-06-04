# Implementation Plan: Lightweight Web Dashboard

This document details the architectural design and implementation plan for adding a secure, premium web dashboard to **Scotch Egg**. 

To ensure the bot remains highly viable for users self-hosting on low-resource hardware like a **Raspberry Pi 3B+** (Quad-Core 1.4GHz, 1GB RAM, MicroSD card storage), the system is optimized for **extreme memory efficiency** and **minimum CPU / Disk I/O impact**.

---

## 1. Raspberry Pi 3B+ Resource & Feasibility Analysis

Running both a Discord bot and a web administration panel on a Pi 3B+ is highly feasible if we avoid heavy bundling pipelines, Server-Side Rendering (SSR) frameworks (like Next.js/Nuxt), and independent database processes.

### A. Resource Constraints of the Pi 3B+
*   **Memory (1GB LPDDR2):** This is the main bottleneck. Spawning a separate React/Next.js Node runtime or an independent database service (like PostgreSQL/MongoDB) will exceed the Pi's physical RAM and force thrashing via slow virtual swap space.
*   **CPU (4x ARMv8 @ 1.4GHz):** Extremely lightweight for routing, but throttles when compiling assets at runtime or during encryption cycles.
*   **I/O (Slow MicroSD card):** SD cards have slow read/write speeds. Writing high-frequency logs or running complex database queries degrades SD card longevity and blocks the execution loop.

### B. Proposed Low-Impact Architecture
To address these limitations, we design the dashboard with a micro-footprint layout:

```mermaid
graph TD
    subgraph Client (User Browser)
        C[Vanilla JS SPA] -->|Discord OAuth2| D[Discord API]
        C -->|Secure API Requests| B[Express API Engine]
    end
    subgraph Server (Raspberry Pi 3B+)
        subgraph Combined Node Process
            E[Discord Bot client] <-->|Shared memory state| B
            B <-->|Atomic File Sync| DB[(storage.js - JSON DB)]
        end
    end
```

1.  **Single-Process Integration (Express inside Bot):** Instead of running a separate web server process, we integrate a lightweight **Express** server directly inside the bot's existing Node.js runtime process (`index.js`). Spawning zero extra Node instances saves **~40MB to 60MB of RAM**.
2.  **Client-Side Rendering (SPA):** The server only acts as a static server, sending pre-built vanilla HTML, CSS, and JS files to the user's browser. The client's machine handles all UI rendering, keeping idle server CPU overhead at **<0.5%**.
3.  **In-Memory DB Mapping:** Since `storage.js` naturally caches configurations in-memory, Express routes read configurations directly from the bot's memory state. This eliminates read-based disk access (**0% read-based SD card I/O**).

### C. Estimated Resource Overhead

| Component | CPU Idle | CPU Active (Load) | RAM Overhead | I/O Bottlenecks |
| :--- | :--- | :--- | :--- | :--- |
| **Scotch Egg (Core)** | ~0.5% | 2 - 5% (pings/DMs) | ~45MB | Minimal (Sync on writes) |
| **Express API Engine** | 0.0% | ~1.5% (per request) | +8MB | None (In-memory reads) |
| **Static Web Dashboard** | 0.0% | 0.0% | 0MB | MicroSD read on first load |
| **Total Combined System**| **~0.5%** | **~5%** | **~53MB** | **Safe for slow SD cards** |

---

## 2. Technical Implementation Architecture

We will organize the code changes into the backend API wrapper and a vanilla static frontend SPA folder:

### Backend (Pi Server)

#### 1. [index.js](file:///q:/My%20Drive/GitHub/scotch-egg-bot/index.js)
*   **Express Initialization:** Initialize Express inside the ready handler of the Discord bot client. Bind the listener to port `8080` (or `process.env.DASHBOARD_PORT`).
*   **Secure API Router:** Expose a secure router under `/api` that reads/writes directly to our `eventDb` and `serverConfig` objects:
    *   `GET /api/stats` - Exposes active guild events and overall opt-in counts.
    *   `GET /api/settings` - Exposes and saves server configuration parameters.
    *   `POST /api/settings` - Accepts updates, pushes them into `serverConfig`, and executes `saveConfig()` instantly.
*   **Static Assets Server:** Bind static paths using `app.use(express.static('public'))`.

---

### Frontend (Client Browser)

#### 1. `public/index.html` [NEW]
*   A premium, glassmorphism-themed control panel. Contains toggles for reminder modes (private DM vs. public mentions), input forms for custom intervals, active statistics count widgets, and a sync toggle for auto-threads and calendar buttons.
*   Implements responsive CSS layout with modern dark-mode palettes (e.g. deep slate background `#0d1117`, vibrant accents like HSL blue, and glassmorphic translucent panels).

#### 2. `public/dashboard.js` [NEW]
*   Performs secure client-side Discord OAuth2 redirection to authenticate users.
*   Fetches current state configurations from `/api/settings` on load.
*   Performs secure PUT/POST requests to `/api/settings` when settings are changed, showing dynamic save feedback and error states.

#### 3. `public/dashboard.css` [NEW]
*   Sleek premium stylesheet featuring Harmonized HSL variables, fluid gradients, responsive mobile breakpoints, and micro-hover states to create a state-of-the-art interactive experience.

---

## 3. Verification & Deployment Steps

*   **Dependency Isolation:** Add *only* `express` to the dependencies map in `package.json` to keep development installations extremely compact.
*   **OAuth2 Client Configuration:** Configure the Discord Developer Portal application with a new redirect URI pointing to `http://<your-pi-ip>:8080/dashboard.html`.
*   **Data Integrity Check:** Verify that changes made through the web UI immediately trigger atomic writes to `config.json` without process latency or memory leaks.
