import { n as onDestroy } from "../../../../chunks/index-server.js";
import { B as escape_html, a as ensure_array_like, c as stringify, l as unsubscribe_stores, r as attr_style, z as attr } from "../../../../chunks/dev.js";
import { t as supabase } from "../../../../chunks/supabase.js";
import "../../../../chunks/auth.js";
import "../../../../chunks/trades.js";
//#region src/lib/data/candidates.ts
async function listCandidates(strategy) {
	const { data, error } = await supabase.from("candidates").select("*").eq("strategy", strategy).order("created_at", { ascending: false });
	if (error) throw error;
	return data || [];
}
//#endregion
//#region src/lib/strategies/impulse.ts
function calculatePosition(entry, stop, atr, risk_amount, direction) {
	const risk_per_share = direction === "LONG" ? entry - stop : stop - entry;
	const shares = risk_per_share > 0 ? Math.floor(risk_amount / risk_per_share) : 0;
	const position_value = shares * entry;
	const risk_atr_ratio = atr > 0 ? risk_per_share / atr : 0;
	const target1 = direction === "LONG" ? entry + risk_per_share : entry - risk_per_share;
	const target2 = direction === "LONG" ? entry + 2 * risk_per_share : entry - 2 * risk_per_share;
	return {
		entry,
		stop,
		risk_per_share,
		shares,
		position_value,
		risk_amount: shares * risk_per_share,
		risk_atr_ratio,
		target1,
		target2,
		risk_warning: risk_atr_ratio > 1.5
	};
}
//#endregion
//#region src/lib/components/ImpulseForm.svelte
function ImpulseForm($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let { onClose, onAdded } = $$props;
		let ticker = "";
		let d0Date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
		let d_1_C = "";
		let d0_O = "";
		let d0_H = "";
		let d0_L = "";
		let d0_C = "";
		let d0_V = "";
		let atr = "";
		let relVol = "";
		let riskAmt = "100";
		let errors = [];
		$$renderer.push(`<div class="mo-bg svelte-1eacxn1" role="presentation"><div class="mo svelte-1eacxn1" role="dialog"><div class="mh svelte-1eacxn1"><div>Добавить импульсного кандидата</div> <button class="cls svelte-1eacxn1" aria-label="Close">×</button></div> <div class="hint svelte-1eacxn1"><div><b class="svelte-1eacxn1">D0 LONG:</b> Move +5% to +12%, CLV > 0.70, Body > 0.50, RelVol >= 1.5</div> <div><b class="svelte-1eacxn1">D0 SHORT:</b> Move -5% to -12%, CLV &lt; 0.30, Body > 0.50, RelVol >= 1.5</div> <div><b class="svelte-1eacxn1">D+1:</b> Inside Day OR Weak Pullback OR Compression</div> <div><b class="svelte-1eacxn1">Entry D+2:</b> LONG = High_D0 + 0.1*ATR; SHORT = Low_D0 - 0.1*ATR</div> <div><b class="svelte-1eacxn1">Stop:</b> LONG = Low_D0 - 0.2*ATR; SHORT = High_D0 + 0.2*ATR</div></div> <div class="row svelte-1eacxn1"><div class="fg svelte-1eacxn1"><label for="if-ticker" class="svelte-1eacxn1">Ticker</label> <input id="if-ticker"${attr("value", ticker)} placeholder="NVDA" class="up svelte-1eacxn1"/></div> <div class="fg svelte-1eacxn1"><label for="if-d0date" class="svelte-1eacxn1">D0 date</label> <input id="if-d0date" type="date"${attr("value", d0Date)} class="svelte-1eacxn1"/></div></div> <div class="shdif svelte-1eacxn1">Day D-1</div> <div class="row row-5 svelte-1eacxn1"><div class="fg svelte-1eacxn1"><label for="if-d1c" class="svelte-1eacxn1">Close</label> <input id="if-d1c"${attr("value", d_1_C)} inputmode="decimal" class="svelte-1eacxn1"/></div> <div></div><div></div><div></div><div></div></div> <div class="shdif svelte-1eacxn1">Day D0 (impulse)</div> <div class="row row-5 svelte-1eacxn1"><div class="fg svelte-1eacxn1"><label for="if-d0o" class="svelte-1eacxn1">Open</label><input id="if-d0o"${attr("value", d0_O)} inputmode="decimal" class="svelte-1eacxn1"/></div> <div class="fg svelte-1eacxn1"><label for="if-d0h" class="svelte-1eacxn1">High</label><input id="if-d0h"${attr("value", d0_H)} inputmode="decimal" class="svelte-1eacxn1"/></div> <div class="fg svelte-1eacxn1"><label for="if-d0l" class="svelte-1eacxn1">Low</label><input id="if-d0l"${attr("value", d0_L)} inputmode="decimal" class="svelte-1eacxn1"/></div> <div class="fg svelte-1eacxn1"><label for="if-d0c" class="svelte-1eacxn1">Close</label><input id="if-d0c"${attr("value", d0_C)} inputmode="decimal" class="svelte-1eacxn1"/></div> <div class="fg svelte-1eacxn1"><label for="if-d0v" class="svelte-1eacxn1">Volume</label><input id="if-d0v"${attr("value", d0_V)} inputmode="numeric" class="svelte-1eacxn1"/></div></div> <div class="shdif svelte-1eacxn1">Metrics &amp; risk</div> <div class="row row-3 svelte-1eacxn1"><div class="fg svelte-1eacxn1"><label for="if-atr" class="svelte-1eacxn1">ATR(14)</label><input id="if-atr"${attr("value", atr)} inputmode="decimal" class="svelte-1eacxn1"/></div> <div class="fg svelte-1eacxn1"><label for="if-relvol" class="svelte-1eacxn1">RelVol</label><input id="if-relvol"${attr("value", relVol)} inputmode="decimal" class="svelte-1eacxn1"/></div> <div class="fg svelte-1eacxn1"><label for="if-risk" class="svelte-1eacxn1">Риск $</label><input id="if-risk"${attr("value", riskAmt)} inputmode="numeric" class="svelte-1eacxn1"/></div></div> `);
		if (errors.length) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="err svelte-1eacxn1"><!--[-->`);
			const each_array = ensure_array_like(errors);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let e = each_array[$$index];
				$$renderer.push(`<div>• ${escape_html(e)}</div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="ar svelte-1eacxn1"><button>Отмена</button> <button>Рассчитать</button> <button${attr("disabled", true, true)} class="btn-p">${escape_html("Добавить")}</button></div></div></div>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/lib/components/D1Form.svelte
function D1Form($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { candidate, onClose, onUpdated } = $$props;
		let d1_O = "";
		let d1_H = "";
		let d1_L = "";
		let d1_C = "";
		let errors = [];
		$$renderer.push(`<div class="mo-bg svelte-1ns79f7" role="presentation"><div class="mo svelte-1ns79f7" role="dialog"><div class="mh svelte-1ns79f7"><div>D+1 — ${escape_html(candidate.ticker)} (${escape_html(candidate.direction)})</div> <button class="cls svelte-1ns79f7" aria-label="Close">×</button></div> <div class="info svelte-1ns79f7"><div>D0 (${escape_html(candidate.signal_date)}): O=${escape_html(candidate.payload?.d0.O?.toFixed(2))} H=${escape_html(candidate.payload?.d0.H?.toFixed(2))} L=${escape_html(candidate.payload?.d0.L?.toFixed(2))} C=${escape_html(candidate.payload?.d0.C?.toFixed(2))}</div> <div>ATR=${escape_html(candidate.payload?.atr?.toFixed(2))} · RelVol=${escape_html(candidate.payload?.rel_vol?.toFixed(2))}x</div></div> <div class="hint svelte-1ns79f7"><div><b class="svelte-1ns79f7">Ищем один из паттернов:</b></div> <div>• <b class="svelte-1ns79f7">Inside Day:</b> H1 ≤ H_D0 AND L1 ≥ L_D0 (день внутри предыдущего)</div> `);
		if (candidate.direction === "LONG") {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div>• <b class="svelte-1ns79f7">Weak Pullback:</b> L1 > Mid_D0 AND retracement &lt; 50% AND C1 > Mid_D0</div> <div>• <b class="svelte-1ns79f7">Compression:</b> Range1/Range_D0 &lt; 0.5 AND |C1 − C_D0| &lt; 0.3·Range_D0 AND C1 > Mid_D0</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div>• <b class="svelte-1ns79f7">Weak Pullback:</b> H1 &lt; Mid_D0 AND retracement &lt; 50% AND C1 &lt; Mid_D0</div> <div>• <b class="svelte-1ns79f7">Compression:</b> Range1/Range_D0 &lt; 0.5 AND |C1 − C_D0| &lt; 0.3·Range_D0 AND C1 &lt; Mid_D0</div>`);
		}
		$$renderer.push(`<!--]--></div> <div class="shdif svelte-1ns79f7">Day D+1</div> <div class="row row-4 svelte-1ns79f7"><div class="fg svelte-1ns79f7"><label for="d1-o" class="svelte-1ns79f7">Open</label><input id="d1-o"${attr("value", d1_O)} inputmode="decimal" class="svelte-1ns79f7"/></div> <div class="fg svelte-1ns79f7"><label for="d1-h" class="svelte-1ns79f7">High</label><input id="d1-h"${attr("value", d1_H)} inputmode="decimal" class="svelte-1ns79f7"/></div> <div class="fg svelte-1ns79f7"><label for="d1-l" class="svelte-1ns79f7">Low</label><input id="d1-l"${attr("value", d1_L)} inputmode="decimal" class="svelte-1ns79f7"/></div> <div class="fg svelte-1ns79f7"><label for="d1-c" class="svelte-1ns79f7">Close</label><input id="d1-c"${attr("value", d1_C)} inputmode="decimal" class="svelte-1ns79f7"/></div></div> `);
		if (errors.length) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="err svelte-1ns79f7"><!--[-->`);
			const each_array = ensure_array_like(errors);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let e = each_array[$$index];
				$$renderer.push(`<div>• ${escape_html(e)}</div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="ar svelte-1ns79f7"><button>Отмена</button> <button>Рассчитать</button> <button${attr("disabled", true, true)} class="btn-p">${escape_html("Сохранить D+1")}</button></div></div></div>`);
	});
}
//#endregion
//#region src/lib/components/TradeForm.svelte
function TradeForm($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let { candidate, onClose, onSaved } = $$props;
		let entryDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
		let entryActual = (candidate.entry || 0).toFixed(2);
		let riskAmt = "100";
		let commission = "0";
		let errors = [];
		$$renderer.push(`<div class="mo-bg svelte-sm4c74" role="presentation"><div class="mo svelte-sm4c74" role="dialog"><div class="mh svelte-sm4c74"><div>Открыть сделку — ${escape_html(candidate.ticker)} (${escape_html(candidate.direction)})</div> <button class="cls svelte-sm4c74" aria-label="Close">×</button></div> <div class="info svelte-sm4c74"><div>Pattern D+1: <b class="svelte-sm4c74">${escape_html(candidate.payload?.pattern || "не подтверждён")}</b></div> <div>Calculated entry: $${escape_html(candidate.entry?.toFixed(2))} · Stop: $${escape_html(candidate.stop !== null ? Number(candidate.stop).toFixed(2) : "—")}</div> <div>ATR: ${escape_html(candidate.payload?.atr?.toFixed(2))} · 0.2×ATR: ${escape_html(candidate.payload?.atr ? (.2 * candidate.payload.atr).toFixed(2) : "—")}</div></div> <div class="row svelte-sm4c74"><div class="fg svelte-sm4c74"><label for="tf-date" class="svelte-sm4c74">Дата входа</label> <input id="tf-date" type="date"${attr("value", entryDate)} class="svelte-sm4c74"/></div> <div class="fg svelte-sm4c74"><label for="tf-entry" class="svelte-sm4c74">Фактический Entry</label> <input id="tf-entry"${attr("value", entryActual)} inputmode="decimal" class="svelte-sm4c74"/></div></div> <div class="row svelte-sm4c74"><div class="fg svelte-sm4c74"><label for="tf-risk" class="svelte-sm4c74">Риск $</label> <input id="tf-risk"${attr("value", riskAmt)} inputmode="numeric" class="svelte-sm4c74"/></div> <div class="fg svelte-sm4c74"><label for="tf-comm" class="svelte-sm4c74">Комиссия $</label> <input id="tf-comm"${attr("value", commission)} inputmode="decimal" class="svelte-sm4c74"/></div></div> `);
		if (errors.length) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="err svelte-sm4c74"><!--[-->`);
			const each_array = ensure_array_like(errors);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let e = each_array[$$index];
				$$renderer.push(`<div>• ${escape_html(e)}</div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="ar svelte-sm4c74"><button>Отмена</button> <button>Рассчитать</button> <button${attr("disabled", true, true)} class="btn-p">${escape_html("Открыть сделку")}</button></div></div></div>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/routes/scanner/impulse/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let candidates = [];
		let showAddForm = false;
		let d1Candidate = null;
		let tradeCandidate = null;
		let loading = true;
		let error = null;
		async function load() {
			try {
				loading = true;
				candidates = await listCandidates("impulse");
				error = null;
			} catch (e) {
				error = e.message || String(e);
			} finally {
				loading = false;
			}
		}
		onDestroy(() => {});
		function statusLabel(s) {
			return {
				WAITING_D1: "Ждём D+1",
				READY_ENTRY: "Готов вход",
				WAITING_OPEN: "Ждём Open",
				GAP_CANCEL: "Gap отмена",
				ENTERED: "В сделке",
				CLOSED: "Закрыта",
				REJECTED: "Отклонён"
			}[s] || s;
		}
		function statusColor(s) {
			if (s === "READY_ENTRY") return "var(--color-acc)";
			if (s === "ENTERED") return "var(--color-acc4)";
			if (s === "CLOSED") return "var(--color-t3)";
			if (s === "REJECTED" || s === "GAP_CANCEL") return "var(--color-acc2)";
			return "var(--color-acc3)";
		}
		function getProjectedPosition(c) {
			if (!c.entry || c.stop === null || c.stop === void 0 || !c.direction || !c.payload?.atr) return null;
			return calculatePosition(c.entry, Number(c.stop), c.payload.atr, 100, c.direction);
		}
		function isActive(s) {
			return s === "WAITING_D1" || s === "READY_ENTRY" || s === "WAITING_OPEN";
		}
		$$renderer.push(`<div class="page svelte-1c4bv59"><div class="head svelte-1c4bv59"><div><h1 class="svelte-1c4bv59">Impulse Scanner</h1> <p class="sub svelte-1c4bv59">Импульсное движение D0 + подтверждение паттерна на D+1</p></div> <button class="btn-p">+ Добавить кандидата</button></div> <div class="hint svelte-1c4bv59"><div><b class="svelte-1c4bv59">D0 LONG:</b> Move +5..+12%, CLV > 0.70, Body > 0.50, RelVol >= 1.5</div> <div><b class="svelte-1c4bv59">D0 SHORT:</b> Move -5..-12%, CLV &lt; 0.30, Body > 0.50, RelVol >= 1.5</div> <div><b class="svelte-1c4bv59">D+1:</b> Inside Day OR Weak Pullback OR Compression</div> <div><b class="svelte-1c4bv59">Entry D+2 (LONG):</b> High_D0 + 0.1*ATR · <b class="svelte-1c4bv59">Stop:</b> Low_D0 - 0.2*ATR</div> <div><b class="svelte-1c4bv59">Entry D+2 (SHORT):</b> Low_D0 - 0.1*ATR · <b class="svelte-1c4bv59">Stop:</b> High_D0 + 0.2*ATR</div></div> `);
		if (loading) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="state svelte-1c4bv59">Загрузка...</div>`);
		} else if (error) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="state err svelte-1c4bv59">Ошибка: ${escape_html(error)}</div>`);
		} else if (candidates.length === 0) {
			$$renderer.push("<!--[2-->");
			$$renderer.push(`<div class="state svelte-1c4bv59">Нет кандидатов. Нажми «+ Добавить кандидата».</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="tw svelte-1c4bv59"><table><thead><tr><th>Ticker</th><th>D0 Date</th><th>Dir</th><th>Imp%</th><th>CLV</th><th>Body</th><th>RelVol</th><th>Pattern</th><th>Entry</th><th>Stop</th><th>Status</th><th>Actions</th></tr></thead><tbody><!--[-->`);
			const each_array = ensure_array_like(candidates);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let c = each_array[$$index];
				const m = c.payload?.metrics;
				const dirColor = c.direction === "LONG" ? "var(--color-acc)" : "var(--color-acc2)";
				const proj = getProjectedPosition(c);
				$$renderer.push(`<tr><td><b>${escape_html(c.ticker)}</b></td><td>${escape_html(c.signal_date ?? "—")}</td><td><span${attr_style(`color:${stringify(dirColor)};font-weight:700`)}>${escape_html(c.direction ?? "—")}</span></td><td>${escape_html(m?.impulse !== void 0 ? (m.impulse >= 0 ? "+" : "") + (m.impulse * 100).toFixed(1) + "%" : "—")}</td><td>${escape_html(m?.clv !== void 0 ? m.clv.toFixed(2) : "—")}</td><td>${escape_html(m?.body !== void 0 ? m.body.toFixed(2) : "—")}</td><td>${escape_html(m?.vol_ratio !== void 0 ? m.vol_ratio.toFixed(1) + "x" : "—")}</td><td>${escape_html(c.payload?.pattern ?? "—")}</td><td>${escape_html(c.entry !== null ? "$" + c.entry.toFixed(2) : "—")}</td><td>${escape_html(c.stop !== null && c.stop !== void 0 ? "$" + Number(c.stop).toFixed(2) : "—")}</td><td><span${attr_style(`color:${stringify(statusColor(c.status))}`)}>${escape_html(statusLabel(c.status))}</span></td><td class="acts svelte-1c4bv59">`);
				if (c.status === "WAITING_D1") {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<button style="font-size:9px;padding:4px 8px">+ D+1</button>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (c.status === "READY_ENTRY") {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<button class="btn-p" style="font-size:9px;padding:4px 8px">+ Сделка</button>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <button class="btn-r" style="font-size:9px;padding:4px 8px">×</button></td></tr> `);
				if (proj && isActive(c.status)) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<tr class="proj-row svelte-1c4bv59"><td colspan="12" class="svelte-1c4bv59"><span class="proj-label svelte-1c4bv59">Прогноз позиции (риск $100):</span> Stop $${escape_html(proj.stop.toFixed(2))} · Risk/share $${escape_html(proj.risk_per_share.toFixed(2))} · Risk/ATR ${escape_html(proj.risk_atr_ratio.toFixed(2))}${escape_html(proj.risk_warning ? " ⚠" : "")} · Shares <b>${escape_html(proj.shares)}</b> · Size $${escape_html(proj.position_value.toFixed(0))} · T1 $${escape_html(proj.target1.toFixed(2))} · T2 $${escape_html(proj.target2.toFixed(2))}</td></tr>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></tbody></table></div>`);
		}
		$$renderer.push(`<!--]--></div> `);
		if (showAddForm) {
			$$renderer.push("<!--[0-->");
			ImpulseForm($$renderer, {
				onClose: () => showAddForm = false,
				onAdded: load
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (d1Candidate) {
			$$renderer.push("<!--[0-->");
			D1Form($$renderer, {
				candidate: d1Candidate,
				onClose: () => d1Candidate = null,
				onUpdated: load
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (tradeCandidate) {
			$$renderer.push("<!--[0-->");
			TradeForm($$renderer, {
				candidate: tradeCandidate,
				onClose: () => tradeCandidate = null,
				onSaved: load
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _page as default };
