// ==UserScript==
// @name         Site's Password Protection
// @namespace    spp.local
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/frostbittenbull/TamperMonkey-Scripts/main/Security-Tools/Sites-Password-Protection.user.js
// @downloadURL  https://raw.githubusercontent.com/frostbittenbull/TamperMonkey-Scripts/main/Security-Tools/Sites-Password-Protection.user.js
// @description  Блокирует выбранные сайты чёрным экраном с паролем, пока не введён верный код
// @icon         https://img.icons8.com/?size=100&id=10480&format=png&color=000000
// @icon64       https://img.icons8.com/?size=100&id=10480&format=png&color=000000
// @author       frostbittenbull
// @match        http://*/*
// @match        https://*/*
// @noframes
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  async function sppHash(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function sppHost() {
    return location.hostname.replace(/^www\./, '');
  }

  function sppIsTargetSite() {
    const sites = GM_getValue('spp_sites', []);
    const host = sppHost();
    return sites.some((s) => host === s || host.endsWith('.' + s) || host.includes(s));
  }

  GM_addStyle(`
    html.spp-lock { visibility: hidden !important; }

    .spp-backdrop {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }

    #spp-overlay.spp-backdrop {
      visibility: visible !important;
      background: #000;
    }

    .spp-dialog-backdrop {
      background: rgba(0, 0, 0, 0.75);
    }

    .spp-modal {
      visibility: visible !important;
      width: 360px;
      max-width: 90vw;
      box-sizing: border-box;
      background: linear-gradient(180deg, #1a0000 0%, #0a0000 100%);
      border: 1px solid #ff1a1a;
      border-radius: 12px;
      padding: 32px 28px;
      text-align: center;
      box-shadow: 0 0 20px 2px rgba(255, 0, 0, 0.6);
      animation: spp-pulse 2s ease-in-out infinite;
    }

    .spp-modal--wide {
      width: 420px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      text-align: left;
      padding: 24px 24px 20px;
    }

    .spp-icon {
      font-size: 42px;
      margin-bottom: 12px;
      filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.8));
    }

    .spp-title {
      color: #ff3333;
      font-size: 17px;
      font-weight: 700;
      letter-spacing: 0.5px;
      line-height: 1.4;
      margin-bottom: 8px;
      text-shadow: 0 0 8px rgba(255, 0, 0, 0.7);
    }

    .spp-modal--wide .spp-title { margin-bottom: 14px; }

    .spp-subtitle {
      color: #cc8888;
      font-size: 13px;
      margin-bottom: 20px;
    }

    .spp-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      background: #150000;
      border: 1px solid #660000;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      outline: none;
      margin-bottom: 14px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .spp-input:focus {
      border-color: #ff3333;
      box-shadow: 0 0 8px rgba(255, 0, 0, 0.5);
    }

    .spp-btn {
      width: 100%;
      padding: 10px 12px;
      background: #cc0000;
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
    }

    .spp-btn:hover { background: #ff1a1a; }
    .spp-btn:active { transform: scale(0.98); }

    .spp-error {
      min-height: 18px;
      margin-top: 12px;
      color: #ff6666;
      font-size: 12px;
    }

    .spp-success {
      min-height: 18px;
      margin-top: 12px;
      color: #66ff99;
      font-size: 12px;
    }

    .spp-modal.spp-shake { animation: spp-pulse 2s ease-in-out infinite, spp-shake 0.4s; }

    @keyframes spp-pulse {
      0%, 100% { box-shadow: 0 0 20px 2px rgba(255, 0, 0, 0.6); }
      50% { box-shadow: 0 0 34px 6px rgba(255, 0, 0, 0.95); }
    }

    @keyframes spp-shake {
      10%, 90% { transform: translateX(-2px); }
      20%, 80% { transform: translateX(4px); }
      30%, 50%, 70% { transform: translateX(-8px); }
      40%, 60% { transform: translateX(8px); }
    }

    .spp-manage-list {
      overflow-y: auto;
      margin-bottom: 14px;
      border: 1px solid #440000;
      border-radius: 8px;
      min-height: 40px;
    }

    .spp-manage-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      color: #fff;
      font-size: 13px;
      border-bottom: 1px solid #330000;
    }

    .spp-manage-item:last-child { border-bottom: none; }

    .spp-manage-empty {
      padding: 14px 12px;
      color: #886666;
      font-size: 13px;
      text-align: center;
    }

    .spp-manage-del {
      background: transparent;
      border: 1px solid #660000;
      color: #ff6666;
      border-radius: 6px;
      width: 26px;
      height: 26px;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      flex-shrink: 0;
      margin-left: 10px;
      transition: background 0.2s, color 0.2s;
    }

    .spp-manage-del:hover { background: #cc0000; color: #fff; }

    .spp-manage-addrow {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }

    .spp-manage-addrow .spp-input { margin-bottom: 0; flex: 1; }

    .spp-manage-addrow .spp-btn { width: auto; white-space: nowrap; }
  `);

  function closeOnBackdropClick(wrap) {
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) wrap.remove();
    });
  }

  function closeOnEscape(wrap) {
    function handler(e) {
      if (e.key === 'Escape') {
        wrap.remove();
        document.removeEventListener('keydown', handler);
      }
    }
    document.addEventListener('keydown', handler);
  }

  function showOverlay() {
    if (document.getElementById('spp-overlay')) return;

    const wrap = document.createElement('div');
    wrap.id = 'spp-overlay';
    wrap.className = 'spp-backdrop';
    wrap.innerHTML = `
      <div class="spp-modal">
        <div class="spp-icon">⛔</div>
        <div class="spp-title">САЙТ ЗАБЛОКИРОВАН<br>АДМИНИСТРАТОРОМ</div>
        <div class="spp-subtitle">Введите пароль для доступа</div>
        <input type="password" id="spp-pass-input" class="spp-input" placeholder="Пароль"
          autocomplete="off" name="spp-field-${Date.now()}"
          data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" />
        <button id="spp-submit-btn" class="spp-btn">Разблокировать</button>
        <div id="spp-error" class="spp-error"></div>
      </div>
    `;
    document.documentElement.appendChild(wrap);

    const input = wrap.querySelector('#spp-pass-input');
    const btn = wrap.querySelector('#spp-submit-btn');
    const errorEl = wrap.querySelector('#spp-error');
    const modal = wrap.querySelector('.spp-modal');

    async function trySubmit() {
      const val = input.value;
      if (!val) return;
      const hash = await sppHash(val);
      const stored = GM_getValue('spp_password', '');
      if (hash === stored) {
        observer.disconnect();
        document.documentElement.classList.remove('spp-lock');
        wrap.remove();
      } else {
        errorEl.textContent = 'Неверный пароль';
        modal.classList.remove('spp-shake');
        void modal.offsetWidth;
        modal.classList.add('spp-shake');
        input.value = '';
        input.focus();
      }
    }

    btn.addEventListener('click', trySubmit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') trySubmit();
    });

    const observer = new MutationObserver(() => {
      if (!document.getElementById('spp-overlay') && document.documentElement.classList.contains('spp-lock')) {
        document.documentElement.appendChild(wrap);
      }
    });
    observer.observe(document.documentElement, { childList: true });

    setTimeout(() => input.focus(), 100);
  }

  function toggleEnabled() {
    const enabled = GM_getValue('spp_enabled', true);
    GM_setValue('spp_enabled', !enabled);
    location.reload();
  }

  function showChangePasswordModal() {
    if (document.getElementById('spp-changepass-overlay')) return;

    const hasPassword = !!GM_getValue('spp_password', '');

    const wrap = document.createElement('div');
    wrap.id = 'spp-changepass-overlay';
    wrap.className = 'spp-backdrop spp-dialog-backdrop';
    wrap.innerHTML = `
      <div class="spp-modal">
        <div class="spp-icon">🔑</div>
        <div class="spp-title">Смена пароля</div>
        <div class="spp-subtitle">${hasPassword ? 'Введите текущий и новый пароль' : 'Задайте пароль для блокировки'}</div>
        ${hasPassword ? `<input type="password" id="spp-cp-current" class="spp-input" placeholder="Текущий пароль" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" />` : ''}
        <input type="password" id="spp-cp-new1" class="spp-input" placeholder="Новый пароль" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" />
        <input type="password" id="spp-cp-new2" class="spp-input" placeholder="Повторите новый пароль" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" />
        <button id="spp-cp-submit" class="spp-btn">Сохранить</button>
        <div id="spp-cp-error" class="spp-error"></div>
      </div>
    `;
    document.documentElement.appendChild(wrap);

    const currentInput = wrap.querySelector('#spp-cp-current');
    const new1Input = wrap.querySelector('#spp-cp-new1');
    const new2Input = wrap.querySelector('#spp-cp-new2');
    const submitBtn = wrap.querySelector('#spp-cp-submit');
    const errorEl = wrap.querySelector('#spp-cp-error');
    const modal = wrap.querySelector('.spp-modal');

    function shake() {
      modal.classList.remove('spp-shake');
      void modal.offsetWidth;
      modal.classList.add('spp-shake');
    }

    async function trySubmit() {
      errorEl.textContent = '';

      if (hasPassword) {
        const stored = GM_getValue('spp_password', '');
        const oldHash = await sppHash(currentInput.value);
        if (oldHash !== stored) {
          errorEl.textContent = 'Неверный текущий пароль';
          shake();
          currentInput.value = '';
          currentInput.focus();
          return;
        }
      }

      const p1 = new1Input.value;
      const p2 = new2Input.value;
      if (!p1.trim()) {
        errorEl.textContent = 'Введите новый пароль';
        shake();
        return;
      }
      if (p1 !== p2) {
        errorEl.textContent = 'Пароли не совпадают';
        shake();
        new2Input.value = '';
        new2Input.focus();
        return;
      }

      const hash = await sppHash(p1);
      GM_setValue('spp_password', hash);
      wrap.remove();
    }

    submitBtn.addEventListener('click', trySubmit);
    [currentInput, new1Input, new2Input].forEach((el) => {
      if (!el) return;
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') trySubmit();
      });
    });

    closeOnBackdropClick(wrap);
    closeOnEscape(wrap);

    setTimeout(() => (currentInput || new1Input).focus(), 100);
  }

  function showAddSiteModal() {
    if (document.getElementById('spp-addsite-overlay')) return;

    const wrap = document.createElement('div');
    wrap.id = 'spp-addsite-overlay';
    wrap.className = 'spp-backdrop spp-dialog-backdrop';
    wrap.innerHTML = `
      <div class="spp-modal">
        <div class="spp-icon">➕</div>
        <div class="spp-title">Добавить сайт в блокировку</div>
        <div class="spp-subtitle">Домен(ы) через запятую</div>
        <input type="text" id="spp-add-input" class="spp-input" placeholder="например: youtube.com" autocomplete="off" />
        <button id="spp-add-submit" class="spp-btn">Добавить</button>
        <div id="spp-add-status" class="spp-error"></div>
      </div>
    `;
    document.documentElement.appendChild(wrap);

    const input = wrap.querySelector('#spp-add-input');
    const submitBtn = wrap.querySelector('#spp-add-submit');
    const statusEl = wrap.querySelector('#spp-add-status');

    input.value = sppHost();

    function addFromInput() {
      const raw = input.value.trim().toLowerCase();
      if (!raw) return;
      const newSites = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const sites = GM_getValue('spp_sites', []);
      const merged = Array.from(new Set([...sites, ...newSites]));
      GM_setValue('spp_sites', merged);

      statusEl.className = 'spp-success';
      statusEl.textContent = 'Добавлено';
      setTimeout(() => wrap.remove(), 600);
    }

    submitBtn.addEventListener('click', addFromInput);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addFromInput();
    });

    closeOnBackdropClick(wrap);
    closeOnEscape(wrap);

    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
  }

  function showManageSitesModal() {
    if (document.getElementById('spp-manage-overlay')) return;

    const wrap = document.createElement('div');
    wrap.id = 'spp-manage-overlay';
    wrap.className = 'spp-backdrop spp-dialog-backdrop';
    wrap.innerHTML = `
      <div class="spp-modal spp-modal--wide">
        <div class="spp-title">Заблокированные сайты</div>
        <div class="spp-manage-list" id="spp-manage-list"></div>
        <div class="spp-manage-addrow">
          <input type="text" id="spp-manage-add-input" class="spp-input" placeholder="например: youtube.com" autocomplete="off" />
          <button id="spp-manage-add-btn" class="spp-btn">Добавить</button>
        </div>
        <button id="spp-manage-close-btn" class="spp-btn">Закрыть</button>
      </div>
    `;
    document.documentElement.appendChild(wrap);

    const listEl = wrap.querySelector('#spp-manage-list');
    const addInput = wrap.querySelector('#spp-manage-add-input');
    const addBtn = wrap.querySelector('#spp-manage-add-btn');
    const closeBtn = wrap.querySelector('#spp-manage-close-btn');

    function render() {
      const sites = GM_getValue('spp_sites', []);
      listEl.innerHTML = '';
      if (!sites.length) {
        const empty = document.createElement('div');
        empty.className = 'spp-manage-empty';
        empty.textContent = 'Список пуст';
        listEl.appendChild(empty);
        return;
      }
      sites.forEach((site) => {
        const row = document.createElement('div');
        row.className = 'spp-manage-item';

        const label = document.createElement('span');
        label.textContent = site;

        const delBtn = document.createElement('button');
        delBtn.className = 'spp-manage-del';
        delBtn.textContent = '✕';
        delBtn.title = 'Удалить';
        delBtn.addEventListener('click', () => {
          const updated = GM_getValue('spp_sites', []).filter((s) => s !== site);
          GM_setValue('spp_sites', updated);
          render();
        });

        row.appendChild(label);
        row.appendChild(delBtn);
        listEl.appendChild(row);
      });
    }

    function addFromInput() {
      const raw = addInput.value.trim().toLowerCase();
      if (!raw) return;
      const newSites = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const sites = GM_getValue('spp_sites', []);
      const merged = Array.from(new Set([...sites, ...newSites]));
      GM_setValue('spp_sites', merged);
      addInput.value = '';
      render();
    }

    addBtn.addEventListener('click', addFromInput);
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addFromInput();
    });
    closeBtn.addEventListener('click', () => wrap.remove());

    closeOnBackdropClick(wrap);
    closeOnEscape(wrap);

    render();
  }

  function registerMenu() {
    const enabled = GM_getValue('spp_enabled', true);
    GM_registerMenuCommand(enabled ? '🔴 Выключить защиту' : '🟢 Включить защиту', toggleEnabled);
    GM_registerMenuCommand('🔑 Сменить пароль', showChangePasswordModal);
    GM_registerMenuCommand('➕ Добавить сайт в список блокировки', showAddSiteModal);
    GM_registerMenuCommand('📋 Управление списком сайтов', showManageSitesModal);
  }

  registerMenu();

  const enabled = GM_getValue('spp_enabled', true);
  const password = GM_getValue('spp_password', '');

  if (enabled && password && sppIsTargetSite()) {
    document.documentElement.classList.add('spp-lock');
    const start = () => showOverlay();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})();
