

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const universal = {
  "ssr": false,
  "prerender": false
};
export const universal_id = "src/routes/+layout.ts";
export const imports = ["_app/immutable/nodes/0.JCjKYsk7.js","_app/immutable/chunks/9FVOOZlH.js","_app/immutable/chunks/LL6TRIcz.js","_app/immutable/chunks/DIf9eeMQ.js","_app/immutable/chunks/UhT3OVMQ.js","_app/immutable/chunks/v_jBEYI6.js","_app/immutable/chunks/CRwSFlM1.js","_app/immutable/chunks/BHjEBGx7.js","_app/immutable/chunks/CnwOe17Q.js"];
export const stylesheets = ["_app/immutable/assets/0.WTDVONpW.css"];
export const fonts = [];
