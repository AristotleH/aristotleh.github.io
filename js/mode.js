// The view mode: "3d" (WebGL globe), "ascii" (text only) or "html" (a basic document). #ascii / #html open those;
// otherwise start in 3D on every visit, falling back only if it cannot initialize.
export let MODE = (() => {
  if (window.siteStartup) return window.siteStartup.mode;
  const known = ["3d", "ascii", "html"];
  if (known.includes(location.hash.slice(1))) return location.hash.slice(1);
  return "3d";
})();
export const useMode = m => { MODE = m; };
