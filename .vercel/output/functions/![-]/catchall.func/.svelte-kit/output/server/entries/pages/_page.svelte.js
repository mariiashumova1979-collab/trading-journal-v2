import { B as escape_html, a as ensure_array_like, c as stringify, n as attr_class, r as attr_style, z as attr } from "../../chunks/dev.js";
import { t as STRATEGIES } from "../../chunks/types.js";
//#region src/routes/+page.svelte
function _page($$renderer) {
	$$renderer.push(`<div class="page svelte-1uha8ag"><h1 class="svelte-1uha8ag">Trading Journal</h1> <p class="sub svelte-1uha8ag">Выбери стратегию для работы</p> <div class="grid svelte-1uha8ag"><!--[-->`);
	const each_array = ensure_array_like(Object.values(STRATEGIES));
	for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
		let s = each_array[$$index];
		$$renderer.push(`<a${attr("href", s.active ? "/scanner/" + s.id : "#")}${attr_class("card svelte-1uha8ag", void 0, { "disabled": !s.active })}><div class="icon svelte-1uha8ag">${escape_html(s.icon)}</div> <div class="name svelte-1uha8ag"${attr_style(`color:${stringify(s.color)}`)}>${escape_html(s.name)}</div> <div class="desc svelte-1uha8ag">${escape_html(s.description)}</div> `);
		if (!s.active) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="soon svelte-1uha8ag">Скоро</div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></a>`);
	}
	$$renderer.push(`<!--]--></div></div>`);
}
//#endregion
export { _page as default };
