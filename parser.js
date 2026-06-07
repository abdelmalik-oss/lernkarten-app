import { createCard } from './srs.js';

export function parseFile(text) {
  const lines = text.split('\n');
  const decks = {};
  let currentDeck = 'Standard';

  lines.forEach(line => {
    line = line.trim();

    // Leere Zeilen und Kommentare überspringen
    if (!line || line.startsWith('//')) return;

    // #STAPEL:-Zeile erkennen
    if (line.startsWith('#STAPEL:')) {
      currentDeck = line.replace('#STAPEL:', '').trim();
      if (!decks[currentDeck]) decks[currentDeck] = [];
      return;
    }

    // Andere #-Zeilen ignorieren
    if (line.startsWith('#')) return;

    // Semikolon-Trennung
    const semiIdx = line.indexOf(';');
    if (semiIdx === -1) return;

    const front = line.substring(0, semiIdx).trim();
    const back = line.substring(semiIdx + 1).trim();

    if (front && back) {
      if (!decks[currentDeck]) decks[currentDeck] = [];

      // Eindeutige ID aus Deck + Frage (damit Reimport Fortschritt behält)
      const id = currentDeck + '::' + front.substring(0, 50);

      decks[currentDeck].push(
        createCard(id, currentDeck, front, back)
      );
    }
  });

  return decks;
}
