/**
 * Ruft fetch() mit einem harten Zeit-Limit auf. Node's fetch() wartet ohne eigenes
 * Timeout im Zweifel UNBEGRENZT auf eine Antwort — hängt z.B. Render's Netzwerk oder
 * die Anthropic-API mal kurz, würde das den aufrufenden Code für immer blockieren.
 * Da wir Matching-Vorgänge serialisieren (siehe server.js, matchingLock), würde ein
 * einziger hängender Aufruf sonst die komplette Warteschlange für ALLE Nutzer
 * einfrieren. Nach Ablauf des Limits wird der Request abgebrochen und ein Fehler
 * geworfen, den der Aufrufer ganz normal per try/catch abfangen und auf einen
 * Fallback ausweichen kann.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchWithTimeout };
