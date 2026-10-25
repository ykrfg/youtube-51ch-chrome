// Opaque-origin sandbox: no extension APIs, network, or parent DOM access.
function bindSolver(event) {
  if (event.source !== parent || event.data?.type !== 'bind-solver' || !event.ports[0]) return;
  window.removeEventListener('message', bindSolver);
  const port = event.ports[0];
  port.onmessage = ({data}) => {
    try {
      if (typeof data.code !== 'string' || data.code.length > 8_000_000) throw new Error('Invalid solver input');
      const value = new Function(data.code)();
      if (!value || typeof value !== 'object') throw new Error('Invalid solver result');
      port.postMessage({id:data.id, value:{n:value.n, sig:value.sig}});
    } catch (error) { port.postMessage({id:data.id, error:String(error.message)}); }
  };
  port.start();
}
window.addEventListener('message', bindSolver);
