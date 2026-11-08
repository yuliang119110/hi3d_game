export const STOOL_SIZE = Object.freeze([1.96, .16, 1.84]);

export function configureCharacters(characters) {
 for (const character of characters) {
  character.dollScale = Math.min(1.3, 1.12 / character.height);
  character.captureRadius *= character.dollScale;
  character.stoolSize = [...STOOL_SIZE];
 }
 return characters;
}

export function arrangeCharacters(characters, portrait) {
 const columns = portrait ? 3 : 4;
 for (const [index, character] of characters.entries()) {
  const row = Math.floor(index / columns), column = index % columns;
  const spacing = portrait ? 2.8 : 3.65;
  const stagger = portrait ? (row % 2 ? .12 : -.12) : (row === 1 ? .28 : 0);
  character.position = [(column - (columns - 1) / 2) * spacing + stagger, .8 + row * .18, 2 - row * (portrait ? 2.4 : 3.25)];
  character.layoutRow = row;
  character.layoutMotionScale = portrait ? .38 : .6;
 }
 return characters;
}
