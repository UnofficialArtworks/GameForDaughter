# My Fuzzlet

A cozy browser pet game. Adopt a magical little creature (or up to three), pet it, feed it, play with it,
and slowly discover *who it is*: its favourite snack, the toy it's obsessed with, the spot it loves being
scratched, and its personality. It remembers you, and it's always happy when you come back.

No accounts, no server, no ads, no purchases. Everything is saved in the browser on this device.

## Run it

```bash
npm install
npm run dev        # open the printed http://localhost:5173 URL
```

Production build (static files in `dist/`, can be hosted anywhere):

```bash
npm run build
npm run preview    # serve the built files locally
```

**GitHub Pages:** `.github/workflows/pages.yml` tests, builds and publishes the game on every push to the default
branch. One-time setup: *Settings → Pages → Build and deployment → Source: **GitHub Actions***. Don't use
"Deploy from a branch": it publishes the unbuilt source code, which shows a blank page. The game is then at
`https://<user>.github.io/<repo>/`. To publish by hand: *Actions → Publish to GitHub Pages → Run workflow*.

Tests (save/load & migration to several pets, memory & preference logic, needs, walks, floppy ears):

```bash
npm test
```

Tip for testing day and night: add `?hour=13` or `?hour=22` to the URL. Add `?debug=1` for the diagnostics overlay
(see *Diagnostics* below).

## How to play

| Do this | What happens |
| --- | --- |
| **Stroke** the pet with a finger or the mouse | Petting. It leans in, closes its eyes, purrs. It has favourite spots! |
| **Tap** the pet | Opens the close-up (Cuddle / Feed / Brush / Bath / Tricks). Tap the nose for a *boop*. |
| **Press and hold** the pet, then drag | Pick it up and carry it around. |
| **Tap the floor** | Calls your pet over. In the garden, tap a sparkly dirt mound to dig. |
| Tap the **bowls** | Fill the food bowl / refresh the water. Tap the doorway to go to the garden. |
| **Play** menu | Ball, Squeaky Donut, Feather Wand, Bubble Wand, Bubble Party, Treasure Sniff |
| Flick the ball | Throw it. Tapping anywhere also throws it there, and the **Throw!** button works too. |
| **Treasure Sniff** (garden) | Tap the grass to send your pet sniffing. The closer it gets, the more excited it is (shrug → wag → bouncing and pawing). Follow its nose, tap the wiggly spot, and it digs up a treasure. |

Every drag interaction has a button alternative: spot buttons for petting, a **Give it!** button for
feeding, **Brush / Scrub / Rinse / Dry** buttons, and **Throw! / Wiggle! / Blow!** for toys. Menus work with the
keyboard (Tab / Enter / Esc).

## What's in it

- **Pet brain**: needs (hunger, energy, cleanliness, fun, affection) feed a mood (content, playful, sleepy,
  hungry, curious, affectionate, excited, bored, grumpy, mischievous). A utility-weighted chooser picks from about 35
  autonomous behaviours: napping in bed or a sunbeam, watching birds out of the window, sniffing, drinking,
  zoomies, tail-chasing, grooming, rolling on the rug, bringing you toys, asking for food, play, cuddles or a trip
  outside, performing tricks it has learned, and rare surprises (sneezes, hiccups, dozing off, hearing
  something behind it, singing, a butterfly landing on its nose, a leaf falling on its head, pouncing on your finger).
- **Context, anticipation & habits**: the brain's choices read what just happened (a few minutes of short-term
  memory: just ate, just played fetch four times, just had a bath, just woke up…), so the pet hiccups after gobbling,
  flops panting after a big fetch session, gets post-bath zoomies and stays extra poofy, and doesn't ask to play
  right after playing. Most behaviours are short chains that start with a look (eyes → head → body) before moving.
  It reacts to what's *about* to happen: opening the food/toy/care tray, picking up the ball, the brush or the bath
  appearing, trick time. Six slow habits (fetch, bedtime cuddles, garden trips, brushing, tricks, baths) form from
  repetition, fade gently over days, and are announced in the journal when they appear. Requests are paced, expire
  on their own and never cost anything when ignored. Friendship changes behaviour (eye contact, closeness, greetings,
  bringing toys, napping near you); greetings differ by personality and time away.
- **Walkies**: once you're Pals, take your pet out through the garden gate (or Play → Walkies) for a 3–5 minute
  stroll through one hand-drawn park path. There are 5–6 stops and one fork where you pick a path (Flower Path, Pond Path,
  Shady Woods, Sunny Meadow), and your pet leans toward the one it likes. At each stop the pet notices something first
  and reacts in its own way: flowers, puddles, leaf piles, butterflies (fireflies at night), bushes, the bench, a
  mystery sound, a digging spot, a stick, a picnic. A cautious pet tests the puddle with a paw; an energetic one
  cannonballs in; a picky one tiptoes round. Tap things to point them out; pet them when you pause. Walks collect
  a little story for the Memory Book, occasional keepsakes (their own page in Treasures), muddy paws, and maybe a
  stick. Favourite walk spots and a "walkies" habit (waiting by the gate) emerge over many walks.
- **Personality**: six continuous traits, rolled randomly for each pet. They affect speed, sleepiness, bravery around new
  things, how it returns the ball (or plays keep-away), cuddliness, pickiness, and how fast it learns tricks. The
  memory book reveals them gradually.
