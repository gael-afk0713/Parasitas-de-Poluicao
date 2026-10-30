/* =========================================================================
   fase2/mundo/perigo.js — vizinhança de espinho
   -------------------------------------------------------------------------
   Arquivo próprio (e não dentro de render/chao.js) por causa do cache do
   GitHub Pages: os módulos da Fase 2 vêm sem `?v`, e uma exportação NOVA
   num módulo antigo quebra o `import` estático de quem chega mais novo.
   Arquivo novo nunca está em cache.
   ========================================================================= */

import { PERIGO } from './terreno.js';

/** Espinho a até um tile de (x, y)? Ali nada cai nem pousa: perigo lê limpo. */
export function pertoDePerigo(terreno, x, y) {
  const t = terreno.tile, cx = Math.floor(x / t), cy = Math.floor(y / t);
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if (terreno.em(cx + dx, cy + dy) === PERIGO) return true;
  }
  return false;
}
