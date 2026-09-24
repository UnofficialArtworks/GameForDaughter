// Static game content catalogs.

export type FoodId = 'kibble' | 'apple' | 'strawberry' | 'carrot' | 'blueberry' | 'cookie' | 'cheese' | 'moonberry';
export interface FoodDef { id: FoodId; name: string; price: number; pack: number; hunger: number; fun: number; kind: 'meal' | 'fruit' | 'veg' | 'treat' | 'magic'; }
export const FOODS: FoodDef[] = [
  { id: 'kibble', name: 'Crunchy Bits', price: 0, pack: 0, hunger: 0.45, fun: 0, kind: 'meal' },
  { id: 'apple', name: 'Apple', price: 4, pack: 3, hunger: 0.2, fun: 0.05, kind: 'fruit' },
  { id: 'strawberry', name: 'Strawberry', price: 5, pack: 3, hunger: 0.15, fun: 0.08, kind: 'fruit' },
  { id: 'carrot', name: 'Carrot', price: 4, pack: 3, hunger: 0.2, fun: 0.03, kind: 'veg' },
  { id: 'blueberry', name: 'Blueberries', price: 5, pack: 3, hunger: 0.12, fun: 0.08, kind: 'fruit' },
  { id: 'cookie', name: 'Star Cookie', price: 6, pack: 3, hunger: 0.12, fun: 0.15, kind: 'treat' },
  { id: 'cheese', name: 'Cheese Wedge', price: 6, pack: 3, hunger: 0.2, fun: 0.08, kind: 'treat' },
  { id: 'moonberry', name: 'Moonberry', price: 12, pack: 2, hunger: 0.15, fun: 0.25, kind: 'magic' },
];
export const foodDef = (id: string) => FOODS.find((f) => f.id === id)!;

export type ToyId = 'ball' | 'squeaky' | 'wand' | 'bubbles';
export interface ToyDef { id: ToyId; name: string; price: number; hint: string; }
export const TOYS: ToyDef[] = [
  { id: 'ball', name: 'Bouncy Ball', price: 0, hint: 'Flick or tap to throw!' },
  { id: 'squeaky', name: 'Squeaky Donut', price: 25, hint: 'Tap to squeak, flick to throw!' },
  { id: 'wand', name: 'Feather Wand', price: 35, hint: 'Drag the feather around!' },
  { id: 'bubbles', name: 'Bubble Wand', price: 40, hint: 'Swipe to blow bubbles!' },
];
export const toyDef = (id: string) => TOYS.find((t) => t.id === id)!;

export type WearSlot = 'head' | 'face' | 'neck';
export interface WearDef { id: string; name: string; slot: WearSlot; price: number; color: string; }
export const WEARABLES: WearDef[] = [
  { id: 'bow', name: 'Ribbon Bow', slot: 'head', price: 20, color: '#ff6b8b' },
  { id: 'partyhat', name: 'Party Hat', slot: 'head', price: 30, color: '#7cc6ff' },
  { id: 'beanie', name: 'Cozy Beanie', slot: 'head', price: 30, color: '#ffb347' },
  { id: 'flowers', name: 'Flower Crown', slot: 'head', price: 40, color: '#ffd1e8' },
  { id: 'crown', name: 'Tiny Crown', slot: 'head', price: 60, color: '#ffd23f' },
  { id: 'glasses', name: 'Round Glasses', slot: 'face', price: 25, color: '#5b4636' },
  { id: 'stars', name: 'Star Shades', slot: 'face', price: 40, color: '#ff8ad8' },
  { id: 'bandana', name: 'Bandana', slot: 'neck', price: 20, color: '#e8505b' },
  { id: 'collar', name: 'Bell Collar', slot: 'neck', price: 25, color: '#4f8cff' },
  { id: 'scarf', name: 'Stripy Scarf', slot: 'neck', price: 35, color: '#8bd17c' },
];

