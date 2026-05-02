import "../../../../chunks/index-server.js";
import { B as escape_html } from "../../../../chunks/dev.js";
import "../../../../chunks/client.js";
import "../../../../chunks/navigation.js";
import "../../../../chunks/supabase.js";
//#region src/routes/auth/callback/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<div class="wrap svelte-3cfahf">${escape_html("Авторизация...")}</div>`);
	});
}
//#endregion
export { _page as default };
