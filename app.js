import { initDB, saveCards, getDueCards, updateCard, getAllDecks, deleteDeck } from './db.js';
import { ankiAlgorithm } from './srs.js';
import { parseFile } from './parser.js';

// Service Worker registrieren
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── GLOBALE VARIABLEN ────────────────────────────────────────
//
//  queue       = Karten die JETZT gezeigt werden sollen
//  waitingList = Karten die auf ihr Minuten-Intervall warten
//                Format: { card, showAt: Date }
//
//  Genau wie Anki:
//  - Gut/Leicht bei neuer Karte → kommt in Minuten wieder (learning)
//  - Nochmal/Schwer bei learning → kommt nach X Minuten wieder
//  - Gut/Leicht bei letztem Lernschritt → abgeschlossen (morgen)
//  - Gut/Leicht/Schwer bei review → abgeschlossen (Tage)
//  - Nochmal bei review → geht in relearning (10 Min warten)

let queue       = [];   // sofort zeigen
let waitingList = [];   // warten auf Minuten-Timer
let sessionStats = { correct: 0, wrong: 0 };
let currentDeckName = '';
let waitingTimer = null;

// ── INIT ──────────────────────────────────────────────────────
await initDB();
renderDeckList();

// ── SCREEN-NAVIGATION ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── STAPEL-LISTE RENDERN ──────────────────────────────────────
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
          ${deck.newCount  > 0 ? `<span class="badge badge-new">${deck.newCount} neu</span>` : ''}
          ${deck.dueCount  > 0 ? `<span class="badge badge-due">${deck.dueCount} fällig</span>` : ''}
          ${totalDue === 0 ? `<span class="badge badge-done">✓ fertig für heute</span>` : ''}
        </div>
      </div>
      <button class="btn-delete" onclick="confirmDelete('${deck.name.replace(/'/g, "\\'")}')">🗑</button>`;
    list.appendChild(div);
  });
}

// ── DATEIIMPORT ───────────────────────────────────────────────
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

// ── STAPEL LÖSCHEN ────────────────────────────────────────────
window.confirmDelete = async function(deckName) {
  if (confirm(`Stapel löschen?\n"${deckName}"\n\nAller Lernfortschritt geht verloren.`)) {
    await deleteDeck(deckName);
    renderDeckList();
  }
};

// ── SESSION STARTEN ───────────────────────────────────────────
window.startSession = async function(deckName) {
  currentDeckName = deckName;
  const dueCards = await getDueCards(deckName);

  if (dueCards.length === 0) {
    alert('🎉 Keine fälligen Karten!\nAlle Karten für heute gelernt.');
    return;
  }

  // Neue Karten zuerst, dann Lernkarten, dann Review
  queue = [...dueCards];
  waitingList = [];
  sessionStats = { correct: 0, wrong: 0 };

  document.getElementById('deck-title').textContent = deckName;
  showScreen('screen-learn');
  showCard();
};

// ── KARTE ANZEIGEN ────────────────────────────────────────────
function showCard() {
  // Warte-Karten die jetzt fällig sind → vorne in Queue
  promoteWaiting();

  if (queue.length === 0) {
    if (waitingList.length > 0) {
      // Noch Karten in Warteliste → Wartebildschirm zeigen
      showWaitingScreen();
    } else {
      // Alles fertig
      showDoneScreen();
    }
    return;
  }

  const card = queue[0];

  document.getElementById('question-text').textContent = card.front;
  document.getElementById('answer-text').textContent = card.back;

  // Karte zurückdrehen
  document.getElementById('card').classList.remove('flipped');
  document.getElementById('rating-buttons').style.display = 'none';
  document.getElementById('flip-hint').style.display = 'block';

  // Zustand-Label
  const stateTexts = {
    new: '🆕 Neu',
    learning: '📖 Lernen',
    review: '🔁 Wiederholung',
    relearning: '⚠️ Nachlernen'
  };
  document.getElementById('card-state').textContent = stateTexts[card.state] || '';

  updateProgress();
}

