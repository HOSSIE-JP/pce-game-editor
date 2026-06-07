export function createPluginRuntime() {
  return {
    activations: new Map(),
    capabilities: new Map(),
    capabilityWaiters: new Map(),
    hostRoots: [],
    styleLinks: [],
    eventTarget: new EventTarget(),
  };
}

export function registerRuntimeCapability(runtime, plugin, name, implementation = {}) {
  const capability = String(name || '').trim();
  if (!capability) return;
  const entries = runtime.capabilities.get(capability) || [];
  entries.push({ pluginId: plugin.id, implementation });
  runtime.capabilities.set(capability, entries);

  const waiters = runtime.capabilityWaiters.get(capability) || [];
  waiters.forEach((resolve) => resolve(implementation));
  runtime.capabilityWaiters.delete(capability);

  runtime.eventTarget.dispatchEvent(new CustomEvent('capability:registered', {
    detail: { capability, pluginId: plugin.id, implementation },
  }));
}

export function getRuntimeCapability(runtime, name, isEnabled) {
  const entries = runtime.capabilities.get(name) || [];
  return entries.find((entry) => isEnabled(entry.pluginId))?.implementation || null;
}

export function getRuntimeCapabilities(runtime, name, isEnabled) {
  const entries = runtime.capabilities.get(name) || [];
  return entries
    .filter((entry) => isEnabled(entry.pluginId))
    .map((entry) => entry.implementation)
    .sort((a, b) => Number(b?.priority || 0) - Number(a?.priority || 0));
}

export function listRuntimeCapabilities(runtime, isEnabled) {
  return Array.from(runtime.capabilities.entries()).map(([name, entries]) => ({
    name,
    providers: entries
      .filter((entry) => isEnabled(entry.pluginId))
      .map((entry) => entry.pluginId),
  })).filter((entry) => entry.providers.length > 0);
}

export function waitForRuntimeCapability(runtime, name, timeoutMs, getCurrent) {
  const capability = String(name || '').trim();
  if (!capability) return Promise.resolve(null);
  const current = getCurrent(capability);
  if (current) return Promise.resolve(current);

  return new Promise((resolve) => {
    const waiters = runtime.capabilityWaiters.get(capability) || [];
    const timer = window.setTimeout(() => {
      const next = runtime.capabilityWaiters.get(capability) || [];
      const remaining = next.filter((fn) => fn !== done);
      if (remaining.length > 0) {
        runtime.capabilityWaiters.set(capability, remaining);
      } else {
        runtime.capabilityWaiters.delete(capability);
      }
      resolve(null);
    }, Math.max(0, Number(timeoutMs) || 0));

    function done(implementation) {
      window.clearTimeout(timer);
      resolve(implementation || null);
    }

    waiters.push(done);
    runtime.capabilityWaiters.set(capability, waiters);
  });
}

export function clearPluginRuntime(runtime, onDeactivateError) {
  runtime.activations.forEach((activation) => {
    try {
      activation?.deactivate?.();
    } catch (err) {
      onDeactivateError?.(err);
    }
  });
  runtime.activations.clear();
  runtime.capabilities.clear();
  runtime.capabilityWaiters.forEach((waiters) => waiters.forEach((resolve) => resolve(null)));
  runtime.capabilityWaiters.clear();
  runtime.styleLinks.forEach((link) => link.remove());
  runtime.styleLinks = [];
  runtime.hostRoots.forEach((root) => root.remove());
  runtime.hostRoots = [];
  runtime.eventTarget = new EventTarget();
}
