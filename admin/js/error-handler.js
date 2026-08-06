// Error overlay handler — loaded before app.js; external file to satisfy CSP script-src 'self'
window.addEventListener('error', function(e) {
  var o = document.getElementById('err-overlay');
  o.textContent = '[JS Error]\n' + (e.message || '') + '\n\nFile: ' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || '') + '\n\nStack:\n' + (e.error && e.error.stack || 'N/A');
  o.classList.add('show');
});
window.addEventListener('unhandledrejection', function(e) {
  var o = document.getElementById('err-overlay');
  o.textContent = '[Promise Rejection]\n' + (e.reason && (e.reason.message || e.reason.stack || String(e.reason)) || 'N/A');
  o.classList.add('show');
});
