'use strict';

// Boot, last: by the time this file runs, renderer.js, inbox.js, atlas.js,
// and contextmenu.js have all executed their top-level setup (window.Inbox /
// window.Atlas / window.ContextMenu all exist), so renderer.js's load() can
// safely call into them (the demo-mode fixture path calls
// window.Inbox.fixtureThreads() and window.Atlas.hydrateFixture()). Split out
// as its own file rather than an inline <script> because the CSP is
// script-src 'self' with no 'unsafe-inline'.
window.bootHumanctl();
