# Drum scrub control — implementation spec

Handoff note: this describes **behavior and mechanics only**. Apply the host app's own
type, color, radii, and spacing tokens. Every literal below that is a color or font is
marked `[app token]` and should be replaced, not copied.

## What it is

A single-parameter numeric control for touch. One parameter is "selected" at a time; the
drum adjusts that parameter. Instead of a slider (absolute position → value, capped by
how far a thumb can reach), the drum uses **relative dragging**: value changes by the
delta of horizontal movement, so the user can lift and re-grab to keep going in the same
direction indefinitely. A fixed centre mark shows "now"; a tick ruler slides beneath it.

Why relative: on a phone the entire usable range is ~340px of thumb travel. Absolute
sliders make fine values (e.g. Gamma 0.20–3.00 at 0.01 steps) impossible, and tapping the
track causes a jump. Relative dragging removes both problems.

## Anatomy

```
┌───────────────────────────────────────┐
│              GAMMA                    │  ← param name, small, uppercase, tracked
│              1.15                     │  ← value, large, tabular/mono, ~44px
│                                       │
│  drag anywhere · 34%                  │  ← hint + normalized position, small, dim
│  ┆┆┆┆|┆┆┆┆┆┆┆┆┆|┆┆┆┆┆|┆┆┆┆┆┆┆┆┆|┆┆┆┆ │  ← tick ruler, slides horizontally
│                  ▌                    │  ← centre mark, fixed, accent color
└───────────────────────────────────────┘
      ↑ the whole card is the drag surface
```

Container: full-width card in the bottom third of the screen, ~150px tall, app's card
radius, app's elevated-surface background. The **entire card** is the pointer target —
not just the ruler strip. This is the single most important detail: it gives a ~340×150px
hit area, so the gesture never misses.

Ruler strip: 56px tall, pinned to the bottom of the card, `overflow: hidden`.
- Minor ticks every 14.4px, 22px tall, ~50% opacity of the app's foreground color.
- Major ticks every 144px (every 10th minor), 34px tall, ~85% opacity.
- Both are bottom-aligned.
- Total ruler width 1440px, horizontally centred on the strip, translated by
  `translateX(-t * 720px)` where `t` is the normalized value 0→1. So t=0 shows the
  ruler's left half, t=1 its right half.
- 56px-wide left and right gradient masks fading to the card background, so ticks fade
  out at the edges rather than being clipped hard.

Centre mark: 3px wide, full height of the ruler strip, `left: 50%` with
`margin-left: -1.5px`, accent color `[app token]`, small radius.

Readouts: parameter name above the value, both centred, in the card's upper area. Keep
the value on a fixed baseline — it must not shift as digit count changes (use tabular
figures or a monospace face `[app token]`). The `drag anywhere · NN%` line is optional
but useful during onboarding; it sits just above the ruler strip, left-aligned, dim.

## Parameter selection

Above the drum, a vertical list of the available parameters, one row each:
`label` left, `current value` right, 36–44px tall rows, ~2px gaps. Selected row gets
the app's inverted/filled treatment; unselected rows are transparent with dim label
color. Tapping a row selects it; the drum immediately retargets to that parameter and
the ruler jumps to reflect the new value's normalized position.

Show 4–6 parameters max. If the app has more, scroll this list — never the drum.

## Parameter model

Each parameter is `{ key, label, min, max, step, decimals }`. Example set:

| key | label | min | max | step | decimals |
|---|---|---|---|---|---|
| gamma | Gamma | 0.2 | 3 | 0.01 | 2 |
| blur | Blur | 0 | 20 | 1 | 0 |
| grain | Grain | 0 | 100 | 1 | 0 |
| posterize | Posterize | 2 | 255 | 1 | 0 |
| white | White Point | 0 | 255 | 1 | 0 |

`decimals` controls display formatting only; `step` controls quantization.

## Gesture math

Sensitivity is expressed as **fraction of full range per pixel of travel**:

