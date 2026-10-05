
/******************************************************************************/

// ---- Enki Browser patch (GPL-3.0, like the file it is appended to) ----------
//
// Appended to uBlock Origin Lite's js/background.js by enki-browser's build
// (build/common.mjs, patchBlocker). It lets Enki Shield — and only Enki
// Shield, identified by its fixed extension id — read and change a site's
// filtering mode, so the Shields button next to the address bar can turn
// blocking down for one site the way Brave's does. Only these four existing
// requests are reachable, and each goes through uBlock's own handler.

const ENKI_SHIELD_ID = '__ENKI_SHIELD_ID__';
const ENKI_SHIELD_REQUESTS = new Set([
    'getFilteringMode',
    'setFilteringMode',
    'getDefaultFilteringMode',
    'setDefaultFilteringMode',
]);

runtime.onMessageExternal.addListener((request, sender, callback) => {
    if ( sender.id !== ENKI_SHIELD_ID ) { return; }
    if ( request instanceof Object === false ) { return; }
    if ( ENKI_SHIELD_REQUESTS.has(request.what) === false ) { return; }
    // These requests sit behind uBlock's "trusted origin" check, which accepts only its own
    // pages; the sender has been checked above, so it is presented as uBlock's own popup.
    onMessage(request, { id: sender.id, origin: UBOL_ORIGIN }).then(callback);
    return true;
});
