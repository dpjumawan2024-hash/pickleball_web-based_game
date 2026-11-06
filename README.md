# Court Clash Pickleball

A browser pickleball game with local AI play and room-based online 1v1 and 2v2 play. Online rooms live only in server memory; there are no accounts, rankings, or saved match records.

On touch devices, the game requests landscape orientation when play is started. Browsers that allow orientation locking enter fullscreen and rotate automatically; if the browser blocks it, the game asks the player to turn the device sideways. Both portrait and landscape layouts are supported. Desktop skill buttons show whether each skill is ready, cooling down, or (for Drop Shot) waiting for a rally.

## Trick strikes

Desktop players can click a strike button or press **Q** (Power Drive), **E** (Drop Shot), or **R** (Topspin Curve) to swing. On mobile, tap a strike button above HIT to use that strike directly; you do not need to press HIT as well. Aim with the movement stick, swipe on the court, or drag the HIT button to choose the shot direction; a short HIT tap uses the stick aim (or the default direction when centered). If the ball is not yet in legal hitting range, the strike waits up to four seconds for a valid hit. The regular HIT/Space control remains available. Buttons show remaining cooldowns.

- **Power Drive:** faster shot with reduced accuracy; 8-second cooldown.
- **Drop Shot:** slower shot aimed into the opponent's kitchen; unavailable on serves; 10-second cooldown.
- **Topspin Curve:** bends the ball toward the selected aim direction while compensating its flight path to keep the landing near the aim point; 8-second cooldown.

Pause with the on-screen pause button or **Esc** / **P**. The pause menu offers Continue and Quit Game. In online matches, pausing stops the match for both players; either player can continue, while quitting forfeits the match.

Online rooms let each player choose a character before creating or joining a room. Characters keep their speed and reach attributes in online matches. Hosts choose 1v1 or 2v2, rally or official side-out scoring, and public or private visibility. Public waiting rooms appear in the room browser and admit players immediately; private rooms require a code and host approval. Public rooms start when full. A private 2v2 host can start the match only after all four seats are filled. In 2v2, players are assigned to teams in arrival order. Online movement, shots, scoring, cooldowns, room admission, and pause state are controlled by the server.

## Run locally

1. Install Node.js 20 or newer.
2. Open a terminal in this folder.
3. Run `npm install` once.
4. Run `npm start`.
5. Open `http://localhost:3000` in two to four browser windows or devices on the same network.
6. Choose **Play online**, select a character, and connect. Create a room after choosing its game type, scoring, and visibility. Join a private room with its six-character code and wait for the host to accept; public rooms can be joined from the room browser. Private 2v2 matches start when the host starts a full four-player room, and public rooms start when full.

Opening `index.html` directly with `file://` still supports local AI play, but online mode needs the server. It will try `ws://localhost:3000/online` when opened as a file.

## Deploy a free prototype on Render

Free plan details can change. Confirm that a free Web Service is available for your account before deploying.

1. Put this folder in a GitHub repository. If the repository contains other folders, set Render's **Root Directory** to `Pickle ball`.
2. In Render, create a **Web Service** and connect the repository.
3. Set **Runtime** to Node, **Build Command** to `npm install`, and **Start Command** to `npm start`.
4. Choose the free instance type if it is offered, then deploy. The server reads Render's `PORT` environment variable and binds to `0.0.0.0`.
5. Open the HTTPS service URL on two devices. The game automatically uses a secure WebSocket (`wss://`) on the same host.

Do not deploy the site as a static site: the WebSocket server must keep running. Free services can sleep when idle, which delays the first connection, and restarts end active matches. This prototype does not persist room or player data.

## Online prototype scope

- Six-character room codes, a public room browser, host approval for private room requests, and a five-minute timeout for waiting rooms.
- 1v1 and 2v2 room play with rally or official side-out scoring (first to 11, win by 2).
- Server-owned movement, ball simulation, bounce/fault checks, team scoring, and room admission.
- A disconnect during a match ends the match for the remaining player or team.
- Basic reach validation, input bounds, payload limits, and per-connection message/code-attempt limits.

This is an early prototype, not a production anti-cheat or account system. Test both browsers together on the deployed HTTPS URL. Local file mode cannot test a match unless a Node server is running on that same computer.
