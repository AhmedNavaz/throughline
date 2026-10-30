const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export const defaultPreferences = { provider: 'codex', model: null, effort: null, mode: 'edit', billing: 'subscription' };
export function preferencePatch(input, previous = {}) {
  const patch = {};
  if (input.theme !== undefined) {
    if (!['graphite', 'light'].includes(input.theme)) fail('Choose Graphite or Light.');
    patch.appearance = input.theme;
  }
  if (input.defaults !== undefined) {
    const value = input.defaults;
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Choose valid assistant defaults.');
    const next = { ...defaultPreferences, ...previous.defaults };
    for (const key of Object.keys(defaultPreferences)) if (value[key] !== undefined) next[key] = value[key];
    if (!['codex', 'claude'].includes(next.provider) || !['read', 'edit'].includes(next.mode) || !['subscription', 'api'].includes(next.billing)) fail('Choose a supported assistant, access level and billing preference.');
    if (next.model !== null && (typeof next.model !== 'string' || !next.model.trim() || next.model.length > 200)) fail('Choose a model or Provider default.');
    if (next.effort !== null && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(next.effort)) fail('Choose a supported effort or Provider default.');
    patch.defaults = next;
  }
  if (input.onboarding !== undefined) {
    const value = input.onboarding;
    if (!value || typeof value !== 'object' || !Number.isInteger(value.step) || value.step < 0 || value.step > 3) fail('Choose a valid setup step.');
    patch.onboarding = { ...previous.onboarding, step: value.step, dismissed: value.dismissed === true };
    if (value.completed === true) patch.onboarding.completedAt = new Date().toISOString();
  }
  return patch;
}
export function publicPreferences(config, hasProjects) {
  return { defaults: { ...defaultPreferences, ...config.defaults }, theme: config.appearance || 'graphite', onboarding: config.onboarding || { step: 0 }, firstRun: !hasProjects && !config.onboarding?.completedAt && !config.onboarding?.dismissed };
}
