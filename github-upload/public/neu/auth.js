/* Flow Valu – Anmelden / Konto erstellen.
   Mit Server (config.js ausgefüllt): echte Konten über Supabase.
   Ohne Server: Testkonten nur im Browser. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var gate = $('gate'), form = $('gate-form');
  if (!gate || !form) return;

  var title = $('gate-title'), submitLabel = $('gate-submit'), switchText = $('gate-switch-text'), switchLink = $('gate-register');
  var fName = $('field-name'), fPass2 = $('field-pass2'), forgot = $('gate-forgot'), modeHint = $('gate-mode');
  var name = $('gate-name'), email = $('gate-email'), pass = $('gate-pass'), pass2 = $('gate-pass2'), msg = $('gate-error');
  var submitBtn = form.querySelector('button[type="submit"]');

  var SESSION = 'fv-signed-in', NAME = 'fv-me-name', USERS = 'fv-demo-users';
  var B = window.FVB, mode = 'login';
  if (!B) return; // Testmodus: script.js übernimmt

  if (modeHint) { modeHint.textContent = B ? '' : 'Testmodus · Konten werden nur in diesem Browser gespeichert'; modeHint.hidden = !!B; }

  function ss(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (x) {} }
  function users() { try { return JSON.parse(localStorage.getItem(USERS) || '{}'); } catch (x) { return {}; } }
  function saveUsers(u) { try { localStorage.setItem(USERS, JSON.stringify(u)); } catch (x) {} }

  function fail(t) { msg.textContent = t; msg.hidden = false; msg.classList.remove('is-ok'); }
  function info(t) { msg.textContent = t; msg.hidden = false; msg.classList.add('is-ok'); }
  function busy(on) { submitBtn.disabled = on; submitBtn.classList.toggle('is-busy', on); }

  function setMode(next) {
    mode = next;
    var reg = mode === 'register';
    title.textContent = reg ? 'Konto erstellen' : 'Anmelden';
    submitLabel.textContent = reg ? 'Konto erstellen' : 'Anmelden';
    switchText.textContent = reg ? 'Schon ein Konto?' : 'Noch kein Konto?';
    switchLink.textContent = reg ? 'Anmelden' : 'Konto erstellen';
    fName.hidden = !reg;
    fPass2.hidden = !reg;
    if (forgot) forgot.hidden = !B || reg;
    pass.setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    msg.hidden = true;
    (reg ? name : email).focus();
  }

  function open() {
    gate.classList.remove('is-hidden', 'is-checking');
    document.body.classList.add('is-locked');
    setTimeout(function () { email.focus(); }, 50);
  }
  function close() {
    gate.classList.add('is-hidden');
    gate.classList.remove('is-checking');
    document.body.classList.remove('is-locked');
    window.scrollTo(0, 0);
  }

  function signedIn(mail, first, id) {
    ss(SESSION, mail);
    ss(NAME, first || '');
    pass.value = ''; pass2.value = '';
    close();
    try { document.dispatchEvent(new CustomEvent('fv:signin', { detail: { email: mail, uid: id || null } })); } catch (x) {}
  }

  function translate(e) {
    var m = String((e && e.message) || '').toLowerCase();
    if (m.indexOf('invalid login') > -1) return 'E-Mail oder Passwort ist falsch.';
    if (m.indexOf('already registered') > -1 || m.indexOf('already been registered') > -1) return 'Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.';
    if (m.indexOf('not confirmed') > -1) return 'Bitte bestätige zuerst deine E-Mail über den Link in deinem Postfach.';
    if (m.indexOf('password') > -1 && m.indexOf('least') > -1) return 'Das Passwort ist zu kurz. Bitte mindestens 8 Zeichen verwenden.';
    if (m.indexOf('weak') > -1) return 'Das Passwort ist zu schwach. Bitte ein längeres oder sichereres wählen.';
    if (m.indexOf('rate') > -1 || m.indexOf('too many') > -1) return 'Zu viele Versuche. Bitte kurz warten und erneut probieren.';
    if (m.indexOf('fetch') > -1 || m.indexOf('network') > -1) return 'Keine Verbindung zum Server. Bitte Internet prüfen.';
    return 'Das hat nicht geklappt: ' + ((e && e.message) || 'Unbekannter Fehler');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var mail = email.value.trim().toLowerCase();
    var pw = pass.value;
    var nm = name.value.trim().slice(0, 40);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return fail('Bitte eine gültige E-Mail-Adresse eingeben.');
    if (mode === 'register') {
      if (!nm) return fail('Bitte deinen Vornamen eingeben.');
      if (pw.length < 8) return fail('Das Passwort braucht mindestens 8 Zeichen.');
      if (pw !== pass2.value) return fail('Die Passwörter stimmen nicht überein.');
    } else if (!pw) return fail('Bitte dein Passwort eingeben.');

    /* ---- Testmodus ---- */
    if (!B) {
      var u = users();
      if (mode === 'register') {
        if (u[mail]) return fail('Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.');
        u[mail] = { name: nm, pw: pw };
        saveUsers(u);
        return signedIn(mail, nm, null);
      }
      if (!u[mail]) return fail('Kein Konto mit dieser E-Mail gefunden. Erstelle zuerst ein Konto.');
      if (u[mail].pw !== pw) return fail('Das Passwort ist falsch.');
      return signedIn(mail, u[mail].name, null);
    }

    /* ---- Server ---- */
    busy(true);
    var done = function () { busy(false); };
    if (mode === 'register') {
      B.sb.auth.signUp({
        email: mail,
        password: pw,
        options: { data: { first_name: nm }, emailRedirectTo: location.origin + location.pathname }
      }).then(function (r) {
        if (r.error) throw r.error;
        var user = r.data.user;
        if (user && Array.isArray(user.identities) && user.identities.length === 0) throw new Error('already registered');
        if (r.data.session) return signedIn(user.email, nm, user.id);
        setMode('login');
        email.value = mail;
        info('Fast geschafft: Wir haben dir eine E-Mail geschickt. Bestätige den Link und melde dich dann hier an.');
      }).catch(function (err) { fail(translate(err)); }).then(done);
    } else {
      B.sb.auth.signInWithPassword({ email: mail, password: pw }).then(function (r) {
        if (r.error) throw r.error;
        var user = r.data.user;
        signedIn(user.email, (user.user_metadata || {}).first_name, user.id);
      }).catch(function (err) { fail(translate(err)); }).then(done);
    }
  });

  switchLink.addEventListener('click', function (e) {
    e.preventDefault();
    setMode(mode === 'login' ? 'register' : 'login');
  });

  if (forgot) forgot.addEventListener('click', function (e) {
    e.preventDefault();
    var mail = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return fail('Bitte zuerst deine E-Mail-Adresse oben eingeben.');
    B.sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname }).then(function (r) {
      if (r.error) throw r.error;
      info('Wir haben dir einen Link zum Zurücksetzen des Passworts geschickt.');
    }).catch(function (err) { fail(translate(err)); });
  });

  function signOutLocal() {
    ss(SESSION, null); ss(NAME, null);
    setMode('login');
    open();
  }

  var logout = $('logout');
  if (logout) logout.addEventListener('click', function (e) {
    e.preventDefault();
    try { document.dispatchEvent(new CustomEvent('fv:signout')); } catch (x) {}
    if (B) B.sb.auth.signOut().then(signOutLocal, signOutLocal);
    else signOutLocal();
  });

  setMode('login');

  /* ---- Start ---- */
  if (!B) {
    var mail0 = null;
    try { mail0 = sessionStorage.getItem(SESSION); } catch (x) {}
    if (mail0 && users()[mail0]) signedIn(mail0, users()[mail0].name, null);
    else { ss(SESSION, null); open(); }
    return;
  }

  ss(SESSION, null);
  gate.classList.add('is-checking');
  document.body.classList.add('is-locked');
  B.sb.auth.getSession().then(function (r) {
    var s = r.data.session;
    if (s) signedIn(s.user.email, (s.user.user_metadata || {}).first_name, s.user.id);
    else open();
  }, open);

  B.sb.auth.onAuthStateChange(function (ev) {
    if (ev === 'PASSWORD_RECOVERY') {
      var np = window.prompt('Neues Passwort eingeben (mindestens 8 Zeichen):');
      if (np && np.length >= 8) {
        B.sb.auth.updateUser({ password: np }).then(function (r) {
          window.alert(r.error ? translate(r.error) : 'Dein Passwort wurde geändert.');
        });
      }
    }
  });
})();
