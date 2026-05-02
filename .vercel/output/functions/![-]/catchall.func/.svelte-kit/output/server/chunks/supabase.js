import { createClient } from "@supabase/supabase-js";
//#endregion
//#region src/lib/supabase.ts
var supabase = createClient("https://fsucbddujwozcxgaxutm.supabase.co", "sb_publishable_pzGc9Z1wIYSFcF5gbeE6lA_CAOzn-ri", { auth: {
	persistSession: true,
	autoRefreshToken: true,
	detectSessionInUrl: true
} });
//#endregion
export { supabase as t };
