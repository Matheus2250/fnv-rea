# fnv-cell-persistence

Minha própria versão, escrita do zero a partir do [`SPEC.md`](../SPEC.md), de como o
Fallout: New Vegas guarda e restaura a posição dos objetos quando você sai de uma célula
e volta (e quando salva/carrega o jogo). Nenhum código do jogo foi copiado.

## Requisitos

Node.js 22.19+ (testado com 24.18). Sem dependências.

## Rodar

```bash
npm test
```

```bash
npm run demo
```

## Como funciona (resumo)

| Peça | Arquivo | Regras do SPEC |
|---|---|---|
| Flags de mudança (`MOVE=0x2`, `HAVOK_MOVE=0x4`, `CELL_CHANGED=0x8`) | `src/flags.js` | §2, §7 |
| Mapa de mudanças `{ flags, buffer }` | `src/changes-map.js` | §3 |
| Registro de posição de 28 bytes e células de 4096 unidades | `src/position-record.js` | §5, R6.4 |
| Formato do arquivo de save (nosso) | `src/save-file.js` | R5.2 |
| Mundo: entrar/sair de célula, mover, salvar/carregar | `src/game.js` | §4, §6, §8–§12 |

### API principal (`src/game.js`)

```js
import { Game, interiorKey } from './src/index.js';

const game = new Game(master);       // dados do "editor" (células e objetos)
game.loadCell(interiorKey(0x100));   // entrar na célula
game.setPos(ref, [x, y, z]);         // liga MOVE
game.markHavokMoved(ref, { pos, linearVelocity });  // liga HAVOK_MOVE
game.unloadCell(interiorKey(0x100)); // sair: tira foto da física
const bytes = game.saveGame();
const next = Game.fromSave(master, bytes);
```

## O que é escolha minha (não veio do jogo)

Marcado como **[PROJ]** no `SPEC.md`: formato do arquivo de save (só o bloco de 28 bytes
segue o jogo), critério de "posição/rotação corrompida", conteúdo da foto da física,
`markHavokMoved` explícito, e a faixa de IDs para objetos criados.
