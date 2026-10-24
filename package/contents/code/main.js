/*
    Animated Tiling: windows slide and stretch to their new place instead of
    jumping there. Only the rendered window is animated, so apps never see
    the in-between sizes.

    SPDX-License-Identifier: GPL-3.0-or-later
*/

"use strict";

// Plasma's standard curve, also as a function (to work out where a window is
// part way through an animation).
const CURVE = QEasingCurve.OutCubic;
const ease = (t) => 1 - (1 - t) ** 3;

const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
// With fractional scaling KWin's geometry is in fractions of a pixel, and
// its rounding varies: anything within a pixel counts as the same.
const near = (a, b) => Math.abs(a - b) < 1;
const sameRect = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
const sameSize = (a, b) => a.width === b.width && a.height === b.height;
const pair = (value1, value2) => ({ value1, value2 });

class AnimatedTiling {
    constructor() {
        this.userResizing = null;
        this.userResizeEnded = 0;
        this.panelUntil = 0;
        this.fadeBatchStarted = 0;
        this.fadesInBatch = 0;
        effects.windowClosed.connect((window) => window.dock && this.notePanel());
        effects.windowAdded.connect((window) => this.manage(window));
        effect.configChanged.connect(() => this.loadConfig());
        effect.animationEnded.connect((window, id) => {
            if (window.hkAnimation === id) delete window.hkAnimation;
        });
        effects.stackingOrder.forEach((window) => this.manage(window));
        this.loadConfig();
    }

    loadConfig() {
        // Durations follow Plasma's global animation speed; "Instant" is 0.
        this.duration = animationTime(200);
        this.slideDuration = animationTime(180);
    }

    manage(window) {
        if (window.dock) this.notePanel();
        window.windowFrameGeometryChanged.connect((w, from) => this.onFrameGeometryChanged(w, from));
        window.windowMaximizedStateAboutToChange.connect(() => this.maximizeAboutToChange(window));
        window.windowMaximizedStateChanged.connect(() => this.maximizeChanged(window));
        // Fullscreen is left to KWin.
        window.windowFullScreenChanged.connect(() => { window.hkSuspendUntil = Date.now() + 500; });
        window.windowStartUserMovedResized.connect(() => { if (window.resize) this.userResizing = window; });
        window.windowFinishUserMovedResized.connect(() => {
            if (this.userResizing !== window) return;
            this.userResizing = null;
            this.userResizeEnded = Date.now();
        });
    }

    // After a panel changes, the work area and the tiles follow it shortly.
    notePanel() {
        this.panelUntil = Date.now() + 1200;
    }

    // ---- maximizing ------------------------------------------------------
    //
    // Plasma's Maximize effect animates maximizing and restoring while it is
    // on, so those are left to it. But it does not follow a move made while
    // it runs, and it gives up if the size changes again (comparing exactly,
    // so the rounding KWin sends under fractional scaling counts). This fills
    // in those cases.

    maximizeAboutToChange(window) {
        if (!window.visible || !effects.isEffectLoaded("maximize")) return;
        window.hkMaximize = { from: rect(window.geometry), started: false, until: Date.now() + 1000 };
    }

    maximizeChanged(window) {
        const m = window.hkMaximize;
        if (!m) return;
        m.started = true;
        m.until = Date.now() + animationTime(250);       // its duration
    }

    // "skip" if the Maximize effect has this change (or it was taken over),
    // "no fade" for a change animated here that cuts its fade short.
    maximizeRole(window, changedFrom) {
        const m = window.hkMaximize;
        if (!m) return "";
        if (Date.now() > m.until) {
            delete window.hkMaximize;
            return "";
        }
        const g = window.geometry;
        if (sameSize(g, changedFrom)) return m.resized ? "no fade" : "skip";   // a move: not followed
        if (sameSize(m.from, changedFrom)) {
            m.resized = true;                                                // the maximize itself
            return "skip";
        }
        if (!m.started) return "skip";
        delete window.hkMaximize;                                            // it gave up
        if (!sameRect(changedFrom, g)) return "no fade";
        // Only rounding: carry on from where the maximize started.
        this.run(window, this.duration, this.moveAndResize(m.from, g), m.from, g);
        return "skip";
    }

