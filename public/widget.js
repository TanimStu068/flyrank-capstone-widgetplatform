/* Embeddable lead-capture widget. Loaded via:
 *   <script src="https://HOST/widget.js?id=WIDGET_ID" async></script>
 * HOST is taken from this script's own URL, so the same snippet works on any deployment. */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || !script.src) return;
  var src = new URL(script.src, location.href);
  var id = src.searchParams.get('id') || script.getAttribute('data-widget-id');
  if (!id) { console.error('[widget] missing ?id='); return; }
  var api = src.origin;

  fetch(api + '/widgets/' + encodeURIComponent(id) + '/config')
    .then(function (r) { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
    .then(render)
    .catch(function (e) { console.warn('[widget] not shown:', e.message); });

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text; // textContent only: config text can never inject HTML
    return n;
  }

  function render(cfg) {
    var pos = (cfg.display && cfg.display.position) || 'inline';
    var accent = (cfg.display && cfg.display.accentColor) || '#2563eb';
    var host = el('div', { 'data-widget-id': cfg.id });
    var root = host.attachShadow({ mode: 'open' }); // CSS isolation from the host page

    var css = el('style', {}, [
      ':host{all:initial;font-family:system-ui,sans-serif;color:#111}',
      '.box{box-sizing:border-box;max-width:380px;padding:16px;border:1px solid #d4d4d8;border-radius:10px;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.08)}',
      '.fixed{position:fixed;right:20px;bottom:20px;z-index:2147483000}',
      '.modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);z-index:2147483000}',
      'h3{margin:0 0 4px;font-size:18px}p{margin:0 0 12px;color:#52525b;font-size:14px}',
      'label{display:block;font-size:13px;margin:8px 0 2px}',
      'input,textarea{box-sizing:border-box;width:100%;padding:8px;border:1px solid #a1a1aa;border-radius:6px;font:inherit}',
      'button.go{margin-top:12px;width:100%;padding:10px;border:0;border-radius:6px;color:#fff;font:inherit;font-weight:600;cursor:pointer;background:' + accent + '}',
      'button.go[disabled]{opacity:.6;cursor:default}',
      '.err{color:#b91c1c;font-size:12px;margin-top:2px}.status{margin-top:10px;font-size:13px}',
      '.hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}',
    ].join(''));
    root.appendChild(css);

    var box = el('div', { class: 'box' + (pos === 'bottom-right' ? ' fixed' : '') });
    var wrap = box;
    if (pos === 'modal') { wrap = el('div', { class: 'modal' }); wrap.appendChild(box); }
    box.appendChild(el('h3', {}, cfg.title));
    if (cfg.description) box.appendChild(el('p', {}, cfg.description));

    var form = el('form', { novalidate: '' });
    var inputs = {}, errs = {};
    cfg.fields.forEach(function (f) {
      var lab = el('label', { for: 'f_' + f.name }, f.label + (f.required ? ' *' : ''));
      var inp = f.type === 'textarea' ? el('textarea', { rows: '3' }) : el('input', { type: f.type === 'email' ? 'email' : 'text' });
      inp.id = 'f_' + f.name; inp.name = f.name;
      if (f.type === 'email') inp.autocomplete = 'email';
      inputs[f.name] = inp; errs[f.name] = el('div', { class: 'err' });
      form.appendChild(lab); form.appendChild(inp); form.appendChild(errs[f.name]);
    });

    // Honeypot: invisible to humans and screen readers, tempting to bots.
    var hpWrap = el('div', { class: 'hp', 'aria-hidden': 'true' });
    var hp = el('input', { type: 'text', tabindex: '-1', autocomplete: 'off', name: 'website', 'aria-hidden': 'true' });
    hpWrap.appendChild(hp); form.appendChild(hpWrap);

    var btn = el('button', { type: 'submit', class: 'go' }, cfg.buttonText);
    var status = el('div', { class: 'status', role: 'status' });
    form.appendChild(btn); form.appendChild(status); box.appendChild(form);
    root.appendChild(wrap);

    // One idempotency key per logical attempt: a retry after a network blip can't create a duplicate lead.
    var attemptKey = null;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      Object.keys(errs).forEach(function (k) { errs[k].textContent = ''; });
      status.textContent = '';
      var data = {};
      cfg.fields.forEach(function (f) { data[f.name] = inputs[f.name].value; });
      attemptKey = attemptKey || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      btn.disabled = true;
      fetch(api + cfg.submitPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptKey },
        body: JSON.stringify({ widgetId: cfg.id, data: data, hp: hp.value }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) { return { r: r, body: body }; });
      }).then(function (x) {
        if (x.r.ok) { form.reset(); attemptKey = null; status.textContent = 'Thanks! We got your details.'; status.style.color = '#15803d'; return; }
        if (x.r.status === 429) { status.textContent = 'Too many attempts. Try again in ' + (x.r.headers.get('Retry-After') || 'a few') + 's.'; return; }
        if (x.r.status === 400 && x.body.error && x.body.error.details) {
          x.body.error.details.forEach(function (d) { var k = d.path.replace(/^data\./, ''); if (errs[k]) errs[k].textContent = d.message; });
          attemptKey = null; // payload will change; next attempt is a new logical submission
          return;
        }
        status.textContent = 'Something went wrong. Please try again.';
      }).catch(function () { status.textContent = 'Network error. Please try again.'; })
        .then(function () { btn.disabled = false; });
    });

    if (pos === 'inline' && script.parentNode) script.parentNode.insertBefore(host, script.nextSibling);
    else document.body.appendChild(host);
  }
})();
