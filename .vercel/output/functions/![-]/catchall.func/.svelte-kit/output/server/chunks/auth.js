import { D as writable } from "./dev.js";
import "./index-server2.js";
import { t as supabase } from "./supabase.js";
//#region src/lib/stores/auth.ts
var user = writable(null);
var session = writable(null);
var authLoading = writable(true);
async function initAuth() {
	const { data } = await supabase.auth.getSession();
	session.set(data.session);
	user.set(data.session?.user ?? null);
	authLoading.set(false);
	supabase.auth.onAuthStateChange((_event, newSession) => {
		session.set(newSession);
		user.set(newSession?.user ?? null);
	});
}
//#endregion
export { initAuth as n, user as r, authLoading as t };
