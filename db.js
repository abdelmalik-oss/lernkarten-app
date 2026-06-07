// ══════════════════════════════════════════════════════
//  IndexedDB — 100% offline, kein CDN
// ══════════════════════════════════════════════════════
let db;

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lernkarten-db', 2); // Version 2 wegen neuem Schema

    request.onupgradeneeded = event => {
      const database = event.target.result;

      // Alten Store löschen falls vorhanden
      if (database.objectStoreNames.contains('cards')) {
        database.deleteObjectStore('cards');
      }

      // Neuen Store anlegen
      const store = database.createObjectStore('cards', { keyPath: 'id' });
      store.createIndex('deck', 'deck', { unique: false });
      store.createIndex('nextReview', 'nextReview', { unique: false });
      store.createIndex('state', 'state', { unique: false });
    };

    request.onsuccess = event => {
      db = event.target.result;
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

// ── KARTEN SPEICHERN ─────────────────────────────────
// Nur neue Karten werden hinzugefügt — bestehende (mit Fortschritt) NICHT überschrieben
export function saveCards(deckName, cards) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readwrite');
    const store = tx.objectStore('cards');

    cards.forEach(card => {
      // Nur hinzufügen wenn ID noch nicht existiert
      const check = store.get(card.id);
      check.onsuccess = () => {
        if (!check.result) {
          store.put(card); // neu → hinzufügen
        }
        // bereits vorhanden → Fortschritt beibehalten, nichts überschreiben
      };
    });

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ── FÄLLIGE KARTEN ABRUFEN ───────────────────────────
// Gibt alle Karten zurück die jetzt gelernt werden sollen
export function getDueCards(deckName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readonly');
    const index = tx.objectStore('cards').index('deck');
    const request = index.getAll(deckName);
    const now = new Date().toISOString();

    request.onsuccess = () => {
      const due = request.result.filter(c => c.nextReview <= now);
      // Neue Karten zuerst, dann Wiederholungen
      due.sort((a, b) => {
        const order = { new: 0, learning: 1, relearning: 1, review: 2 };
        return (order[a.state] || 0) - (order[b.state] || 0);
      });
      resolve(due);
    };

    request.onerror = () => reject(request.error);
  });
}

// ── KARTE AKTUALISIEREN ──────────────────────────────
export function updateCard(card) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readwrite');
    tx.objectStore('cards').put(card);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ── ALLE STAPEL MIT STATISTIKEN ─────────────────────
export function getAllDecks() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readonly');
    const request = tx.objectStore('cards').getAll();
    const now = new Date().toISOString();

    request.onsuccess = () => {
      const deckMap = {};

      request.result.forEach(card => {
        if (!deckMap[card.deck]) {
          deckMap[card.deck] = {
            name: card.deck,
            total: 0,
            newCount: 0,
            dueCount: 0
          };
        }
        deckMap[card.deck].total++;
        if (card.state === 'new') deckMap[card.deck].newCount++;
        if (card.nextReview <= now && card.state !== 'new') deckMap[card.deck].dueCount++;
      });

      const sorted = Object.values(deckMap).sort((a, b) => a.name.localeCompare(b.name));
      resolve(sorted);
    };

    request.onerror = () => reject(request.error);
  });
}

// ── STAPEL LÖSCHEN ───────────────────────────────────
export function deleteDeck(deckName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readwrite');
    const index = tx.objectStore('cards').index('deck');
    const request = index.getAll(deckName);

    request.onsuccess = () => {
      const store = tx.objectStore('cards');
      request.result.forEach(card => store.delete(card.id));
    };

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