- **Memory**: hidden preferences for foods, toys and petting spots. They come out through play and get
  written into the memory book as discoveries. The pet visibly anticipates food it loves (or is suspicious of
  food it didn't like).
- **Friendship**: New Friend → Pal → Buddy → Best Buddy → Forever Friend. Levels unlock behaviour: garden access,
  new tricks, bringing toys, asking for belly rubs, a special greeting dance.
- **Care**: hand-feeding (8 foods), bowls, brushing (it gets extra floofy), a 4-stage bath (soap, rinse,
  *shake*, towel). After a bath the fur is wild and ruffled; brushing smooths it down tuft by tuft
  (Very poofy → Smoother → Groomed!) until it's sleek and shiny, and the pet admires its fur and does a happy hop.
  (A playtester's idea.) Left alone, the post-bath poof settles by itself after a few minutes.
- **Tricks**: Sit, Spin, High Five, Roll Over, taught by asking and then rewarding good tries.
- **Garden**: butterflies, falling leaves, occasional rain with puddles and a rainbow, fireflies at night, and
  dig spots with 16 collectible treasures.
- **Shop** (one currency, *Twinkles*, earned by playing): foods, toys, 10 accessories, 25 room/garden decorations.
- **No punishment**: the pet can't get sick, run away, or die. Time away is capped and gentle, and it greets you
  with "YOU'RE BACK!" and sometimes a gift.
- **Up to three Fuzzlets**: the title screen shows each pet with a Play button. **New Fuzzlet** asks first
  ("Adopt another Fuzzlet? … Biscuit will stay safe.") and never replaces anyone; when the home is full there is
  no way to adopt a fourth. Switch pets from Settings → *Switch Fuzzlet* (no reload). Each pet keeps its own
  memories, friendship, Twinkles, room, habits, walks, keepsakes and achievements; volume and accessibility
  settings are shared. Removing a pet is only in the title screen's quiet *Pet options*, with the pet's name and
  face, plain words ("This will permanently remove Biscuit and all of Biscuit's memories") and a button that has to be
  **held for 2 seconds**.
- **Accessibility**: reduced motion (also follows the OS setting), high contrast, bigger text, separate music and
  sound volumes, large touch targets, visible focus.

## Saves

All pets live in one versioned container in `localStorage` (`fuzzlet.save.v2`: `{ version, activePetId, order, pets,
settings }`). A save from the single-pet version (`fuzzlet.save`) is migrated automatically into slot 1 the first time
the new version runs, exactly as it was, and the old key is left untouched as a backup. Every write is a
read-modify-write of the pet being played, so a save can never undo a pet adopted or removed elsewhere (for example the
game open in a second tab). A container that can't be read is copied aside, never overwritten.

## Input safety & diagnostics

Touch handling is built so that input can't get stuck (a real iPad playtest once ended with the pet "held" forever):

- every pointer is tracked from press to release; releases are heard even if pointer capture is lost; a system
  `pointercancel` never counts as a tap;
- one gesture on the pet at a time: a second finger never takes over, or orphans, a carry;
- when the app is hidden (home button, app switcher), loses focus, or changes scene (walks, close-ups, games, switching
  pets), every gesture in progress ends cleanly: a carried pet is put down;
- Walkies' Home button works in every phase; an error inside a walk brings the pet home instead of freezing the park;
  errors in one system (or one frame) are logged and never stop the game loop; audio can never throw;
- safety nets (a carried pet with no finger on it, a pointer silent for too long, a walk that stops making progress,
  a leftover or empty overlay) repair the state and record what happened.

**Diagnostics**: `?debug=1` (or, in a home-screen app with no URL bar, tap the version line at the bottom of Settings
five times) shows a small overlay with the live interaction state: mode, open dialogs, pointers, the current gesture,
the pet's action, the Walkies phase, errors and safety-net events. The last report is kept on the device and shown in
Settings while diagnostics are on. From the console: `fuzzlet.diag.snapshot()` / `fuzzlet.diag.report()`.

## Code map

```
src/
  main.ts            bootstrap
  game.ts            Game: loop, camera, render order, progression (friendship, rewards, discoveries)
  state.ts           save data model, personality/hidden-preference generation, needs decay, save/load/migrate,
                     the multi-pet store (add / remove / switch, read-modify-write) and the hold-to-confirm rule
  diag.ts            interaction-state diagnostics (event ring buffer, snapshot, overlay, saved report)
  memory.ts          pure preference & learning logic (tasting, petting spots, toys, tricks, journal)
  pet/render.ts      procedural pet renderer (pose parameters → layered vector drawing)
  pet/Pet.ts         pet entity: movement, pose/expression blending, gaze, blinking, springs, hit zones
  pet/brain.ts       moods, utility AI, behaviour chains (generators), anticipation, greetings, tricks
  pet/context.ts     short-term memory, habits, request pacing (pure logic)
  walk.ts            Walkies: park scene, walk flow, stop events, homecoming
  walkmem.ts         walk memory: route planning, favourite walk spot (pure logic)
  interact.ts        pointer input: gesture lifecycle & safety nets, stroke detection, taps, carrying
  closeup.ts         close-up stage: cuddle, hand-feeding, brush, bath, trick training
  toys.ts            ball / squeaky / wand / bubbles and the pet's play logic
  minigames.ts       Bubble Party, Treasure Sniff (the pet's hot/cold reactions are the clue)
  world/world.ts     room + garden art (cached), weather, butterflies, dig spots, points of interest
  art.ts             procedural icons (used on canvas and in the DOM)
  audio.ts           WebAudio synth: pet voice, foley, UI sounds, generative music
  fx.ts              pooled particles
  ui.ts, style.css   DOM UI: title/adoption, HUD, trays, memory book, shop, settings
tests/core.test.ts   save/load, needs, memory/preference tests
tests/pets.test.ts   old save → multi-pet migration, adding/switching/removing pets, the 3-pet limit, settings,
                     saving from two tabs, hold-to-confirm
tests/ears.test.ts   floppy ears stay rooted on the skull and layer correctly in every view
```

All art and sound is generated in code. There are no image or audio assets.