export type DecorSlot = 'bed' | 'rug' | 'bowls' | 'wall' | 'curtains' | 'basket' | 'garden';
export interface DecorDef { id: string; slot: DecorSlot; name: string; price: number; colors: string[]; }
export const DECOR: DecorDef[] = [
  { id: 'bed_basic', slot: 'bed', name: 'Comfy Cushion', price: 0, colors: ['#6fa8dc', '#cfe2f3'] },
  { id: 'bed_cloud', slot: 'bed', name: 'Cloud Bed', price: 45, colors: ['#f4f7ff', '#c9d6f2'] },
  { id: 'bed_donut', slot: 'bed', name: 'Donut Bed', price: 45, colors: ['#f7a1c4', '#8a5a3c'] },
  { id: 'bed_royal', slot: 'bed', name: 'Royal Pillow', price: 80, colors: ['#8e6bd8', '#ffd23f'] },
  { id: 'rug_round', slot: 'rug', name: 'Round Rug', price: 0, colors: ['#e9a07a', '#f6c9a8'] },
  { id: 'rug_rainbow', slot: 'rug', name: 'Rainbow Rug', price: 40, colors: ['#ff8b8b', '#ffd37a', '#9be38b', '#7ec8ff', '#c49bff'] },
  { id: 'rug_star', slot: 'rug', name: 'Starry Rug', price: 40, colors: ['#3a4a8c', '#ffe27a'] },
  { id: 'rug_leaf', slot: 'rug', name: 'Leafy Rug', price: 35, colors: ['#7dbb6e', '#b8e0a6'] },
  { id: 'bowls_basic', slot: 'bowls', name: 'Simple Bowls', price: 0, colors: ['#ffffff', '#8fb8de'] },
  { id: 'bowls_paw', slot: 'bowls', name: 'Pink Paw Bowls', price: 25, colors: ['#ffb6cf', '#ff7aa8'] },
  { id: 'bowls_gold', slot: 'bowls', name: 'Golden Bowls', price: 50, colors: ['#ffd84a', '#d9a520'] },
  { id: 'wall_sun', slot: 'wall', name: 'Sunny Painting', price: 0, colors: ['#ffe39a', '#ff9f43'] },
  { id: 'wall_hills', slot: 'wall', name: 'Hills Painting', price: 30, colors: ['#9fd8ff', '#7bc47f'] },
  { id: 'wall_heart', slot: 'wall', name: 'Heart Frame', price: 30, colors: ['#ffd9e5', '#ff6b8b'] },
  { id: 'wall_portrait', slot: 'wall', name: 'Pet Portrait', price: 60, colors: ['#fff4d6', '#c08a4a'] },
  { id: 'curtains_yellow', slot: 'curtains', name: 'Sunny Curtains', price: 0, colors: ['#ffd66b', '#ffe9a8'] },
  { id: 'curtains_stars', slot: 'curtains', name: 'Starry Curtains', price: 30, colors: ['#4a5aa8', '#ffe27a'] },
  { id: 'curtains_pink', slot: 'curtains', name: 'Candy Curtains', price: 30, colors: ['#ff9ec4', '#ffd6e6'] },
  { id: 'basket_wicker', slot: 'basket', name: 'Wicker Basket', price: 0, colors: ['#c8935a', '#a56d3a'] },
  { id: 'basket_crate', slot: 'basket', name: 'Red Toy Crate', price: 25, colors: ['#e05a4e', '#b8392f'] },
  { id: 'basket_pastel', slot: 'basket', name: 'Pastel Toy Box', price: 30, colors: ['#a8e6cf', '#ffd3b6'] },
  { id: 'garden_none', slot: 'garden', name: 'Empty Patch', price: 0, colors: ['#7cc36a'] },
  { id: 'garden_birdbath', slot: 'garden', name: 'Birdbath', price: 50, colors: ['#d8d4cc', '#8fd3ff'] },
  { id: 'garden_mushroom', slot: 'garden', name: 'Mushroom House', price: 70, colors: ['#e94f4f', '#fff3e0'] },
  { id: 'garden_pinwheels', slot: 'garden', name: 'Pinwheels', price: 40, colors: ['#ff6b8b', '#ffd23f', '#6bc5ff'] },
];
export const DECOR_SLOTS: { slot: DecorSlot; name: string }[] = [
  { slot: 'bed', name: 'Bed' }, { slot: 'rug', name: 'Rug' }, { slot: 'bowls', name: 'Bowls' },
  { slot: 'wall', name: 'Wall Art' }, { slot: 'curtains', name: 'Curtains' }, { slot: 'basket', name: 'Toy Box' },
  { slot: 'garden', name: 'Garden' },
];
export const decorDef = (id: string) => DECOR.find((d) => d.id === id)!;

export interface CollectDef { id: string; name: string; weight: number; color: string; shape: string; }
export const COLLECTIBLES: CollectDef[] = [
  { id: 'pebble', name: 'Shiny Pebble', weight: 10, color: '#9aa7b8', shape: 'pebble' },
  { id: 'acorn', name: 'Acorn', weight: 10, color: '#b07a45', shape: 'acorn' },
  { id: 'leaf', name: 'Golden Leaf', weight: 8, color: '#f2b640', shape: 'leaf' },
  { id: 'button', name: 'Old Button', weight: 8, color: '#e86a6a', shape: 'button' },
  { id: 'feather', name: 'Blue Feather', weight: 7, color: '#6fb5ff', shape: 'feather' },
  { id: 'shell', name: 'Seashell', weight: 7, color: '#ffc4b0', shape: 'shell' },
  { id: 'marble', name: 'Swirly Marble', weight: 6, color: '#7fe0c9', shape: 'marble' },
  { id: 'pinecone', name: 'Pinecone', weight: 6, color: '#8a5a33', shape: 'pinecone' },
  { id: 'bottlecap', name: 'Bottle Cap', weight: 6, color: '#e0c040', shape: 'button' },
  { id: 'snail', name: 'Empty Snail Shell', weight: 5, color: '#e4b680', shape: 'snail' },
  { id: 'clover', name: 'Lucky Clover', weight: 3, color: '#54b85a', shape: 'clover' },
  { id: 'heartstone', name: 'Heart Stone', weight: 3, color: '#ff7aa2', shape: 'heart' },
  { id: 'key', name: 'Tiny Key', weight: 2, color: '#e8c65a', shape: 'key' },
  { id: 'crystal', name: 'Glow Crystal', weight: 2, color: '#b890ff', shape: 'crystal' },
  { id: 'starrock', name: 'Star Rock', weight: 1.5, color: '#ffe066', shape: 'star' },
  { id: 'rainbow', name: 'Rainbow Scale', weight: 1, color: '#ff9ad5', shape: 'rainbow' },
];