    // ---- animations ------------------------------------------------------

    shouldAnimate(window) {
        return window.visible && !window.minimized && !window.deleted &&
            !window.move && !window.resize &&                                // following the pointer
            !(Date.now() < window.hkSuspendUntil) &&
            !window.popupWindow && !window.desktopWindow && !window.dock &&
            (window.normalWindow || window.dialog || window.utility);
    }

    // Somewhere on the desktop (not parked out of sight by a scrolling layout).
    onScreen(g) {
        const s = effects.virtualScreenGeometry;
        return !s || (g.x < s.x + s.width && s.x < g.x + g.width && g.y < s.y + s.height && s.y < g.y + g.height);
    }

    // A split nudged a little, far edges kept: snaps, as the app does.
    isSplitNudge(o, n) {
        return (near(o.x, n.x) || near(o.x + o.width, n.x + n.width)) &&
            (near(o.y, n.y) || near(o.y + o.height, n.y + n.height)) &&
            Math.abs(n.width - o.width) < 0.4 * Math.max(1, o.width) &&
            Math.abs(n.height - o.height) < 0.4 * Math.max(1, o.height);
    }

    // Cross-fading draws the window offscreen, and a whole layout of those at
    // once can bring a driver down: at most two per batch.
    allowCrossFade() {
        const now = Date.now();
        if (now - this.fadeBatchStarted > 100) {
            this.fadeBatchStarted = now;
            this.fadesInBatch = 0;
        }
        return ++this.fadesInBatch <= 2;
    }

    snap(window) {
        if (window.hkAnimation) cancel(window.hkAnimation);
        delete window.hkAnimation;
    }

    // One animation per window; `from` and `to` are where it is drawn.
    run(window, duration, animations, from, to) {
        this.snap(window);
        window.hkAnimation = animate({ window, duration, animations });
        window.hkVisual = { from: rect(from), to: rect(to), start: Date.now(), end: Date.now() + duration };
    }

    // Whether KWin is still animating the window. Its animations start on the
    // next frame, so they end a little after our clock says; animationEnded
    // tells us when, and the margin covers a KWin that never says.
    animating(window) {
        const v = window.hkVisual;
        return !!window.hkAnimation && !!v && Date.now() < v.end + 250;
    }

    // Where the window is drawn part way through its animation, if it is.
    visualRect(window) {
        const v = window.hkVisual;
        if (!window.hkAnimation || !v || Date.now() >= v.end) return null;
        const p = ease(Math.min(1, (Date.now() - v.start) / Math.max(1, v.end - v.start)));
        const mix = (k) => v.from[k] + (v.to[k] - v.from[k]) * p;
        return { x: mix("x"), y: mix("y"), width: mix("width"), height: mix("height") };
    }

    // Centre to centre, as KWin's maximize effect does, to go with the size.
    moveAndResize(from, to) {
        const animations = [{
            type: Effect.Translation,
            from: pair(from.x - to.x + (from.width - to.width) / 2, from.y - to.y + (from.height - to.height) / 2),
            to: pair(0, 0),
            curve: CURVE,
        }];
        if (!sameSize(from, to)) {
            animations.push({ type: Effect.Size, from: pair(from.width, from.height), to: pair(to.width, to.height), curve: CURVE });
        }
        return animations;
    }