```
SENSITIVITY = 0.0022   // ≈ 455px of drag to cross the full range
```

That figure is deliberate: ~1.3 full-screen-width swipes covers min→max, which reads as
"weighted" rather than twitchy, and one 340px swipe covers ~75% of the range — enough to
reach any value in one or two motions.

Pointer handling:

```js
function onPointerDown(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
  let last = e.clientX;

  function onMove(ev) {
    ev.preventDefault();                 // listener must be { passive: false }
    const dx = ev.clientX - last;
    last = ev.clientX;

    const delta = dx * SENSITIVITY * (max - min);
    let next = value + delta;
    next = Math.round(next / step) * step;
    next = Math.min(max, Math.max(min, next));
    setValue(key, next);
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}
```

Requirements this encodes, all load-bearing:

1. **No value change on pointerdown.** Tap-without-drag is a no-op — the user can rest a
   thumb on the control to see the current value without altering it.
2. **`last` is updated every move event**, so the value tracks incremental delta, not
   distance from the origin. This is what makes lift-and-re-grab work.
3. **Listeners on `window`, not the element.** The finger will leave the card bounds
   mid-gesture; the drag must survive that.
4. **`touch-action: none`** on the card (and `overscroll-behavior: contain` on its
   scroll ancestor) so the browser does not steal the gesture for scroll/pull-to-refresh.
5. **Quantize before clamping**, in that order, so the endpoints are always exactly
   `min` and `max` rather than a stepped value near them.
6. **No pointer-move throttling / rAF batching of the value.** Latency is felt here.
   Batch the *render* if needed, never the state update.

Derived render values:

```js
const t = (value - min) / (max - min);       // 0..1
const rulerOffset = -t * 720;                // px, applied as translateX
const percent = Math.round(t * 100);
```

## Feedback

- **Haptics** (the thing that makes it feel like a drum): fire a light impact each time
  the value crosses a tick boundary — i.e. when `Math.round(t * 100)` changes, or every
  `step` for coarse params. Throttle to ~40ms minimum interval; iOS Safari needs
  `navigator.vibrate` fallback or a native bridge. Fire a distinct, slightly heavier
  impact once when the value hits `min` or `max`, and then suppress until it leaves the
  endpoint — otherwise the user gets a buzz-wall.
- **Rubber-band at the ends:** optional. If added, translate the ruler up to 12px past
  its limit while the finger continues, and spring back on release. The *value* stays
  clamped; only the ruler moves. Skip this if it complicates the render path.
- Do not animate the ruler offset with a CSS transition during drag — it must be
  1:1 with the finger. A transition is only acceptable on the jump that happens when the
  user switches parameters (150–200ms ease-out is right there).

## Secondary actions

Below the drum, a row of low-emphasis text buttons, 44px tall:
- **reset** — sets the selected parameter to its default (not `min`).
- **hold to compare** — while held, render the source unmodified; on release, return.
  Implement as pointerdown/pointerup on that button, not a toggle.

## Accessibility

The card carries `role="slider"` with `aria-valuemin` / `aria-valuemax` /
`aria-valuenow` / `aria-valuetext` (formatted with `decimals`) and
`aria-label="{parameter label}"`. Support Left/Right arrows for ±1 step and
PageUp/PageDown for ±10 steps when focused. `aria-valuetext` must be updated on every
commit, not just on release, or VoiceOver reads a stale value.

## Acceptance checks

- Tapping the card without moving does not change the value.
- Dragging past the card's edge continues to adjust; releasing anywhere ends cleanly.
- Lifting mid-drag and re-grabbing continues from the current value, no jump.
- Gamma can be set to exactly 1.00 and to exactly 0.20 and 3.00.
- The value's baseline does not shift between `0.20`, `1.15`, and `3.00`.
- The page never scrolls while dragging the drum.
- Switching parameters retargets the drum and moves the ruler within one frame budget.
