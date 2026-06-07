import { initDB, saveCards, getDueCards, updateCard, getAllDecks, deleteDeck } from './db.js';
import { ankiAlgorithm } from './srs.js';
import { parseFile } from './parser.js';

// Service Worker registrieren
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── GLOBALE VARIABLEN ────────────────────────────────
let queue = [];          // aktuelle Session-Warteschlange
let currentIndex = 0;
let isFlipped = false;
let sessionStats = { correct: 0, wrong: 0 };
let currentDeckName = '';

// ── INIT ─────────────────────────────────────────────
await initDB();
renderDeckList();

// ── SCREEN-NAVIGATION ────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── STAPEL-LISTE RENDERN ─────────────────────────────
async function renderDeckList() {
  const decks = await getAllDecks();
  const list = document.getElementById('deck-list');
  list.innerHTML = '';

  if (decks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>📂 Noch keine Karten importiert</p>
        <p class="hint">Tippe auf „Datei importieren" um deine TXT-Datei zu laden</p>
      </div>`;
    return;
  }

  decks.forEach(deck => {
    const totalDue = deck.newCount + deck.dueCount;
    const div = document.createElement('div');
    div.className = 'deck-card';
    div.innerHTML = `
      <div class="deck-info" onclick="startSession('${deck.name.replace(/'/g, "\\'")}')">
        <span class="deck-name">${deck.name}</span>
        <div class="deck-badges">
          ${deck.newCount > 0 ? `<span class="badge badge-new">${deck.newCount} neu</span>` : ''}
          ${deck.dueCount > 0 ? `<span class="badge badge-due">${deck.dueCount} fällig</span>` : ''}
          ${totalDue === 0 ? `<span class="badge badge-done">✓ fertig für heute</span>` : ''}
        </div>
      </div>
      <button class="btn-delete" onclick="confirmDelete('${deck.name.replace(/'/g, "\\'")}')">🗑</button>`;
    list.appendChild(div);
  });
}

// ── DATEIIMPORT ──────────────────────────────────────
document.getElementById('btn-import').onclick = () => {
  document.getElementById('fileInput').click();
};

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const decks = parseFile(text);
    const deckNames = Object.keys(decks);

    if (deckNames.length === 0) {
      alert('❌ Keine Karten gefunden.\nBitte Dateiformat prüfen (Semikolon als Trennzeichen).');
      return;
    }

    let totalCards = 0;
    for (const [deckName, cards] of Object.entries(decks)) {
      await saveCards(deckName, cards);
      totalCards += cards.length;
    }

    alert(`✅ Import erfolgreich!\n${totalCards} Karten in ${deckNames.length} Stapeln geladen.`);
    renderDeckList();
  } catch (err) {
    alert('❌ Fehler beim Import: ' + err.message);
  }

  e.target.value = '';
});

// ── STAPEL LÖSCHEN ───────────────────────────────────
window.confirmDelete = async function(deckName) {
  if (confirm(`Stapel löschen?\n"${deckName}"\n\nAller Lernfortschritt geht verloren.`)) {
    await deleteDeck(deckName);
    renderDeckList();
  }
};

// ── LERNSESSION STARTEN ──────────────────────────────
window.startSession = async function(deckName) {
  currentDeckName = deckName;
  const dueCards = await getDueCards(deckName);
  currentIndex = 0;
  isFlipped = false;
  sessionStats = { correct: 0, wrong: 0 };

  if (dueCards.length === 0) {
    alert('🎉 Keine fälligen Karten!\nAlle Karten für heute gelernt.');
    return;
  }

  // Warteschlange aufbauen
  // Neue Karten zuerst, dann Wiederholungen
  queue = [...dueCards];

  document.getElementById('deck-title').textContent = deckName;
  showScreen('screen-learn');
  showCard();
};

