# GameHub

GameHub is a small full‑stack "game portal" for LAN , which uses P2P for gaming

- A **Node/Express + MySQL** backend manages users, games, lobbies, and player stats.
- A **PeerJS server** (running inside the backend) provides WebRTC signaling.
- A **React + Vite** frontend provides the UI, lobby room, and the games.
- Actual gameplay is **P2P (PeerJS DataConnections)**: the host is authoritative and broadcasts state.


---

## Features

- **Authentication**: register/login.
- **Profile page**: overall stats and per‑game stats.
- **Lobbies**:
	- public or private (password)
	- ready toggle
	- host starts the match
	- lobby cleanup via leave endpoint
- **Games** (frontend):
	- Tris (Tic‑Tac‑Toe)
	- Connect 4
	- Sasso Carta Forbici (Rock‑Paper‑Scissors) – best of 3
	- Indovina il numero (Guess the Number) – turn based

---

## Tech Stack

- Frontend: React 18, Vite
- Backend: Node.js, Express
- Database: MySQL (mysql2)
- Signaling + P2P: PeerJS the library + PeerJS server (`peer`)

---

## Ports and Network Model

By default the project uses:

- Frontend (Vite dev server): `5173`
- Backend REST API (Node ,Express): `4000`
- PeerJS server (signaling): `9000`
- Database server: `3306`

Important:

- The frontend **automatically detects the host IP** using `window.location.hostname`:
	- `frontend/src/config.js` (API connects to same host on port 4000)
	- `frontend/src/lib/usePeer.js` (PeerJS connects to same host on port 9000)


---

## Project Structure

```text
GameHub/
	backend/
		index.js              # Express API + PeerJS server bootstrap
		db.js                 # MySQL connection pool
		routes/
			auth.js             # register/login/profile
			games.js            # list games + report results
			lobbies.js          # lobby CRUD/ready/start/update-peer/leave
		.env                  # DB config (committed in this repo)

	frontend/
		vite.config.js
		src/
			App.jsx             # top-level navigation (home/profile/game)
			config.js           # API base URL (dynamic via window.location.hostname)
			lib/usePeer.js      # PeerJS client hook (dynamic via window.location.hostname)
			components/
				LobbyModal.jsx    # lobby list + lobby room (ready/start)
				TrisGame.jsx
				Connect4Game.jsx
				RpsGame.jsx
				GuessNumberGame.jsx
				AuthModal.jsx
				ProfilePage.jsx
			styles/
				index.css
				games/
					shared.css
					tris.css
					connect4.css
					rps.css
					guess-number.css

	schema.sql              # MySQL schema
	README.md
```

---

## Setup (Windows / PowerShell)

### 1) Prerequisites

- Node.js 20+ recommended
- MySQL 8+ recommended

Make sure ports `4000`, `9000`, `5173` are available.

### 2) Database

Create a database (example name `gamehub`) and run the schema:

```sql
CREATE DATABASE gamehub;
USE gamehub;
-- then run schema.sql
```

Run schema.sql in bash of docker 
It creates new games too

```powershell
# Example (if mysql client is installed and in PATH)
mysql -u <user> -p <password> < schema.sql
```


#### Optional: seed test users

The UI includes quick buttons “Play as User 1 / User 2” which attempt login with:

- `test@test` / password `test`
- `test2@test` / password `test`

Create them via the Register form, or insert them (passwords must be bcrypt-hashed if inserted manually).
Dont create them via database , cause its without bcrypt

### 3) Backend (API + PeerJS server)

Backend config is in `backend/.env`:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=password
DB_NAME=gamehub
PORT=4000
```

Install and run:

```powershell
cd backend
npm install
npm run dev
```

You should see logs for:

- `Server running on port 4000`
- `PeerServer running on port 9000`
- `Database connected at port  3306`

Quick check status:

- `GET http://<HOST>:4000/ping` should return `{ ok: true }`

### 4) Frontend

Install and run:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

---

## LAN Configuration (Most Common Setup)

If you want to play from **two devices on the same Wi‑Fi/LAN**:

