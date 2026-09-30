// The view mode: "3d" (WebGL globe), "ascii" (text only) or "html" (a basic document). #ascii / #html open those;
// otherwise the last choice, then 3D.
export let MODE = (() => {
  const known = ["3d", "ascii", "html"];
  if (known.includes(location.hash.slice(1))) return location.hash.slice(1);
  try { const v = localStorage.getItem("site-mode"); if (known.includes(v)) return v; } catch (e) {}
  return "3d";
})();
export const useMode = m => { MODE = m; };
