// Walkthrough: move a tin can, leave, come back, save, quit, load.
import { Game, interiorKey, exteriorKey, decodeSave } from './src/index.js';

const ROOM = 0x100;
const WASTELAND = 0x3c;
const CAN = 0x2000;

const master = {
  interiors: [ROOM],
  worldspaces: [WASTELAND],
  refs: [{ id: CAN, baseId: 0x500, location: { interior: ROOM }, pos: [10, 20, 30], rot: [0, 0, 0] }],
};

const room = interiorKey(ROOM);
const outside = exteriorKey(WASTELAND, 0, 0);
const show = (label, ref) =>
  console.log(`${label.padEnd(44)} pos=${JSON.stringify(ref.pos)} rot=${JSON.stringify(ref.rot)} 3D=${ref.has3D}`);

console.log('--- Sessão 1 ---');
const game = new Game(master);
game.loadCell(room);
const can = game.getRef(CAN);
show('Entrei na sala; lata na posição do editor:', can);

game.markHavokMoved(can, { pos: [14.5, 22, 0], linearVelocity: [2, 0, 0] });
game.setAngle(can, [0, 0, 1.25]);
show('Chutei a lata (física + rotação):', can);
console.log(`  flags = 0x${game.changes.flags(CAN).toString(16)} (MOVE=0x2 | HAVOK_MOVE=0x4)`);

game.unloadCell(room);
game.loadCell(outside);
show('Saí da sala (a lata continua na memória):', can);
console.log(`  snapshot de física guardado: ${JSON.stringify(can.savedHavok)}`);

game.unloadCell(outside);
game.loadCell(room);
show('Voltei para a sala:', can);
console.log(`  velocidade reaplicada: ${JSON.stringify(can.physics.linearVelocity)}`);

const save = game.saveGame();
const [record] = decodeSave(save);
console.log(`\nSalvei o jogo: ${save.length} bytes; registro da lata tem ${record.payload.length} bytes de posição.`);

console.log('\n--- Sessão 2 (carregando o save) ---');
const loaded = Game.fromSave(master, save);
console.log(`Lata na memória antes de entrar na sala? ${loaded.getRef(CAN) !== null}`);
console.log(`Buffer de descarregado guardado: ${loaded.changes.buffer(CAN).payload.length} bytes`);
loaded.loadCell(room);
show('Entrei na sala:', loaded.getRef(CAN));
