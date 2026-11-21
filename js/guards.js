// Reusable, UX-only page guards. Real access control lives on the server.
// Pages include this file before their own script, then call:
//   window.HCGuards.requireRole(['admin', 'employee', 'employer']);
// The returned promise resolves to the signed-in user (or null after a redirect),
// and is also stored on window.HCGuards.lastCheck for the page script to consume.
(function () {
  'use strict';

  function delegate(roles, redirect) {
    if (window.HCAuth && typeof window.HCAuth.requireRole === 'function') {
      return window.HCAuth.requireRole(roles, redirect);
    }
    if (typeof window.requireRole === 'function') {
      return window.requireRole(roles, redirect);
    }
    return Promise.resolve(null);
  }

  var Guards = {
    lastCheck: null,

    requireRole: function (roles, redirect) {
      var result = delegate(roles, redirect);
      Guards.lastCheck = (result && typeof result.then === 'function') ? result : Promise.resolve(result);
      return Guards.lastCheck;
    },

    requireSignedIn: function (redirect) {
      return this.requireRole(['admin', 'employee', 'employer'], redirect);
    },

    // Cached, normalised user from auth.js (safe to call before the guard resolves).
    user: function () {
      if (window.HCAuth && typeof window.HCAuth.getCurrentUser === 'function') {
        return window.HCAuth.getCurrentUser();
      }
      try {
        return JSON.parse(localStorage.getItem('currentUser') || 'null');
      } catch {
        return null;
      }
    }
  };

  window.HCGuards = Guards;
})();
