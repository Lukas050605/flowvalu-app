/* Flow Valu – Verbindung zu Supabase. Ohne Eintrag in config.js bleibt window.FVB = null (Testmodus). */
(function () {
  'use strict';
  var c = window.FV_CONFIG || {};
  window.FVB = null;
  if (!c.supabaseUrl || !c.supabaseAnonKey) return;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.warn('Supabase konnte nicht geladen werden – Testmodus aktiv.');
    return;
  }

  var sb = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  function rpc(name, args) {
    return sb.rpc(name, args || {}).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
  }

  function fn(name, body) {
    return sb.functions.invoke(name, { body: body || {} }).then(function (r) {
      if (!r.error) return r.data;
      var err = r.error, ctx = err && err.context;
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().then(function (j) { throw new Error((j && j.error) || err.message); }, function () { throw new Error(err.message); });
      }
      throw new Error(err.message || 'Serverfehler');
    });
  }

  function uid() {
    return sb.auth.getSession().then(function (r) { return r.data.session ? r.data.session.user.id : null; });
  }

  window.FVB = { sb: sb, rpc: rpc, fn: fn, uid: uid };
})();
