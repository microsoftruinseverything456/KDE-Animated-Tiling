<img width="426" height="240" alt="untitled" src="https://github.com/user-attachments/assets/c75f9b11-2cc0-43cd-a9c4-a187f98041f3" />

# Animated Tiling

A KWin effect for KDE Plasma 6: windows slide and stretch to their new place
instead of jumping there, whenever they are moved or resized in one step
(Meta+arrows, the tile editor, a tiling script, a window rule). Dragging with
the mouse is left alone.

A port of [HyprKwin](https://github.com/DGBooth/HyprKwin/) focused purely on
its tiling animations, with improvements: smooth quick key presses, edges
that slide open, fractional display scaling, and better maximizing.

## Install

Plasma 6.6 or 6.8, on Wayland.

```bash
bash tools/install.sh      # install or upgrade
bash tools/uninstall.sh    # remove
```

After the first install, log out and back in once (KWin finds new effects
only when it starts). Upgrades apply straight away.

## Settings

Speed follows Plasma's global animation speed (General Behavior › Animation
speed); "Instant" turns it off. Under Desktop Effects › Animated Tiling:

- **Curve** (default: ease out, cubic).
- **Fade old contents into new when resizing** (default: on). Stops a growing
  window looking stretched; turn it off if your graphics driver struggles
  with it.

**Maximizing** is animated by Plasma's own Maximize effect while it is on,
with Animated Tiling covering the cases it misses. With it off, Animated
Tiling animates maximizing too.

## Development

```bash
deno test --allow-read tests/     # tests
bash tools/package.sh             # dist/animatedtiling-<version>.kwineffect
```

The effect is `package/contents/code/main.js`; its settings page is
`package/contents/ui/config.ui`.

## License

GPL-3.0-or-later, like HyprKwin by dgbooth; see [LICENSE](LICENSE).
