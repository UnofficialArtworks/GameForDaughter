# My Fuzzlet

A cozy browser pet game. Adopt one magical little creature, pet it, feed it, play with it, and slowly
discover *who it is*: its favourite snack, the toy it's obsessed with, the spot it loves being scratched,
and its personality. It remembers you, and it's always happy when you come back.

No accounts, no server, no ads, no purchases. Everything is saved in the browser on this device.

## Run it

```bash
npm install
npm run dev        # open the printed http://localhost:5173 URL
```

Production build (static files in `dist/`, can be hosted anywhere, including GitHub Pages):

```bash
npm run build
npm run preview    # serve the built files locally
```

Tests (save/load, memory & preference logic, needs, floppy-ear anchoring and layering):

```bash
npm test
```

Tip for testing day and night: add `?hour=13` or `?hour=22` to the URL.

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
- **Personality**: six continuous traits, rolled randomly for each pet. They affect speed, sleepiness, bravery around new
  things, how it returns the ball (or plays keep-away), cuddliness, pickiness, and how fast it learns tricks. The
  memory book reveals them gradually.
- **Memory**: hidden preferences for foods, toys and petting spots. They come out through play and get
  written into the memory book as discoveries. The pet visibly anticipates food it loves (or is suspicious of
  food it didn't like).
- **Friendship**: New Friend → Pal → Buddy → Best Buddy → Forever Friend. Levels unlock behaviour: garden access,
  new tricks, bringing toys, asking for belly rubs, a special greeting dance.
- **Care**: hand-feeding (8 foods), bowls, brushing (it gets extra floofy), a 4-stage bath (soap, rinse,
  *shake*, towel).
- **Tricks**: Sit, Spin, High Five, Roll Over, taught by asking and then rewarding good tries.
- **Garden**: butterflies, falling leaves, occasional rain with puddles and a rainbow, fireflies at night, and
  dig spots with 16 collectible treasures.
- **Shop** (one currency, *Twinkles*, earned by playing): foods, toys, 10 accessories, 25 room/garden decorations.
- **No punishment**: the pet can't get sick, run away, or die. Time away is capped and gentle, and it greets you
  with "YOU'RE BACK!" and sometimes a gift.
- **Accessibility**: reduced motion (also follows the OS setting), high contrast, bigger text, separate music and
  sound volumes, large touch targets, visible focus.

## Code map

```
src/
  main.ts            bootstrap
  game.ts            Game: loop, camera, render order, progression (friendship, rewards, discoveries)
  state.ts           save data model, personality/hidden-preference generation, needs decay, save/load/migrate
  memory.ts          pure preference & learning logic (tasting, petting spots, toys, tricks, journal)
  pet/render.ts      procedural pet renderer (pose parameters → layered vector drawing)
  pet/Pet.ts         pet entity: movement, pose/expression blending, gaze, blinking, springs, hit zones
  pet/brain.ts       moods, utility AI, behaviour chains (generators), anticipation, greetings, tricks
  pet/context.ts     short-term memory, habits, request pacing (pure logic)
  interact.ts        pointer input: stroke detection, taps, carrying
  closeup.ts         close-up stage: cuddle, hand-feeding, brush, bath, trick training
  toys.ts            ball / squeaky / wand / bubbles and the pet's play logic
  minigames.ts       Bubble Party, Treasure Sniff (the pet's hot/cold reactions are the clue)
  world/world.ts     room + garden art (cached), weather, butterflies, dig spots, points of interest
  art.ts             procedural icons (used on canvas and in the DOM)
  audio.ts           WebAudio synth: pet voice, foley, UI sounds, generative music
  fx.ts              pooled particles
  ui.ts, style.css   DOM UI: title/adoption, HUD, trays, memory book, shop, settings
tests/core.test.ts   save/load, needs, memory/preference tests
tests/ears.test.ts   floppy ears stay rooted on the skull and layer correctly in every view
```

All art and sound is generated in code. There are no image or audio assets.
