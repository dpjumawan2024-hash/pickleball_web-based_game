# Court Clash Pickleball

## Project overview

Court Clash Pickleball is a browser-based pickleball game. Players can practice or play against computer-controlled opponents, or play online with other people in private or public rooms. The game is designed for desktop and touch devices, with keyboard, mouse, and mobile controls.

The project is a prototype focused on playing a match, learning the rules, and connecting players without requiring accounts. Online rooms and match data exist only while the server is running; the game does not save accounts, rankings, or match history.

## Main features

- **Play against AI:** Choose singles (1v1) or doubles (2v2), and select an easy, medium, or hard opponent.
- **Practice and rules:** Use the practice guide to learn the controls, and read the in-game pickleball rules.
- **Online multiplayer:** Create or join public and private rooms for 1v1 or 2v2 matches. Private rooms use a six-character code and host approval; public rooms can be found in the room browser.
- **Match options:** Hosts choose rally scoring or official side-out scoring. Matches are first to 11 points and must be won by 2.
- **Character choices:** Choose a character before a match. Characters have different movement speed and reach.
- **Special shots:** Use Power Drive, Drop Shot, and Topspin Curve for tactical variety. Each has its own rules and cooldown.
- **Desktop and mobile controls:** Play with keyboard and mouse or touch controls. The interface supports portrait and landscape layouts and can request landscape mode on touch devices.
- **Settings and feedback:** Adjust sound, player name, handedness, haptic feedback, and graphics quality. Pause, resume, or leave a game.
- **Server-controlled online matches:** The server manages online movement, ball simulation, scoring, room admission, and pause state.

## How the project works

1. **The browser displays and runs the game.** `public/index.html` defines the menus, game canvas, and controls. `public/css/styles.css` handles layout and appearance. `public/js/game.js` draws the game, reads player input, runs local AI matches, and saves preferences in the browser.
2. **Online play uses a second client script.** `public/js/online.js` connects the browser to the game server using a WebSocket. It sends actions such as creating or joining a room and receives room and match updates.
3. **Node.js runs the server.** `server.js` serves the files in `public/` and handles online rooms and matches. For online games, it checks player actions and broadcasts the current match state to connected players.
4. **JSON carries data between parts.** The browser and server encode online messages as JSON so they can exchange information such as room choices, player actions, scores, and match updates. Browser settings are also stored as JSON in local storage.
5. **The project uses npm to manage its server dependency.** `package.json` lists the `ws` WebSocket library and defines the `npm start` command. `package-lock.json` records the installed dependency version.

### Software and technologies

- **HTML, CSS, and JavaScript:** Build the browser interface, visuals, controls, and game logic.
- **Node.js 20 or newer:** Runs the server-side JavaScript for hosting the game and online matches.
- **npm:** Installs the server dependency and starts the server.
- **`ws`:** Adds WebSocket support for live communication between players and the server.
- **A modern web browser:** Runs the game. Local AI play can be opened directly in a browser; online play requires the Node.js server.

## Project layout

```text
Pickle ball/
├── public/
│   ├── assets/fonts/     # Game font and its license
│   ├── css/              # Browser styles
│   ├── js/               # Browser game and online client
│   └── index.html        # Browser entry page
├── server.js             # Node.js HTTP and WebSocket server
├── package.json          # Project scripts and dependencies
└── package-lock.json     # Locked dependency versions
```

On touch devices, the game requests landscape orientation when play is started. Browsers that allow orientation locking enter fullscreen and rotate automatically; if the browser blocks it, the game asks the player to turn the device sideways. Both portrait and landscape layouts are supported. Desktop skill buttons show whether each skill is ready, cooling down, or (for Drop Shot) waiting for a rally.

## Trick strikes

Desktop players can click a strike button or press **Q** (Power Drive), **E** (Drop Shot), or **R** (Topspin Curve) to swing. On mobile, tap a strike button above HIT to use that strike directly; you do not need to press HIT as well. Aim with the movement stick, swipe on the court, or drag the HIT button to choose the shot direction; a short HIT tap uses the stick aim (or the default direction when centered). If the ball is not yet in legal hitting range, the strike waits up to four seconds for a valid hit. The regular HIT/Space control remains available. Buttons show remaining cooldowns.

- **Power Drive:** faster shot with reduced accuracy; 8-second cooldown.
- **Drop Shot:** slower shot aimed into the opponent's kitchen; unavailable on serves; 10-second cooldown.
- **Topspin Curve:** bends the ball toward the selected aim direction while compensating its flight path to keep the landing near the aim point; 8-second cooldown.

## Tips for beating the AI

The AI moves toward the ball's expected landing point, so avoid sending every shot to the same place. Aim toward the sidelines to make it cover more ground, then change direction or use a short shot into the kitchen when it is deep. Mix deep drives with softer dinks rather than relying on Power Drive alone; drives are faster but less accurate. Topspin Curve can help vary the ball's path. Keep shots inside the court, and remember that the serve and return must bounce before you can volley.

- **Easy:** Learn the controls and focus on returning the ball. Move toward where it is going to land, and try aiming away from the AI instead of hitting straight back.
- **Medium:** Expect the AI to move and recover more capably than on Easy. Vary shot direction and depth to pull it out of position, then aim for the open side. In 2v2, use the whole court and let your teammate help cover returns.
- **Hard:** The AI reacts quickly and covers more ground, so a single obvious shot may not be enough. Change direction, mix dinks with deep shots, and use your special shots when they create an opening. Be patient: keep the rally going and take points when the AI makes a mistake.

For a faster player, choose Zippy; for more hitting reach, choose Bruno. In 2v2, control your player while your teammate automatically helps cover the court. Matches use rally scoring by default, so every rally won earns your side a point.

Pause with the on-screen pause button or **Esc** / **P**. The pause menu offers Continue and Quit Game. In online matches, pausing stops the match for both players; either player can continue, while quitting forfeits the match.

Online rooms let each player choose a character before creating or joining a room. Characters keep their speed and reach attributes in online matches. Hosts choose 1v1 or 2v2, rally or official side-out scoring, and public or private visibility. Public waiting rooms appear in the room browser and admit players immediately; private rooms require a code and host approval. Public rooms start when full. A private 2v2 host can start the match only after all four seats are filled. In 2v2, players are assigned to teams in arrival order. Online movement, shots, scoring, cooldowns, room admission, and pause state are controlled by the server.

## Run locally

1. Install Node.js 20 or newer.
2. Open a terminal in the project folder (the folder containing `package.json`).
3. Run `npm install` once.
4. Run `npm start`.
5. Open `http://localhost:3000` in two to four browser windows or devices on the same network.
6. Choose **Play online**, select a character, and connect. Create a room after choosing its game type, scoring, and visibility. Join a private room with its six-character code and wait for the host to accept; public rooms can be joined from the room browser. Private 2v2 matches start when the host starts a full four-player room, and public rooms start when full.

Opening `public/index.html` directly with `file://` still supports local AI play, but online mode needs the server. It will try `ws://localhost:3000/online` when opened as a file.

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


