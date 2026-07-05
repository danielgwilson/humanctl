'use strict';

// Bespoke select component (0.16.1 controls + a11y pass). Replaces every
// native <select> in the app (DESIGN.md: "no OS-default interactive
// controls"). A button trigger + a popover listbox, styled to match
// contextmenu.js / the user picker's panel language (panel2 bg, radius,
// rule, shadow, hover). Renderer-ephemera only: it holds no durable state of
// its own and calls back into the caller's onChange, which is where
// renderer.js/inbox.js keep writing to their existing filter objects exactly
// as before (this component changes NO state shape, only how the control is
// drawn and driven).
//
// Full keyboard + ARIA contract:
//   - trigger: role via <button>, aria-haspopup="listbox", aria-expanded,
//     a stable id referenced by the popover's aria-labelledby.
//   - popover: role="listbox", positioned under the trigger.
//   - options: role="option", aria-selected, one is aria-activedescendant'd
//     from the trigger's owning listbox.
//   - Click or Enter/Space opens; ArrowUp/Down move the highlighted option
//     (wrapping); Enter selects the highlighted option and closes; Esc closes
//     and returns focus to the trigger; click-away closes.
//
// Usage: HcSelect.create(hostEl, { options: [[value,label], ...], value,
// onChange(value), ariaLabel }). hostEl is replaced in place with the
// trigger+popover markup. Returns { setValue(v), destroy() }.

(function () {
  let idSeq = 0;
  const openInstances = new Set();

  function closeAllExcept(inst) {
    openInstances.forEach((o) => { if (o !== inst) o.close(); });
  }

  function create(host, opts) {
    if (!host) return null;
    const id = 'hcs' + (++idSeq);
    const options = (opts.options || []).map((o) => ({ value: String(o[0]), label: String(o[1]) }));
    let value = opts.value != null ? String(opts.value) : (options[0] ? options[0].value : '');
    let open = false;
    let hiIndex = -1;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
    const ariaLabel = opts.ariaLabel || '';

    const wrap = document.createElement('div');
    wrap.className = 'hc-select' + (opts.className ? ' ' + opts.className : '');
    wrap.innerHTML = `
      <button type="button" class="hc-select-trigger" id="${id}-trig" data-esc-self aria-haspopup="listbox" aria-expanded="false" ${ariaLabel ? `aria-label="${escAttr(ariaLabel)}"` : ''}>
        <span class="hcs-val"></span>
        <svg class="hcs-caret" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="hc-select-pop" id="${id}-pop" role="listbox" aria-labelledby="${id}-trig" tabindex="-1" hidden></div>
    `;
    host.replaceWith(wrap);
    const trigger = wrap.querySelector('.hc-select-trigger');
    const pop = wrap.querySelector('.hc-select-pop');
    const valEl = wrap.querySelector('.hcs-val');

    function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }
    function escHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function labelFor(v) { const o = options.find((x) => x.value === v); return o ? o.label : ''; }
    function renderValue() { valEl.textContent = labelFor(value); }
    function renderOptions() {
      pop.innerHTML = options.map((o, i) => `<div class="hcs-opt" role="option" id="${id}-opt-${i}" data-i="${i}" aria-selected="${o.value === value}">
        <svg class="hcs-check" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 6.2l2.6 2.6L10 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${escHtml(o.label)}</span>
      </div>`).join('');
      pop.querySelectorAll('.hcs-opt').forEach((node) => {
        node.addEventListener('mouseenter', () => setHighlight(+node.dataset.i));
        node.addEventListener('click', () => { selectIndex(+node.dataset.i); close(); trigger.focus(); });
      });
    }
    function setHighlight(i) {
      hiIndex = i;
      pop.querySelectorAll('.hcs-opt').forEach((n) => n.classList.toggle('hi', +n.dataset.i === i));
      trigger.setAttribute('aria-activedescendant', i >= 0 ? `${id}-opt-${i}` : '');
      const hiNode = pop.querySelector(`.hcs-opt[data-i="${i}"]`);
      if (hiNode) hiNode.scrollIntoView({ block: 'nearest' });
    }
    function selectIndex(i) {
      const o = options[i];
      if (!o) return;
      const changed = o.value !== value;
      value = o.value;
      renderValue();
      renderOptions();
      if (changed) onChange(value);
    }

    function position() {
      const r = trigger.getBoundingClientRect();
      pop.style.left = Math.round(r.left) + 'px';
      pop.style.top = Math.round(r.bottom + 4) + 'px';
      pop.style.minWidth = Math.round(r.width) + 'px';
      // Flip upward if there is not enough room below (toolbar selects near
      // the bottom of a short window, e.g. the Inbox toolbar on a small
      // viewport, must not run off-screen).
      const estH = Math.min(280, options.length * 34 + 8);
      if (r.bottom + 4 + estH > window.innerHeight && r.top - 4 - estH > 0) {
        pop.style.top = Math.round(r.top - 4 - estH) + 'px';
      }
    }
    function openPop() {
      if (open) return;
      closeAllExcept(instance);
      open = true;
      openInstances.add(instance);
      wrap.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      renderOptions();
      pop.hidden = false;
      position();
      const curIdx = Math.max(0, options.findIndex((o) => o.value === value));
      setHighlight(curIdx);
      document.addEventListener('mousedown', onOutside, true);
      window.addEventListener('resize', position);
      window.addEventListener('scroll', position, true);
    }
    function close() {
      if (!open) return;
      open = false;
      openInstances.delete(instance);
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      pop.hidden = true;
      hiIndex = -1;
      document.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    }
    function toggle() { if (open) close(); else openPop(); }
    function onOutside(e) {
      if (!wrap.contains(e.target) && !pop.contains(e.target)) close();
    }
    function onTriggerKey(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) { openPop(); return; }
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = (hiIndex + dir + options.length) % options.length;
        setHighlight(next);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!open) { openPop(); return; }
        if (hiIndex >= 0) { selectIndex(hiIndex); close(); trigger.focus(); }
      } else if (e.key === 'Escape') {
        if (open) { e.preventDefault(); close(); trigger.focus(); }
      } else if (e.key === 'Home' && open) { e.preventDefault(); setHighlight(0); }
      else if (e.key === 'End' && open) { e.preventDefault(); setHighlight(options.length - 1); }
      else if (e.key === 'Tab' && open) { close(); }
    }

    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', onTriggerKey);
    pop.addEventListener('keydown', onTriggerKey);

    renderValue();

    const instance = {
      setValue(v) { value = String(v); renderValue(); if (open) renderOptions(); },
      getValue() { return value; },
      destroy() { close(); wrap.remove(); },
      el: wrap,
    };
    return instance;
  }

  window.HcSelect = { create };
})();