export type TrickId = 'sit' | 'spin' | 'highfive' | 'rollover';
export interface TrickDef { id: TrickId; name: string; level: number; }
export const TRICKS: TrickDef[] = [
  { id: 'sit', name: 'Sit', level: 0 },
  { id: 'spin', name: 'Spin', level: 1 },
  { id: 'highfive', name: 'High Five', level: 2 },
  { id: 'rollover', name: 'Roll Over', level: 3 },
];

export const FRIEND_LEVELS = [
  { name: 'New Friend', xp: 0 },
  { name: 'Pal', xp: 50 },
  { name: 'Buddy', xp: 160 },
  { name: 'Best Buddy', xp: 380 },
  { name: 'Forever Friend', xp: 750 },
];
export const FRIEND_UNLOCKS = [
  '',
  'The garden door is open! Spin trick unlocked.',
  'High Five unlocked! Your pet will bring you toys now.',
  'Roll Over unlocked! Your pet will ask for belly rubs.',
  'Your pet will greet you with a special dance!',
];

export const BODY_TYPES = ['round', 'sleek', 'fluffy'] as const;
export const EAR_TYPES = ['pointy', 'floppy', 'round', 'long'] as const;
export const TAIL_TYPES = ['fluffy', 'curly', 'pom', 'thin'] as const;
export const EYE_TYPES = ['sparkle', 'button', 'gem'] as const;
export const MARKINGS = ['none', 'socks', 'patch', 'spots', 'star', 'tips'] as const;
export interface Palette { name: string; main: string; belly: string; dark: string; inner: string; eye: string; }
export const PALETTES: Palette[] = [
  { name: 'Cream', main: '#f6e3c4', belly: '#fff8ec', dark: '#c9a27a', inner: '#ffb3c1', eye: '#5a3d2b' },
  { name: 'Ginger', main: '#f5a55c', belly: '#fff1dc', dark: '#c46a2c', inner: '#ffb3a7', eye: '#4a2e1d' },
  { name: 'Cocoa', main: '#a87a5a', belly: '#f1dcc4', dark: '#6b4a34', inner: '#f5b1a6', eye: '#2d1d14' },
  { name: 'Snow', main: '#f4f6fb', belly: '#ffffff', dark: '#a9b4cc', inner: '#ffc2d4', eye: '#3a67b8' },
  { name: 'Lilac', main: '#c9b3f0', belly: '#f3ecff', dark: '#8d70c7', inner: '#ffb8e1', eye: '#40306e' },
  { name: 'Mint', main: '#a8e3cf', belly: '#effff8', dark: '#5fae93', inner: '#ffc4c9', eye: '#23574b' },
  { name: 'Storm', main: '#8e97a8', belly: '#e6e9ef', dark: '#5a6273', inner: '#ffb7c5', eye: '#f0b73a' },
  { name: 'Honey', main: '#ffd66e', belly: '#fff6d8', dark: '#d99c2b', inner: '#ffb49a', eye: '#5b3a12' },
  { name: 'Berry', main: '#f7a8c4', belly: '#fff0f6', dark: '#d46a93', inner: '#ffe0ea', eye: '#5b2340' },
  { name: 'Night', main: '#4b4f6b', belly: '#9aa0c4', dark: '#2c2f45', inner: '#ff9fb8', eye: '#ffd84a' },
];

export const NAME_IDEAS = ['Mochi', 'Pip', 'Biscuit', 'Nimbus', 'Clover', 'Pudding', 'Sprout', 'Bean', 'Waffles', 'Juniper', 'Pebble', 'Tofu', 'Maple', 'Kiwi', 'Button', 'Noodle', 'Sunny', 'Marshmallow', 'Pickle', 'Dot'];

export const PET_SPOTS = ['head', 'ears', 'cheeks', 'back', 'belly'] as const;
export type PetSpot = (typeof PET_SPOTS)[number];
export const SPOT_NAMES: Record<PetSpot, string> = {
  head: 'head pats', ears: 'ear scritches', cheeks: 'cheek rubs', back: 'back strokes', belly: 'belly rubs',
};
