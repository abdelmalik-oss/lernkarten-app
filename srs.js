// ══════════════════════════════════════════════════════════════
//  EXAKTER Anki SM-2 Algorithmus
//  Zustände: 'new' → 'learning' → 'review' ⟷ 'relearning'
//
//  Lernschritte (Minuten): [1, 10]
//  Nachlernen  (Minuten):  [10]
//
//  Intervall-Berechnung (Review):
//    Nochmal → 1 Tag,    EF − 0.20
//    Schwer  → × 1.2,   EF − 0.15
//    Gut     → × EF
//    Leicht  → × EF × 1.3, EF + 0.15
// ══════════════════════════════════════════════════════════════

const LEARNING_STEPS   = [1, 10];   // Minuten für neue Karten
const RELEARNING_STEPS = [10];       // Minuten nach "Nochmal" bei Review
const STARTING_EASE    = 2.5;
const MIN_EASE         = 1.3;

// ── KARTE ERSTELLEN ───────────────────────────────────────────
export function createCard(id, deck, front, back) {
  return {
    id,
    deck,
    front,
    back,
    state: 'new',
    step: 0,
    interval: 0,
    easeFactor: STARTING_EASE,
    lapses: 0,
    nextReview: new Date().toISOString()
  };
}

// ── HAUPT-ALGORITHMUS ─────────────────────────────────────────
// Gibt zurück: { card: updatedCard, showInMinutes: number|null }
// showInMinutes = null  → Karte ist für heute erledigt (Tage-Intervall)
// showInMinutes = N     → Karte in N Minuten in dieser Session zeigen
export function ankiAlgorithm(card, quality) {
  let { state, step, interval, easeFactor, lapses } = card;

  // ── NEUE KARTE ────────────────────────────────────────────
  if (state === 'new') {
    if (quality === 1) {
      // Nochmal → Lernschritt 0 → in 1 Minute
      return buildLearning(card, 0, LEARNING_STEPS[0], lapses);
    }
    if (quality === 2) {
      // Schwer → Lernschritt 0, aber 6 Minuten (Anki-Standard für Schwer bei neuen Karten)
      return buildLearning(card, 0, 6, lapses);
    }
    if (quality === 3) {
      // Gut → direkt zu Lernschritt 1 (10 Min)
      return buildLearning(card, 1, LEARNING_STEPS[1], lapses);
    }
    if (quality === 4) {
      // Leicht → sofort abschließen → 4 Tage
      easeFactor = Math.min(STARTING_EASE + 0.15, 3.0);
      return buildReview(card, 4, easeFactor, lapses);
    }
  }

  // ── LERNKARTE ─────────────────────────────────────────────
  if (state === 'learning') {
    if (quality === 1) {
      // Nochmal → zurück zu Schritt 0 → 1 Minute
      return buildLearning(card, 0, LEARNING_STEPS[0], lapses);
    }
    if (quality === 2) {
      // Schwer → aktuellen Schritt wiederholen
      const minutes = LEARNING_STEPS[step] || LEARNING_STEPS[0];
      return buildLearning(card, step, minutes, lapses);
    }
    if (quality === 3) {
      // Gut → nächster Schritt oder abschließen
      const nextStep = step + 1;
      if (nextStep >= LEARNING_STEPS.length) {
        // Letzter Schritt abgeschlossen → 1 Tag
        return buildReview(card, 1, easeFactor, lapses);
      } else {
        return buildLearning(card, nextStep, LEARNING_STEPS[nextStep], lapses);
      }
    }
    if (quality === 4) {
      // Leicht → sofort abschließen → 4 Tage
      easeFactor = Math.min(easeFactor + 0.15, 3.0);
      return buildReview(card, 4, easeFactor, lapses);
    }
  }

  // ── WIEDERHOLUNGSKARTE ────────────────────────────────────
  if (state === 'review') {
    if (quality === 1) {
      // Nochmal → Nachlernen, EF −20%, Intervall reset
      lapses += 1;
      easeFactor = Math.max(MIN_EASE, easeFactor - 0.20);
      interval = 1; // nach Nachlernen: 1 Tag
      return buildRelearning(card, 0, RELEARNING_STEPS[0], interval, easeFactor, lapses);
    }
    if (quality === 2) {
      // Schwer → Intervall × 1.2, EF −15%
      easeFactor = Math.max(MIN_EASE, easeFactor - 0.15);
      interval = Math.max(interval + 1, Math.round(interval * 1.2));
      return buildReview(card, interval, easeFactor, lapses);
    }
    if (quality === 3) {
      // Gut → Intervall × EF
      interval = Math.max(interval + 1, Math.round(interval * easeFactor));
      return buildReview(card, interval, easeFactor, lapses);
    }
    if (quality === 4) {
      // Leicht → Intervall × EF × 1.3, EF +15%
      easeFactor = Math.min(easeFactor + 0.15, 3.0);
      interval = Math.max(interval + 1, Math.round(interval * easeFactor * 1.3));
      return buildReview(card, interval, easeFactor, lapses);
    }
  }

  // ── NACHLERNEN ────────────────────────────────────────────
  if (state === 'relearning') {
    if (quality === 1) {
      // Nochmal → Schritt 0 → 10 Minuten
      return buildRelearning(card, 0, RELEARNING_STEPS[0], interval, easeFactor, lapses);
    }
    if (quality === 2) {
      // Schwer → aktuellen Schritt wiederholen
      const minutes = RELEARNING_STEPS[step] || RELEARNING_STEPS[0];
      return buildRelearning(card, step, minutes, interval, easeFactor, lapses);
    }
    if (quality === 3) {
      // Gut → zurück zu Review mit gespeichertem Intervall (mind. 1)
      interval = Math.max(1, interval);
      return buildReview(card, interval, easeFactor, lapses);
    }
    if (quality === 4) {
      // Leicht → zurück zu Review, EF +15%
      interval = Math.max(1, interval);
      easeFactor = Math.min(easeFactor + 0.15, 3.0);
      return buildReview(card, interval, easeFactor, lapses);
    }
  }

  return { card, showInMinutes: null }; // Fallback
}

// ── HILFSFUNKTIONEN ──────────────────────────────────────────

// Lernkarte mit Minuten-Intervall (bleibt in Session)
function buildLearning(card, step, minutes, lapses) {
  const next = minutesFromNow(minutes);
  return {
    card: {
      ...card,
      state: 'learning',
      step,
      lapses,
      nextReview: next.toISOString()
    },
    showInMinutes: minutes
  };
}

// Nachlernen mit Minuten-Intervall (bleibt in Session)
function buildRelearning(card, step, minutes, interval, easeFactor, lapses) {
  const next = minutesFromNow(minutes);
  return {
    card: {
      ...card,
      state: 'relearning',
      step,
      interval,
      easeFactor: round(easeFactor),
      lapses,
      nextReview: next.toISOString()
    },
    showInMinutes: minutes
  };
}

// Review-Karte mit Tages-Intervall (Session beendet für heute)
function buildReview(card, days, easeFactor, lapses) {
  const next = new Date();
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0); // Mitternacht
  return {
    card: {
      ...card,
      state: 'review',
      step: 0,
      interval: days,
      easeFactor: round(easeFactor),
      lapses,
      nextReview: next.toISOString()
    },
    showInMinutes: null // nicht mehr heute
  };
}

function minutesFromNow(minutes) {
  const d = new Date();
  d.setSeconds(d.getSeconds() + minutes * 60);
  return d;
}

function round(n) {
  return parseFloat(n.toFixed(2));
}
