/**
 * Interaction sounds, synthesized by cuelume (no audio files, one shared AudioContext).
 *
 * cuelume's own `bind()` reads a `data-cuelume-*` attribute off each element. Every control here is
 * rendered from data — rows, chips, tabs and tree nodes all come out of `{#each}` — so tagging them
 * one by one would be a hundred edits that the next component still misses. Instead a handful of
 * delegated listeners are wired once over the shared classes the app already styles by, and the
 * sound is chosen imperatively.
 *
 * Ordered: the first entry an element sits inside decides its sound, so a `.lab-tab` (which is a
 * `<button>`) clacks as a switch rather than knocking as a plain button.
 */
import { play, setEnabled, setVolume } from 'cuelume';

// One act, one sound, drawn from four: `press` knocks, `toggle` clacks, `tick` marks, `scan` is the
// one three-note figure, kept for opening a menu. The rest of cuelume's palette stays unused — the
// bells and swells read as events in their own right, which wears out fast on a tool people click
// through for an hour.
// An absolute URL that is not ours — the wiki links, and anything else that hands the reader off to
// another site. `[href^="http"]` skips the app's own relative links; in a non-browser import the
// origin is blank, and `[href^=""]` matches nothing, so every http link reads as external there.
const ORIGIN = typeof location === 'undefined' ? '' : location.origin;
const EXTERNAL_LINK = `a[href^="http"]:not([href^="${ORIGIN}"])`;

const KINDS = [
  // an element that names its own sound, for the few that none of the shapes below reads right —
  // "show 30 more" lengthens the list it is already looking at rather than switching anything, so it
  // marks the step the way a slider does instead of knocking like a button
  ['[data-sound="tick"]', { down: 'tick' }],
  // a backdrop or anything else marked as closing something: still a click, so it knocks like one
  ['[data-dismiss]', { down: 'press' }],
  // leaving for another site is the one thing here that is not a move within the app, so it gets the
  // one warm sound — rare enough to stay special, per the four-sound rule above
  [EXTERNAL_LINK, { down: 'bloom' }],
  // switches, tabs, chips, checkboxes and column sorting — one clack per state change. Labels are
  // here too: a filter checkbox is pressed on its text as often as on its box, and both are one act.
  ['.lab-tab, .lab-chip, [aria-pressed], th.sortable, input[type="checkbox"], input[type="radio"], label:has(input[type="checkbox"]), label:has(input[type="radio"])', { down: 'toggle' }],
  // the buttons that bring up a panel — the options, the stage picker, the columns, each `i`
  ['[popovertarget]', { down: 'scan' }],
  // rows, tree nodes, buttons, selects, disclosure triangles — a single knock on the way down
  ['tr.row, .craft-box, button, [role="button"], a[href], select, summary', { down: 'press' }],
];

/**
 * Controls that report themselves instead of being pressed — a slider commits on release after the
 * drag, a text field on the blur after the typing, and neither has a press worth hearing.
 * Checkboxes are deliberately absent: they already clacked under the press.
 */
const CHANGED = [
  ['select', 'toggle'],
  ['input[type="number"], input:not([type]), input[type="text"], input[type="search"]', 'tick'],
];

/**
 * A slider ticks as it moves, not once when it is let go — `input` fires on every step it passes, so
 * the value is felt on the way rather than reported at the end. `MIN_GAP_MS` is what keeps a fast
 * drag across a hundred stages from becoming a drum roll.
 */
const DRAGGED = 'input[type="range"]';

/**
 * Popovers and `<details>` — the options, the stage picker, the column list, each `i`, the full
 * craft tree. Only closing speaks: opening was asked for by a control that has already sounded,
 * while a close often has no click of its own (Escape, a click outside, the panel behind it going).
 */
const CLOSE = 'tick';

/**
 * A close that follows a sound of its own is already accounted for: the Done button that dismissed
 * it, the backdrop, the second panel one gesture takes with it. Those arrive in separate tasks, so
 * only a short window tells them apart from a person closing two things one after another.
 */
