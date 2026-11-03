'use strict';

// The live workbench never loads the historical catalog.
(() => {
  function loadApp() {
    const app = document.createElement('script');
    app.src = 'app.js';
    document.body.appendChild(app);
  }
  if (new URLSearchParams(location.search).get('demo') === '1') {
    const sample = document.createElement('script');
    sample.src = 'data.js';
    sample.onload = loadApp;
    sample.onerror = () => {
      const status = document.querySelector('#gatewayStatus');
      if (status) status.textContent = '样例库加载失败，请刷新后重试。';
    };
    document.body.appendChild(sample);
  } else {
    loadApp();
  }
})();
