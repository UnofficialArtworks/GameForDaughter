import './style.css';
import { Game } from './game';
import { loadSave, newSave, randomAppearance } from './state';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.init(loadSave() ?? newSave('', randomAppearance()));
game.ui.showTitle();
// handy for debugging in the console
(window as unknown as { fuzzlet: Game }).fuzzlet = game;
