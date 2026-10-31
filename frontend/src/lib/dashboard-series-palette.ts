/** Stable metric identity: never index this palette by currently selected position. */
const palette = {
 income: { color: "#047857", dash: "", marker: "circle" },
 expenses: { color: "#b91c1c", dash: "7 4", marker: "square" },
 projects: { color: "#1d4ed8", dash: "2 4", marker: "diamond" },
 orders: { color: "#7e22ce", dash: "10 3 2 3", marker: "triangle" },
 clients: { color: "#92400e", dash: "4 3", marker: "circle" },
} as const;
export function dashboardSeriesStyle(key: string) {
 return Object.prototype.hasOwnProperty.call(palette,key) ? palette[key as keyof typeof palette] : {color:"#171717",dash:"",marker:"circle"} as const;
}
