//#region src/lib/types.ts
var STRATEGIES = {
	impulse: {
		id: "impulse",
		name: "Impulse",
		icon: "IMP",
		color: "#e74c3c",
		description: "Импульсное движение D0 с подтверждением на D+1",
		active: true
	},
	rspc: {
		id: "rspc",
		name: "RSPC",
		icon: "RSPC",
		color: "#f39c12",
		description: "Range-Strength Pullback Continuation",
		active: false
	},
	ibs_swing: {
		id: "ibs_swing",
		name: "IBS RSI(2)",
		icon: "IBS",
		color: "#3498db",
		description: "Mean reversion на RSI(2) + IBS",
		active: false
	},
	pead: {
		id: "pead",
		name: "PEAD",
		icon: "PEAD",
		color: "#9b59b6",
		description: "Post-earnings drift",
		active: false
	},
	event_continuation: {
		id: "event_continuation",
		name: "Event",
		icon: "EVT",
		color: "#f1c40f",
		description: "Event continuation после impulse",
		active: false
	}
};
//#endregion
export { STRATEGIES as t };
