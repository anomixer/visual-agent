// Visual Agent site — shared interactions + i18n (zh / en)

/* ---------------- i18n ---------------- */
(function () {
  var KEY = 'va-lang';
  function getLang() { return localStorage.getItem(KEY) || 'zh'; }
  function apply(lang) {
    document.querySelectorAll('[data-zh][data-en]').forEach(function (el) {
      el.innerHTML = lang === 'en' ? el.getAttribute('data-en') : el.getAttribute('data-zh');
    });
    // language toggle button label
    var btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = lang === 'en' ? '中文' : 'EN';
    // hero screenshots follow language
    document.querySelectorAll('.i18n-img-zh').forEach(function (el) {
      el.style.display = lang === 'en' ? 'none' : '';
    });
    document.querySelectorAll('.i18n-img-en').forEach(function (el) {
      el.style.display = lang === 'en' ? '' : 'none';
    });
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-TW';
    localStorage.setItem(KEY, lang);
  }
  var btn = document.getElementById('lang-toggle');
  if (btn) btn.addEventListener('click', function () { apply(getLang() === 'en' ? 'zh' : 'en'); });
  apply(getLang()); // run immediately (script is at end of body)
})();

/* ---------------- Mobile nav toggle ---------------- */
document.querySelectorAll('.nav-toggle').forEach(function (t) {
  t.addEventListener('click', function () {
    var links = document.querySelector(t.dataset.target || '.nav-links');
    if (links) links.classList.toggle('open');
  });
});

/* ---------------- Copy buttons ---------------- */
document.addEventListener('click', function (e) {
  var b = e.target.closest('.copy-btn');
  if (!b) return;
  var target = document.getElementById(b.dataset.copy);
  if (!target) return;
  var text = target.getAttribute('data-clip') || target.textContent;
  navigator.clipboard.writeText(text).then(function () {
    var old = b.textContent;
    b.textContent = (localStorage.getItem('va-lang') === 'en') ? 'Copied ✓' : '已複製 ✓';
    setTimeout(function () { b.textContent = old; }, 1600);
  });
});

/* ---------------- Tabs ---------------- */
document.querySelectorAll('[data-tabs]').forEach(function (group) {
  var name = group.getAttribute('data-tabs');
  var buttons = group.querySelectorAll('.tab');
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      buttons.forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      document.querySelectorAll('[data-panel="' + name + '"]').forEach(function (p) {
        p.style.display = (p.dataset.value === b.dataset.value) ? '' : 'none';
      });
    });
  });
});
