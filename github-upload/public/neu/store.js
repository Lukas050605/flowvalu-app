/* Flow Valu – Datenschicht. Gleiche Schnittstelle für Testmodus (Browser) und Server (Supabase, RLS).
   Fehler tragen einen maschinenlesbaren Code (z. B. VERSION_CONFLICT). */
(function () {
  'use strict';
  var B = window.FVB;

  function err(code, message) { var e = new Error(message); e.code = code; return e; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function now() { return new Date().toISOString(); }
  function user() { try { return sessionStorage.getItem('fv-signed-in') || 'gast'; } catch (x) { return 'gast'; } }
  function matches(row, f) { for (var k in f) if (f.hasOwnProperty(k) && row[k] !== f[k]) return false; return true; }

  /* ---------- Testmodus ---------- */
  function key() { return 'fv-data-' + user(); }
  function read() { try { return JSON.parse(localStorage.getItem(key()) || '{}'); } catch (x) { return {}; } }
  function write(d) {
    try { localStorage.setItem(key(), JSON.stringify(d)); }
    catch (x) { throw err('STORAGE_FULL', 'Der Browserspeicher ist voll.'); }
  }

  var local = {
    list: function (col, filter, order) {
      var rows = (read()[col] || []).filter(function (r) { return matches(r, filter || {}); });
      var o = order || 'created_at';
      rows.sort(function (a, b) { return (a[o] > b[o] ? 1 : a[o] < b[o] ? -1 : 0); });
      return Promise.resolve(rows);
    },
    get: function (col, id) {
      var r = (read()[col] || []).filter(function (x) { return x.id === id; })[0];
      return r ? Promise.resolve(r) : Promise.reject(err('NOT_FOUND', 'Eintrag nicht gefunden.'));
    },
    insert: function (col, obj) {
      return Promise.resolve().then(function () {
        var d = read(); var arr = d[col] = d[col] || [];
        if (obj.client_key) {
          var ex = arr.filter(function (r) { return r.client_key === obj.client_key; })[0];
          if (ex) return ex;
        }
        var row = Object.assign({ id: uuid(), created_at: now(), updated_at: now(), rev: 1 }, obj);
        arr.push(row); write(d);
        return row;
      });
    },
    update: function (col, id, patch, expected) {
      return Promise.resolve().then(function () {
        var d = read(); var arr = d[col] || [];
        var row = arr.filter(function (r) { return r.id === id; })[0];
        if (!row) throw err('NOT_FOUND', 'Eintrag nicht gefunden.');
        if (expected != null && (row.rev || 1) !== expected) throw err('VERSION_CONFLICT', 'Dieser Eintrag wurde inzwischen an anderer Stelle geändert. Bitte neu laden.');
        Object.assign(row, patch, { rev: (row.rev || 1) + 1, updated_at: now() });
        write(d);
        return row;
      });
    },
    remove: function (col, id) {
      return Promise.resolve().then(function () {
        var d = read(); d[col] = (d[col] || []).filter(function (r) { return r.id !== id; }); write(d);
      });
    },
    profile: function () { return Promise.resolve(read().profile || {}); },
    saveProfile: function (patch) {
      return Promise.resolve().then(function () { var d = read(); d.profile = Object.assign(d.profile || {}, patch); write(d); return d.profile; });
    },
    exportAll: function () { return Promise.resolve(read()); },
    wipe: function () { localStorage.removeItem(key()); return Promise.resolve(); }
  };

  /* ---------- Server ---------- */
  function q(p) { return p.then(function (r) { if (r.error) throw err(r.error.code || 'SERVER_ERROR', r.error.message); return r.data; }); }

  var server = B ? {
    list: function (col, filter, order) {
      var x = B.sb.from(col).select('*');
      for (var k in (filter || {})) if (filter.hasOwnProperty(k)) x = x.eq(k, filter[k]);
      return q(x.order(order || 'created_at', { ascending: true }).limit(500));
    },
    get: function (col, id) { return q(B.sb.from(col).select('*').eq('id', id).single()); },
    insert: function (col, obj) {
      return B.sb.from(col).insert(obj).select().single().then(function (r) {
        if (r.error && r.error.code === '23505' && obj.client_key) {
          return q(B.sb.from(col).select('*').eq('client_key', obj.client_key).single());
        }
        if (r.error) throw err(r.error.code || 'SERVER_ERROR', r.error.message);
        return r.data;
      });
    },
    update: function (col, id, patch, expected) {
      var x = B.sb.from(col).update(patch).eq('id', id);
      if (expected != null) x = x.eq('rev', expected);
      return q(x.select()).then(function (rows) {
        if (!rows || !rows.length) throw err('VERSION_CONFLICT', 'Dieser Eintrag wurde inzwischen an anderer Stelle geändert. Bitte neu laden.');
        return rows[0];
      });
    },
    remove: function (col, id) { return q(B.sb.from(col).delete().eq('id', id)); },
    profile: function () {
      return B.uid().then(function (uid) { return q(B.sb.from('profiles').select('*').eq('id', uid).single()); });
    },
    saveProfile: function (patch) {
      return B.uid().then(function (uid) { return q(B.sb.from('profiles').update(patch).eq('id', uid).select().single()); });
    },
    exportAll: function () { return B.rpc('export_my_data'); },
    wipe: function () { return B.rpc('request_account_deletion'); }
  } : null;

  var api = B ? server : local;

  // Produkt-Ereignisse: nur Name und minimale Eigenschaften, keine Inhalte
  function track(name, props) {
    var clean = {};
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 40)) clean[k] = v;
    });
    return api.insert('events', { name: name, props: clean }).catch(function () {});
  }

  window.FVS = Object.assign({ server: !!B, uuid: uuid, err: err, track: track }, api);
})();
