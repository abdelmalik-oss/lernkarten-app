// ══════════════════════════════════════════════════════
//  Anki-kompatibler Algorithmus (SM-2 modifiziert)
//  Zustände: 'new' → 'learning' → 'review' → 'relearning'
// ══════════════════════════════════════════════════════

// Lernschritte für neue Karten (in Minuten)
const LEARNING_STEPS = [1, 10];

// Lernschritte für Nachlernen (nach "Nochmal" bei Wiederholung)
const RELEARNING_STEPS = [10];

// Standard Ease Factor (250% = 2.5)
const STARTING_EASE = 2.5;

// Mindest Ease Factor
const MIN_EASE = 1.3;

// ── KARTE NEU ERSTELLEN ───────────────────────────────
export function createCard(id, deck, front, back) {
  return {
    id,
    deck,
    front,
    back,
    state: 'new',          // 'new' | 'learning' | 'review' | 'relearning'
    step: 0,               // aktueller Lernschritt-Index
    interval: 0,           // Intervall in Tagen (nur bei 'review')
    easeFactor: STARTING_EASE,
    lapses: 0,             // wie oft "Nochmal" bei Review gedrückt
    nextReview: new Date().toISOString()
  };
}

// ── HAUPT-ALGORITHMUS ─────────────────────────────────
// quality: 1=Nochmal, 2=Schwer, 3=Gut, 4=Leicht
export function ankiAlgorithm(card, quality) {
  const now = new Date();
  let { state, step, interval, easeFactor, lapses } = card;

  switch (state) {

    // ── NEUE KARTE ──────────────────────────────────
    case 'new':
      if (quality === 1) {
        // Nochmal → bleibt neu, zurück zu Schritt 0
        step = 0;
        state = 'learning';
        return setNextReviewMinutes(card, LEARNING_STEPS[0], state, step, interval, easeFactor, lapses);
      }
      if (quality === 2) {
        // Schwer → Schritt 0 (1 Minute)
        step = 0;
        state = 'learning';
        return setNextReviewMinutes(card, LEARNING_STEPS[0], state, step, interval, easeFactor, lapses);
      }
      if (quality === 3) {
        // Gut → nächster Lernschritt
        step = 1;
        state = 'learning';
        return setNextReviewMinutes(card, LEARNING_STEPS[1], state, step, interval, easeFactor, lapses);
      }
      if (quality === 4) {
        // Leicht → direkt abschließen, 4 Tage
        state = 'review';
        interval = 4;
        easeFactor = STARTING_EASE + 0.15;
        return setNextReviewDays(card, interval, state, 0, interval, easeFactor, lapses);
      }
      break;

    // ── LERNKARTE ───────────────────────────────────
    case 'learning':
      if (quality === 1) {
        // Nochmal → zurück zu Schritt 0
        step = 0;
        return setNextReviewMinutes(card, LEARNING_STEPS[0], state, step, interval, easeFactor, lapses);
      }
      if (quality === 2) {
        // Schwer → aktuellen Schritt wiederholen
        return setNextReviewMinutes(card, LEARNING_STEPS[step] || LEARNING_STEPS[0], state, step, interval, easeFactor, lapses);
      }
      if (quality === 3) {
        // Gut → nächster Schritt oder abschließen
        if (step + 1 >= LEARNING_STEPS.length) {
          // Letzter Schritt → Review
          state = 'review';
          interval = 1;
          return setNextReviewDays(card, interval, state, 0, interval, easeFactor, lapses);
        } else {
          step = step + 1;
          return setNextReviewMinutes(card, LEARNING_STEPS[step], state, step, interval, easeFactor, lapses);
        }
      }
      if (quality === 4) {
        // Leicht → sofort abschließen
        state = 'review';
        interval = 4;
        easeFactor = Math.min(STARTING_EASE + 0.15, easeFactor + 0.15);
        return setNextReviewDays(card, interval, state, 0, interval, easeFactor, lapses);
      }
      break;

    // ── WIEDERHOLUNGSKARTE ───────────────────────────
    case 'review':
      if (quality === 1) {
        // Nochmal → Nachlernen
        lapses += 1;
        state = 'relearning';
        step = 0;
        easeFactor = Math.max(MIN_EASE, easeFactor - 0.20);
        // Intervall auf 0 oder minimum (Anki nutzt einen "lapse interval" von ~0 Tagen)
        interval = Math.max(1, Math.round(interval * 0.0)); // Reset
        interval = 1;
        return setNextReviewMinutes(card, RELEARNING_STEPS[0], state, step, interval, easeFactor, lapses);
      }
      if (quality === 2) {
        // Schwer → Intervall × 1.2, EF -0.15
        easeFactor = Math.max(MIN_EASE, easeFactor - 0.15);
        interval = Math.max(interval + 1, Math.round(interval * 1.2));
        return setNextReviewDays(card, interval, state, 0, interval, easeFactor, lapses);
      }
      if (quality === 3) {
        // Gut → Intervall × EF
        interval = Math.max(interval + 1, Math.round(interval * easeFactor));
        return setNextReviewDays(card, interval, state, 0, interval, easeFactor, lapses);
      }
      if (quality === 4) {
        // Leicht → Intervall × EF × 1.3, EF +0.15
        easeFactor = Math.min(easeFactor + 0.15, 3.0);
        interval = Math.max(interval + 1, Math.round(interval * easeFactor * 1.3));
        return setNextReviewDays(card, interval, state, 0, interval, easeFactor, lapses);
      }
      break;

    // ── NACHLERNEN ───────────────────────────────────
    case 'relearning':
      if (quality === 1) {
        // Nochmal → zurück zu Schritt 0
        step = 0;
        return setNextReviewMinutes(card, RELEARNING_STEPS[0], state, step, interval, easeFactor, lapses);
      }
      if (quality === 2) {
        // Schwer → aktuellen Schritt wiederholen
        return setNextReviewMinutes(card, RELEARNING_STEPS[step] || RELEARNING_STEPS[0], state, step, interval, easeFactor, lapses);
      }
      if (quality === 3 || quality === 4) {
        // Gut/Leicht → zurück zu Review mit Intervall 1
        state = 'review';
        interval = Math.max(1, interval);
        if (quality === 4) {
          easeFactor = Math.min(easeFactor + 0.15, 3.0);
        }
        return setNextReviewDays(card, interval, state, 0, interval, easeFactor, lapses);
      }
      break;
  }

  return card; // Fallback
}

// ── HILFSFUNKTIONEN ───────────────────────────────────

function setNextReviewMinutes(card, minutes, state, step, interval, easeFactor, lapses) {
  const next = new Date();
  next.setMinutes(next.getMinutes() + minutes);
  return {
    ...card,
    state,
    step,
    interval,
    easeFactor: parseFloat(easeFactor.toFixed(2)),
    lapses,
    nextReview: next.toISOString()
  };
}

function setNextReviewDays(card, days, state, step, interval, easeFactor, lapses) {
  const next = new Date();
  next.setDate(next.getDate() + days);
  // Auf Tagesbeginn setzen (Mitternacht)
  next.setHours(0, 0, 0, 0);
  return {
    ...card,
    state,
    step,
    interval,
    easeFactor: parseFloat(easeFactor.toFixed(2)),
    lapses,
    nextReview: next.toISOString()
  };
}
