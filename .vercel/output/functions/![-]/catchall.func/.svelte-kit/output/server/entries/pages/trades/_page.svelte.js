import { n as onDestroy } from "../../../chunks/index-server.js";
import { B as escape_html, a as ensure_array_like } from "../../../chunks/dev.js";
import "../../../chunks/supabase.js";
import { t as STRATEGIES } from "../../../chunks/types.js";
import "../../../chunks/trades.js";
//#region src/routes/trades/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let fStrategy = "";
		let fStatus = "";
		onDestroy(() => {});
		$$renderer.push(`<div class="page svelte-4z9rsc"><h1 class="svelte-4z9rsc">Сделки</h1> <div class="filters svelte-4z9rsc">`);
		$$renderer.select({ value: fStrategy }, ($$renderer) => {
			$$renderer.option({ value: "" }, ($$renderer) => {
				$$renderer.push(`Все стратегии`);
			});
			$$renderer.push(`<!--[-->`);
			const each_array = ensure_array_like(Object.values(STRATEGIES));
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let s = each_array[$$index];
				$$renderer.option({ value: s.id }, ($$renderer) => {
					$$renderer.push(`${escape_html(s.name)}`);
				});
			}
			$$renderer.push(`<!--]-->`);
		});
		$$renderer.push(` `);
		$$renderer.select({ value: fStatus }, ($$renderer) => {
			$$renderer.option({ value: "" }, ($$renderer) => {
				$$renderer.push(`Все статусы`);
			});
			$$renderer.option({ value: "OPEN" }, ($$renderer) => {
				$$renderer.push(`Открытые`);
			});
			$$renderer.option({ value: "PARTIAL" }, ($$renderer) => {
				$$renderer.push(`Частичный выход`);
			});
			$$renderer.option({ value: "CLOSED" }, ($$renderer) => {
				$$renderer.push(`Закрытые`);
			});
		});
		$$renderer.push(`</div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="state svelte-4z9rsc">Загрузка...</div>`);
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
export { _page as default };
