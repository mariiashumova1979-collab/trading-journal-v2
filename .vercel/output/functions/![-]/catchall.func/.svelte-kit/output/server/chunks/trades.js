import { t as supabase } from "./supabase.js";
//#region src/lib/data/trades.ts
async function listTrades(filter) {
	let q = supabase.from("trades").select("*").order("entry_date", { ascending: false });
	if (filter?.strategy) q = q.eq("strategy", filter.strategy);
	if (filter?.status) q = q.eq("status", filter.status);
	const { data, error } = await q;
	if (error) throw error;
	return data || [];
}
function subscribeTrades(callback) {
	const channel = supabase.channel("trades_all").on("postgres_changes", {
		event: "*",
		schema: "public",
		table: "trades"
	}, (payload) => {
		callback({
			eventType: payload.eventType,
			new: payload.new,
			old: payload.old
		});
	}).subscribe();
	return () => {
		supabase.removeChannel(channel);
	};
}
//#endregion
export { subscribeTrades as n, listTrades as t };
