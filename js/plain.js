// Refresh the static document from validated data when JavaScript is available.
import { SITE } from "./site.js";
import { plainContent } from "./plain-content.mjs";

export function renderPlain() {
  document.getElementById("plain").innerHTML = plainContent(SITE);
}