// ── WARTE-KARTEN PRÜFEN ───────────────────────────────────────
// Karten die ihr Minuten-Intervall abgewartet haben → in Queue
function promoteWaiting() {
  const now = new Date();
  const ready = waitingList.filter(w => w.showAt <= now);
  const still = waitingList.filter(w => w.showAt >  now);
  waitingList = still;

  // Fällige Karten vorne in Queue einreihen
  ready.forEach(w => queue.unshift(w.card));
}

// ── WARTE-BILDSCHIRM ──────────────────────────────────────────
function showWaitingScreen() {
  if (waitingTimer) clearInterval(waitingTimer);

  // Nächste fällige Karte
  const next = waitingList.reduce((a, b) => a.showAt < b.showAt ? a : b);
  const msLeft = Math.max(0, next.showAt - new Date());

  document.getElementById('waiting-seconds').textContent =
    Math.ceil(msLeft / 1000);

  showScreen('screen-waiting');

  waitingTimer = setInterval(() => {
    const remaining = Math.max(0, next.showAt - new Date());
    document.getElementById('waiting-seconds').textContent =
      Math.ceil(remaining / 1000);

    if (remaining <= 0) {
      clearInterval(waitingTimer);
      showScreen('screen-learn');
      showCard();
    }
  }, 500);
}

// ── KARTE UMDREHEN ────────────────────────────────────────────
window.flipCard = function() {
  document.getElementById('card').classList.add('flipped');
  document.getElementById('rating-buttons').style.display = 'grid';
  document.getElementById('flip-hint').style.display = 'none';
};

// ── KARTE BEWERTEN ────────────────────────────────────────────
// quality: 1=Nochmal  2=Schwer  3=Gut  4=Leicht
window.rateCard = async function(quality) {
  const card = queue.shift();
  const { card: updated, showInMinutes } = ankiAlgorithm(card, quality);
  await updateCard(updated);

  // Farb-Feedback
  const colors = { 1: '#ff6b6b', 2: '#ffd93d', 3: '#6bcb77', 4: '#4d96ff' };
  flashCard(colors[quality]);

  if (showInMinutes !== null) {
    // ── Lernkarte → kommt nach X Minuten wieder ──────────────
    // Genau wie Anki: andere Karten werden dazwischen gezeigt
    const showAt = new Date(Date.now() + showInMinutes * 60 * 1000);
    waitingList.push({ card: updated, showAt });

  } else {
    // ── Abgeschlossen (Review/Tages-Intervall) ───────────────
    if (quality >= 3) {
      sessionStats.correct++;
    } else {
      // Nochmal bei Review → geht in relearning (showInMinutes = 10)
      // Das wird oben schon in waiting gepusht
      // Hier: nur wenn wirklich abgeschlossen (was bei quality=1 nicht passiert)
    }
  }

  setTimeout(() => showCard(), 300);
};

// ── FORTSCHRITT ───────────────────────────────────────────────
function updateProgress() {
  const inQueue   = new Set(queue.map(c => c.id)).size;
  const inWaiting = new Set(waitingList.map(w => w.card.id)).size;
  const total = sessionStats.correct + inQueue + inWaiting;
  const done  = sessionStats.correct;
  const pct   = total > 0 ? (done / total) * 100 : 0;

  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('card-counter').textContent  = `${done} / ${total}`;
}

// ── BLINKEN ───────────────────────────────────────────────────
function flashCard(color) {
  const inner = document.getElementById('card-inner');
  inner.style.transition = 'background 0.15s';
  inner.style.background = color;
  setTimeout(() => { inner.style.background = ''; }, 280);
}

// ── FERTIG-SCREEN ─────────────────────────────────────────────
function showDoneScreen() {
  const total = sessionStats.correct + sessionStats.wrong;
  const pct   = total > 0 ? Math.round((sessionStats.correct / total) * 100) : 100;

  document.getElementById('done-deck').textContent    = currentDeckName;
  document.getElementById('done-correct').textContent = sessionStats.correct;
  document.getElementById('done-wrong').textContent   = sessionStats.wrong;
  document.getElementById('done-pct').textContent     = pct + '%';

  showScreen('screen-done');
}

// ── ZURÜCK ZU STAPELN ─────────────────────────────────────────
window.showDecks = function() {
  if (waitingTimer) clearInterval(waitingTimer);
  renderDeckList();
  showScreen('screen-decks');
};
