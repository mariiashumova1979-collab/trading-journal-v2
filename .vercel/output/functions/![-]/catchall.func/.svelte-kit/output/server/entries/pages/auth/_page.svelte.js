import { B as escape_html, z as attr } from "../../../chunks/dev.js";
import "../../../chunks/auth.js";
//#region src/routes/auth/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let email = "";
		let loading = false;
		$$renderer.push(`<div class="wrap svelte-1s728sz"><div class="box svelte-1s728sz"><div class="head svelte-1s728sz"><h1 class="svelte-1s728sz">Trading Journal</h1> <p class="svelte-1s728sz">Вход через magic link</p></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<form><div class="field svelte-1s728sz"><label for="email-input" class="svelte-1s728sz">Email</label> <input id="email-input" type="email"${attr("value", email)} required="" placeholder="you@example.com"${attr("disabled", loading, true)} class="svelte-1s728sz"/></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <button type="submit" class="btn-p svelte-1s728sz"${attr("disabled", true, true)}>${escape_html("Отправить ссылку")}</button></form>`);
		$$renderer.push(`<!--]--></div></div>`);
	});
}
//#endregion
export { _page as default };
