/* Flow Valu – „Coming soon“ für Fortschritt & Level. Admins sehen den vollen Bereich, Punkte werden für alle im Hintergrund gesammelt. */
(function () {
  'use strict';
  var B = window.FVB;
  var view = document.getElementById('fortschritt');
  if (!view) return;
  var pv = view.querySelector('.pv');

  var soon = document.createElement('div');
  soon.className = 'pv soon';
  soon.innerHTML =
    '<div class="eyebrow">Fortschritt &amp; Level</div>' +
    '<h1 class="pv__title">Bald verfügbar.</h1>' +
    '<p class="pv__sub">Hier siehst du bald dein Level, deine Meilensteine und wie weit du auf deinem Weg gekommen bist. Alles, was du ab heute erledigst, wird schon jetzt mitgezählt.</p>' +
    '<div class="glass glass--pad-lg soon__card"><span class="soon__tag">Coming soon</span>' +
    '<ul class="soon__list"><li>Level und Flow-Punkte für erledigte Schritte und Gespräche</li><li>Meilensteine auf deinem persönlichen Weg</li><li>Abzeichen in deinem Profil</li></ul></div>' +
    '<div class="tx__actions"><a class="btn btn--solid btn--sm" href="#heute">Zu deinem nächsten Schritt<span class="btn__rule"></span></a></div>';
  view.appendChild(soon);

  function apply(isAdmin) {
    document.body.classList.toggle('fv-soon', !isAdmin);
    if (pv) pv.hidden = !isAdmin;
    soon.hidden = !!isAdmin;
    var adminNote = document.getElementById('soon-admin');
    if (isAdmin && pv && !adminNote) {
      adminNote = document.createElement('p');
      adminNote.id = 'soon-admin'; adminNote.className = 'soon__admin';
      adminNote.textContent = 'Admin-Vorschau · Mitglieder sehen hier „Coming soon“.';
      pv.insertBefore(adminNote, pv.firstChild);
    }
  }

  apply(false);
  function check() { if (!B) return apply(false); B.rpc('is_admin').then(function (y) { apply(!!y); }).catch(function () { apply(false); }); }
  document.addEventListener('fv:signin', check);
  document.addEventListener('fv:signout', function () { apply(false); });
  check();
})();
