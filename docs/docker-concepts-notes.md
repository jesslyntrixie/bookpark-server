# Docker Concepts — My Notes

Personal reference for the BookPark server. Written in plain language, built around the
analogies that finally made it click.

---

## 0. The problem Docker solves

"It works on my machine" — code that runs for me breaks on a teammate's laptop or the
server, because everyone has different OS versions, system libraries, runtime versions, etc.
Docker seals my app **plus everything it needs to run** into one box that behaves the same
everywhere.

**Not the same as package.json / conda.** Those only pin my *libraries* — they assume the
OS, system libs, and runtime below them already match. Docker pins the **whole stack** (OS
userland + runtime + system libs + app) *and* isolates it in a sandbox.
- `package.json` / conda = "here's a shopping list, install these ingredients in your kitchen."
- Docker = "here's the whole sealed kitchen, ingredients already installed, correct oven — just plug it in."

---

## 1. The three things I kept mixing up

| Thing | What it is | Analogy | Where it lives |
|-------|------------|---------|----------------|
| **Image** | A blueprint. Built or downloaded. Doesn't run. | An **installed app** just sitting there | Docker's storage on my Mac |
| **Container** | An image **brought to life and running** | The app **while it's open** and running | A running program on my Mac (run by Docker) |
| **Volume** (e.g. `bookpark-data`) | A **folder** for saving data | A **filing cabinet**, bolted down outside | Docker's hidden storage on my Mac |

Core analogy (same as classes/objects):
- **Image = class** (blueprint, built once)
- **Container = object/instance** (a running copy — I can start many)
- **`docker run` = the constructor** (turns an image into a running container)

---

## 2. What a container actually IS

A container is **not a place** I can point to — it's a **running program**, like an app
that's open.

- **Stopped** = dormant, just saved files in Docker's storage (like a closed app).
- **Running** = alive, using my Mac's CPU/memory (like an open app).

Who runs it? **Docker** — itself a program running on my Mac. Containers run *inside* Docker,
which runs on my Mac. **Not the cloud.** The only "cloud" part is downloading the image from
Docker Hub (an app store); after that everything runs locally.

A container behaves like a **tiny separate computer**: its own files, own network address,
own ports, own processes — walled off from my Mac and from other containers.

Containers are **disposable** — delete one and everything inside it vanishes. That's why data
I want to keep goes in a **volume** (outside the container).

---

## 3. Two worlds: my repo vs inside the container