const QUIET_AFTER_MS = 250;

/**
 * A floor under repeats of one sound. A burst of the same knock is what stacks voices — each with
 * its own nodes and its own deferred `setTimeout` teardown — onto an audio thread at the moment the
 * page can least spare it, and two of them inside one twitch are a single sound to the ear anyway.
 *
 * Only repeats: a different sound means something else happened. Picking from a dropdown lands its
 * `change` about 20 ms after the press that opened it, and a blanket floor swallowed the pick.
 */
const MIN_GAP_MS = 45;
let lastSound = null;
let lastSoundAt = -Infinity;

function emit(sound) {
  const now = performance.now();
  if (sound === lastSound && now - lastSoundAt < MIN_GAP_MS) return;
  lastSound = sound;
  lastSoundAt = now;
  play(sound);
}

/**
 * cuelume starts every layer at exactly `context.currentTime`, and a `press` envelope is only 21 ms
 * long end to end, so that leaves no room for the clock to be behind. In Firefox it is: `currentTime`
 * there advances in jumps — 8, 10.67, 18.67, 21.33 ms were all observed — so "now" can already be a
 * whole envelope stale, and the sound is over before the audio thread reaches it. The source still
 * runs, so the tab goes on showing the audio indicator while nothing is heard. Chrome's clock is
 * fine-grained, which is why the same build sounds fine there.
 *
 * Measured in Firefox with an analyser on the same envelope: scheduled at `currentTime` it was
 * silent in 4 of 5 tries, and 0 of 5 when scheduled 30 ms ahead. The library reads that clock in one
 * place and takes no option for it, so the context it builds lazily on the first play is given one
 * that reads a beat ahead. Set LOOKAHEAD_S to 0 to take it back out.
 *
 * This does not rescue a stalled main thread: with one blocked for 90 ms, Firefox dropped the sound
 * at every offset tried, 60 ms included. That one is the page's own work to fix, not the clock's.
 */
const LOOKAHEAD_S = 0.03;
function scheduleAhead() {
  const Native = window.AudioContext ?? window.webkitAudioContext;
  if (!Native || Native.__ahead) return;
  class Ahead extends Native {
    get currentTime() { return super.currentTime + LOOKAHEAD_S; }
  }
  Ahead.__ahead = true;
  window.AudioContext = Ahead;
}

/** The sounds of the control an event happened in, `{}` when it happened outside every control. */
function control(target) {
  if (!(target instanceof Element)) return {};
  for (const [sel, sounds] of KINDS) if (target.closest(sel)) return sounds;
  return {};
}

/**
 * Wires the listeners once. Nothing can fire at page load: cuelume's `play` no-ops until
 * `navigator.userActivation` says the page has been interacted with.
 */
export function startSound(volume = 0.55) {
  scheduleAhead(); // before anything can play: cuelume builds its context on the first sound
  setVolume(volume);
  const on = (event, pick) => document.addEventListener(event, (ev) => {
    const sound = pick(ev);
    if (sound) emit(sound);
  }, true);
  // Everything sounds on the way down. `click` only lands once the button has been released again,
  // which puts the sound a whole gesture behind the hand that made it — and `click` is also the
  // event the browser forwards from a label to its checkbox, so listening to it sounds twice.
  on('pointerdown', (ev) => control(ev.target).down);
  // The keyboard is asked directly rather than inferred from a click: only the focused element gets
  // a keydown, so there is nothing to forward and nothing to tell apart.
  on('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && !ev.repeat && control(ev.target).down);
  on('input', (ev) => ev.target instanceof Element && ev.target.matches(DRAGGED) && 'tick');
  on('change', (ev) => CHANGED.find(([sel]) => ev.target instanceof Element && ev.target.matches(sel))?.[1]);
  // `toggle` does not bubble, but a capture listener still sees it on the way down
  on('toggle', (ev) => (ev.newState ?? (ev.target.open ? 'open' : 'closed')) === 'closed'
    && performance.now() - lastSoundAt >= QUIET_AFTER_MS && CLOSE);
}

export { setEnabled };
