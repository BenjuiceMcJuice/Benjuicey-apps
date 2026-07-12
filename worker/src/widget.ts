export const WIDGET_JS = `
(function(){
  if (window.BenjuiceyFeedback) return;
  var API = 'https://benjuicey-feedback.benjuicemcjuice.workers.dev';
  var script = document.currentScript;
  var appId = script.getAttribute('data-app-id');
  var accent = script.getAttribute('data-accent') || '#2563eb';
  var position = script.getAttribute('data-position') || 'br';
  var noButton = script.getAttribute('data-no-button') === 'true';

  if (!appId) { console.warn('[BenjuiceyFeedback] missing data-app-id on script tag'); return; }

  var css = ''
    + '.bjfw-btn{position:fixed;' + (position === 'bl' ? 'left:1rem;' : 'right:1rem;') + 'bottom:1rem;z-index:9998;'
    + 'background:' + accent + ';color:#fff;border:none;padding:.6rem 1.1rem;border-radius:999px;'
    + 'font:600 .85rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;'
    + 'box-shadow:0 4px 14px rgba(0,0,0,.35);}'
    + '.bjfw-btn:hover{filter:brightness(1.1);}'
    + '.bjfw-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:none;'
    + 'align-items:center;justify-content:center;padding:1rem;}'
    + '.bjfw-overlay.bjfw-open{display:flex;}'
    + '.bjfw-panel{background:#1a1a1a;color:#eee;border-radius:12px;padding:1.5rem;width:100%;max-width:420px;'
    + 'max-height:85vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'border-top:3px solid ' + accent + ';box-shadow:0 20px 60px rgba(0,0,0,.5);}'
    + '.bjfw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.25rem;}'
    + '.bjfw-head h3{font-size:1.1rem;margin:0;}'
    + '.bjfw-close{background:none;border:none;color:#999;font-size:1.1rem;cursor:pointer;line-height:1;padding:.25rem;}'
    + '.bjfw-sub{font-size:.82rem;color:#999;margin:.25rem 0 1rem;}'
    + '.bjfw-field{margin-bottom:.75rem;}'
    + '.bjfw-field label{display:block;font-size:.72rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:#999;margin-bottom:.3rem;}'
    + '.bjfw-field input,.bjfw-field select,.bjfw-field textarea{width:100%;box-sizing:border-box;background:#262626;'
    + 'border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#eee;padding:.55rem .65rem;font-size:.88rem;'
    + 'font-family:inherit;}'
    + '.bjfw-field textarea{resize:vertical;min-height:90px;}'
    + '.bjfw-submit{width:100%;background:' + accent + ';color:#fff;border:none;border-radius:8px;padding:.7rem;'
    + 'font-size:.9rem;font-weight:600;cursor:pointer;}'
    + '.bjfw-submit:disabled{opacity:.6;cursor:default;}'
    + '.bjfw-error{color:#f87171;font-size:.82rem;margin-bottom:.75rem;display:none;}'
    + '.bjfw-success{font-size:.9rem;line-height:1.5;}'
    + '.bjfw-success strong{color:' + accent + ';}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var overlay = document.createElement('div');
  overlay.className = 'bjfw-overlay';
  overlay.innerHTML =
    '<div class="bjfw-panel">'
    + '<div id="bjfwFormWrap">'
    + '<div class="bjfw-head"><h3>Got feedback?</h3><button class="bjfw-close" type="button" aria-label="Close">✕</button></div>'
    + '<p class="bjfw-sub">Found a bug, spotted something wrong, or want to suggest something? Let us know.</p>'
    + '<form id="bjfwForm">'
    + '<div class="bjfw-field"><label for="bjfwName">Your name</label><input type="text" id="bjfwName" required autocomplete="name"></div>'
    + '<div class="bjfw-field"><label for="bjfwEmail">Your email (optional)</label><input type="email" id="bjfwEmail" autocomplete="email"></div>'
    + '<div class="bjfw-field"><label for="bjfwType">What\\'s this about</label><select id="bjfwType">'
    + '<option value="bug">found a bug</option><option value="content">something\\'s wrong / unclear</option>'
    + '<option value="request">feature or content suggestion</option><option value="general">general feedback</option>'
    + '</select></div>'
    + '<div class="bjfw-field"><label for="bjfwMessage">Message</label><textarea id="bjfwMessage" required></textarea></div>'
    + '<p class="bjfw-error" id="bjfwError">Something went wrong — try again in a moment.</p>'
    + '<button class="bjfw-submit" id="bjfwSubmitBtn" type="submit">Send feedback</button>'
    + '</form></div>'
    + '<div id="bjfwSuccessWrap" style="display:none">'
    + '<div class="bjfw-head"><h3>Got it!</h3><button class="bjfw-close" type="button" aria-label="Close">✕</button></div>'
    + '<p class="bjfw-success">Your message has been logged as <strong id="bjfwRef"></strong>. We\\'ll take a look and get back to you if needed.</p>'
    + '</div>'
    + '</div>';
  document.body.appendChild(overlay);

  var closeBtns = overlay.querySelectorAll('.bjfw-close');
  for (var i = 0; i < closeBtns.length; i++) closeBtns[i].addEventListener('click', close);
  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });

  function open(){
    document.getElementById('bjfwFormWrap').style.display = 'block';
    document.getElementById('bjfwSuccessWrap').style.display = 'none';
    overlay.classList.add('bjfw-open');
    document.body.style.overflow = 'hidden';
  }
  function close(){
    overlay.classList.remove('bjfw-open');
    document.body.style.overflow = '';
  }

  document.getElementById('bjfwForm').addEventListener('submit', function(e){
    e.preventDefault();
    var errorEl = document.getElementById('bjfwError');
    var submitBtn = document.getElementById('bjfwSubmitBtn');
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    var data = {
      appId: appId,
      name: document.getElementById('bjfwName').value,
      email: document.getElementById('bjfwEmail').value,
      type: document.getElementById('bjfwType').value,
      message: document.getElementById('bjfwMessage').value
    };

    fetch(API + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function(res){
      return res.json().then(function(json){ return { ok: res.ok, json: json }; });
    }).then(function(result){
      if (result.ok && result.json.success) {
        document.getElementById('bjfwRef').textContent = result.json.ref || '';
        document.getElementById('bjfwFormWrap').style.display = 'none';
        document.getElementById('bjfwSuccessWrap').style.display = 'block';
        document.getElementById('bjfwForm').reset();
        window.dispatchEvent(new CustomEvent('benjuiceyfeedback:submitted', { detail: { appId: appId, ref: result.json.ref, type: data.type } }));
      } else {
        errorEl.style.display = 'block';
      }
    }).catch(function(){
      errorEl.style.display = 'block';
    }).finally(function(){
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send feedback';
    });
  });

  if (!noButton) {
    var btn = document.createElement('button');
    btn.className = 'bjfw-btn';
    btn.type = 'button';
    btn.textContent = 'Feedback';
    btn.addEventListener('click', open);
    document.body.appendChild(btn);
  }

  window.BenjuiceyFeedback = { open: open, close: close };
})();
`
