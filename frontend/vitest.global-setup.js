export default async () => {
  // Ensure Node-like process event hooks exist very early, before modules import
  // Use a unified object shared across global and globalThis
  const proc = (globalThis.process || global.process || {});
  if (typeof proc.on !== 'function') proc.on = () => {};
  if (typeof proc.removeListener !== 'function') proc.removeListener = () => {};
  // eslint-disable-next-line no-global-assign
  globalThis.process = proc;
  // eslint-disable-next-line no-undef
  global.process = proc;
};
