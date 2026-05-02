

export const index = 6;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/trades/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/6.C0hFLBPW.js","_app/immutable/chunks/9FVOOZlH.js","_app/immutable/chunks/BHjEBGx7.js","_app/immutable/chunks/v_jBEYI6.js","_app/immutable/chunks/Go05uJOD.js","_app/immutable/chunks/CnwOe17Q.js"];
export const stylesheets = ["_app/immutable/assets/6.DG_spBon.css"];
export const fonts = [];