    // The one edge that moved outwards, if that is all that changed.
    grownEdge(o, n) {
        if (near(o.y, n.y) && near(o.height, n.height)) {
            if (near(o.x, n.x) && n.width > o.width) return { axis: "x", end: true, from: o.x + o.width, to: n.x + n.width };
            if (near(o.x + o.width, n.x + n.width) && n.x < o.x) return { axis: "x", end: false, from: o.x, to: n.x };
        }
        if (near(o.x, n.x) && near(o.width, n.width)) {
            if (near(o.y, n.y) && n.height > o.height) return { axis: "y", end: true, from: o.y + o.height, to: n.y + n.height };
            if (near(o.y + o.height, n.y + n.height) && n.y < o.y) return { axis: "y", end: false, from: o.y, to: n.y };
        }
        return null;
    }

    // A grown edge slides open: the window is clipped as the edge travels,
    // so its contents are never stretched. When the top or left edge grows,
    // the contents move with it too, as they stay put when the far edge does.
    slide(window, from, edge) {
        const ex = window.expandedGeometry;            // KWin clips a share of this
        const x = edge.axis === "x";
        const start = x ? ex.x : ex.y;
        const size = Math.max(1, x ? ex.width : ex.height);
        const share = (e) => Math.max(0, Math.min(1, edge.end ? (e - start) / size : (start + size - e) / size));
        const clip = (e) => (x ? pair(share(e), 1) : pair(1, share(e)));
        const anchor = x ? (edge.end ? Effect.Left : Effect.Right) : (edge.end ? Effect.Top : Effect.Bottom);
        const animations = [{ type: Effect.Clip, from: clip(edge.from), to: clip(edge.to), sourceAnchor: anchor, targetAnchor: anchor, curve: CURVE }];
        if (!edge.end) {
            const shift = edge.from - edge.to;
            animations.push({ type: Effect.Translation, from: x ? pair(shift, 0) : pair(0, shift), to: pair(0, 0), curve: CURVE });
        }
        this.run(window, this.slideDuration, animations, from, window.geometry);
    }

    onFrameGeometryChanged(window, changedFrom) {
        if (window.dock) return this.notePanel();
        if (this.duration <= 0 || !this.shouldAnimate(window)) return;
        const maximize = this.maximizeRole(window, changedFrom);
        const to = window.geometry;
        if (maximize === "skip" || sameRect(changedFrom, to)) return;      // sub-pixel rounding: carry on
        if (this.userResizing || Date.now() - this.userResizeEnded < 150) return this.snap(window);
        // Interrupted: carry on from where it is drawn, as a plain move/resize.
        const visual = this.visualRect(window);
        const interrupting = this.animating(window);
        const from = visual || changedFrom;
        if (!this.onScreen(from) || !this.onScreen(to)) return this.snap(window);
        if (Date.now() < this.panelUntil) {
            // Re-tiles after a panel change glide together, quickly, unfaded.
            const dist = Math.max(...["x", "y", "width", "height"].map((k) => Math.abs(to[k] - from[k])));
            return this.run(window, Math.min(this.duration, Math.max(60, Math.round(3 * dist))), this.moveAndResize(from, to), from, to);
        }
        if (!visual) {
            const edge = this.slideDuration > 0 && this.grownEdge(from, to);
            if (edge) return this.slide(window, from, edge);
            if (this.isSplitNudge(from, to)) return this.snap(window);
        }
        const moved = !near(from.x, to.x) || !near(from.y, to.y);
        const resized = !near(from.width, to.width) || !near(from.height, to.height);
        if (!moved && !resized) return;
        const animations = this.moveAndResize(from, to);
        // Fade old contents into new ones, so a growing window is not just
        // stretched. Not when interrupting, even in an animation's last frames:
        // KWin has no picture to fade from for that first frame, and the
        // window would vanish for it.
        if (resized && !interrupting && maximize !== "no fade" && this.allowCrossFade()) {
            animations.push({ type: Effect.CrossFadePrevious, from: 0, to: 1, curve: CURVE });
        }
        this.run(window, this.duration, animations, from, to);
    }
}

new AnimatedTiling();