1. Pick the machine that runs backend + PeerJS server (the “host machine”).
2. Find its LAN IP (example `192.168.1.2`).
3. **No code changes needed!** The frontend automatically detects the IP from `window.location.hostname`.
4. Ensure Windows firewall allows inbound TCP on ports `4000` and `9000`.
5. Start backend, then frontend.
6. Open the frontend from another device using the host machine IP:
	 - `http://192.168.1.2:5173`
	 - The frontend will connect to `192.168.1.2:4000` (API) and `192.168.1.2:9000` (PeerJS) automatically!

---

## How the App Works (High Level)

### Authentication

- `POST /api/auth/register` creates a user.
- `POST /api/auth/login` returns `{ user }`.
- The frontend keeps the user in React state (no JWT/session cookies).

### Lobby flow (REST, polled)

1. Player opens a game and sees the lobby list.
2. Host creates a lobby:
	 - backend inserts into `lobbies`
	 - backend inserts the host into `lobby_members` (host starts ready)
3. Players join a lobby (private lobbies require password).
4. In the lobby room:
	 - players toggle ready (`POST /api/lobbies/:id/ready`)
	 - host starts (`POST /api/lobbies/:id/start`), status becomes `Playing`
5. Frontend polls `GET /api/lobbies/:id` every second.
6. When status becomes `Playing`, the frontend transitions into the game.

### PeerJS / P2P gameplay

- On login, the frontend creates a PeerJS client via `usePeer(userId)`.
- Each player writes its `peer_id` into the lobby (`POST /api/lobbies/:id/update-peer`).
- The host receives incoming connections (`peer.on('connection', ...)`).
- Game state is exchanged using small JSON messages (`conn.send({ type: ... })`).
- In multiplayer games, the **host is authoritative** and broadcasts updates.

### Reporting results

- The host reports match results to `POST /api/games/result`.
- The backend updates `user_game_stats` using `INSERT ... ON DUPLICATE KEY UPDATE`.
- The Profile page reads aggregated stats from `GET /api/auth/profile/:id`.

---

## Backend API (Summary)

### Auth

- `POST /api/auth/register`  `{ email, password, username }`
- `POST /api/auth/login`     `{ email, password }`
- `GET  /api/auth/profile/:id`

### Games

- `GET  /api/games/games`  → list of games shown in the grid
- `POST /api/games/result` → save stats
	- supports 1v1 (`winner_user_id`/`loser_user_id`) and multiplayer arrays (`winner_user_ids`/`loser_user_ids`)
	- supports draws (`is_draw: true` and `player_user_ids`)

### Lobbies

- `GET  /api/lobbies?game_id=<id>`
- `POST /api/lobbies/createlobby` `{ game_id, host_user_id, max_players, peer_id, is_private, password }`
- `POST /api/lobbies/:id/join`    `{ user_id, peer_id, password }`
- `GET  /api/lobbies/:id`
- `GET  /api/lobbies/:id/members`
- `POST /api/lobbies/:id/ready`      `{ user_id, peer_id? }`
- `POST /api/lobbies/:id/start`      `{ user_id }`
- `POST /api/lobbies/:id/update-peer` `{ user_id, peer_id }`
- `POST /api/lobbies/:id/leave`      `{ user_id }`

---

## Troubleshooting

### “Frontend loads but no games show up”

- The `games` table is empty. Insert rows as shown in the seed section.
- Verify backend is running and reachable from the frontend machine.

### “Login works on one device but not another / fetch fails”

- Check that backend API is reachable: `http://<backend-host>:4000/ping` should return `{ ok: true }`
- Verify the URL you're visiting matches the backend host (the frontend auto-detects from `window.location.hostname`).
- Check Windows firewall for port `4000`.

### "PeerJS connect/reconnect loops / players can't see each other"

- Ensure port `9000` is reachable from both devices (firewall!).
- Start backend first: it runs the PeerJS server.
- Verify the URL hostname matches your backend machine.

### “Two devices on different networks”

This setup is designed for LAN. Across the internet you typically need:

- a public PeerJS server with TLS (https/wss)
- TURN servers for NAT traversal
- proper domain + certificates

---