// ── KARTE ANZEIGEN ───────────────────────────────────
function showCard() {
  if (queue.length === 0) {
    showDoneScreen();
    return;
  }

  const card = queue[0];

  document.getElementById('question-text').textContent = card.front;
  document.getElementById('answer-text').textContent = card.back;

  // Karte zurückdrehen
  document.getElementById('card').classList.remove('flipped');
  document.getElementById('rating-buttons').style.display = 'none';
  document.getElementById('flip-hint').style.display = 'block';
  isFlipped = false;

  // Zustand-Label
  const stateLabel = document.getElementById('card-state');
  const stateTexts = {
    new: '🆕 Neu',
    learning: '📖 Lernen',
    review: '🔁 Wiederholung',
    relearning: '⚠️ Nachlernen'
  };
  stateLabel.textContent = stateTexts[card.state] || '';

  // Fortschritt zeigt wie viele EINMALIG gelernte Karten
  updateProgress();
}

// ── FORTSCHRITT BERECHNEN ────────────────────────────
function updateProgress() {
  // Zähle nur einzigartige Karten in der Queue (nicht Duplikate)
  const uniqueInQueue = new Set(queue.map(c => c.id)).size;
  const total = sessionStats.correct + sessionStats.wrong + uniqueInQueue;
  const done = sessionStats.correct + sessionStats.wrong;
  const progress = total > 0 ? (done / total) * 100 : 0;

  document.getElementById('progress-fill').style.width = progress + '%';
  document.getElementById('card-counter').textContent =
    `${done} / ${total}`;
}

// ── KARTE UMDREHEN ───────────────────────────────────
window.flipCard = function() {
  if (!isFlipped) {
    document.getElementById('card').classList.add('flipped');
    document.getElementById('rating-buttons').style.display = 'grid';
    document.getElementById('flip-hint').style.display = 'none';
    isFlipped = true;
  }
};

// ── KARTE BEWERTEN ───────────────────────────────────
// quality: 1=Nochmal, 2=Schwer, 3=Gut, 4=Leicht
window.rateCard = async function(quality) {
  const card = queue.shift(); // aktuelle Karte aus Queue entfernen
  const updated = ankiAlgorithm(card, quality);
  await updateCard(updated);

  if (quality === 1) {
    // ❌ Nochmal → Karte kommt SOFORT wieder ans Ende der Queue
    flashCard('#ff6b6b');
    queue.push(updated); // wieder hinten einreihen

  } else if (quality === 2) {
    // 😐 Schwer → Karte kommt nochmal, aber weiter hinten
    flashCard('#ffd93d');
    // Nach 3 Karten wieder einreihen (oder am Ende wenn Queue klein)
    const insertAt = Math.min(3, queue.length);
    queue.splice(insertAt, 0, updated);

  } else if (quality === 3) {
    // ✅ Gut → Karte ist für diese Session erledigt
    flashCard('#6bcb77');
    sessionStats.correct++;

  } else if (quality === 4) {
    // ⭐ Leicht → Karte ist sofort erledigt
    flashCard('#4d96ff');
    sessionStats.correct++;
  }

  setTimeout(() => showCard(), 350);
};

// ── KURZES BLINKEN ───────────────────────────────────
function flashCard(color) {
  const inner = document.getElementById('card-inner');
  inner.style.transition = 'background 0.15s';
  inner.style.background = color;
  setTimeout(() => { inner.style.background = ''; }, 300);
}

// ── FERTIG-SCREEN ────────────────────────────────────
function showDoneScreen() {
  const total = sessionStats.correct + sessionStats.wrong;

  // Wie viele Karten wurden wirklich gemeistert?
  document.getElementById('done-deck').textContent = currentDeckName;
  document.getElementById('done-correct').textContent = sessionStats.correct;
  document.getElementById('done-wrong').textContent = sessionStats.wrong;

  const pct = total > 0 ? Math.round((sessionStats.correct / total) * 100) : 100;
  document.getElementById('done-pct').textContent = pct + '%';

  showScreen('screen-done');
}

// ── ZURÜCK ZU STAPELN ────────────────────────────────
window.showDecks = function() {
  renderDeckList();
  showScreen('screen-decks');
};