Paths like `/app`, `/app/data`, `/etc/nginx/...` are **real folders, but they live INSIDE the
container** (a separate computer's drive) — that's why I can't see them in Finder.

- **World 1 — my Mac / repo:** what I see in Finder (`Dockerfile`, `server.js`, `nginx.conf`…).
- **World 2 — inside a container:** `/app`, `/etc`, `/usr`… These come from:
  1. the **base image** (`FROM node:22-slim` ships a mini Debian Linux with `/etc`, `/usr`, etc.), and
  2. my **Dockerfile** (`WORKDIR /app` creates `/app`, `COPY . .` copies my code into it *at build time* — into the container's drive, not my repo).

Standard Linux folder conventions: `/etc` = config, `/app` = the app, `/var/lib/...` = program data.

---

## 4. Volumes & mounts — the part that confused me most

**A mount is a DOORWAY, not a copy.** One folder/file, reached from two sides.

- The database **physically lives in `bookpark-data`** (Docker's hidden storage on my Mac).
- `/app/data` is just the **door in the container's wall** that opens into that exact folder.
- So the data is **NOT in two places** — it's one folder with two names.
  (Like a shared Google Drive folder showing as "MyDrive" on my laptop and "/storage/drive"
  on my phone — same folder, two names, not two copies.)

That's why the database **survives** when I delete the container: the container was only
borrowing a doorway; the real folder was never inside it.

### Reading a mount line: `SOURCE:TARGET`
- **TARGET** (right of `:`) = always a folder **inside the container**.
- **SOURCE** (left of `:`) = where the storage comes from. Two cases:
  - **A name, no slash** (`bookpark-data`) → a **named volume** = Docker-managed storage in its
    hidden area. NOT in my repo.
  - **A path with a slash** (`./nginx.conf`) → a **bind mount** = a real file/folder from my Mac.

### The two kinds of volume in my compose file
| Line | Type | Meaning |
|------|------|---------|
| `bookpark-data:/app/data` (server) | **named volume** | Docker's managed box, mounted at `/app/data`. Keeps my DB. |
| `./nginx.conf:/etc/.../default.conf:ro` (nginx) | **bind mount** | My real file, mounted read-only into nginx. |

### Global `volumes:` vs service `volumes:` — the connection
- **Top-level `volumes: bookpark-data:`** = *declares/creates* the box (in Docker's hidden storage).
- **`volumes:` under a service** = *plugs that box in* to that container.
- **Same name = same one box.** Declared once at the top, used below — exactly like a variable.
- **Rule (not just style):** use a named volume → I **must** declare it up top (or Compose errors).
  Use a path (bind mount) → I **must not** declare it. That's why nginx's mount never appears
  in the global list.

### "Docker's hidden storage" = ?
A private folder Docker keeps on my Mac's disk (~`/var/lib/docker/volumes/`), separate from my
repo. Each named volume is a real folder in there. Real storage, just in Docker's own area — not
meant to be browsed by hand.

---

## 5. docker-compose — running multiple containers together

Compose runs several containers as one stack and puts them on **one private network** where
they find each other **by service name**.

My setup = **two** containers:
- **`server`** — my Node app, **built** from my Dockerfile (`build: .`), listens on 3000 *inside*.
  Has **no `ports:`** on purpose → only reachable from inside the network, not from my Mac.
- **`nginx`** — a reverse proxy, **downloaded** ready-made (`image: nginx:stable`), listens on 80,
  publishes `8080:80` to my Mac.

Traffic flow:
```
My Mac :8080  →  nginx (:80)  →  server (:3000)  →  Node app
```
nginx reaches the app via `server:3000` — `server` is the **service name**, which resolves to
the app's container on the compose network.

### Build vs download an image
- **Build my own** from a Dockerfile → my `server` (`build: .`). I wrote that Dockerfile.
- **Download a ready-made one** from Docker Hub → `nginx` (`image: nginx:stable`). Its Dockerfile
  exists on the nginx team's side; I never see or need it. (Like compiling an app myself vs
  installing one from an app store.)

### "One image → many containers"
Image = blueprint, container = running copy. I could run 3 containers from one image
(`docker compose up --scale server=3`) and nginx would load-balance across them.

---

## 5b. What nginx (a reverse proxy) actually is

nginx is a **front door / receptionist** that sits in front of my app. All traffic hits nginx
first, and nginx forwards it to my app. Changing the port is just the visible side effect —
**not** the point.

Analogy: an **office building lobby**. Visitors don't walk straight into offices — they go to
the **front desk**, which checks them and directs them to the right office. The app (the
employees) doesn't need its own guard; the lobby handles it once, for everyone.

Why set it up now, if it "just forwards" today? Because the front desk is the **one place** to
add cross-cutting stuff later, without touching my app:
- **HTTPS/TLS** — certificates and `https://` handled here (the L4 step). App stays plain HTTP inside.
- **Security** — rate limiting, blocking bad requests, hiding the app from direct access.
- **Routing & load balancing** — send `/api` to one app, `/images` to another; or spread traffic across multiple copies.
- **Caching, compression, logging** — done once at the door.

**Why my app lost its `ports:` line:** to force everything through the front door. If the app
also published 3000, people could walk past the receptionist straight in. Removing its public
port means **the only way in is through nginx** — that's the security win.
- `curl localhost:8080` works (through nginx) ✅
- `curl localhost:3000` is refused (app no longer exposed directly) ✅ (this is the proof it works)

One line: **nginx isn't moving my app to a new port — it's putting a controlled front door in
front of it.** The port only changed because the front door is now the only public entrance.

---

## 5c. Stopping: Ctrl-C vs `docker compose down`

They do **two different things** — one *stops*, the other *removes*.

| Action | What it does | Analogy |
|--------|--------------|---------|
| **Ctrl-C** | **Stops** the running containers. They still exist (dormant), and the network stays. | Turn the appliances **off** |
| **`docker compose down`** | **Stops AND removes** the containers + the private network. Clean slate. | Turn them off **and put them away** |

Two reasons `down` matters:
1. **If I started with `docker compose up -d` (background), Ctrl-C does nothing** — no terminal
   attached to interrupt. `docker compose down` is the *only* way to stop it.
2. Even in the foreground, Ctrl-C leaves **stopped containers + the network lying around** —
   clutter, and possible leftover-state weirdness on the next `up`.

**Habit:** Ctrl-C to stop now → `docker compose down` to tidy up. (A foreground run can get
away with just Ctrl-C, but `down` is the clean version.)

**⚠️ My data is safe:** `docker compose down` does **NOT** delete the `bookpark-data` volume —
the database survives. Only `docker compose down -v` (with `-v`) wipes volumes. So never add
`-v` and the data always persists.

---

## 6. Reading my Dockerfile

```dockerfile
FROM node:22-slim         # base image: mini Debian + Node 22 (glibc so better-sqlite3 works)
WORKDIR /app              # work inside /app in the container
COPY package*.json ./     # copy manifests first...
RUN npm install --omit=dev  # ...install deps (cached unless package.json changes)
COPY . .                  # copy the rest of my source in
EXPOSE 3000               # document the port the app listens on
CMD ["node", "server.js"] # command that runs WHEN the container starts
```
Two phases: `RUN` = at **build time** (setup). `CMD` = at **start time** (launch the app; only one).

---

## 7. Commands cheat sheet

| Command | Plain English |
|---------|---------------|
| `docker compose up --build` | Rebuild images, then start all containers |
| `docker compose up -d` | Start in the background (detached) |
| `docker compose down` | Stop and remove the containers |
| `docker compose logs -f server` | Follow the server's logs live |
| `docker ps` / `docker ps -a` | List running / all containers |
| `docker images` | List local images |
| `docker exec -it <id> bash` | Open a shell **inside** a running container |
| `docker logs <id>` | See a container's output (main debugging tool) |
| `docker stop <id>` / `docker rm <id>` | Stop / delete a container |

Flags: `-it` = interactive terminal · `-d` = detached/background · `-p` = ports · `-t` = tag.

---

## 8. Debugging checklist

1. `docker ps -a` — is it running, or did it crash?
2. `docker logs <id>` (or `docker compose logs`) — read the error. ~90% of answers are here.
3. `docker exec -it <id> bash` — go inside; check files/env vars are what I expect.
4. Port already in use? Change the left number of `-p`.
5. Changed code but nothing updated? **Rebuild:** `docker compose up --build`.

---

## The 5 one-liners to remember

1. **Image = installed app (sits there). Container = the app running. Volume = a folder it saves into.**
2. **A container is a running program on my Mac (run by Docker), not a place or the cloud.**
3. **Container paths like `/app` live inside the container — a separate computer's drive — not my repo.**
4. **A mount is a doorway, not a copy: one folder, two names. Data lives in the volume; `/app/data` is just the door.**
5. **Global `volumes:` declares the box; a service's `volumes:` plugs it in. Name on the left = named volume (must declare); path on the left = bind mount (must not).**
