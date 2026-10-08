// Builds the globe's tiles off the page's main thread (see tiles.js). The hex grid starts as soon as its size is
// known; the rest waits for the terrain. Block geometry is handed over without copying.
import { hexGrid } from "./hexgrid.js";
import { buildGlobe, buildDetail } from "./tiles.js";

let grid = null;
onmessage = ({ data }) => {
  if (data.type === "grid") { grid = data.hex ? hexGrid(data.n) : null; return; }
  const G = buildGlobe(data.input, grid);
  const { cornerStart, corner, tileAng, ...forPage } = G;
  postMessage({ type: "globe", G: forPage }, G.blocks.flatMap(b => [b.geo.pos.buffer, b.geo.nor.buffer, b.geo.info.buffer, b.geo.index.buffer]));
  if (!data.input.detailStops.length) return;
  const DT = buildDetail(data.input, G);
  postMessage({ type: "detail", DT }, [DT.geo.pos.buffer, DT.geo.nor.buffer, DT.geo.info.buffer, DT.geo.index.buffer]);
};
