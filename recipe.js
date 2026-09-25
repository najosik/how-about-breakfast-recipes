/* recipe.js — persists the ingredient checklist's checked state per recipe
   in localStorage, so a shopping-trip checklist survives a page reload.
   Loaded on every static recipe detail page (recipes/*.html, en/recipes/*.html). */
(function () {
  'use strict';

  var list = document.getElementById('ingList');
  if (!list) return;

  var storageKey = 'hab_ing_checked:' + list.getAttribute('data-recipe-id');

  function loadChecked() {
    try {
      var raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveChecked(arr) {
    try { localStorage.setItem(storageKey, JSON.stringify(arr)); } catch (e) {}
  }

  var checked = loadChecked();
  Array.prototype.forEach.call(list.querySelectorAll('.recipe-ing-check'), function (cb) {
    var idx = cb.getAttribute('data-idx');
    if (checked.indexOf(idx) !== -1) {
      cb.checked = true;
      cb.closest('label').classList.add('checked-off');
    }
    cb.addEventListener('change', function () {
      cb.closest('label').classList.toggle('checked-off', cb.checked);
      var cur = loadChecked();
      var pos = cur.indexOf(idx);
      if (cb.checked && pos === -1) cur.push(idx);
      else if (!cb.checked && pos !== -1) cur.splice(pos, 1);
      saveChecked(cur);
    });
  });
})();
