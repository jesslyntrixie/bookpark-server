# BookPark Smart Parking — Deployment & Hosting Learning Plan (v1)

*Companion to `BookPark_Backend_Handbook.md`. The handbook covers **building** the server (cards B1–B6: get Node talking to the flap over MQTT). It deliberately said "Skip: hosting." This document is that skipped phase — **how the finished server gets to run somewhere real** — turned into a learning ladder.*

> **Read this after** your server works locally (handbook B1–B5 basically done: it connects to HiveMQ, publishes "drop", subscribes to status). This is phase 2: **deployment + backend infrastructure**, structured so you learn Docker, nginx, and tunnels properly instead of just copy-pasting.

---

## Part 0 — Where this fits in one paragraph

Your handbook got the server **working**. This plan gets it **hosted** — running 24/7 somewhere the app can reach it. Along the way you'll learn the core backend-infrastructure skills (containers, reverse proxies, tunnels, TLS) because your mentor's idea — **run it on a loaner MacBook as a server** — makes every one of those concepts *real* instead of theoretical.

```
   [ App ] ⇄ HTTPS ⇄  [ tunnel ] ⇄ [ nginx ] ⇄ [ Docker: your Node server ] ⇄ MQTT ⇄ [ Flap ]
                                    ^^^^^ all of this runs on the always-on loaner Mac ^^^^^
```

---

## Part 1 — The one idea everything hangs on

**Serverless vs. persistent process.** This single distinction explains every hosting decision below.

| | Serverless (e.g. Vercel) | Persistent process (Render / Railway / a laptop) |
|---|---|---|
| When your code runs | Only *during* an HTTP request, then it's destroyed | Continuously — it stays alive between requests |
| Good for | **Pull:** client asks, server answers | **Push:** server holds an open connection and catches incoming messages |
| Your `flap` in-memory state | Wiped after every request | Stays alive |
| Your MQTT connection | Nothing to push to between requests | Connection stays open, always listening |
| Works for BookPark? | ❌ No | ✅ Yes |

**Why BookPark *must* be a persistent process:** MQTT is **push**. The flap device shoves a status message at your server on a connection that has to already be open. There's no HTTP request to "wake up" a serverless function, so a serverless host has nothing to receive it. Your server has to be a process that stays awake holding that connection open. That's the whole reason we're not using Vercel — it's not "harder," it's structurally incompatible.

> Keep this handy: **HTTP = pull (refactors to serverless fine). MQTT = push (needs a persistent process).** Your app is both, so the MQTT half decides it: persistent.

---

## Part 2 — The hosting options (and the honest trade-offs)

