import './style.css';
import { Game } from './game';
import { loadStore } from './state';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
// every Fuzzlet on this device (an old single-pet save is migrated into slot 1 automatically)
const { store, migrated, problem } = loadStore();
game.init(store);
if (migrated) game.diag.log('pets', 'migrated the old single-pet save into slot 1');
if (problem) game.diag.log('pets', `load: ${problem}`);
game.ui.showTitle();
// handy for debugging in the console
(window as unknown as { fuzzlet: Game }).fuzzlet = game;
