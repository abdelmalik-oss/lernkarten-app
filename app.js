import { initDB, saveCards, getDueCards, updateCard, getAllDecks, deleteDeck } from './db.js';
import { ankiAlgorithm } from './srs.js';
import { parseFile } from './parser.js';

// Service Worker registrieren
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── GLOBALE VARIABLEN ────────────────────────────────
let dueCards = [];
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
          ${totalDue === 0 ? `<span class="badge badge-done">✓ fertig</span>` : ''}
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
  dueCards = await getDueCards(deckName);
  currentIndex = 0;
  isFlipped = false;
  sessionStats = { correct: 0, wrong: 0 };

  if (dueCards.length === 0) {
    alert('🎉 Keine fälligen Karten!\nAlle Karten für heute gelernt.');
    return;
  }

  document.getElementById('deck-title').textContent = deckName;
  showScreen('screen-learn');
  showCard();
};

// ── KARTE ANZEIGEN ───────────────────────────────────
function showCard() {
  if (currentIndex >= dueCards.length) {
    showDoneScreen();
    return;
  }

  const card = dueCards[currentIndex];

  document.getElementById('question-text').textContent = card.front;
  document.getElementById('answer-text').textContent = card.back;

  // Karte zurückdrehen
  document.getElementById('card').classList.remove('flipped');
  document.getElementById('rating-buttons').style.display = 'none';
  document.getElementById('flip-hint').style.display = 'block';
  isFlipped = false;

  // Zustand-Label anzeigen
  const stateLabel = document.getElementById('card-state');
  const stateTexts = {
    new: '🆕 Neu',
    learning: '📖 Lernen',
    review: '🔁 Wiederholung',
    relearning: '⚠️ Nachlernen'
  };
  stateLabel.textContent = stateTexts[card.state] || '';

  // Fortschritt
  const progress = (currentIndex / dueCards.length) * 100;
  document.getElementById('progress-fill').style.width = progress + '%';
  document.getElementById('card-counter').textContent =
    `${currentIndex + 1} / ${dueCards.length}`;
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
  const card = dueCards[currentIndex];
  const updated = ankiAlgorithm(card, quality);
  await updateCard(updated);

  if (quality >= 3) {
    sessionStats.correct++;
    flashCard('#6bcb77'); // grün
  } else {
    sessionStats.wrong++;
    flashCard('#ff6b6b'); // rot
  }

  currentIndex++;
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
  const pct = total > 0 ? Math.round((sessionStats.correct / total) * 100) : 0;

  document.getElementById('done-deck').textContent = currentDeckName;
  document.getElementById('done-correct').textContent = sessionStats.correct;
  document.getElementById('done-wrong').textContent = sessionStats.wrong;
  document.getElementById('done-pct').textContent = pct + '%';

  showScreen('screen-done');
}

// ── ZURÜCK ZU STAPELN ────────────────────────────────
window.showDecks = function() {
  renderDeckList();
  showScreen('screen-decks');
};