| Option | Cost | Always on? | Setup | Best for |
|---|---|---|---|---|
| **Render (free tier)** | $0 | ❌ Sleeps after ~15 min idle | Easiest — deploys from GitHub | A reliable **demo fallback** |
| **Railway / Fly.io** | ~few $/mo | ✅ Yes | Easy | Real production if this graduates |
| **Loaner MacBook as a server** | $0 (hardware you're lent) | ✅ Yes (if you keep it awake) | Most work — you're the sysadmin | **Learning** — the richest path |

### The "15-minute sleep" explained (Render)
Render's free tier gives a *real* persistent process (good — MQTT works). But to save money it **sleeps the process after ~15 minutes with zero HTTP traffic.** Sleeping = process stopped = MQTT connection closed = messages missed while asleep. Any HTTP request wakes it (~30–60s boot). The 15-min timer **resets on every request**, so during a demo you're poking it constantly and it never sleeps. It only sleeps when left completely alone. Fine for demo-on-demand; not fine for true always-on.

###             Why the laptop-as-server is the best *learning* choice
A laptop you leave on is a **genuine always-on machine** — it kills the sleep problem entirely, gives the `flap` memory and MQTT connection a permanent home, and (crucially) makes **nginx and Docker actually necessary**, because nothing wraps your app for you the way Render does. You build that layer yourself → you learn it for real.

### Recommendation: **do both**
- **Render free** = your always-works safety net for demos (a wifi hiccup never ruins a presentation).
- **Loaner Mac** = your learning playground where you build the "real production" version with Docker + nginx + a tunnel.

Portfolio payoff: *"Here's my PoC on Render, and here's the same app self-hosted on a machine I run, with nginx and Docker."* Far stronger than either alone.

---

## Part 3 — The three tools, in *this* project's context

They're not rivals — they do different jobs. **ngrok exposes, nginx fronts, Docker packages.**

- **Docker — packages your app.** Bundles Node + your code + dependencies into one **image** that runs identically on any machine. Solves "works on my laptop, breaks on the server." Also gives auto-restart (`restart: always`) so a crash or reboot self-heals. *This is the tool that makes moving from your Mac to the loaner Mac trivial — same image, just run it.*
- **nginx — sits in front of your app.** A reverse proxy: terminates HTTPS/TLS, forwards plain HTTP to your Node app, can route and rate-limit. Pointless on Render (Render *is* your nginx). Essential on the laptop, where nothing else plays front door.
- **Tunnel (Cloudflare Tunnel or ngrok) — exposes your app to the internet.** Your laptop sits behind a home/campus router with no public address. A tunnel agent dials *out* and lets traffic back in — no router config, no open inbound ports. **Cloudflare Tunnel** = permanent, free HTTPS, works on any network (dorm/campus included). **ngrok** = simplest, but free URLs are temporary — great for a 30-second test, weak as a permanent home.

Full picture once assembled:
```
Phone/app ──https──► Cloudflare Tunnel ──► nginx ──http──► Docker(server.js) ──mqtts──► HiveMQ broker ◄──► flap device
                                          └──────── the always-on loaner Mac ────────┘
```

---

## Part 4 — The learning ladder (do these IN ORDER, one concept each)

Don't build the whole diagram at once — that's how people drown. Each rung works on its own, is independently demoable, and you never lose progress. **Start now, on this MacBook** (macOS is Unix like the server will be — ideal).

**L0 — Make the app deploy-ready** ✅ *(already done — verified)*
- ✅ Port read from environment: `server.js` already has `const WEB_PORT = process.env.PORT || 3000;`
- ✅ Secrets in `.env`, not hardcoded: `server.js` already does `import "dotenv/config"` and reads `process.env.MQTT_HOST` / `MQTT_USERNAME` / `MQTT_PASSWORD`.
- ✅ `.env` is in `.gitignore`, so secrets won't hit GitHub.
- One thing to double-check yourself: `publish-test.js` still has the broker password hardcoded — worth moving it to `.env` too for consistency (it's a test file, low risk, but good hygiene).
→ *Done when:* all green above. You're here already — move to L2 (Docker).

**L1 — Run it raw** *(baseline)*
- `npm start`, hit `http://localhost:3000/status` in the browser, POST to `/open`, watch the MQTT logs.
→ *Done when:* you can see the HTTP→MQTT flow work locally. *(Basically already done.)*

**L2 — Dockerize it** ⭐ *(the key learning rung)*
- Write a small `Dockerfile`, build an image, run the container, hit the *same* localhost URL — now running inside a container.
→ *Done when:* your app boots inside Docker and `/status` still answers. **This rung is what makes the loaner transfer painless.**

**L3 — Put nginx in front**
- Use `docker-compose` with two containers (your app + nginx). Hit nginx; watch it forward to your app.
→ *Done when:* requests go through nginx → your app, and you understand reverse proxying.

**L4 — Expose to the internet**
- Add **Cloudflare Tunnel** (or ngrok for a quick test) so your phone can reach it over real HTTPS.
→ *Done when:* you hit your server from your phone over `https://` from outside your network.

**L5 — Move to the loaner Mac + make it a true server**
- Install Docker on the loaner, run your image + compose, disable sleep (`caffeinate` / Energy Settings), set it to auto-start.
→ *Done when:* the app runs 24/7 on the loaner, survives a reboot, and never sleeps. Because of L2–L4 this is mostly copy-and-run.

---

## Part 5 — The dev-now → loaner-later flow (your mentor's plan)

Your mentor said: **code it on your machine first, then try it on the loaner MacBook.** That's a standard professional workflow (develop locally → deploy to the server), and it's the *perfect* motivation to learn Docker:

- You build the Docker **image** here on your Mac (L2).
- Moving to the loaner (L5) becomes: install Docker → run the same image → done. No re-setup, no "it worked on my machine" surprises, because the image *is* your machine, boxed up.
- Mac → Mac makes it even smoother (same OS, same commands, same Docker).

So the ordering is: **L0–L4 here, now. L5 when you get the loaner.** Nothing about L5 changes the code — it's the same image on different hardware.

---

## Part 6 — Which exposure method (decide at L4, not before)
Everything up to L3 is pure `localhost` — no router, no internet, no decision needed. At **L4**:

- **Shared / campus / dorm wifi, or no router access** → **Cloudflare Tunnel** (works anywhere, opens no inbound ports, free HTTPS). Recommended default.
- **Your own home router** → Cloudflare Tunnel still works and is safer; *or*, if you want the deep-networking exercise, **port-forward + dynamic DNS** as a "hard mode" second lesson.
- **Just testing quickly** → **ngrok** for 30 seconds, then tear it down.

---

## Part 7 — Security notes (because you'll be exposing a real machine)
- Keep secrets in `.env` / env vars — never commit them (done via `.gitignore`).
- Prefer **Cloudflare Tunnel** over port-forwarding: it opens **no inbound ports** on your network, so your home/loaner machine isn't directly exposed.
- Keep the OS and Docker images updated.
- Don't expose ports you don't need — only the one your app serves on.

---

## Part 8 — Definition of done (this phase's checklist)
- [x] L0 — app reads `PORT` from env; secrets in `.env`, not in `server.js` ✅ done
- [ ] L1 — runs raw locally, HTTP→MQTT flow confirmed
- [ ] L2 — runs inside a Docker container ⭐
- [ ] L3 — nginx reverse-proxies to the app (via docker-compose)
- [ ] L4 — reachable from the internet over HTTPS (Cloudflare Tunnel)
- [ ] L5 — running 24/7 on the loaner Mac, survives reboot, never sleeps
- [ ] (Parallel) Render free tier deployed as a demo fallback

---

## Part 9 — Quick reference (say these in an interview)
- *"MQTT is push, so my server has to be a persistent process, not serverless — a serverless function has nothing to receive a pushed message between requests."*
- *"The free tier sleeps after inactivity and can miss messages while idle; for production I'd use an always-on host, or MQTT persistent sessions with QoS 1 so the broker queues and redelivers on reconnect."*
- *"I didn't need nginx on the PaaS because it handles TLS and routing; on my self-hosted box I put nginx in front to terminate HTTPS and reverse-proxy to Node."*
- *"Docker gave me reproducible builds — the image I built on my laptop runs identically on the server."*
- *"I used Cloudflare Tunnel instead of port-forwarding so I didn't expose any inbound ports on my network."*

---

*Rule of thumb learned here: **match the host to the shape of the workload.** Stateless request/response → serverless. Long-lived connection or in-memory state → persistent process. Need it never to sleep → always-on (paid host, or your own always-on machine).*
