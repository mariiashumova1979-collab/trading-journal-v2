import "../../chunks/index-server.js";
import { $ as getContext, B as escape_html, a as ensure_array_like, c as stringify, l as unsubscribe_stores, n as attr_class, r as attr_style, s as store_get, z as attr } from "../../chunks/dev.js";
import "../../chunks/client.js";
import "../../chunks/navigation.js";
import { r as user, t as authLoading } from "../../chunks/auth.js";
import { t as STRATEGIES } from "../../chunks/types.js";
//#region node_modules/@sveltejs/kit/src/runtime/app/stores.js
/**
* A function that returns all of the contextual stores. On the server, this must be called during component initialization.
* Only use this if you need to defer store subscription until after the component has mounted, for some reason.
*
* @deprecated Use `$app/state` instead (requires Svelte 5, [see docs for more info](https://svelte.dev/docs/kit/migrating-to-sveltekit-2#SvelteKit-2.12:-$app-stores-deprecated))
*/
var getStores = () => {
	const stores$1 = getContext("__svelte__");
	return {
		/** @type {typeof page} */
		page: { subscribe: stores$1.page.subscribe },
		/** @type {typeof navigating} */
		navigating: { subscribe: stores$1.navigating.subscribe },
		/** @type {typeof updated} */
		updated: stores$1.updated
	};
};
/**
* A readable store whose value contains page data.
*
* On the server, this store can only be subscribed to during component initialization. In the browser, it can be subscribed to at any time.
*
* @deprecated Use `page` from `$app/state` instead (requires Svelte 5, [see docs for more info](https://svelte.dev/docs/kit/migrating-to-sveltekit-2#SvelteKit-2.12:-$app-stores-deprecated))
* @type {import('svelte/store').Readable<import('@sveltejs/kit').Page>}
*/
var page = { subscribe(fn) {
	return getStores().page.subscribe(fn);
} };
//#endregion
//#region src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let { children } = $$props;
		if (store_get($$store_subs ??= {}, "$authLoading", authLoading)) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="loader svelte-12qhfyh">Загрузка...</div>`);
		} else if (!store_get($$store_subs ??= {}, "$user", user)) {
			$$renderer.push("<!--[1-->");
			children($$renderer);
			$$renderer.push(`<!---->`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<header class="svelte-12qhfyh"><div class="hdr svelte-12qhfyh"><div class="brand svelte-12qhfyh">TRADING JOURNAL</div> <nav class="tabs svelte-12qhfyh"><!--[-->`);
			const each_array = ensure_array_like(Object.values(STRATEGIES));
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let s = each_array[$$index];
				const isActiveTab = store_get($$store_subs ??= {}, "$page", page).url.pathname.startsWith("/scanner/" + s.id);
				$$renderer.push(`<a${attr("href", s.active ? "/scanner/" + s.id : "#")}${attr_class("tab svelte-12qhfyh", void 0, {
					"tab-active": isActiveTab,
					"tab-disabled": !s.active
				})}${attr_style(`--tab-color: ${stringify(s.color)}`)}>${escape_html(s.icon)} ${escape_html(s.name)}</a>`);
			}
			$$renderer.push(`<!--]--></nav> <div class="user-area svelte-12qhfyh"><a href="/trades"${attr_class("trades-link svelte-12qhfyh", void 0, { "active": store_get($$store_subs ??= {}, "$page", page).url.pathname === "/trades" })}>Сделки</a> <span class="user-email svelte-12qhfyh">${escape_html(store_get($$store_subs ??= {}, "$user", user).email)}</span> <button class="signout-btn svelte-12qhfyh">Выйти</button></div></div></header> <main class="svelte-12qhfyh">`);
			children($$renderer);
			$$renderer.push(`<!----></main>`);
		}
		$$renderer.push(`<!--]-->`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _layout as default };
