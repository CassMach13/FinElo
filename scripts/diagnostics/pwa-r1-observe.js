// Observer only, injected in disposable loopback profiles; never imported by App.
(() => {
  if (location.hostname !== '127.0.0.1') return;
  const ids = new WeakMap();
  let sequence = 0;
  const worker = value => value ? {
    id: ids.get(value) || (ids.set(value, ++sequence), sequence),
    scriptURL: value.scriptURL, state: value.state,
  } : null;
  const state = registration => ({
    scope: registration?.scope,
    installing: worker(registration?.installing),
    waiting: worker(registration?.waiting),
    active: worker(registration?.active),
    controller: worker(navigator.serviceWorker?.controller),
  });
  const report = (event, detail = {}) => {
    void window.__pwaR1Report?.({event, browserTime: Date.now(), url: location.href, ...detail});
  };
  window.__pwaR1State = state;
  window.__pwaR1InitialController = navigator.serviceWorker?.controller;
  window.__pwaR1WorkerVersion = controller => new Promise(resolve => {
    if (!controller) return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close(); resolve(event.data);
    };
    controller.postMessage({type:'PWA_R1_VERSION'}, [channel.port2]);
  });
  window.__pwaR1ControllerVersion = () => window.__pwaR1WorkerVersion(navigator.serviceWorker?.controller);
  const watched = new WeakSet();
  const watchWorker = value => {
    if (!value || watched.has(value)) return;
    watched.add(value);
    value.addEventListener('statechange', () => report('worker-statechange', {worker: worker(value)}));
  };
  const registrations = new WeakSet();
  const observe = registration => {
    if (!registration || registrations.has(registration)) return registration;
    registrations.add(registration);
    report('registration-observed', state(registration));
    [registration.installing, registration.waiting, registration.active].forEach(watchWorker);
    registration.addEventListener('updatefound', () => {
      report('updatefound', state(registration));
      watchWorker(registration.installing);
    });
    return registration;
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => report('controllerchange', {
      controller: worker(navigator.serviceWorker.controller),
    }));
    // Observe calls made by the original UI. Return the exact native promise;
    // this side channel never initiates a registration/update/activation/reload.
    const nativeRegister = navigator.serviceWorker.register;
    navigator.serviceWorker.register = function (...args) {
      report('register-called', {script: String(args[0])});
      const promise = nativeRegister.apply(this, args);
      promise.then(observe).catch(error => report('register-rejected', {reason: String(error)}));
      return promise;
    };
    navigator.serviceWorker.getRegistration().then(observe).catch(() => {});
    navigator.serviceWorker.ready.then(observe).catch(() => {});
  }
  let lastPrompt;
  addEventListener('DOMContentLoaded', () => {
    report('document-ready', {revision: document.querySelector('meta[name="qa-build"]')?.content});
    const inspect = () => {
      const text = document.body?.textContent || '';
      const prompt = text.includes('Nova versão disponível!') ? 'needRefresh'
        : text.includes('App pronto para uso offline') ? 'offlineReady' : 'hidden';
      if (lastPrompt !== prompt) {
        lastPrompt = prompt;
        report('reload-prompt-dom-state', {stateInferredFromOriginalUI: prompt});
      }
    };
    new MutationObserver(inspect).observe(document.documentElement, {childList: true, subtree: true});
    inspect();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('button')?.textContent?.trim() === 'Atualizar Agora') {
      report('reload-prompt-original-button-click');
    }
  }, true);
})();
